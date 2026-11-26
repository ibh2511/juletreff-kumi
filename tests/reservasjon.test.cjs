// Kjør med: npm test. Reservert betaling uten navn: kobles bare når det er én aktuell reservasjon og én som nettopp
// trykket Vipps, og navnet sjekkes når banken bokfører den (sjekkBank_ i backend/Code.gs).
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const MIN = 60000;
let naa;
const KlokkeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [naa])); } static now() { return naa; } };
const props = {};
const ctx = { console, Date: KlokkeDate, JSON, Math, String, Number, Object, Array, encodeURIComponent,
  Utilities: { formatDate: d => new Date(d).toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'Europe/Oslo' },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8'), ctx);

let rader, bank, trans, bekreftet, varsler;
const K = ctx.BANK_KOLONNER, kol = (row, k) => row[K.indexOf(k)];
Object.assign(ctx, {
  bankKlar_: () => true, bankTransaksjoner_: () => trans, alle_: () => rader, arrangement_: () => ({ pris: 600 }),
  sheet_: () => ({ getDataRange: () => ({ getValues: () => [K, ...bank] }), appendRow: row => bank.push(row) }),
  oppdater_: (rad, felt) => Object.assign(rader.find(r => r._rad === rad), felt),
  oppdaterBankRad_: (row, felt) => Object.keys(felt).forEach(k => { bank[row - 2][K.indexOf(k)] = felt[k]; }),
  sendBekreftelse_: r => bekreftet.push(r.id), varsle_: emne => varsler.push(emne) });

const start = Date.UTC(2026, 10, 26, 12, 0, 0);
const pers = (id, fornavn, etternavn, tappet) => ({ id, fornavn, etternavn, belop: 600, status: 'UBETALT', notat: '', _rad: rader.length + 2,
  opprettet: new Date(start - 20 * MIN), vipps_apnet: tappet == null ? '' : new Date(start + tappet * MIN) });
const res = (id, navn = '', bokforing = 'PENDING') => ({ id, belop: 600, dato: '', navn, beskrivelse: 'Transaksjon',
  type: 'Straksbetaling', bokforing, tekst: [navn, 'Transaksjon Straksbetaling', bokforing].join(' ') });
const ny = () => { naa = start; rader = []; bank = []; trans = []; bekreftet = []; varsler = []; };
const status = id => kol(bank.find(b => kol(b, 'bank_id') === id), 'status');
const sjekk = (min = 0) => { naa = start + min * MIN; ctx.sjekkBank_(); };

// Én reservasjon, én som trykket Vipps for 3 minutter siden: kobles, og deltakeren får bekreftelsen
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3)); trans = [res('r1')]; sjekk();
assert.strictEqual(rader[0].status, 'BETALT');
assert.strictEqual(status('r1'), 'RESERVERT');
assert.deepStrictEqual(bekreftet, ['JT-1']);
assert.match(rader[0].notat, /uten navn koblet automatisk/);

// Banken bokfører den under en ny ID med navnet hennes: samme betaling, ingen «mulig dobbel betaling» og ingen varsel
trans = [res('b1', 'Kari Nordmann', 'BOOKED')]; sjekk(60);
assert.strictEqual(status('r1'), 'KOBLET');
assert.strictEqual(status('b1'), 'BOKFORT');
assert.deepStrictEqual(varsler, []);

// … eller under samme ID, med navnet
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3)); trans = [res('r1')]; sjekk();
trans = [res('r1', 'Kari Nordmann', 'BOOKED')]; sjekk(60);
assert.strictEqual(status('r1'), 'KOBLET');
assert.strictEqual(bank.length, 1);

// Bokført fra noen andre: raden må sjekkes, og du får varsel med en gang
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3)); trans = [res('r1')]; sjekk();
trans = [res('b1', 'Per Olsen', 'BOOKED')]; sjekk(60);
assert.strictEqual(status('r1'), 'SJEKK');
assert.strictEqual(status('b1'), 'UMATCHET');
assert.match(varsler[0], /Sjekk betalingen til Kari Nordmann/);

// Bokført under ny ID mens reservasjonen fortsatt står i listen: samme betaling, ikke «mulig dobbel betaling»
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3)); trans = [res('r1')]; sjekk();
trans = [res('r1'), res('b1', 'Kari Nordmann', 'BOOKED')]; sjekk(60);
assert.strictEqual(status('r1'), 'KOBLET');
assert.strictEqual(status('b1'), 'BOKFORT');

// Reservasjonen er borte, og Ola betaler sine 600 kr samtidig: Olas betaling kobles til Ola, ikke falsk alarm for Kari
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3), pers('JT-2', 'Ola', 'Hansen', null)); trans = [res('r1')]; sjekk();
trans = [res('o1', 'Ola Hansen', 'BOOKED')]; sjekk(10);
assert.strictEqual(status('r1'), 'RESERVERT');
assert.strictEqual(status('o1'), 'KOBLET');
assert.deepStrictEqual(varsler, []);

// Borte fra listen, men ikke bokført ennå: vent
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3)); trans = [res('r1')]; sjekk();
trans = [res('x', 'Noen', 'BOOKED')]; trans[0].belop = 250; sjekk(5);
assert.strictEqual(status('r1'), 'RESERVERT');
assert.deepStrictEqual(varsler, []);

// To reservasjoner på samme beløp: ingen kobling
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3)); trans = [res('r1'), res('r2')]; sjekk();
assert.strictEqual(rader[0].status, 'UBETALT');
assert.strictEqual(status('r1'), 'UMATCHET');

// To som nettopp trykket Vipps, men bare én reservasjon: ingen kobling
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3), pers('JT-2', 'Ola', 'Hansen', -20)); trans = [res('r1')]; sjekk();
assert.strictEqual(status('r1'), 'UMATCHET');

// Et gammelt Vipps-trykk (50 min) teller ikke med: Kari kobles
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3), pers('JT-2', 'Ola', 'Hansen', -50)); trans = [res('r1')]; sjekk();
assert.strictEqual(status('r1'), 'RESERVERT');
assert.strictEqual(rader[1].status, 'UBETALT');

// En gammel reservasjon uten navn (fra en time siden) teller ikke med
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3)); trans = [res('r0')]; sjekk(-60);
trans = [res('r0'), res('r1')]; sjekk();
assert.strictEqual(status('r0'), 'UMATCHET');
assert.strictEqual(status('r1'), 'RESERVERT');

// To reservasjoner og to som nettopp trykket: begge kobles
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3), pers('JT-2', 'Ola', 'Hansen', -1)); trans = [res('r1'), res('r2')]; sjekk();
assert.deepStrictEqual(rader.map(r => r.status), ['BETALT', 'BETALT']);
assert.deepStrictEqual([status('r1'), status('r2')], ['RESERVERT', 'RESERVERT']);
const kariFikk = rader[0].bank_id, olaFikk = rader[1].bank_id;
// Banken bokfører dem omvendt av hvordan de ble fordelt, og den ene får navn før den andre: ingen falsk alarm
trans = [res(kariFikk), res(olaFikk, 'Kari Nordmann', 'BOOKED')]; sjekk(30);
assert.deepStrictEqual(varsler, []);
assert.strictEqual(status(kariFikk), 'RESERVERT');
trans = [res(kariFikk, 'Ola Hansen', 'BOOKED'), res(olaFikk, 'Kari Nordmann', 'BOOKED')]; sjekk(60);
assert.deepStrictEqual([status('r1'), status('r2')], ['KOBLET', 'KOBLET']);
assert.deepStrictEqual(varsler, []);
// … men er ett av navnene feil, kommer varselet
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3), pers('JT-2', 'Ola', 'Hansen', -1)); trans = [res('r1'), res('r2')]; sjekk();
trans = [res('r1', 'Kari Nordmann', 'BOOKED'), res('r2', 'Per Olsen', 'BOOKED')]; sjekk(60);
assert.strictEqual(varsler.length, 1);
assert.match(varsler[0], /Ola Hansen/);

// To reservasjoner og tre som nettopp trykket: ingen kobling
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3), pers('JT-2', 'Ola', 'Hansen', -1), pers('JT-3', 'Per', 'Olsen', -5));
trans = [res('r1'), res('r2')]; sjekk();
assert.deepStrictEqual([status('r1'), status('r2')], ['UMATCHET', 'UMATCHET']);

// Trykket Vipps for 45 minutter siden: bare forslag i admin
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -45)); trans = [res('r1')]; sjekk();
assert.strictEqual(status('r1'), 'UMATCHET');
assert.strictEqual(kol(bank[0], 'pamelding'), 'JT-1');

// Ingen hadde trykket da reservasjonen kom. Trykker hun 5 minutter etter, kobles den («Jeg har betalt» på PC) …
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', null)); trans = [res('r1')]; sjekk();
assert.strictEqual(status('r1'), 'UMATCHET');
rader[0].vipps_apnet = new Date(start + 5 * MIN); sjekk(6);
assert.strictEqual(status('r1'), 'RESERVERT');
// … men ikke 20 minutter etter: da er reservasjonen trolig en annen betaling
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', null)); trans = [res('r1')]; sjekk();
rader[0].vipps_apnet = new Date(start + 20 * MIN); sjekk(21);
assert.strictEqual(status('r1'), 'UMATCHET');

// To reservasjoner og tre som trykket: når den tredje reservasjonen kommer, kobles alle (de to første ved neste sjekk)
ny(); rader.push(pers('JT-1', 'Kari', 'Nordmann', -3), pers('JT-2', 'Ola', 'Hansen', -1), pers('JT-3', 'Per', 'Olsen', 4));
trans = [res('r1'), res('r2')]; sjekk();
assert.deepStrictEqual(rader.map(r => r.status), ['UBETALT', 'UBETALT', 'UBETALT']);
trans = [res('r1'), res('r2'), res('r3')]; sjekk(5); sjekk(7);
assert.deepStrictEqual(rader.map(r => r.status), ['BETALT', 'BETALT', 'BETALT']);

console.log('reservasjon ok');
