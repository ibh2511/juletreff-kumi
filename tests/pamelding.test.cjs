// Kjør med: npm test. Påmelding, plasser, venteliste og utsendelser i backend/Code.gs, med regnearket,
// e-posten og låsen simulert i minnet.
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
const MIN = 60000, DOGN = 24 * 60 * MIN;
let naa = Date.UTC(2026, 10, 26, 12, 0, 0);
const KlokkeDate = class extends Date { constructor(...a) { super(...(a.length ? a : [naa])); } static now() { return naa; } };
const props = {}, cache = {}, ark = {}, eposter = [];
let laast = false, mailFeiler = false, mailUnderLas = 0, uuid = 0;
const lagArk = (navn) => {
  // Som i Google: ingen tomme rader nederst før insertRowAfter, og alle radene under den frosne kan ikke slettes
  const rader = [];
  let tomme = 0;
  return ark[navn] = {
    rader, appendRow: (r) => { tomme = Math.max(0, tomme - 1); rader.push(r.slice()); },
    getMaxRows: () => rader.length + tomme, insertRowAfter: () => { tomme++; },
    deleteRows: (row, n) => {
      if (rader.length + tomme - n <= 1) throw new Error('Sorry, it is not possible to delete all non-frozen rows.');
      rader.splice(row - 1, n);
    },
    copyTo: () => ({ setName() {} }), getParent: () => ({}),
    getDataRange: () => ({ getValues: () => rader.map((r) => r.slice()) }),
    getRange: (row, col) => ({ setValue: (v) => { rader[row - 1][col - 1] = v; }, setValues: (v) => { rader[row - 1] = v[0].slice(); } }),
    getLastColumn: () => (rader[0] || []).length, getLastRow: () => rader.length, setFrozenRows() {},
  };
};
const ctx = {
  console: { log() {}, error: (...a) => process.env.DEBUG && console.error(...a), warn() {} }, Date: KlokkeDate, JSON, Math, String, Number, Object, Array, RegExp, encodeURIComponent, Error,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
    setProperties: (o) => Object.assign(props, o), deleteProperty: (k) => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
  CacheService: { getScriptCache: () => ({ get: (k) => (cache[k] && cache[k].til > naa ? cache[k].v : null),
    put: (k, v, s) => { cache[k] = { v: String(v), til: naa + (s || 600) * 1000 }; }, remove: (k) => { delete cache[k]; } }) },
  LockService: { getScriptLock: () => ({ waitLock() { laast = true; }, tryLock: () => (laast = true), releaseLock() { laast = false; } }) },
  SpreadsheetApp: { openById: () => ({ getSheetByName: (n) => ark[n] || null, insertSheet: (n) => lagArk(n) }) },
  MailApp: { sendEmail: (til, emne) => { if (mailFeiler) throw new Error('kvote'); if (laast) mailUnderLas++; eposter.push({ til, emne }); } },
  Utilities: { getUuid: () => (++uuid).toString(16).padStart(32, '0'), formatDate: (d) => new Date(d).toISOString().slice(0, 10), sleep() {},
    computeDigest: (a, s) => Array.from(crypto.createHash('sha256').update(String(s)).digest()), base64Encode: (b) => Buffer.from(b).toString('base64'),
    newBlob: () => ({}), DigestAlgorithm: {}, Charset: {} },
  Session: { getScriptTimeZone: () => 'Europe/Oslo' },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { const c = { timeBased: () => c, everyMinutes: () => c, everyDays: () => c, atHour: () => c, create: () => c }; return c; } },
  ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: {} },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8'), ctx);
Object.assign(props, { KAPASITET: '2', VIPPS_NUMMER: '12345678', SVAR_EPOST: 'svar@x.no', ADMIN_PASSORD: 'et-langt-passord-123' });
const kall = (o) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(o) }, parameter: {} }));
const pm = (fornavn, epost, x = {}) => kall({ action: 'pamelding', fornavn, etternavn: 'Test', epost, telefon: '41234567', bindende: true, ...x });
const rad = (epost) => ctx.finn_('epost', epost);
const emner = (del) => eposter.filter((e) => e.emne.includes(del));

// Plasser og venteliste
const kari = pm('Kari', 'kari@x.no'), ola = pm('Ola', 'ola@x.no'), per = pm('Per', 'per@x.no');
assert.deepStrictEqual([kari.status, ola.status, per.waitlist], ['UBETALT', 'UBETALT', true]);

// Samme e-post igjen, med store bokstaver og mellomrom: ingen ny plass
const radAntall = () => ark['Påmeldinger'].rader.length;
const for_ = radAntall();
const igjen = pm('Kari', ' KARI@x.no ');
assert.deepStrictEqual([igjen.duplicate, igjen.ubetalt], [true, true]);
assert.strictEqual(radAntall(), for_);

// Roboter som fyller ut det skjulte feltet, får et falskt svar, og ingenting lagres
assert.ok(pm('Bot', 'bot@x.no', { nettside: 'http://spam' }).ok);
assert.strictEqual(radAntall(), for_);

// Trykket «Åpne Vipps» uten å betale: etter et døgn vises betalingsstegene igjen, og et nytt trykk huskes
const vippsApnet = (r) => kall({ action: 'status', id: r.id, k: r.k }).betalingsinfo.vippsApnet;
kall({ action: 'vipps', id: kari.id, k: kari.k });
assert.strictEqual(vippsApnet(kari), naa);
naa += 10 * MIN; kall({ action: 'vipps', id: kari.id, k: kari.k });
assert.strictEqual(vippsApnet(kari), naa - 10 * MIN, 'nytt trykk innen 30 minutter flytter ikke tidspunktet');
naa += 2 * DOGN;
assert.strictEqual(vippsApnet(kari), 0);
kall({ action: 'vipps', id: kari.id, k: kari.k });
assert.strictEqual(vippsApnet(kari), naa);

// Gi plassen videre: den nye arver ikke «betaler fra»-navnet eller Vipps-trykket
const okt = kall({ action: 'admin', passord: 'et-langt-passord-123' }).okt;
ctx.oppdater_(rad('kari@x.no')._rad, { vipps_navn: 'Partner Partnersen' });
assert.ok(kall({ action: 'endre', okt, id: kari.id, handling: 'overdra', fornavn: 'Lise', etternavn: 'Ny', epost: 'lise@x.no', telefon: '41234567' }).ok);
assert.deepStrictEqual([rad('lise@x.no').vipps_navn, rad('lise@x.no').vipps_apnet], ['', '']);

// Fellesmail: sendes utenfor låsen, én gang per person, og merket settes tilbake hvis e-posten feiler
kall({ action: 'endre', okt, id: ola.id, handling: 'betalt' });
mailFeiler = true;
assert.strictEqual(kall({ action: 'fellesmail', okt }).ok, false);
assert.strictEqual(rad('ola@x.no').program, '');
mailFeiler = false; mailUnderLas = 0;
assert.ok(kall({ action: 'fellesmail', okt }).ok);
assert.strictEqual(mailUnderLas, 0, 'ingen e-post sendt mens låsen holdes');
assert.match(kall({ action: 'fellesmail', okt }).error, /fra før/);

// Purring: merket under låsen, satt tilbake når e-posten feiler
naa += DOGN;
mailFeiler = true;
kall({ action: 'purring', okt });
mailFeiler = false;
assert.strictEqual(ctx.antallPurringer_(rad('lise@x.no')), 0);

// Morgenrapporten sender ikke betalingsinfo til den som nettopp meldte seg på og venter på banken
props.BANK_REFRESH_TOKEN = 'x'; props.BANK_ACCOUNT_KEY = 'x'; props.KAPASITET = '10';
const nina = pm('Nina', 'nina@x.no');
kall({ action: 'vipps', id: nina.id, k: nina.k });
const ninaFor = eposter.filter((e) => e.til === 'nina@x.no').length;
ctx.dagligRapport();
assert.strictEqual(eposter.filter((e) => e.til === 'nina@x.no').length, ninaFor);

// Banken: henter fra siste vellykkede sjekk, minst 3 og høyst 14 dager
const dager = [];
ctx.bankTransaksjoner_ = (d) => { dager.push(d); return []; };
delete props.BANK_SIST_SJEKKET; ctx.sjekkBank_();
props.BANK_SIST_SJEKKET = new Date(naa - 6 * DOGN).toISOString(); ctx.sjekkBank_();
props.BANK_SIST_SJEKKET = new Date(naa - 30 * DOGN).toISOString(); ctx.sjekkBank_();
ctx.sjekkBank_();
assert.deepStrictEqual(dager, [3, 7, 14, 3]);

// Mer enn 10 påmeldinger på 10 minutter: du får ett varsel
naa += DOGN;
for (let i = 0; i < 12; i++) pm('Mange' + i, 'mange' + i + '@x.no');
assert.strictEqual(emner('Mange påmeldinger').length, 1);

// Nullstill før lansering: alle fanene tømmes, også når de ikke har tomme rader nederst
const dag = (d) => new Date(naa + d * DOGN).toISOString().slice(0, 10);
const tx = (id, d, navn = 'Første Test', bokforing = 'BOOKED') => ({ id, belop: 600, dato: dag(d), navn, beskrivelse: '',
  type: 'Straksbetaling', bokforing, tekst: [navn, 'Straksbetaling', bokforing].join(' ') });
// En bokført testbetaling og en reservasjon uten navn fra i dag ligger i «Bank» når du nullstiller
let trans = [tx('test-i-dag', 0), tx('reservert-for', 0, '', 'PENDING')];
ctx.bankTransaksjoner_ = () => trans;
ctx.sjekkBank_();
ark['Påmeldinger'].rader.slice(1).forEach((r, i) => ctx.oppdater_(i + 2, { test: 'ja' }));
kall({ action: 'hit', v: 'a' }); kall({ action: 'hit', v: 'b' });
const nullstilt = kall({ action: 'nullstill', okt: kall({ action: 'admin', passord: 'et-langt-passord-123' }).okt, bekreft: 'NULLSTILL' });
assert.ok(nullstilt.ok, nullstilt.error);
assert.deepStrictEqual(['Påmeldinger', 'Besøk'].map((n) => ark[n].rader.length), [1, 1]);
const forste = pm('Første', 'forste@x.no');
assert.strictEqual(forste.id, 'JT-1001');

// Innbetalinger fra før nullstillingen kobles ikke til nye påmeldinger med samme navn: den som var lagret og en
// fra i går hoppes over, og reservasjonen fra før, bokført i dag under ny ID med navn, kobles ikke.
trans = [tx('test-i-dag', 0), tx('bokfort-i-gaar', -1), tx('reservert-for-bokfort', 0)];
ctx.sjekkBank_();
assert.strictEqual(rad('forste@x.no').status, 'UBETALT');
const bankRader = () => ark['Bank'].rader.slice(1).map((r) => [r[1], r[8]].join(':'));
assert.deepStrictEqual(bankRader(), ['reservert-for-bokfort:NULLSTILT']);
// En ny betaling samme dag kobles automatisk
trans.push(tx('ny-i-dag', 0));
ctx.sjekkBank_();
assert.strictEqual(rad('forste@x.no').status, 'BETALT');
assert.strictEqual(rad('forste@x.no').bank_id, 'ny-i-dag');

// Bryteren for egne innbetalinger: fra Isabelle Haugan og ikke prisen ignoreres, og lagrede skjules under ukoblede
const okt2 = kall({ action: 'admin', passord: 'et-langt-passord-123' }).okt;
const egne = (b) => kall({ action: 'innstillinger', okt: okt2, ignorerEgne: b });
const ukoblede = () => kall({ action: 'oversikt', okt: okt2 }).bankrader.map((b) => b.bankId).filter((id) => id.startsWith('meg-'));
pm('Isabelle', 'isabelle@x.no', { etternavn: 'Haugan' });
const fraMeg = (id, belop) => ({ ...tx(id, 0, 'Isabelle Haugan'), belop });
assert.ok(egne(false).ok);
trans.push(fraMeg('meg-450', 450));
ctx.sjekkBank_();
assert.deepStrictEqual(ukoblede(), ['meg-450'], 'av: vises som feil beløp');
assert.strictEqual(kall({ action: 'oversikt', okt: okt2 }).arrangement.ignorerEgne, false);
assert.ok(egne(true).ok);
assert.deepStrictEqual(ukoblede(), [], 'på: skjult');
const bankFor = ark['Bank'].rader.length, varslerFor = eposter.length;
trans.push(fraMeg('meg-1kr', 1));
ctx.sjekkBank_();
assert.deepStrictEqual([ark['Bank'].rader.length, eposter.length], [bankFor, varslerFor], 'på: ikke lagret, ingen varsel');
trans.push(fraMeg('meg-600', 600));
ctx.sjekkBank_();
assert.deepStrictEqual([rad('isabelle@x.no').status, rad('isabelle@x.no').bank_id], ['BETALT', 'meg-600']);

console.log('pamelding ok');
