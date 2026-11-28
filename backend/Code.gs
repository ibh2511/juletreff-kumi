/**
 * Juletreff på KUMI – påmeldingsbackend (Google Apps Script)
 *
 * Gjør dette:
 *  - Tar imot påmeldinger, sjekker ledige plasser og doble påmeldinger
 *  - To betalingsløsninger, som velges i adminsiden:
 *     Vipps bedrift: Vipps-avtalen (ePayment API). Deltakeren sendes til Vipps, betalingen sjekkes
 *                    direkte hos Vipps og beløpet trekkes.
 *     Vipps privat:  deltakeren vippser til et mobilnummer fra betalingssiden («Åpne Vipps» med nummeret
 *                    fylt ut, QR-kode på PC). Backend kan lese innbetalingene i SpareBank 1
 *                    og koble dem til påmeldingen på påmeldings-ID, navn og beløp. Uten bankkobling markerer
 *                    du betalingen som mottatt i adminsiden.
 *  - Sender bekreftelse på e-post
 *  - Logger sidebesøk uten informasjonskapsler og uten personopplysninger
 *  - Gir oversikt over påmeldinger, betaling og besøk til adminsiden, bak passord
 *
 * Ingen hemmeligheter ligger i nettsiden. Vipps-nøkler, banktilgang og adminpassord ligger bare i
 * Skriptegenskaper (Prosjektinnstillinger > Skriptegenskaper). Se backend/OPPSETT.md.
 */

// Regnearket i Drive-mappen «Juletreff KUMI 2026». Kan overstyres med SHEET_ID i Skriptegenskaper.
var STANDARD_SHEET_ID = '1uAHLTHwgjCizlvYMFi_SO28o5bhb1j6KD86dYPxc-4g';
// Facebook-eventet. Kan overstyres med FACEBOOK_URL i Skriptegenskaper.
var STANDARD_FACEBOOK_URL = 'https://www.facebook.com/events/664624256515915';

var PAMELDING_ARK = 'Påmeldinger';
var BESOK_ARK = 'Besøk';
// Betaling uten Vipps-avtale: et Vipps-nummer (5–6 sifre) eller et mobilnummer (8 sifre).
// Settes i adminsiden og lagres i Skriptegenskaper, så et privat nummer aldri ligger i koden.
// Det vises bare til den som har meldt seg på, i e-posten og på betalingssiden.
var STANDARD_VIPPS_NUMMER = '';
var STANDARD_VIPPS_NAVN = '';
/** «#12345» for Vipps-nummer, «12 34 56 78» for mobilnummer. */
function vippsTil_(nr) {
  var d = String(nr || '').replace(/\D/g, '');
  return d.length === 8 ? d.replace(/(\d{2})(?=\d)/g, '$1 ') : '#' + d;
}
function vippsErMobil_(nr) { return String(nr || '').replace(/\D/g, '').length === 8; }
// Kolonner i «Påmeldinger». Nye kolonner legges alltid til bakerst, så eksisterende ark virker videre.
//  betaling   'vipps' = Vipps bedrift (ePayment), 'manuell' = Vipps privat (til mobil- eller Vipps-nummeret)
//  vipps_navn navnet på Vipps-kontoen det betales fra, hvis deltakeren betaler fra en annens Vipps
//  bank_id    innbetalingen i banken som betalte plassen, eller «manuell» når admin markerte den
//  gebyr      Vipps-gebyret for salget (bare Vipps bedrift)
//  vipps_ref  referansen til siste betaling hos Vipps bedrift (påmeldings-ID, eller ID-2, ID-3 … ved ny betaling)
var KOLONNER = ['id', 'opprettet', 'status', 'fornavn', 'etternavn', 'epost', 'telefon', 'kommentar',
  'belop', 'betaling', 'nokkel', 'betalt', 'epost_sendt', 'bindende_godtatt', 'trukket', 'refundert', 'notat', 'kilde', 'refusjon', 'test', 'varslet', 'purret', 'program', 'purringer', 'mott', 'takket',
  'vipps_navn', 'bank_id', 'gebyr', 'vipps_ref', 'vipps_apnet'];
var BESOK_KOLONNER = ['tid', 'besokende', 'kilde', 'enhet'];
// Innbetalinger fra banken (Vipps privat). Bare de som kan gjelde juletreffet lagres.
var BANK_ARK = 'Bank';
var BANK_KOLONNER = ['sett', 'bank_id', 'dato', 'belop', 'navn', 'tekst', 'type', 'bokforing', 'status', 'pamelding', 'varslet'];
// En betaling som ikke kunne kobles, står ofte som «Transaksjon under behandling» uten navn. Den sjekkes på nytt
// ved hver banksjekk, og du får varsel først når den fortsatt ikke er koblet etter så mange timer.
var UMATCHET_VARSEL_TIMER = 2;

/**
 * Vipps-gebyret for et salg med Vipps bedrift (ePayment): prosent av beløpet + fast kronebeløp per salg.
 * Satsen står fast her og lagres på hvert salg, så adminsiden kan vise gebyr og netto. Endrer Vipps
 * satsen i avtalen, endres tallene under. Vipps privat har ikke gebyr.
 */
var GEBYR_PROSENT = 2.99;
var GEBYR_KR = 1;
function gebyr_(kr) {
  return Math.round((Number(kr) * GEBYR_PROSENT / 100 + GEBYR_KR) * 100) / 100;
}

/**
 * Lenke (og QR-kode) som åpner Vipps med mottakeren fylt ut. Formatet er det Vipps dokumenterer for
 * personlige QR-koder i Norge, med landskoden 47 foran mobilnummeret:
 *   https://qr.vipps.no/28/2/01/031/4712345678?v=1
 *   (developer.vippsmobilepay.com/docs/APIs/epayment-api/api-guide/features/personal-qr/)
 * Uten 47 åpnet Vipps seg, men ble stående og laste. Beløp og melding står ikke i formatet og ble ikke
 * fylt ut i testen, så de er ikke med. Deltakeren skriver beløpet selv. Virker bare for mobilnummer.
 */
function vippsLenke_(nr) {
  var d = String(nr || '').replace(/\D/g, '');
  if (d.length === 10 && d.slice(0, 2) === '47') d = d.slice(2);
  if (d.length !== 8) return '';
  return 'https://qr.vipps.no/28/2/01/031/47' + d + '?v=1';
}

/** Det som skal stå i Vipps-meldingen. Påmeldings-ID-en gjør at banken kan koble betalingen sikkert. */
function vippsMelding_(r) { return ('Juletreff ' + r.id + ' ' + r.fornavn + ' ' + r.etternavn).slice(0, 50); }

/** Betalingssiden for en påmelding: viser «Åpne Vipps» (privat) eller «Betal med Vipps» (bedrift). */
function betalingsside_(r) {
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  return site + '/?betaling=' + encodeURIComponent(r.id) + '&k=' + encodeURIComponent(r.nokkel || '');
}

// Statuser:
//  VENTER      sendt til Vipps, ikke betalt ennå (holder plassen i 30 minutter)
//  BETALT      betalt med Vipps, eller markert som betalt i adminsiden
//  UBETALT     påmeldt uten Vipps-avtale, skal betale til Vipps-nummeret (holder plassen)
//  AVBRUTT     avbrøt eller lot være å betale i Vipps (holder ikke plass)
//  VENTELISTE  meldte seg på da det var fullt
//  TRUKKET     trukket med legeerklæring (eller av arrangør)
var HOLDER_PLASS = ['BETALT', 'UBETALT'];

// Testpåmeldinger fra adminsiden har «ja» i kolonnen «test». De teller ikke som plasser,
// er ikke med i tall, deltakerliste eller innbetalt, og kan slettes fra adminsiden.
function erTest_(r) { return r && (r.test === 'ja' || r.test === true); }
var VENTER_MINUTTER = 30;

/* ------------------------------------------------------------------ */
/* Testlenke: hele påmeldingen med 1 kr, bare for den som har lenken   */
/* ------------------------------------------------------------------ */

// Påmeldingen går gjennom det samme som en ekte: skjemaet på nettsiden, betalingssiden, Vipps, banken og
// e-postene. Den merkes som test, tar ikke plass og telles ikke. Lenken virker også når det er fullt
// eller fristen har gått ut, så du kan teste når som helst.
var TESTPRIS_KR = 1;
var TESTLENKE_TIMER = 2;

/** Lenken som er aktiv nå, eller null. Bare én lenke gjelder om gangen, og den går ut av seg selv. */
function aktivTestlenke_() {
  var lagret = cfg_('TESTLENKE', '');
  if (!lagret) return null;
  var t;
  try { t = JSON.parse(lagret); } catch (e) { return null; }
  if (!t || !t.kode || !(Date.now() < new Date(t.utloper).getTime())) return null;
  return t;
}

function testprisGyldig_(kode) {
  var t = aktivTestlenke_();
  return !!(t && kode && String(kode) === t.kode);
}

function testlenkeInfo_() {
  var t = aktivTestlenke_();
  if (!t) return null;
  return { url: cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '') + '/?testpris=' + t.kode,
    utloper: t.utloper, belop: TESTPRIS_KR };
}

/** Admin: lager en ny testlenke (den gamle slutter å virke), eller stopper den som er aktiv. */
function adminTestlenke_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('testlenke', 10);
  var props = PropertiesService.getScriptProperties();
  if (p.stopp === true || p.stopp === 'true' || p.stopp === '1') {
    props.deleteProperty('TESTLENKE');
    return { ok: true, testlenke: null, melding: 'Testlenken er stoppet. Alle ser vanlig pris.' };
  }
  var utloper = new Date(Date.now() + TESTLENKE_TIMER * 36e5);
  props.setProperty('TESTLENKE', JSON.stringify({ kode: nyNokkel_(24), utloper: utloper.toISOString() }));
  return { ok: true, testlenke: testlenkeInfo_(),
    melding: 'Testlenken er klar og virker til kl. ' + Utilities.formatDate(utloper, 'Europe/Oslo', 'HH:mm') + '. Åpne den på mobilen.' };
}

/* ------------------------------------------------------------------ */
/* Innstillinger                                                       */
/* ------------------------------------------------------------------ */

function cfg_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (v === null || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('Mangler skriptegenskap: ' + key);
  }
  return v;
}

function arrangement_() {
  return {
    pris: Number(cfg_('PRIS', '600')),
    dato: cfg_('DATO_TEKST', 'Fredag 18. desember kl. 18.30'),
    sted: cfg_('STED', 'KUMI, Operagata 71B, Oslobukta'),
    frist: new Date(cfg_('PAMELDINGSFRIST', '2026-12-16T23:59:59+01:00')),
    fristTekst: cfg_('FRIST_TEKST', 'onsdag 16. desember'),
    kapasitet: Number(cfg_('KAPASITET', '30')),
    // Trekk med legeerklæring under 48 timer før start: vi beholder no-show-gebyret til KUMI
    start: new Date(cfg_('ARR_START', '2026-12-18T18:30:00+01:00')),
    // Når kvelden er slutt, for «Legg i kalenderen»: middagen på KUMI og MUNCH bar etterpå
    slutt: new Date(cfg_('ARR_SLUTT', '2026-12-18T23:00:00+01:00')),
    noshow: Number(cfg_('NOSHOW_GEBYR', '300')),
    vippsNummer: cfg_('VIPPS_NUMMER', STANDARD_VIPPS_NUMMER),
    vippsNavn: cfg_('VIPPS_NAVN', STANDARD_VIPPS_NAVN),
    // Valget i adminsiden. Vipps bedrift brukes bare når det er valgt OG nøklene finnes.
    // VIPPS_MODUS: 'api' = Vipps bedrift, 'nummer' = Vipps privat.
    vippsModus: cfg_('VIPPS_MODUS', 'nummer') === 'api' ? 'api' : 'nummer',
    vippsAktiv: cfg_('VIPPS_MODUS', 'nummer') === 'api' && harVippsNokler_()
  };
}

/** «bedrift» (Vipps-avtalen) eller «privat» (vippse til nummeret). */
function betalingsmate_() { return arrangement_().vippsAktiv ? 'bedrift' : 'privat'; }

/** Alle fire Vipps-nøklene må ligge i Skriptegenskaper før API-et kan slås på. */
function harVippsNokler_() {
  return ['VIPPS_CLIENT_ID', 'VIPPS_CLIENT_SECRET', 'VIPPS_SUBSCRIPTION_KEY', 'VIPPS_MSN']
    .every(function (k) { return !!cfg_(k, ''); });
}

/** Lenken til Facebook-eventet. Settes i adminsiden. Bare ekte Facebook-adresser godtas. */
function gyldigFacebookUrl_(u) {
  return /^https:\/\/((www|m|web)\.)?(facebook\.com|fb\.me)\/[A-Za-z0-9\/?&=._%\-]{1,300}$/.test(String(u || ''));
}
function facebookUrl_() {
  var u = cfg_('FACEBOOK_URL', STANDARD_FACEBOOK_URL);
  return gyldigFacebookUrl_(u) ? u : STANDARD_FACEBOOK_URL;
}

function vippsBase_() {
  return cfg_('VIPPS_ENV', 'test') === 'prod' ? 'https://api.vipps.no' : 'https://apitest.vipps.no';
}

function sheet_(name) {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID', STANDARD_SHEET_ID));
  var sh = ss.getSheetByName(name);
  var kol = name === PAMELDING_ARK ? KOLONNER : name === BANK_ARK ? BANK_KOLONNER : BESOK_KOLONNER;
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(kol);
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < kol.length) {
    sh.getRange(1, 1, 1, kol.length).setValues([kol]);
  }
  return sh;
}

/* ------------------------------------------------------------------ */
/* Web-app-inngang                                                     */
/* ------------------------------------------------------------------ */

function doGet(e) { return route_(e, null); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) {}
  return route_(e, body);
}

/** Feil som trygt kan vises til den som bruker siden. Alt annet blir en nøytral melding. */
function Brukerfeil(melding) { this.message = melding; this.bruker = true; }

// Bare disse kan kalles med GET. Alt som endrer noe, og alt i admin, må sendes med POST,
// så verken passord eller innloggingsnøkkel havner i en nettadresse.
var GET_HANDLINGER = ['info', 'status', 'hit'];
var OFFENTLIGE = ['info', 'pamelding', 'status', 'hit', 'betal', 'navn'];

function route_(e, body) {
  var p = Object.assign({}, (e && e.parameter) || {}, body || {});
  // SpareBank 1 sender nettleseren hit etter BankID-innloggingen. Svaret er en vanlig nettside.
  if (p.action === 'bank' && !body) return bankCallback_(p);
  var admin = OFFENTLIGE.indexOf(p.action) < 0;
  try {
    if (!body && p.action && GET_HANDLINGER.indexOf(p.action) < 0) return json_({ ok: false, error: 'Ugyldig forespørsel' });
    switch (p.action) {
      case 'info':      begrens_('info', 300); return json_(info_(p));
      case 'pamelding': begrens_('pamelding', 60); return json_(pamelding_(p));
      case 'status':    begrens_('status', 240); return json_(sjekkBetaling_(p.id, p.k, false, p.sjekk === '1' || p.sjekk === true));
      case 'betal':     begrens_('betal', 30); return json_(betalBedrift_(p));
      case 'navn':      begrens_('navn', 30); return json_(endreVippsNavn_(p));
      case 'vipps':     begrens_('vipps', 60); return json_(meldVipps_(p));
      case 'hit':       begrens_('hit', 300); return json_(hit_(p));
      case 'admin':     return json_(adminLogin_(p.passord));
      case 'logout':    return json_(adminLogout_(p.okt));
      case 'oversikt':  return json_(adminOversikt_(p.okt));
      case 'endre':     return json_(adminEndre_(p));
      case 'innstillinger': return json_(adminInnstillinger_(p));
      case 'testpamelding': return json_(adminTestpamelding_(p));
      case 'leggtil': return json_(adminLeggTil_(p));
      case 'testlenke': return json_(adminTestlenke_(p));
      case 'varsleventeliste': return json_(adminVarsleVenteliste_(p));
      case 'nullstill': return json_(adminNullstill_(p));
      case 'purring': return json_(adminPurring_(p));
      case 'rapport': return json_(adminRapport_(p));
      case 'fellesmail': return json_(adminFellesmail_(p));
      case 'takkemail': return json_(adminTakkemail_(p));
      case 'slettdata': return json_(adminSlettData_(p));
      case 'vippssjekk': return json_(adminVippsSjekk_(p));
      case 'bankstart': return json_(adminBankStart_(p));
      case 'bankkontoer': return json_(adminBankKontoer_(p));
      case 'banktest': return json_(adminBankTest_(p));
      case 'koble': return json_(adminKoble_(p));
      case 'ignorer': return json_(adminIgnorer_(p));
      default:          return json_({ ok: true, info: 'Juletreff KUMI API' });
    }
  } catch (err) {
    console.error(err && err.stack || err);
    // Innloggede administratorer får se hele feilen. Besøkende får bare feil som er ment for dem,
    // så svar fra Vipps eller Google aldri lekker ut.
    var vis = (err && err.bruker) || (admin && sjekkOkt_(p.okt));
    return json_({ ok: false, error: vis ? String(err.message || err) : 'Noe gikk galt. Prøv igjen om litt.' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Offentlig info: pris, dato og ledige plasser                        */
/* ------------------------------------------------------------------ */

function info_(p) {
  var a = arrangement_();
  var opptatt = opptatte_(alle_());
  var svar = {
    ok: true, pris: a.pris, dato: a.dato, sted: a.sted, fristTekst: a.fristTekst, kapasitet: a.kapasitet,
    stengt: Date.now() > a.frist.getTime(),
    ledige: Math.max(0, a.kapasitet - opptatt), fullt: opptatt >= a.kapasitet,
    vippsAktiv: a.vippsAktiv, betaling: a.vippsAktiv ? 'bedrift' : 'privat', noshow: a.noshow, start: a.start.toISOString(),
    facebookUrl: facebookUrl_(),
    // Samme adresse som står som svaradresse i e-postene, så den er allerede offentlig
    kontaktEpost: cfg_('SVAR_EPOST', '')
  };
  // Testlenken: 1 kr, og skjemaet vises selv om det er fullt eller fristen er ute. Alle andre ser vanlig pris.
  if (testprisGyldig_(p && p.testpris)) {
    Object.assign(svar, { pris: TESTPRIS_KR, test: true, testUtloper: aktivTestlenke_().utloper, stengt: false, fullt: false,
      ledige: Math.max(1, svar.ledige) });
  }
  return svar;
}

/** Antall plasser som er tatt: betalt, ubetalt (manuell Vipps) og ferske Vipps-betalinger som venter. */
function opptatte_(rader) {
  var grense = Date.now() - VENTER_MINUTTER * 60000;
  return rader.filter(function (r) {
    if (erTest_(r)) return false;
    return HOLDER_PLASS.indexOf(r.status) >= 0 || (r.status === 'VENTER' && new Date(r.opprettet).getTime() > grense);
  }).length;
}

/* ------------------------------------------------------------------ */
/* Påmelding                                                           */
/* ------------------------------------------------------------------ */

/** admin: lagt til fra adminsiden. Tar en plass, men fristen gjelder ikke, telefon kan mangle, og p.betalt gir BETALT. */
function pamelding_(p, test, admin) {
  // Skjult felt som mennesker ikke ser. Roboter fyller det ut, og får et «ok» uten at noe lagres.
  if (!test && tekst_(p.nettside, 50)) return { ok: true, waitlist: true };
  var a = arrangement_();
  var d = {
    fornavn: tekst_(p.fornavn, 60), etternavn: tekst_(p.etternavn, 60),
    epost: tekst_(p.epost, 120).toLowerCase(), telefon: formatPhone_(tekst_(p.telefon, 20)),
    kommentar: tekst_(p.kommentar, 500)
  };
  if (!d.fornavn || !d.etternavn) return { ok: false, error: 'Skriv inn fornavn og etternavn' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.epost)) return { ok: false, error: 'Skriv inn en gyldig e-postadresse' };
  if (!(admin && !d.telefon) && String(d.telefon).replace(/\D/g, '').length < 8) return { ok: false, error: 'Skriv inn et gyldig telefonnummer' };
  if (!test && !admin && !(p.bindende === true || p.bindende === 'true' || p.bindende === '1')) {
    return { ok: false, error: 'Du må bekrefte at påmeldingen er bindende' };
  }
  var testlenke = !test && testprisGyldig_(p.testpris);
  if (!test && !admin && !testlenke && Date.now() > a.frist.getTime()) return { ok: false, stengt: true, error: 'Påmeldingen er stengt' };
  if (testlenke) test = true; // videre gjelder alt som for en testpåmelding fra admin

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var rad, ubetalt, mange = false;
  try {
    var rader = alle_();
    var grense = Date.now() - VENTER_MINUTTER * 60000;
    // Testpåmeldinger sjekkes ikke mot ekte påmeldinger, og ekte påmeldinger ikke mot tester.
    var tidligere = test ? [] : rader.filter(function (r) { return r.epost === d.epost && !erTest_(r); });
    var holder = tidligere.filter(function (r) { return HOLDER_PLASS.indexOf(r.status) >= 0; });
    if (holder.some(function (r) { return r.status === 'BETALT'; })) return { ok: true, duplicate: true };
    // Påmeldt, men ikke betalt: betalingslenken sendes på nytt etter låsen (under).
    ubetalt = holder[0];
    if (!ubetalt) {
      // En tidligere påbegynt Vipps-betaling som ikke ble fullført, avbrytes før vi lager en ny.
      tidligere.forEach(function (r) {
        if (r.status === 'VENTER') {
          if (new Date(r.opprettet).getTime() > grense) avbrytVipps_(aktivRef_(r) || r.id);
          oppdater_(r._rad, { status: 'AVBRUTT' });
          r.status = 'AVBRUTT'; // så plassen ikke telles som opptatt under
        }
      });

      var fullt = !test && opptatte_(rader) >= a.kapasitet;
      if (fullt && admin) return { ok: false, error: 'Det er ingen ledige plasser. Øk antall plasser under Innstillinger først, hvis du vil legge til likevel.' };
      if (fullt && tidligere.some(function (r) { return r.status === 'VENTELISTE'; })) {
        return { ok: true, waitlist: true };
      }

      rad = {}; KOLONNER.forEach(function (k) { rad[k] = ''; });
      Object.assign(rad, d);
      rad.id = nesteId_();
      rad.opprettet = new Date();
      rad.belop = testlenke ? TESTPRIS_KR : a.pris;
      rad.nokkel = nyNokkel_();
      rad.bindende_godtatt = test || admin ? '' : new Date();
      rad.kilde = testlenke ? 'testlenke' : test ? 'admin-test' : admin ? 'admin' : tekst_(p.kilde, 60);
      rad.test = test ? 'ja' : '';
      if (test) rad.notat = testlenke ? 'Test med ' + TESTPRIS_KR + ' kr fra testlenken' : 'Testpåmelding fra admin';
      rad.status = fullt ? 'VENTELISTE' : a.vippsAktiv ? 'VENTER' : 'UBETALT';
      rad.betaling = fullt ? '' : a.vippsAktiv ? 'vipps' : 'manuell';
      if (rad.status === 'VENTER') rad.vipps_ref = rad.id;
      if (admin) {
        Object.assign(rad, { status: p.betalt ? 'BETALT' : 'UBETALT', betaling: 'manuell', vipps_ref: '',
          notat: 'Lagt til i admin' + (p.betalt ? ', markert betalt' : '') });
        if (p.betalt) Object.assign(rad, { betalt: new Date(), bank_id: 'manuell', gebyr: 0 });
      }
      sheet_(PAMELDING_ARK).appendRow(KOLONNER.map(function (k) { return celle_(rad[k]); }));
      // Mer enn 10 på 10 minutter kan være falske påmeldinger som tar plassene
      mange = !test && rader.filter(function (r) { return !erTest_(r) && new Date(r.opprettet).getTime() > Date.now() - 10 * 60000; }).length >= 10;
      if (rad.status !== 'VENTELISTE') {
        tidligere.forEach(function (r) {
          if (r.status === 'VENTELISTE') oppdater_(r._rad, { status: 'AVBRUTT', notat: [r.notat, 'Meldte seg på igjen og fikk plass (' + rad.id + ')'].filter(String).join(' | ') });
        });
      }
    }
  } finally { lock.releaseLock(); }
  // Samme tekst hver gang, så varsle_ sender den høyst hver 6. time
  if (mange) varsle_('Mange påmeldinger på kort tid', 'Det har kommet mer enn 10 påmeldinger de siste 10 minuttene. ' +
    'Sjekk i admin at de er ekte. Falske påmeldinger kan du trekke, så plassene blir ledige igjen.');

  // Den som melder seg på igjen uten å ha betalt, får betalingslenken på e-post på nytt, og siden sier fra om det.
  // Siden viser ikke selve betalingen, for den viser navnet til hvem som helst som skriver inn e-postadressen.
  if (ubetalt) return { ok: true, duplicate: true, ubetalt: true, sendt: sendBetalingIgjen_(ubetalt) };

  if (rad.status === 'BETALT') return { ok: true, status: 'BETALT', id: rad.id, sendt: sendBekreftelse_(rad) };

  if (rad.status === 'VENTELISTE') {
    sendVentelisteEpost_(rad);
    return { ok: true, waitlist: true };
  }

  if (rad.status === 'UBETALT') {
    // Vipps privat: banken sjekkes ofte de neste døgnene, så betalingen blir funnet raskt.
    venterPaBank_();
    // Med banken koblet til venter e-posten med betalingsinfo i EPOST_VENT_MIN minutter. Betaler deltakeren
    // med en gang, får de bare bekreftelsen. Testpåmeldinger fra admin får e-posten med en gang.
    var vent = bankKlar_() && !(test && !testlenke);
    if (!vent) sendBekreftelse_(rad);
    return { ok: true, status: 'UBETALT', id: rad.id, k: rad.nokkel, belop: rad.belop, fornavn: rad.fornavn, test: erTest_(rad),
      epostVent: vent ? EPOST_VENT_MIN : 0,
      epost: maskEmail_(rad.epost), betalingsinfo: betalingsinfo_(rad) };
  }

  try {
    var res = opprettVippsBetaling_(rad, rad.id, test);
    return { ok: true, status: 'VENTER', id: rad.id, k: rad.nokkel, redirectUrl: res.redirectUrl };
  } catch (err) {
    var o = finn_('id', rad.id);
    if (o) oppdater_(o._rad, { status: 'AVBRUTT', notat: 'Vipps-feil: ' + String(err.message).slice(0, 200) });
    vippsFeilVarsel_(err);
    throw new Brukerfeil('Vi fikk ikke kontakt med Vipps. Prøv igjen om litt.');
  }
}

/**
 * Sender e-posten med betalingslenken på nytt til en påmelding som ikke er betalt. Høyst én gang i kvarteret
 * per påmelding, så skjemaet ikke kan brukes til å fylle innboksen til noen. Svarer true når den er sendt nå
 * eller nylig.
 */
function sendBetalingIgjen_(r) {
  var cache = CacheService.getScriptCache(), nokkel = 'betaling_igjen_' + r.id;
  if (cache.get(nokkel)) return true;
  var sendt = sendBekreftelse_(r) === true;
  if (sendt) cache.put(nokkel, '1', 15 * 60);
  return sendt;
}

/** Lager en betaling hos Vipps bedrift. ref er påmeldings-ID-en, eller ID-2, ID-3 … når samme plass betales på nytt. */
function opprettVippsBetaling_(r, ref, test) {
  return vipps_('post', '/epayment/v1/payments', {
    amount: { currency: 'NOK', value: Math.round(Number(r.belop) * 100) },
    paymentMethod: { type: 'WALLET' },
    reference: ref,
    userFlow: 'WEB_REDIRECT',
    returnUrl: betalingsside_(r),
    paymentDescription: (test || erTest_(r) ? 'TEST ' : '') + 'Juletreff på KUMI – ' + r.fornavn + ' ' + r.etternavn
  }, 'create-' + ref);
}

/**
 * Vipps bedrift virker ikke: du får e-post med feilen og hva du kan gjøre, høyst én gang i timen.
 * Deltakeren ser bare «Vi fikk ikke kontakt med Vipps».
 */
function vippsFeilVarsel_(err) {
  console.error('Vipps bedrift feilet: ' + err);
  var cache = CacheService.getScriptCache();
  if (cache.get('vipps_feil_varslet')) return;
  cache.put('vipps_feil_varslet', '1', 3600);
  var m = String((err && err.message) || err);
  varsle_('Vipps bedrift virker ikke', 'Noen prøvde å melde seg på, men Vipps svarte med en feil, så de kom ikke videre til betaling.\n\n' +
    vippsFeilForklart_(m) + '\n\nFeilmelding fra Vipps: ' + m.slice(0, 1500) +
    '\n\nI adminsiden kan du trykke «Test Vipps bedrift» under Betaling, eller bytte til Vipps privat så lenge.');
}

/**
 * «Betal med Vipps» på betalingssiden for en plass som ikke er betalt ennå (for eksempel fra ventelisten,
 * eller når betalingen ble avbrutt). Gjelder når Vipps bedrift er i bruk. Plassen beholdes mens deltakeren betaler.
 */
function betalBedrift_(p) {
  if (!/^JT-\d{4,}$/.test(p.id || '')) throw new Brukerfeil('Fant ikke påmeldingen');
  if (!arrangement_().vippsAktiv) return { ok: false, error: 'Betal med Vipps til nummeret som står på siden.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var o, ref;
  try {
    o = finn_('id', p.id);
    if (!o || !p.k || String(p.k) !== String(o.nokkel)) throw new Brukerfeil('Fant ikke påmeldingen');
    if (o.status === 'BETALT') return { ok: true, status: 'BETALT' };
    if (o.status !== 'UBETALT') throw new Brukerfeil('Påmeldingen venter ikke på betaling');
  } finally { lock.releaseLock(); }
  // En tidligere betaling kan være godkjent i en annen fane. Da fullføres den i stedet for å lage en ny.
  if (aktivRef_(o)) {
    var forrige = sjekkBetaling_(o.id, null, true);
    if (forrige.status === 'BETALT') return { ok: true, status: 'BETALT' };
  }
  lock.waitLock(15000);
  try {
    o = finn_('id', p.id);
    if (o.status !== 'UBETALT') return { ok: true, status: o.status };
    // Ny referanse for hver betaling, fordi Vipps ikke godtar samme referanse to ganger.
    var forrigeRef = String(o.vipps_ref || '').replace(/^~/, '');
    var m = forrigeRef.match(/^JT-\d+-(\d+)$/);
    ref = !forrigeRef ? o.id : o.id + '-' + (m ? Number(m[1]) + 1 : 2);
    oppdater_(o._rad, { vipps_ref: ref, betaling: 'vipps' });
  } finally { lock.releaseLock(); }
  try {
    var res = opprettVippsBetaling_(o, ref);
    return { ok: true, status: 'VENTER', redirectUrl: res.redirectUrl };
  } catch (err) {
    vippsFeilVarsel_(err);
    throw new Brukerfeil('Vi fikk ikke kontakt med Vipps. Prøv igjen om litt.');
  }
}

/**
 * Det betalingssiden og e-postene trenger for å vise betalingen. Vipps-nummeret sendes bare til den
 * som har meldt seg på (svaret krever den hemmelige nøkkelen).
 */
function betalingsinfo_(r) {
  var a = arrangement_();
  var nr = String(a.vippsNummer || '').replace(/\D/g, '');
  return {
    losning: a.vippsAktiv ? 'bedrift' : 'privat',
    belop: Number(r.belop), id: r.id,
    nr: nr, mottaker: nr ? vippsTil_(nr) : '', mobil: vippsErMobil_(nr), vippsNavn: a.vippsNavn,
    lenke: vippsLenke_(nr), melding: vippsMelding_(r),
    fraNavn: r.vipps_navn || (r.fornavn + ' ' + r.etternavn),
    // Når deltakeren trykket «Åpne Vipps» (ms), så betalingssiden viser kvitteringen og ikke stegene.
    // Etter et døgn uten betaling vises stegene igjen, slik purringen også regner.
    vippsApnet: r.vipps_apnet && Date.now() - new Date(r.vipps_apnet).getTime() < 24 * 36e5 ? new Date(r.vipps_apnet).getTime() : 0,
    automatisk: bankKlar_()
  };
}

/** Betalingssiden sier fra når deltakeren trykker «Åpne Vipps» eller kopierer nummeret (se VIPPS_VENT_MIN). */
function meldVipps_(p) {
  if (!/^JT-\d{4,}$/.test(p.id || '')) throw new Brukerfeil('Fant ikke påmeldingen');
  var o = finn_('id', p.id);
  if (!o || !p.k || String(p.k) !== String(o.nokkel)) throw new Brukerfeil('Fant ikke påmeldingen');
  // Et nytt trykk teller når det forrige er over 30 minutter gammelt, for eksempel når de betaler dager senere.
  if (o.status === 'UBETALT' && !(o.vipps_apnet && Date.now() - new Date(o.vipps_apnet).getTime() < 30 * 60000)) {
    oppdater_(o._rad, { vipps_apnet: new Date() });
  }
  return { ok: true };
}

/** Deltakeren betaler fra en annens Vipps (for eksempel en partner): navnet banken skal se etter. */
function endreVippsNavn_(p) {
  var o = finn_('id', p.id);
  if (!o || !p.k || String(p.k) !== String(o.nokkel)) throw new Brukerfeil('Fant ikke påmeldingen');
  if (o.status !== 'UBETALT') return { ok: false, error: 'Påmeldingen venter ikke på betaling' };
  var navn = tekst_(p.navn, 80).replace(/\s+/g, ' ');
  if (navnOrd_(navn).length < 2) return { ok: false, error: 'Skriv fullt navn, slik det står i Vipps.' };
  oppdater_(o._rad, { vipps_navn: navn });
  return { ok: true, navn: navn };
}

/**
 * Kalles fra betalingssiden (også når deltakeren kommer tilbake fra Vipps) og fra tidsstyrt utløser.
 * Trygg å kalle mange ganger. Nettsiden må sende med den hemmelige nøkkelen, så ingen kan se andres påmelding.
 * Med sjekkBanken spør backend også banken (Vipps privat), høyst hvert 20. sekund.
 */
function sjekkBetaling_(id, nokkel, fraUtloser, sjekkBanken) {
  if (!/^JT-\d{4,}$/.test(id || '')) throw new Brukerfeil('Fant ikke påmeldingen');
  var forst = finn_('id', id);
  if (!forst || !(fraUtloser || (nokkel && String(nokkel) === String(forst.nokkel)))) throw new Brukerfeil('Fant ikke påmeldingen');
  // Vipps privat: betalingen finnes i banken, ikke hos Vipps.
  if (forst.status === 'UBETALT' && !aktivRef_(forst)) {
    if (sjekkBanken && bankKlar_()) {
      try { sjekkBankHvisLenge_(BANK_MELLOMROM_SEK); } catch (err) { console.error('Banksjekk feilet: ' + err); }
      forst = finn_('id', id);
    }
    return statusSvar_(forst);
  }
  if (forst.status !== 'VENTER' && !(forst.status === 'UBETALT' && aktivRef_(forst))) return statusSvar_(forst);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var o = finn_('id', id);
    if (o.status !== 'VENTER' && !(o.status === 'UBETALT' && aktivRef_(o))) return statusSvar_(o);
    var ref = aktivRef_(o) || o.id;
    var pay = vipps_('get', '/epayment/v1/payments/' + encodeURIComponent(ref));
    if (pay.state === 'CREATED') return statusSvar_(o, o.status === 'VENTER' ? 'VENTER' : 'UBETALT');
    if (pay.state !== 'AUTHORIZED') {
      if (o.status === 'VENTER') {
        oppdater_(o._rad, { status: 'AVBRUTT', notat: 'Vipps: ' + pay.state });
        o.status = 'AVBRUTT';
      } else {
        // Plassen er gitt (venteliste eller tidligere påmelding), så den beholdes. Deltakeren kan prøve igjen.
        oppdater_(o._rad, { vipps_ref: '~' + ref, notat: [o.notat, 'Vipps: ' + pay.state].filter(String).join(' | ').slice(-500) });
        o.vipps_ref = '~' + ref;
      }
      return statusSvar_(o);
    }
    // Betalt etter at reservasjonen på 30 minutter gikk ut, og plassen er gitt til en annen:
    // reservasjonen i Vipps oppheves, så ingenting trekkes.
    if (o.status === 'VENTER' && !erTest_(o) && new Date(o.opprettet).getTime() <= Date.now() - VENTER_MINUTTER * 60000 &&
        opptatte_(alle_()) >= arrangement_().kapasitet) {
      avbrytVipps_(ref);
      oppdater_(o._rad, { status: 'AVBRUTT', notat: 'Betalte for sent, det var fullt. Beløpet er ikke trukket.' });
      o.status = 'AVBRUTT';
      return statusSvar_(o);
    }
    // Plassen er reservert, så beløpet trekkes med en gang.
    vipps_('post', '/epayment/v1/payments/' + encodeURIComponent(ref) + '/capture',
      { modificationAmount: { currency: 'NOK', value: pay.amount.value } }, 'capture-' + ref);
    oppdater_(o._rad, { status: 'BETALT', betalt: new Date(), betaling: 'vipps', gebyr: gebyr_(pay.amount.value / 100) });
    o.status = 'BETALT'; o.betaling = 'vipps';
    sendBekreftelse_(o);
    return statusSvar_(o);
  } finally { lock.releaseLock(); }
}

/**
 * Referansen til en betaling hos Vipps bedrift som ikke er avgjort ennå. En avbrutt betaling får «~» foran,
 * så den ikke sjekkes igjen, men nummeret huskes til neste forsøk (Vipps godtar ikke samme referanse to ganger).
 */
function aktivRef_(o) { var r = String(o.vipps_ref || ''); return r && r.charAt(0) !== '~' ? r : ''; }
/** Referansen betalingen hos Vipps bedrift ble gjort med (for refusjon). Eldre rader har bare påmeldings-ID-en. */
function betaltRef_(o) { return aktivRef_(o) || o.id; }

/** Svaret betalingssiden får. Ubetalte får også det som trengs for å betale. */
function statusSvar_(o, status) {
  var s = { ok: true, status: status || o.status, fornavn: o.fornavn, epost: maskEmail_(o.epost), belop: o.belop, test: erTest_(o) };
  if (s.status === 'UBETALT') s.betalingsinfo = betalingsinfo_(o);
  return s;
}

/** Tidsstyrt utløser (hvert 5. minutt): fullfører betalinger der deltakeren lukket Vipps før retur. */
function pollPending() {
  var grense = Date.now() - 2 * 36e5;
  alle_().forEach(function (r) {
    if (r.status === 'UBETALT' && aktivRef_(r)) {
      try { sjekkBetaling_(r.id, null, true); } catch (err) { console.error(err); }
    } else if (r.status === 'VENTER' && new Date(r.opprettet).getTime() > grense) {
      try { sjekkBetaling_(r.id, null, true); } catch (err) { console.error(err); }
    } else if (r.status === 'VENTER') {
      oppdater_(r._rad, { status: 'AVBRUTT', notat: 'Utløpt' });
    }
  });
  // Reserve hvis bankutløseren ikke går: betalingsinfoen kommer senest etter et kvarter.
  try { sendVentendeBetalingsinfo_(15); } catch (err) { console.error(err); }
}

/* ------------------------------------------------------------------ */
/* Vipps ePayment API                                                  */
/* ------------------------------------------------------------------ */

function vippsHeaders_(token) {
  var h = {
    'Ocp-Apim-Subscription-Key': cfg_('VIPPS_SUBSCRIPTION_KEY'),
    'Merchant-Serial-Number': cfg_('VIPPS_MSN'),
    'Vipps-System-Name': 'juletreff-kumi',
    'Vipps-System-Version': '1.0',
    'Vipps-System-Plugin-Name': 'apps-script',
    'Vipps-System-Plugin-Version': '1.0'
  };
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

function vippsToken_() {
  var cache = CacheService.getScriptCache();
  var t = cache.get('vipps_token');
  if (t) return t;
  var h = vippsHeaders_();
  h.client_id = cfg_('VIPPS_CLIENT_ID');
  h.client_secret = cfg_('VIPPS_CLIENT_SECRET');
  var res = UrlFetchApp.fetch(vippsBase_() + '/accesstoken/get', { method: 'post', headers: h, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('Vipps token feilet: ' + res.getContentText());
  var d = JSON.parse(res.getContentText());
  cache.put('vipps_token', d.access_token, Math.min(3000, Number(d.expires_in || 3600) - 300));
  return d.access_token;
}

function vipps_(method, path, payload, idemKey) {
  var h = vippsHeaders_(vippsToken_());
  if (idemKey) h['Idempotency-Key'] = idemKey;
  var opt = { method: method, headers: h, muteHttpExceptions: true, contentType: 'application/json' };
  if (payload) opt.payload = JSON.stringify(payload);
  var res = UrlFetchApp.fetch(vippsBase_() + path, opt);
  var code = res.getResponseCode();
  var txt = res.getContentText();
  if (code >= 300) throw new Error('Vipps ' + method + ' ' + path + ' → ' + code + ': ' + txt);
  return txt ? JSON.parse(txt) : {};
}

function avbrytVipps_(id) {
  try { vipps_('post', '/epayment/v1/payments/' + encodeURIComponent(id) + '/cancel', null, 'cancel-' + id); }
  catch (err) { console.error('Kunne ikke avbryte ' + id + ': ' + err); }
}

/** Gjør en feil fra Vipps om til noe du kan gjøre noe med. */
function vippsFeilForklart_(melding) {
  var prod = cfg_('VIPPS_ENV', 'test') === 'prod';
  if (/token feilet/i.test(melding)) {
    return 'Vipps godtok ikke nøklene. Backend bruker ' + (prod ? 'produksjonsmiljøet (VIPPS_ENV = prod)' : 'testmiljøet, fordi VIPPS_ENV ikke er satt til prod') + '. ' +
      (prod ? 'Sjekk at VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET og VIPPS_SUBSCRIPTION_KEY er limt inn riktig, uten mellomrom, fra produksjonsnøklene i portal.vippsmobilepay.com.'
            : 'Er nøklene fra produksjon (portal.vippsmobilepay.com etter at avtalen ble godkjent), må VIPPS_ENV i Skriptegenskaper settes til prod.');
  }
  if (/→ 401|→ 403/.test(melding)) return 'Vipps sier at salgsstedet ikke har tilgang. Sjekk at VIPPS_MSN er salgsstedsnummeret fra portalen, og at salgsstedet har tilgang til ePayment-API-et.';
  if (/→ 400/.test(melding)) return 'Vipps avviste betalingen. Feilmeldingen sier hva som var galt.';
  return 'Vipps svarte ikke som forventet.';
}

/* ------------------------------------------------------------------ */
/* Vipps privat: innbetalinger i SpareBank 1                           */
/* ------------------------------------------------------------------ */
// Backend leser bare konto- og transaksjonsoppslag og flytter aldri penger. Tilgangen gis med BankID
// fra adminsiden, og tokenene ligger bare i Skriptegenskaper.

var SB1_AUTH = 'https://api-auth.sparebank1.no';
var SB1_API = 'https://api.sparebank1.no';
var SB1_ACCEPT = 'application/vnd.sparebank1.v1+json; charset=utf-8';
// Hvor ofte utløseren spør banken. Så ofte grensen under tillater de første to timene etter en ny ubetalt påmelding
// (da betaler de fleste), hvert 5. minutt resten av de to døgnene, og ellers hvert 15. minutt så lenge noen ikke har betalt.
// Betalingssiden spør i tillegg banken selv mens deltakeren står på den. Google gir et vanlig Gmail-konto
// 90 minutter kjøretid for utløsere i døgnet, og det deles mellom alle skriptene på kontoen.
// SpareBank 1 tillater rundt 60 kall i timen per API. Utløseren og betalingssiden spør derfor til sammen høyst
// én gang per BANK_MELLOMROM_SEK (40 i timen), så det er rom for «Test banken» i admin.
// shortcut: grensen på 60 i timen er ikke bekreftet av SpareBank 1, juster hvis banken svarer 429 likevel.
var BANK_MELLOMROM_SEK = 90;
// Svarer banken at vi har spurt for ofte (429), venter vi så lenge før vi spør igjen.
var BANK_PAUSE_SEK = 900;
var BANK_STRAKS_TIMER = 2;
// E-posten med betalingsinfo sendes først når betalingen ikke har kommet etter så mange minutter.
var EPOST_VENT_MIN = 5;
// Trykket deltakeren «Åpne Vipps» eller kopierte nummeret, har de trolig betalt, og Vipps privat kan bruke litt tid
// før betalingen kommer til banken. Da venter vi så mange minutter, og sender så en rolig e-post i stedet.
var VIPPS_VENT_MIN = 90;
var BANK_OFTE_TIMER = 48;
var BANK_OFTE_MIN = 5;
var BANK_SJELDEN_MIN = 15;

function bankKlar_() { return !!(cfg_('BANK_REFRESH_TOKEN', '') && cfg_('BANK_ACCOUNT_KEY', '')); }

/** Noen skal betale til nummeret snart: utløseren spør banken hvert minutt de neste døgnene. */
function venterPaBank_() {
  PropertiesService.getScriptProperties().setProperties({
    BANK_STRAKS_TIL: String(Date.now() + BANK_STRAKS_TIMER * 36e5),
    BANK_VENTER_TIL: String(Date.now() + BANK_OFTE_TIMER * 36e5)
  });
}

function qs_(o) {
  return Object.keys(o).filter(function (k) { return o[k] !== '' && o[k] != null; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]); }).join('&');
}

/** Bytter en BankID-kode eller et refresh-token mot nye tokens. */
function bankTokenKall_(felter, erFornyelse) {
  felter.client_id = cfg_('BANK_CLIENT_ID');
  felter.client_secret = cfg_('BANK_CLIENT_SECRET');
  var res = UrlFetchApp.fetch(SB1_AUTH + '/oauth/token', {
    method: 'post', payload: felter, headers: { Accept: 'application/json' }, muteHttpExceptions: true
  });
  var code = res.getResponseCode(), txt = res.getContentText();
  if (code !== 200) {
    var melding = 'SpareBank 1 svarte ' + code + ' på token: ' + txt.slice(0, 200);
    if (erFornyelse && (code === 400 || code === 401)) bankFrakoblet_(melding);
    throw new Error(melding);
  }
  return JSON.parse(txt);
}

/** Lagrer tokens. Et nytt refresh-token erstatter det gamle med en gang, fordi det gamle kan slutte å virke. */
function lagreBankTokens_(d) {
  var props = PropertiesService.getScriptProperties();
  if (d.refresh_token) props.setProperty('BANK_REFRESH_TOKEN', d.refresh_token);
  if (d.refresh_token_expires_in) {
    props.setProperty('BANK_REFRESH_UTLOPER', new Date(Date.now() + Number(d.refresh_token_expires_in) * 1000).toISOString());
    props.deleteProperty('BANK_VARSLET_UTLOP');
  }
  props.setProperty('BANK_SIST_FORNYET', new Date().toISOString());
  props.deleteProperty('BANK_FEIL'); props.deleteProperty('BANK_VARSLET_FEIL');
  var sek = Math.max(60, Math.min(540, Number(d.expires_in || 600) - 60));
  CacheService.getScriptCache().put('bank_token', d.access_token, sek);
}

function bankToken_(tving) {
  var cache = CacheService.getScriptCache();
  var t = tving ? null : cache.get('bank_token');
  if (t) return t;
  var rt = cfg_('BANK_REFRESH_TOKEN', '');
  if (!rt) throw new Error('Banken er ikke koblet til');
  var d = bankTokenKall_({ grant_type: 'refresh_token', refresh_token: rt }, true);
  lagreBankTokens_(d);
  return d.access_token;
}

/** Fornyelsen feilet: banken må godkjennes på nytt med BankID. Gir beskjed på e-post én gang. */
function bankFrakoblet_(melding) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('BANK_FEIL', new Date().toISOString() + ' ' + melding);
  if (props.getProperty('BANK_VARSLET_FEIL')) return;
  props.setProperty('BANK_VARSLET_FEIL', '1');
  var v = varselFrakoblet_(melding);
  varsle_(v.emne, v.tekst);
}

/** Varsler til deg går til VARSEL_EPOST, ellers ADMIN_EPOST, ellers SVAR_EPOST. */
function varselEpost_() { return cfg_('VARSEL_EPOST', '') || rapportMottaker_(); }

/** E-post til deg. Gir true hvis den ble sendt. Testen i adminsiden sender til en annen adresse. */
function varsle_(emne, tekst, til, test) {
  til = til || varselEpost_();
  if (!til) return false;
  // Samme varsel høyst hver 6. time, så et varsel som utløses hvert minutt ikke bruker opp e-postkvoten
  if (!test) {
    var cache = CacheService.getScriptCache();
    var nokkel = 'varsel_' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, til + emne + tekst));
    if (cache.get(nokkel)) return true;
    cache.put(nokkel, '1', 21600);
  }
  try {
    MailApp.sendEmail(til, (test ? '[TEST] ' : '') + 'Juletreff KUMI: ' + emne,
      tekst + '\n\nAdmin: ' + cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '') + '/#admin',
      { name: cfg_('AVSENDER_NAVN', 'Juletreff på KUMI') });
    return true;
  } catch (err) { console.error('Varsel feilet: ' + err); return false; }
}

/* ---- Tekstene i varslene. Egne funksjoner, så testen i adminsiden sender nøyaktig det samme. ---- */

function varselFrakoblet_(melding) {
  return { emne: 'Banken må kobles til på nytt', tekst:
    'Backend får ikke lenger lese innbetalinger fra SpareBank 1. Gå til adminsiden, trykk «Koble til banken» under Banken og logg inn med BankID.\n\n' +
    'Til det er gjort, må Vipps-betalinger markeres som betalt for hånd i adminsiden.\n\nFeilmelding: ' + melding };
}

function varselUtloper_(utloper) {
  return { emne: 'Banktilgangen går snart ut', tekst:
    'Tilgangen til SpareBank 1 går ut ' + Utilities.formatDate(new Date(utloper), Session.getScriptTimeZone(), 'd. MMMM yyyy') +
    '. Gå til adminsiden, trykk «Koble til banken» og logg inn med BankID, så varer den på nytt.' };
}

function varselFeilBelop_(t, r) {
  return { emne: 'Betaling med feil beløp (' + kroner_(t.belop) + ')', tekst:
    'Det har kommet ' + kroner_(t.belop) + ' fra ' + (t.navn || 'en deltaker') + (t.dato ? ' (' + t.dato + ')' : '') + '. ' +
    'Den ser ut til å høre til påmelding ' + r.id + ' fra ' + (r.vipps_navn || r.fornavn + ' ' + r.etternavn) +
    ', som koster ' + kroner_(r.belop) + '.\n\n' +
    'Betalinger med feil beløp kobles ikke automatisk, så plassen er ikke markert som betalt. ' +
    'I adminsiden, under «Innbetalinger som ikke ble koblet», kan du trykke «Koble» for å markere plassen som betalt, eller «Ignorer». ' +
    'Deltakeren har e-post ' + r.epost + ' hvis du vil be om resten av beløpet.' };
}

function varselReservasjon_(r, t) {
  var hvem = r.vipps_navn || r.fornavn + ' ' + r.etternavn;
  return { emne: 'Sjekk betalingen til ' + hvem + ' (' + kroner_(t.belop) + ')', tekst:
    'En reservert betaling uten navn ble koblet automatisk til påmelding ' + r.id + ' fra ' + hvem +
    ', som nettopp hadde trykket Vipps.\n\n' +
    'Nå har banken bokført ' + kroner_(t.belop) + ' fra ' + t.navn + (t.dato ? ' (' + t.dato + ')' : '') + ', og navnet passer ikke. ' +
    'Sjekk i nettbanken om ' + hvem + ' har betalt. Har de ikke det, kan du trekke plassen i adminsiden. ' +
    'Betalingen står under «Innbetalinger som ikke ble koblet» til du trykker «Ignorer».' };
}

function varselIkkeKoblet_(t, flere, samme) {
  return { emne: 'Betaling som ikke ble koblet (' + kroner_(t.belop) + ')', tekst:
    'Det har kommet ' + kroner_(t.belop) + ' fra ' + (t.navn || 'ukjent') + (t.dato ? ' (' + t.dato + ')' : '') + ', ' +
    (flere ? 'men flere som ikke har betalt, har samme navn og beløp.' : 'men navnet passer ikke med noen som ikke har betalt.') + '\n\n' +
    (samme.length ? 'Påmeldinger som venter på ' + kroner_(t.belop) + ':\n' + samme.map(function (r) {
      return '· ' + r.id + ': ' + (r.vipps_navn || r.fornavn + ' ' + r.etternavn) + ' (' + r.epost + ')';
    }).join('\n') + '\n\n' : 'Ingen påmeldinger venter på dette beløpet.\n\n') +
    'I adminsiden, under «Innbetalinger som ikke ble koblet», velger du påmeldingen og trykker «Koble», så får deltakeren bekreftelsen. Gjelder den ikke juletreffet, trykker du «Ignorer».' };
}

/** 14.9 → «14,90 kr», 600 → «600 kr». */
function kroner_(kr) {
  var n = Number(kr) || 0;
  return (n % 1 ? n.toFixed(2).replace('.', ',') : String(n)) + ' kr';
}

function bankGet_(path, query) {
  var url = SB1_API + path + (query ? '?' + qs_(query) : '');
  for (var forsok = 0; forsok < 2; forsok++) {
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + bankToken_(forsok > 0), Accept: SB1_ACCEPT }, muteHttpExceptions: true
    });
    var code = res.getResponseCode(), txt = res.getContentText();
    if (code === 401 && forsok === 0) continue; // tokenet gikk nettopp ut: hent nytt og prøv igjen
    if (code === 429) {
      CacheService.getScriptCache().put('bank_pause', '1', BANK_PAUSE_SEK);
      throw new Error('SpareBank 1 sier vi har spurt for ofte (429). Banken spørres igjen om ' + BANK_PAUSE_SEK / 60 + ' minutter.');
    }
    if (code >= 300) throw new Error('SpareBank 1 ' + path + ' → ' + code + ': ' + txt.slice(0, 300));
    return txt ? JSON.parse(txt) : {};
  }
}

/** Første liste i svaret (accounts, transactions, list …). Tåler at feltnavnet er et annet enn ventet. */
function finnListe_(d, nokler) {
  if (Array.isArray(d)) return d;
  for (var i = 0; i < nokler.length; i++) if (d && Array.isArray(d[nokler[i]])) return d[nokler[i]];
  for (var k in d) if (Array.isArray(d[k])) return d[k];
  return [];
}

function tekstAv_(v) {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.formatted || v.value || v.name || v.amount || '');
  return String(v);
}

function bankKontoer_() {
  var d = bankGet_('/personal/banking/accounts');
  return finnListe_(d, ['accounts', 'list', 'items']).map(function (a) {
    return { key: String(a.key || a.accountKey || a.id || ''), navn: tekstAv_(a.name || a.description || a.accountName),
      nummer: tekstAv_(a.accountNumber || a.number) };
  }).filter(function (a) { return a.key; });
}

/** Alle tekstfelt i en transaksjon, så navnet og meldingen blir funnet uansett hvilket felt banken bruker. */
function alleTekster_(o, dybde) {
  var ut = [];
  if (dybde > 3 || o == null) return ut;
  if (typeof o === 'string') { ut.push(o); return ut; }
  if (typeof o !== 'object') return ut;
  Object.keys(o).forEach(function (k) {
    if (/key$|^id$|links?$/i.test(k)) return;
    ut = ut.concat(alleTekster_(o[k], (dybde || 0) + 1));
  });
  return ut;
}

/** Gjør om en transaksjon fra banken til et fast format. Tåler ulike feltnavn. */
function normTrans_(t) {
  var tz = Session.getScriptTimeZone();
  var a = t.amount;
  var belop = a && typeof a === 'object' ? Number(a.amount != null ? a.amount : a.value) : Number(a);
  var d = t.date || t.bookingDate || t.accountingDate || t.transactionDate || t.valueDate || '';
  var dato = typeof d === 'number' ? Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd') : String(d).slice(0, 10);
  var id = t.id || t.transactionId || t.archiveReference || '';
  if (!id) {
    var dig = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(t));
    id = 'h' + dig.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
  }
  return {
    id: String(id), belop: belop, dato: dato,
    navn: tekstAv_(t.remoteAccountName || t.counterpartyName || t.counterPartyName),
    beskrivelse: [tekstAv_(t.description || t.cleanedDescription), tekstAv_(t.kidOrMessage || t.message)].filter(String).join(' · '),
    type: tekstAv_(t.typeText || t.typeCode || t.type),
    bokforing: tekstAv_(t.bookingStatus || t.status),
    tekst: alleTekster_(t, 0).join(' ').slice(0, 2000)
  };
}

/** Transaksjonene på kontoen fra de siste «dager» dagene, slik banken sender dem. */
function bankRaa_(dager) {
  var key = cfg_('BANK_ACCOUNT_KEY');
  var fra = Utilities.formatDate(new Date(Date.now() - dager * 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var d;
  try { d = bankGet_('/personal/banking/transactions', { accountKey: key, fromDate: fra }); }
  catch (err) {
    if (!/→ 400/.test(err.message)) throw err;
    d = bankGet_('/personal/banking/transactions', { accountKey: key }); // uten datofilter hvis banken ikke tar det
  }
  return finnListe_(d, ['transactions', 'list', 'items']);
}

/**
 * SpareBank 1 gir samme transaksjon en ny ID hver gang vi spør, så ID-en lages av innholdet i stedet.
 * Like transaksjoner (samme dag, beløp og tekst) nummereres i rekkefølge: -2, -3 osv.
 */
function bankTransaksjoner_(dager) {
  var antall = {};
  return bankRaa_(dager).map(normTrans_).map(function (t) {
    var k = bankInnhold_(t.dato, t.belop, t.bokforing, t.type, bankTekst_(t)), n = antall[k] = (antall[k] || 0) + 1;
    var dig = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, k, Utilities.Charset.UTF_8);
    t.id = 'i' + dig.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 24) + (n > 1 ? '-' + n : '');
    return t;
  });
}

/** Teksten som lagres i «Bank»: navnet og beskrivelsen fra banken. */
function bankTekst_(t) { return [t.navn, t.beskrivelse].filter(String).join(' · ').slice(0, 300); }

/** Det som gjør en transaksjon gjenkjennelig, likt for transaksjoner fra banken og rader i «Bank». */
function bankInnhold_(dato, belop, bokforing, type, tekst) { return [dato, ore_(belop), bokforing, type, tekst].join('|'); }

/** Spør banken høyst én gang per «sek» sekunder, uansett hvor mange som venter samtidig. */
function sjekkBankHvisLenge_(sek) {
  var cache = CacheService.getScriptCache();
  if (cache.get('bank_sist') || cache.get('bank_pause')) return;
  cache.put('bank_sist', '1', sek);
  sjekkBank_();
}

/* ---- Navn og kobling ---- */

/** Navnet som ord uten store bokstaver, æøå og tegn: «Kari-Anne Nordmann» → ['kari', 'anne', 'nordmann']. */
function navnOrd_(s) {
  return String(s || '').toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').filter(function (w) { return w.length > 1; });
}

/** Navn som er skjult i listen over ukoblede innbetalinger i admin («Skjul navnet»), uansett beløp. */
function skjulteNavn_() {
  try { return JSON.parse(cfg_('SKJUL_NAVN', '[]')); } catch (err) { return []; }
}

/** Bank-ID fra før ID-en ble laget av innholdet (SpareBank 1 ga samme transaksjon ny ID ved hver sjekk). */
function gammelBankId_(id) { return !/^i[0-9a-f]{24}(-\d+)?$/.test(String(id)); }

/** Fornavn og etternavn må begge finnes i bankteksten. Mellomnavn i Vipps gjør ingenting. */
function navnTreff_(navn, tekst) {
  var o = navnOrd_(navn), ord = navnOrd_(tekst), t = ' ' + ord.join(' ') + ' ';
  if (o.length === 1) {
    // Etternavnet er bare en forbokstav («Joachim F»): et annet ord i bankteksten må starte på den
    var f = /\s(\S)\.?\s*$/.exec(String(navn || ''));
    var b = f && navnOrd_(f[1] + f[1])[0]; // doblet, så navnOrd_ ikke kaster den (og ø blir o)
    return !!b && t.indexOf(' ' + o[0] + ' ') >= 0 && ord.some(function (w) { return w !== o[0] && w.charAt(0) === b.charAt(0); });
  }
  if (o.length < 2) return false;
  return t.indexOf(' ' + o[0] + ' ') >= 0 && t.indexOf(' ' + o[o.length - 1] + ' ') >= 0;
}

/** Hvor mange bokstaver som må byttes, legges til eller fjernes for å gjøre a om til b. */
function avstand_(a, b) {
  var d = [];
  for (var i = 0; i <= a.length; i++) d[i] = [i];
  for (var j = 1; j <= b.length; j++) d[0][j] = j;
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/**
 * Fornavnet står i bankteksten, og etternavnet nesten: en skrivefeil eller et avkortet navn,
 * som «Christian Ihn» for Christian Ihle. Høyst to bokstaver feil, og bare for etternavn på fire bokstaver eller mer.
 */
function nestenNavnTreff_(navn, tekst) {
  var o = navnOrd_(navn);
  if (o.length < 2) return false;
  var ord = navnOrd_(tekst), fornavn = o[0], etter = o[o.length - 1];
  if (ord.indexOf(fornavn) < 0 || etter.length < 4) return false;
  return ord.some(function (w) {
    return w !== fornavn && w.length >= 3 && (avstand_(w, etter) <= 2 || etter.indexOf(w) === 0);
  });
}

/** Minst ett av navnene (tre bokstaver eller mer) står i bankteksten. */
function delvisNavnTreff_(navn, tekst) {
  var t = ' ' + navnOrd_(tekst).join(' ') + ' ';
  return navnOrd_(navn).some(function (w) { return w.length >= 3 && t.indexOf(' ' + w + ' ') >= 0; });
}

function ore_(kr) { return Math.round(Number(kr) * 100); }
function fulltNavn_(r) { return r.fornavn + ' ' + r.etternavn; }
function navnPasser_(r, tekst) { return navnTreff_(r.vipps_navn || fulltNavn_(r), tekst) || navnTreff_(fulltNavn_(r), tekst); }

/** Innbetalingen er tidligst dagen før påmeldingen. */
function etterPamelding_(t, r) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.dato)) return true;
  return t.dato >= Utilities.formatDate(new Date(new Date(r.opprettet).getTime() - 864e5), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function idITekst_(tekst) {
  var m = String(tekst || '').match(/\bJT[\s-]?(\d{4,})/i);
  return m ? 'JT-' + m[1] : '';
}

/**
 * Betaling til et annet arrangement på samme Vipps-nummer, som vegansk juleribbe (VJ-12345, TEST-10001).
 * Vipps privat sender alt til samme bankkonto, så begge backendene ser de samme innbetalingene. Den med
 * den andres nummer eller navn i meldingen hoppes over, også når navn og beløp passer med en her.
 */
function annetArrangement_(tekst) {
  var t = String(tekst || '');
  if (idITekst_(t)) return false;
  return /\b(VJ|TEST)[\s-]?\d{5,}/i.test(t) || /juleribbe/i.test(t);
}

/**
 * Finner påmeldingen en innbetaling hører til. Først på påmeldings-ID i meldingen (Vipps-lenken fyller den ut),
 * så på navn og beløp. Gir påmeldingen, 'FLERE' hvis det ikke går å skille, eller null.
 */
function finnPameldingForBetaling_(t, ventende) {
  var kand = ventende.filter(function (r) { return ore_(r.belop) === ore_(t.belop) && etterPamelding_(t, r); });
  var id = idITekst_(t.tekst);
  if (id) {
    var nr = kand.filter(function (r) { return r.id === id; });
    if (nr.length === 1) return nr[0];
  }
  var navn = kand.filter(function (r) { return navnPasser_(r, t.tekst); });
  if (navn.length === 1) return navn[0];
  if (navn.length > 1) {
    // Samme person har meldt seg på flere ganger (for eksempel en testpåmelding): den nyeste får betalingen.
    var eposter = {}; navn.forEach(function (r) { eposter[r.epost] = 1; });
    if (Object.keys(eposter).length === 1) return navn[navn.length - 1];
    return 'FLERE';
  }
  // Nesten likt navn: fornavnet stemmer, og etternavnet er feilstavet eller avkortet i banken.
  // Bare når det gjelder én av dem som venter på beløpet. Sammenligner bare med navnet på betaleren,
  // ellers kunne ord som «NOK» eller «Vipps» i resten av bankteksten telle som et nesten likt etternavn.
  var nesten = kand.filter(function (r) {
    return nestenNavnTreff_(r.vipps_navn || fulltNavn_(r), t.navn) || nestenNavnTreff_(fulltNavn_(r), t.navn);
  });
  if (nesten.length === 1) return nesten[0];
  // Reserve: deltakeren brukte et annet navn enn i Vipps (kallenavn, nytt etternavn). Venter bare én på dette
  // beløpet, og minst ett av navnene står i bankteksten, er det nesten sikkert den.
  if (kand.length === 1 && (delvisNavnTreff_(kand[0].vipps_navn || fulltNavn_(kand[0]), t.tekst) || delvisNavnTreff_(fulltNavn_(kand[0]), t.tekst))) {
    return kand[0];
  }
  return null;
}

/** Betaling med et annet beløp: hvilken ventende deltaker den trolig kommer fra. Bare et forslag i adminsiden. */
function deltakerForBetaling_(t, ventende) {
  var kand = ventende.filter(function (r) { return etterPamelding_(t, r); });
  var id = idITekst_(t.tekst);
  if (id) {
    var nr = kand.filter(function (r) { return r.id === id; });
    if (nr.length) return nr[0];
  }
  var navn = kand.filter(function (r) { return navnPasser_(r, t.tekst); });
  return navn.length ? navn[navn.length - 1] : null;
}

/** Plassen er betalt til nummeret: markeres som betalt, og deltakeren får bekreftelsen. */
function markerPrivatBetalt_(r, bankId, notat) {
  var stempel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM HH:mm');
  var felt = { status: 'BETALT', betalt: new Date(), bank_id: bankId || 'manuell', gebyr: 0, betaling: 'manuell',
    notat: [r.notat, stempel + ' ' + (notat || (bankId ? 'Betaling funnet i banken' : 'Markert betalt'))].filter(String).join(' | ').slice(-500) };
  oppdater_(r._rad, felt);
  Object.assign(r, felt);
  return sendBekreftelse_(r);
}

/**
 * Henter innbetalinger siden forrige sjekk (minst tre dager) og kobler dem til påmeldinger som ikke er betalt.
 * Bare innbetalinger med beløpet for juletreffet lagres (fanen «Bank»), så private vippsinger ikke blir liggende.
 * Unntak: har noen som venter betalt feil beløp (navnet eller påmeldings-ID-en står i bankteksten), lagres den
 * som «FEIL_BELOP» med påmeldingen som forslag, og du får en e-post. Den kobles aldri automatisk.
 */
function sjekkBank_() {
  if (!bankKlar_()) return { ok: false, error: 'Banken er ikke koblet til' };
  // Fra siste vellykkede sjekk, så betalinger ikke blir borte etter et brudd. Minst 3 og høyst 14 dager.
  var sist = Date.parse(cfg_('BANK_SIST_SJEKKET', '')) || Date.now();
  var trans = bankTransaksjoner_(Math.min(14, Math.max(3, Math.ceil((Date.now() - sist) / 864e5) + 1)));
  PropertiesService.getScriptProperties().setProperty('BANK_SIST_SJEKKET', new Date().toISOString());
  // Innbetalinger fra før «Nullstill» hører til testene: de som var lagret, og alt datert dagene før, hoppes over.
  // En reservasjon fra før kan bli bokført samme dag under en ny ID, nå med navn. Den første nye bokførte på samme
  // beløp den dagen kobles derfor ikke, men vises i admin («NULLSTILT»). Alt annet kobles som vanlig.
  // shortcut: får den bokførte en senere dato enn nullstillingsdagen, kobles den som ny. Ikke sett ennå.
  var nullstilt = JSON.parse(cfg_('BANK_NULLSTILT', '{}')), forNullstill = nullstilt.reservert || [];
  trans = trans.filter(function (t) { return !(nullstilt.dag && t.dato && t.dato < nullstilt.dag); });
  // Bokført under samme ID: den hoppes over (ID-en er kjent), og reservasjonen er ferdig
  var bokfortSamme = {}; trans.forEach(function (t) { if (t.navn) bokfortSamme[t.id] = 1; });
  forNullstill = forNullstill.filter(function (r) { return !bokfortSamme[r.id]; });
  var fraForNullstill = function (t) {
    if (!t.navn || t.dato !== nullstilt.dag) return false;
    var i = forNullstill.map(function (r) { return ore_(r.belop); }).indexOf(ore_(t.belop));
    if (i < 0) return false;
    forNullstill.splice(i, 1);
    return true;
  };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: true, opptatt: true };
  var varsler = [], bekreftes = [];
  var nye = 0, koblet = 0;
  try {
    var bsh = sheet_(BANK_ARK), B = {}; BANK_KOLONNER.forEach(function (k, i) { B[k] = i; });
    var sett = {}, feilSett = {}, umatchet = {}, reservasjoner = {}, lagret = {}, kobletBok = {}, bokfortFor = {}, datoer = {};
    var tz = Session.getScriptTimeZone();
    var datoTekst = function (v) {
      if (!(v instanceof Date)) return String(v);
      return datoer[v.getTime()] || (datoer[v.getTime()] = Utilities.formatDate(v, tz, 'yyyy-MM-dd'));
    };
    // Ukoblede betalinger fra før varselet ble forsinket, har allerede gitt varsel
    var props = PropertiesService.getScriptProperties();
    var varselFra = Number(props.getProperty('UMATCHET_VARSEL_FRA')) || 0;
    if (!varselFra) { varselFra = Date.now(); props.setProperty('UMATCHET_VARSEL_FRA', String(varselFra)); }
    bsh.getDataRange().getValues().slice(1).forEach(function (r, i) {
      sett[String(r[B.bank_id])] = 1;
      var k = bankInnhold_(datoTekst(r[B.dato]), r[B.belop], r[B.bokforing], r[B.type], r[B.tekst]);
      lagret[k] = (lagret[k] || 0) + 1;
      if (r[B.status] === 'KOBLET') kobletBok[String(r[B.bank_id])] = String(r[B.bokforing]);
      if (r[B.status] === 'BOKFORT') bokfortFor[String(r[B.pamelding])] = 1;
      if (r[B.status] === 'FEIL_BELOP') feilSett[r[B.pamelding] + '|' + ore_(r[B.belop])] = 1;
      // SJEKK også: kommer betalingen bokført med riktig navn senere, er alarmen falsk og raden kobles
      if (r[B.status] === 'RESERVERT' || r[B.status] === 'SJEKK') reservasjoner[String(r[B.bank_id])] = { rad: i + 2, pamelding: String(r[B.pamelding]), belop: r[B.belop], sjekk: r[B.status] === 'SJEKK' };
      if (r[B.status] === 'UMATCHET') {
        var naar = new Date(r[B.sett]).getTime();
        umatchet[String(r[B.bank_id])] = { rad: i + 2, sett: naar, innhold: k, varslet: !!r[B.varslet] || naar < varselFra,
          navn: String(r[B.navn]), tekst: String(r[B.tekst]), bokforing: String(r[B.bokforing]), pamelding: String(r[B.pamelding] || '') };
      }
    });
    (nullstilt.ider || []).forEach(function (id) { sett[id] = 1; });
    // Lagret med samme innhold minst like mange ganger: sett før. Gjelder også rader fra før ID-en ble laget av
    // innholdet, da samme transaksjon ble lagret på nytt ved hver sjekk.
    var nr = {};
    trans.forEach(function (t) {
      var k = bankInnhold_(t.dato, t.belop, t.bokforing, t.type, bankTekst_(t));
      nr[k] = (nr[k] || 0) + 1;
      if ((lagret[k] || 0) >= nr[k]) sett[t.id] = 1;
    });
    var settNa = {};

    var nylig = Date.now() - 4 * 864e5;
    var rader = alle_();
    var ventende = rader.filter(function (r) { return r.status === 'UBETALT'; });
    var betalte = rader.filter(function (r) { return r.status === 'BETALT' && r.bank_id && new Date(r.betalt).getTime() > nylig; });
    var priser = {}; priser[ore_(arrangement_().pris)] = 1;
    ventende.forEach(function (r) { priser[ore_(r.belop)] = 1; });

    var bankTekst = bankTekst_;
    var lagre = function (t, status, id) {
      bsh.appendRow([new Date(), t.id, t.dato, t.belop, t.navn, bankTekst(t), t.type, t.bokforing, status, id, ''].map(celle_));
      sett[t.id] = 1; nye++;
    };
    var kobl = function (treff, t, hva) {
      var stempel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM HH:mm');
      var felt = { status: 'BETALT', betalt: new Date(), bank_id: t.id, gebyr: 0, betaling: 'manuell',
        notat: [treff.notat, stempel + ' ' + (hva || 'Betaling funnet i banken')].filter(String).join(' | ').slice(-500) };
      oppdater_(treff._rad, felt);
      Object.assign(treff, felt);
      bekreftes.push(treff);
      ventende.splice(ventende.indexOf(treff), 1);
      betalte.push(treff);
      koblet++;
    };
    // Den eneste som venter på dette beløpet og har trykket «Åpne Vipps»: forslag i adminsiden
    var forslag = function (t) {
      var k = ventende.filter(function (r) { return ore_(r.belop) === ore_(t.belop) && r.vipps_apnet; });
      return k.length === 1 ? k[0].id : '';
    };
    // Reservert betaling uten navn og melding: banken sier ikke hvem den er fra før den er bokført.
    var utenNavn = function (x) {
      // «Vipps*Vipps*Navn» i teksten: navnet finnes, bare ikke i navnefeltet (ofte en eldre betaling i ny form)
      return x.belop > 0 && !x.navn && /pending/i.test(x.bokforing) && !idITekst_(x.tekst) && !annetArrangement_(x.tekst) && !/vipps\*/i.test(x.tekst);
    };
    // Slike reservasjoner per beløp som ikke er koblet og dukket opp de siste 40 minuttene, telt før noe lagres under
    var aktuelle = {};
    trans.forEach(function (x) {
      var forst = !sett[x.id] ? Date.now() : umatchet[x.id] ? umatchet[x.id].sett : 0;
      if (utenNavn(x) && Date.now() - forst < 40 * 60000) aktuelle[ore_(x.belop)] = (aktuelle[ore_(x.belop)] || 0) + 1;
    });
    // De som venter på beløpet og trykket Vipps fra 30 minutter før til 10 minutter etter at reservasjonen dukket opp.
    // Er de like mange som de aktuelle reservasjonene på beløpet, kobles reservasjonen til den som trykket nærmest i tid.
    // Hvem som får hvilken, spiller ingen rolle før banken bokfører dem med navn, og da sjekkes navnene samlet.
    var reservasjon = function (t, forst) {
      var naer = function (r) { return Math.abs(forst - new Date(r.vipps_apnet).getTime()); };
      var k = !utenNavn(t) ? [] : ventende.filter(function (r) {
        var d = forst - new Date(r.vipps_apnet).getTime();
        return ore_(r.belop) === ore_(t.belop) && r.vipps_apnet && d > -10 * 60000 && d < 30 * 60000;
      });
      if (!k.length || k.length !== aktuelle[ore_(t.belop)]) return null;
      aktuelle[ore_(t.belop)]--;
      return k.sort(function (a, b) { return naer(a) - naer(b); })[0];
    };
    // Automatisk koblede reservasjoner som banken har bokført med navn (under samme eller ny ID): finnes navnet?
    // Står noen av reservasjonene på beløpet fortsatt uten navn, kan den være hvem som helst av dem, så da venter vi
    // med varselet, og godtar bare nye bokførte betalinger med riktig navn.
    var iBanken = {}; trans.forEach(function (x) { iBanken[x.id] = x; });
    var venter = {};
    Object.keys(reservasjoner).forEach(function (id) { if (iBanken[id] && !iBanken[id].navn && !reservasjoner[id].sjekk) venter[ore_(reservasjoner[id].belop)] = 1; });
    if (trans.length) Object.keys(reservasjoner).forEach(function (bid) {
      var rv = reservasjoner[bid], A = ore_(rv.belop);
      var p = rader.filter(function (r) { return r.id === rv.pamelding; })[0];
      if (!p) return;
      // Bokførte betalinger på beløpet: reservasjonene, og nye som ikke kobles til andre som venter
      // eller kommer fra andre som nettopp har betalt (bokført utgave av en betaling som alt er koblet eller markert)
      var nye = trans.filter(function (x) {
        return ore_(x.belop) === A && x.navn && (reservasjoner[x.id] || (!sett[x.id] && !finnPameldingForBetaling_(x, ventende) &&
          !betalte.some(function (r) { return r !== p && navnPasser_(r, x.tekst); })));
      });
      var bok = nye.filter(function (x) { return navnPasser_(p, x.tekst) && !(venter[A] && reservasjoner[x.id]); })[0];
      if (bok) {
        oppdaterBankRad_(rv.rad, { status: 'KOBLET', navn: bok.navn, tekst: bankTekst(bok), bokforing: bok.bokforing });
        if (!sett[bok.id]) lagre(bok, 'BOKFORT', p.id); // samme betaling, bokført under en ny ID
      } else if (nye.length && !venter[A] && !rv.sjekk) {
        oppdaterBankRad_(rv.rad, { status: 'SJEKK' });
        varsler.push(varselReservasjon_(p, nye[0]));
      } // ellers er den borte fra listen, men ikke bokført ennå: vent
      // shortcut: bokfører banken den aldri (eller etter mer enn tre dager), venter raden for alltid uten varsel. Legg til en frist hvis det skjer.
    });
    trans.forEach(function (t) {
      if (!(t.belop > 0) || annetArrangement_(t.tekst)) return;
      settNa[t.id] = 1;
      var u = umatchet[t.id];
      if (u) {
        // Sett før uten treff, ofte fordi navnet manglet («under behandling»). Har navnet kommet nå, kobles den.
        var igjen = finnPameldingForBetaling_(t, ventende), res = !igjen && reservasjon(t, u.sett);
        if (res) igjen = res;
        if (igjen && igjen !== 'FLERE') {
          kobl(igjen, t, res && 'Reservert betaling uten navn koblet automatisk');
          oppdaterBankRad_(u.rad, { status: res ? 'RESERVERT' : 'KOBLET', pamelding: igjen.id, navn: t.navn, tekst: bankTekst(t), bokforing: t.bokforing });
        } else {
          // Skriver bare det som er endret, så arket ikke oppdateres hvert minutt
          var ny = { navn: t.navn, tekst: bankTekst(t), bokforing: t.bokforing, pamelding: forslag(t) }, endret = {};
          Object.keys(ny).forEach(function (k) { if (String(ny[k] || '') !== u[k]) endret[k] = ny[k]; });
          if (Object.keys(endret).length) oppdaterBankRad_(u.rad, endret);
          if (!u.varslet && Date.now() - u.sett > UMATCHET_VARSEL_TIMER * 36e5) {
            oppdaterBankRad_(u.rad, { varslet: new Date() });
            varsler.push(varselIkkeKoblet_(t, igjen === 'FLERE', ventende.filter(function (r) { return ore_(r.belop) === ore_(t.belop); })));
          }
        }
        return;
      }
      if (sett[t.id]) return;
      if (fraForNullstill(t)) { if (priser[ore_(t.belop)]) lagre(t, 'NULLSTILT', ''); return; }
      if (!priser[ore_(t.belop)]) {
        var hvem = deltakerForBetaling_(t, ventende);
        if (!hvem) return; // en vanlig vipps som ikke gjelder juletreffet
        var nokkel = hvem.id + '|' + ore_(t.belop);
        if (feilSett[nokkel]) { lagre(t, 'DUPLIKAT', hvem.id); return; } // samme betaling igjen (reservert, så bokført)
        feilSett[nokkel] = 1;
        lagre(t, 'FEIL_BELOP', hvem.id);
        varsler.push(varselFeilBelop_(t, hvem));
        return;
      }
      var treff = finnPameldingForBetaling_(t, ventende), status = 'UMATCHET', id = '';
      var res = !treff && reservasjon(t, Date.now());
      if (res) treff = res;
      if (treff && treff !== 'FLERE') {
        kobl(treff, t, res && 'Reservert betaling uten navn koblet automatisk');
        status = res ? 'RESERVERT' : 'KOBLET'; id = treff.id;
      } else if (!treff) {
        // Samme navn og beløp som en som nettopp betalte: samme betaling igjen, eller at noen betalte to ganger
        var samme = betalte.filter(function (r) {
          return ore_(r.belop) === ore_(t.belop) && String(r.bank_id) !== t.id && navnPasser_(r, t.tekst);
        });
        // Koblet mens den var reservert, eller markert betalt i admin, og nå bokført: samme betaling. Én bokført per påmelding.
        var bokf = !/pending/i.test(t.bokforing) && samme.filter(function (r) {
          return (/pending/i.test(kobletBok[String(r.bank_id)] || '') || r.bank_id === 'manuell') && !bokfortFor[r.id];
        })[0];
        if (bokf) { status = 'BOKFORT'; id = bokf.id; bokfortFor[bokf.id] = 1; }
        else if (samme.length) status = 'DUPLIKAT';
      }
      // Ikke koblet: varsel kommer først etter UMATCHET_VARSEL_TIMER, hvis navnet ikke dukker opp før det
      lagre(t, status, status === 'UMATCHET' ? forslag(t) : id);
    });
    // Ukoblet betaling som ikke lenger finnes i banken: den var «under behandling» og er bokført på nytt
    // under en annen ID, som er koblet over. Den skjules i adminsiden.
    // En gammel rad (bankens ID) finnes så lenge innholdet finnes i banken.
    if (trans.length) Object.keys(umatchet).forEach(function (bid) {
      var u = umatchet[bid];
      if (gammelBankId_(bid) && nr[u.innhold]) return;
      if (!settNa[bid] && Date.now() - u.sett < 2 * 864e5) oppdaterBankRad_(u.rad, { status: 'BORTE' });
    });
    if (nullstilt.reservert && forNullstill.length !== nullstilt.reservert.length) {
      nullstilt.reservert = forNullstill;
      props.setProperty('BANK_NULLSTILT', JSON.stringify(nullstilt));
    }
  } finally { lock.releaseLock(); }
  // E-postene sendes etter at låsen er sluppet, så andre forespørsler ikke må vente på Gmail.
  bekreftes.forEach(function (r) { sendBekreftelse_(r); });
  varsler.forEach(function (v) { varsle_(v.emne, v.tekst); });
  return { ok: true, transaksjoner: trans.length, nye: nye, koblet: koblet };
}

/**
 * Tidsstyrt utløser hvert minutt. Spør banken hvert minutt de første døgnene etter en ny ubetalt påmelding
 * eller purring, ellers hvert 15. minutt så lenge noen ikke har betalt. Fornyer også tilgangen én gang i døgnet.
 */
function sjekkBankUtloser() {
  if (!cfg_('BANK_REFRESH_TOKEN', '')) return;
  var props = PropertiesService.getScriptProperties();
  var sist = new Date(props.getProperty('BANK_SIST_FORNYET') || 0).getTime();
  if (Date.now() - sist > 20 * 36e5) {
    try { bankToken_(true); } catch (err) { console.error(err); return; }
  }
  var utloper = props.getProperty('BANK_REFRESH_UTLOPER');
  if (utloper && new Date(utloper).getTime() - Date.now() < 14 * 864e5 && !props.getProperty('BANK_VARSLET_UTLOP')) {
    props.setProperty('BANK_VARSLET_UTLOP', '1');
    var v = varselUtloper_(utloper);
    varsle_(v.emne, v.tekst);
  }
  if (!bankKlar_()) return;
  var cache = CacheService.getScriptCache(), naa = Date.now();
  var min = naa < Number(props.getProperty('BANK_STRAKS_TIL') || 0) ? 1
    : naa < Number(props.getProperty('BANK_VENTER_TIL') || 0) ? BANK_OFTE_MIN : BANK_SJELDEN_MIN;
  if (min > 1) {
    if (cache.get('bank_neste')) return;
    cache.put('bank_neste', '1', min * 60 - 30);
  }
  // Har alle betalt, trengs ikke banken før noen nye melder seg på.
  if (!alle_().some(function (r) { return r.status === 'UBETALT'; })) return;
  // Etter banksjekken, så den som nettopp betalte, får bekreftelsen og ikke betalingsinfo. Svarer ikke banken,
  // går betalingsinfoen likevel ut, ellers ville de som ikke har betalt, ventet på en e-post som aldri kom.
  try { sjekkBankHvisLenge_(BANK_MELLOMROM_SEK); } catch (err) { console.error('Banksjekken feilet: ' + err); }
  sendVentendeBetalingsinfo_(EPOST_VENT_MIN);
}

/**
 * Sender e-posten med betalingsinfo til dem som meldte seg på for mer enn «min» minutter siden og ikke har
 * betalt ennå. De som betalte med en gang, har fått bekreftelsen i stedet. Bare påmeldinger fra de siste
 * to døgnene, så en e-post som feilet tidligere ikke sendes igjen og igjen (den står i statusmailen).
 */
/** E-posten med betalingsinfo er ikke sendt ennå fordi den venter på at betalingen kanskje kommer først. */
function epostVenter_(r) {
  if (r.status !== 'UBETALT' || r.betaling !== 'manuell') return false;
  if (r.vipps_apnet) return Date.now() - new Date(r.vipps_apnet).getTime() < (VIPPS_VENT_MIN + 20) * 60000;
  return Date.now() - new Date(r.opprettet).getTime() < 20 * 60000;
}

function sendVentendeBetalingsinfo_(min) {
  var naa = Date.now();
  // Merket i Skriptegenskaper før sending, så e-posten går høyst én gang per påmelding, også hvis
  // «epost_sendt» ikke blir skrevet i arket. Ellers sendes den på nytt hvert minutt og bruker opp e-postkvoten.
  var props = PropertiesService.getScriptProperties(), sendt = props.getProperties();
  alle_().forEach(function (r) {
    if (r.status !== 'UBETALT' || r.epost_sendt || r.betaling !== 'manuell') return;
    var alder = naa - new Date(r.opprettet).getTime();
    if (alder < min * 60000 || alder > 48 * 36e5) return;
    // Trykket på Vipps: vent lenger, og send den rolige varianten
    var trykket = !!r.vipps_apnet;
    if (trykket && naa - new Date(r.vipps_apnet).getTime() < VIPPS_VENT_MIN * 60000) return;
    var merke = 'BETINFO_' + r.id + '_' + new Date(r.opprettet).getTime();
    if (sendt[merke]) return;
    props.setProperty(merke, '1');
    sendBekreftelse_(r, trykket);
  });
}

function sikreBankUtloser_() {
  var finnes = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sjekkBankUtloser'; });
  if (!finnes) ScriptApp.newTrigger('sjekkBankUtloser').timeBased().everyMinutes(1).create();
}

/** SpareBank 1 sender nettleseren hit etter BankID. Bytter koden mot tokens og velger konto. */
function bankCallback_(p) {
  var side = function (tittel, tekst) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#222">' +
      '<h1 style="font-size:26px">' + escapeHtml_(tittel) + '</h1><p style="font-size:17px;line-height:1.5">' +
      escapeHtml_(tekst) + '</p></div>').setTitle(tittel).addMetaTag('viewport', 'width=device-width, initial-scale=1');
  };
  if (p.error) return side('Tilkoblingen ble avbrutt', String(p.error_description || p.error).slice(0, 200));
  var cache = CacheService.getScriptCache();
  if (!p.state || !/^[a-f0-9]{32}$/.test(p.state) || !cache.get('bank_state_' + p.state)) {
    return side('Lenken er gått ut', 'Gå tilbake til adminsiden og trykk «Koble til banken» på nytt.');
  }
  cache.remove('bank_state_' + p.state);
  try {
    var d = bankTokenKall_({ grant_type: 'authorization_code', code: String(p.code || ''), redirect_uri: cfg_('BANK_REDIRECT') }, false);
    lagreBankTokens_(d);
    var props = PropertiesService.getScriptProperties();
    props.setProperty('BANK_TILKOBLET', new Date().toISOString());
    var kontoer = bankKontoer_();
    var valgt = kontoer.filter(function (k) { return k.key === cfg_('BANK_ACCOUNT_KEY', ''); })[0] ||
      (kontoer.length === 1 ? kontoer[0] : kontoer.filter(function (k) { return /jule|vipps|arrangement/i.test(k.navn); })[0]);
    if (valgt) { props.setProperty('BANK_ACCOUNT_KEY', valgt.key); props.setProperty('BANK_KONTO_NAVN', valgt.navn + ' ' + valgt.nummer); }
    sikreBankUtloser_();
    return side('Banken er koblet til', valgt
      ? 'Backend leser innbetalinger på kontoen «' + valgt.navn + '». Du kan lukke denne siden og gå tilbake til adminsiden.'
      : 'Gå tilbake til adminsiden og velg kontoen Vipps-pengene kommer inn på.');
  } catch (err) {
    console.error(err);
    return side('Noe gikk galt', String(err.message || err).slice(0, 300));
  }
}

/* ------------------------------------------------------------------ */
/* E-post                                                              */
/* ------------------------------------------------------------------ */

/** Bekreftelse i samme stil som den opprinnelige e-posten: fersken ramme, mørkt kort, bilde øverst. */
/** «venter»: deltakeren trykket på Vipps, men betalingen er ikke kommet. Da en rolig e-post uten stor betal-knapp. */
function sendBekreftelse_(r, venter) {
  if (!r.epost) return;
  var a = arrangement_();
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  var betalt = r.status === 'BETALT';
  var fb = facebookUrl_();
  var kart = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('KUMI Operagata 71B Oslo');
  var e = escapeHtml_;
  var fornavn = e(r.fornavn), etternavn = e(r.etternavn);

  var rad = epostRad_, tabell = epostTabell_;
  var bunn = betalt ? 'Spørsmål, eller må du melde deg av med legeerklæring? Svar på denne e-posten.' : 'Spørsmål? Svar på denne e-posten.';

  var venterBoks = function () {
    var b = betalingsinfo_(r), side = betalingsside_(r);
    return '<div class="boks" style="border: 1px solid rgba(244, 234, 223, 0.25); border-radius: 10px; padding: 14px 12px; margin: 30px 0;">' +
      '<p style="text-align: center; margin: 0 0 6px 0;"><b>Har du betalt, trenger du ikke gjøre noe.</b></p>' +
      '<p style="text-align: center; margin: 0; color: #bdb3a8;">Vipps kan bruke litt tid før betalingen kommer fram til oss. ' +
      'Du får en ny e-post når den er registrert.</p></div>' +
      '<p style="font-size: .95rem; margin: 0 0 6px 0;"><b>Har du ikke betalt ennå?</b></p>' +
      (b.nr ? epostTabell_(
        epostRad_(b.mobil ? 'Vipps til:' : 'Vipps-nummer:', '<b>' + e(b.mottaker) + '</b>', false, '#edb77d') +
        (b.vippsNavn ? epostRad_('Mottaker:', e(b.vippsNavn), false) : '') +
        epostRad_('Beløp:', '<b>' + r.belop + ' kr</b>', false, '#edb77d') +
        epostRad_('Melding:', '<b>' + e(b.melding) + '</b>', true, '#edb77d'), 'margin: 0 0 8px 0; ') : '') +
      '<p style="font-size: .9rem; margin: 0;">Eller betal fra <a href="' + e(side) + '" style="color: #edb77d; text-decoration: none; ' +
      'border-bottom: 1px dotted #edb77d;">betalingssiden</a>.</p>';
  };

  var betaling = betalt
    ? '<div class="boks" style="border: 1px solid #6fbf73; border-radius: 10px; padding: 14px 12px; margin: 30px 0;">' +
      '<h3 style="font-size: 1.2rem; color: #8fd694; margin: 0 0 6px 0; text-align: center;">Betalt ' + r.belop + ' kr ✓</h3>' +
      '<p style="text-align: center; margin: 0;">Plassen din er sikret.</p></div>'
    : venter ? venterBoks()
    : vippsBoks_(r, 'Plassen din er sikret når betalingen er mottatt.') +
      '<p style="font-size: .9rem; line-height: 1.5; margin: 0; color: #bdb3a8; text-align: center;">' +
      'Har du allerede betalt? Da trenger du ikke gjøre noe mer. Du får en ny e-post når betalingen er registrert.</p>';

  var html = epostRamme_(
    '<h2 style="color: #edb77d; font-size: 1.5rem; margin-top: 0; text-align: center;">Hei ' + fornavn + ',</h2>' +
    '<p style="font-weight: bold; font-size: 1.1rem; margin: 20px 0 0 0; letter-spacing: 0.5px; text-align: center;">' +
    (betalt ? 'Du er påmeldt Juletreff på KUMI 🌿' : venter ? 'Vi har ikke sett betalingen din ennå'
      : 'Ett steg igjen: betal, så er plassen din 🌿') + '</p>' +

    betaling +

    tabell(
      rad('Sted:', '<a href="' + kart + '" style="color: #edb77d; text-decoration: none; border-bottom: 1px dotted #edb77d;">' +
        e(a.sted) + '</a>') +
      rad('Tid:', e(a.dato) + (betalt ? kalenderLenker_(a, site) : '')) +
      rad('Påmelding:', r.id, true), 'margin: 30px 0; ') +

    (betalt ? epostKnapp_(fb, 'Trykk «Skal» på Facebook-eventet 📅') : '') +

    '<h3 style="font-size: 1.2rem; color: #edb77d; margin-bottom: 10px; text-align: left;">Dine detaljer:</h3>' +
    tabell(
      rad('Navn:', fornavn + ' ' + etternavn) +
      rad('Telefon:', e(r.telefon)) +
      rad('E-post:', '<span style="color: #F4EADF; text-decoration: none;">' +
        e(r.epost).replace('@', '&#8203;@').replace(/\./g, '&#8203;.') + '</span>', !r.kommentar) +
      (r.kommentar ? rad('Melding:', e(r.kommentar), true) : '')),
    bunn);

  var tekst =
    'Hei ' + r.fornavn + '!\n\n' +
    (betalt ? 'Du er påmeldt Juletreff på KUMI. Plassen din er sikret.' : venter ? 'Vi har ikke sett betalingen din for Juletreff på KUMI ennå.'
      : 'Ett steg igjen: betal, så er plassen din på Juletreff på KUMI.') + '\n\n' +
    (betalt ? 'Betalt: ' + r.belop + ' kr.'
      : venter ? 'Har du betalt, trenger du ikke gjøre noe. Vipps kan bruke litt tid før betalingen kommer fram til oss. ' +
        'Du får en ny e-post når den er registrert.\n\nHar du ikke betalt ennå? ' + vippsTekst_(r)
      : vippsTekst_(r) + '\nPlassen din er sikret når betalingen er mottatt.\n' +
        'Har du allerede betalt? Da trenger du ikke gjøre noe mer. Du får en ny e-post når betalingen er registrert.') + '\n\n' +
    'Sted: ' + a.sted + '\nTid: ' + a.dato + '\nPåmelding: ' + r.id + '\n\n' +
    (betalt ? 'Legg i kalenderen:\nGoogle: ' + googleKalender_(a, site) + '\nApple eller Outlook: ' + site + '/juletreff.ics\n\n' : '') +
    (betalt ? 'Trykk «Skal» på Facebook-eventet: ' + fb + '\n\n' : '') +
    bunn + '\n' +
    'Salgsvilkår: ' + site + '/#vilkar\nPersonvern: ' + site + '/#personvern';

  var emne = (erTest_(r) ? '[TEST] ' : '') +
    (betalt ? '✨ Du er påmeldt Juletreff på KUMI 🥂' : venter ? 'Juletreff på KUMI: vi venter på betalingen din'
      : '✨ Juletreff på KUMI 🥂 Betal ' + r.belop + ' kr med Vipps');

  var valg = { htmlBody: html, name: cfg_('AVSENDER_NAVN', 'Juletreff på KUMI'), replyTo: cfg_('SVAR_EPOST', '') || undefined };
  // Kalenderfila som vedlegg: Apple Mail og Outlook legger den i kalenderen med ett trykk.
  // Bekreftelsen er viktigere enn vedlegget, så den sendes uten hvis fila feiler.
  if (betalt) {
    try { valg.attachments = [Utilities.newBlob(kalenderIcs_(a, site), 'text/calendar', 'juletreff.ics')]; }
    catch (err) { console.error('Kalenderfila feilet for ' + r.id + ': ' + err); }
  }

  try {
    MailApp.sendEmail(r.epost, emne, tekst, valg);
  } catch (err) { console.error('E-post feilet for ' + r.id + ': ' + err); return false; }
  // Raden e-posten gjelder. finn_ tar den siste med samme ID, og den kan være en annen.
  try {
    var rad = r._rad || (finn_('id', r.id) || {})._rad;
    if (rad) oppdater_(rad, { epost_sendt: new Date() });
  } catch (err) { console.error('Fikk ikke lagret «epost_sendt» for ' + r.id + ': ' + err); }
  return true;
}

/* «Legg i kalenderen» i bekreftelsen. Samme hendelse som src/kalender.js lager på siden og i juletreff.ics der. */
var KALENDER_TITTEL = 'Juletreff på KUMI';
var KALENDER_STED = 'KUMI, Operagata 71B, Oslo';
var KALENDER_OM = 'Vegansk julebord med seks retter, underholdning og MUNCH bar etterpå.';
// Samme UID som på siden, så kalenderen kjenner igjen hendelsen i stedet for å lage en til
var KALENDER_UID = 'juletreff-kumi-2026-12-18@ibh2511.github.io';

/** 20261218T173000Z. Slutter kvelden ikke etter start (feil i ARR_SLUTT), brukes 4,5 timer. */
function kalenderTider_(a) {
  var utc = function (d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
  var slutt = a.slutt > a.start ? a.slutt : new Date(a.start.getTime() + 4.5 * 36e5);
  return { start: utc(a.start), slutt: utc(slutt), naa: utc(new Date()) };
}

function googleKalender_(a, site) {
  var t = kalenderTider_(a);
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent(KALENDER_TITTEL) +
    '&dates=' + t.start + '/' + t.slutt +
    '&details=' + encodeURIComponent(KALENDER_OM + '\n\n' + site + '/') +
    '&location=' + encodeURIComponent(KALENDER_STED) +
    '&ctz=Europe%2FOslo';
}

/** Kalenderfil (RFC 5545). Tekst får \ foran \ ; , og linjeskift. Lange linjer brytes ved 75 byte, aldri midt i en bokstav. */
function kalenderIcs_(a, site) {
  var t = kalenderTider_(a);
  var tekst = function (s) { return String(s).replace(/[\\;,]/g, '\\$&').replace(/\r?\n/g, '\\n'); };
  var brett = function (linje) {
    var ut = '', n = 0;
    for (var i = 0; i < linje.length; i++) {
      var c = linje.charCodeAt(i), tegn = linje.charAt(i), b = c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
      if (c >= 0xD800 && c <= 0xDBFF) { tegn += linje.charAt(++i); b = 4; }
      if (n + b > 75) { ut += '\r\n '; n = 1; }
      ut += tegn; n += b;
    }
    return ut;
  };
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//juletreff-kumi//NO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', 'UID:' + KALENDER_UID, 'DTSTAMP:' + t.naa, 'DTSTART:' + t.start, 'DTEND:' + t.slutt,
    'SUMMARY:' + tekst(KALENDER_TITTEL), 'LOCATION:' + tekst(KALENDER_STED),
    'DESCRIPTION:' + tekst(KALENDER_OM + '\n\n' + site + '/'), 'URL:' + site + '/',
    'END:VEVENT', 'END:VCALENDAR'].map(brett).join('\r\n') + '\r\n';
}

/** Under klokkeslettet i bekreftelsen: Apple og Outlook åpner fila på siden, Google får sin egen lenke. */
function kalenderLenker_(a, site) {
  var e = escapeHtml_, ics = site + '/juletreff.ics';
  var lenke = function (href, tekst) {
    return '<a href="' + e(href) + '" style="color: #edb77d; text-decoration: none; border-bottom: 1px dotted #edb77d;">' + tekst + '</a>';
  };
  return '<br><span style="display: inline-block; margin-top: 6px; font-size: .9rem; color: #bdb3a8;">📅 Legg i kalenderen: ' +
    '<span style="white-space: nowrap;">' + lenke(ics, 'Apple') + ' · ' + lenke(googleKalender_(a, site), 'Google') + ' · ' +
    lenke(ics, 'Outlook') + '</span></span>';
}

// Hvor langt bakgrunnsfargen tegnes ut i e-postappens egen marg på mobil. Gmail-appen har 16 px og kan skalere
// innholdet litt ned, så 20 px dekker margen med klaring uten å gå langt inn under appens egen topp og bunn.
var EPOST_MARG_PX = 20;

/**
 * Felles ramme for e-postene: fersken bakgrunn, bilde øverst, mørkt kort og mørk bunntekst.
 * Luften er satt for mobil og økes på brede skjermer, så klienter som fjerner <style> også får plass til innholdet.
 *
 * Bakgrunnen må tåle at e-postappene pakker inn e-posten på hver sin måte:
 * - Noen fjerner <body> (Gmail, Yahoo), så fargen står også på en <div> og en tabell i full bredde.
 * - Gmail-appen legger sin egen hvite marg på 16 px rundt e-posten (<body style="margin: 0 16px"> i appens mal).
 *   Negative marger, position og transform fjernes av Gmail, så det eneste som når ut i margen er en outline.
 *   Den tar ingen plass i layouten og gir derfor ingen sidelengs rulling. box-shadow gjør det samme der outline mangler.
 *   Den slås bare på for smale skjermer, så den ikke kan tegne utenfor e-posten i nettlesere på PC.
 */
function epostRamme_(kropp, bunntekst) {
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  var bilde = cfg_('EPOST_BILDE', site + '/images/kumi.jpeg');
  return '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
    '<meta name="color-scheme" content="light only"><style>@media only screen and (min-width: 601px) {' +
    '.ytre { padding: 30px !important; } .indre { padding: 30px !important; } .boks { padding: 20px !important; } }' +
    '@media only screen and (max-width: 600px) { .omslag { outline: ' + EPOST_MARG_PX + 'px solid #ffd9b0 !important; ' +
    'box-shadow: 0 0 0 ' + EPOST_MARG_PX + 'px #ffd9b0 !important; } }' +
    '@media only screen and (max-width: 420px) { .knapp { font-size: .85rem !important; padding: 8px 15px !important; } }</style></head><body style="margin: 0; padding: 0; background-color: #ffd9b0;" bgcolor="#ffd9b0">' +
    '<div class="omslag" style="background-color: #ffd9b0;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; background-color: #ffd9b0;" bgcolor="#ffd9b0"><tr><td align="center" style="background-color: #ffd9b0;" bgcolor="#ffd9b0">' +
    '<table align="center" width="100%" cellpadding="0" cellspacing="0" class="ytre" style="background-color: #ffd9b0; ' +
    "font-family: 'Poppins', Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 8px;\" bgcolor=\"#ffd9b0\">" +
    '<tr><td style="padding: 0; border-radius: 15px 15px 0 0; overflow: hidden;" bgcolor="#ffd9b0">' +
    '<img src="' + bilde + '" alt="Juletreff på KUMI" style="width: 100%; height: 175px; object-fit: cover; display: block; border-radius: 15px 15px 0 0;">' +
    '</td></tr>' +
    '<tr><td class="indre" style="background-color: #333; color: #F4EADF; font-size: 16px; padding: 12px;" bgcolor="#333">' + kropp + '</td></tr>' +
    '<tr><td style="background-color: #111; padding: 20px; text-align: center; color: #777; border-radius: 0 0 15px 15px;" bgcolor="#111">' +
    '<p style="font-size: .8rem; margin: 0 0 6px 0;">' + bunntekst + '</p>' +
    '<p style="font-size: .8rem; margin: 0;"><a href="' + site + '/#vilkar" style="color: #999;">Salgsvilkår</a> · ' +
    '<a href="' + site + '/#personvern" style="color: #999;">Personvern</a></p>' +
    '</td></tr></table></td></tr></table></div></body></html>';
}

/** «Det er ledig plass»: sendes fra admin til alle på ventelisten. Først til mølla. */
function sendLedigPlassEpost_(r, ledige) {
  var a = arrangement_();
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  var plasser = ledige === 1 ? 'en ledig plass' : ledige + ' ledige plasser';
  var kropp =
    '<h2 style="color: #edb77d; font-size: 1.5rem; margin-top: 0; text-align: center;">Hei ' + escapeHtml_(r.fornavn) + ',</h2>' +
    '<p style="font-weight: bold; font-size: 1.1rem; margin: 20px 0 0 0; letter-spacing: 0.5px; text-align: center;">' +
    'Nå er det ' + plasser + ' på Juletreff på KUMI 🌿</p>' +
    '<p style="font-size: 1rem; line-height: 1.5; margin: 20px 0 0 0; text-align: center;">' +
    'Du står på ventelisten, og vi sier fra til alle på listen samtidig. Den som melder seg på først, får plassen.</p>' +
    epostKnapp_(site + '/', 'Meld meg på nå') +
    epostTabell_(
      epostRad_('Tid:', escapeHtml_(a.dato)) +
      epostRad_('Sted:', escapeHtml_(a.sted)) +
      epostRad_('Pris:', a.pris + ' kr', true)) +
    '<p style="font-size: .85rem; line-height: 1.5; margin: 26px 0 0 0; color: #bdb3a8; text-align: center;">' +
    'Påmeldingsfristen er ' + escapeHtml_(a.fristTekst) + '. Vil du ikke lenger stå på ventelisten, kan du bare svare på denne e-posten.</p>';
  var tekst = 'Hei ' + r.fornavn + '!\n\nNå er det ' + plasser + ' på Juletreff på KUMI (' + a.dato + ').\n' +
    'Du står på ventelisten, og vi sier fra til alle på listen samtidig. Den som melder seg på først, får plassen.\n\n' +
    'Meld deg på her: ' + site + '/\n\nPåmeldingsfristen er ' + a.fristTekst + '.\n\nGod jul!';
  MailApp.sendEmail(r.epost, (erTest_(r) ? '[TEST] ' : '') + '✨ Ledig plass på Juletreff på KUMI 🥂', tekst, {
    htmlBody: epostRamme_(kropp, 'Spørsmål? Svar på denne e-posten.'),
    name: cfg_('AVSENDER_NAVN', 'Juletreff på KUMI'), replyTo: cfg_('SVAR_EPOST', '') || undefined
  });
}

/** Gullknappen som brukes i alle e-postene. */
function epostKnapp_(href, tekst) {
  return '<p style="margin: 34px 0; text-align: center;"><a href="' + href + '" class="knapp" style="display: inline-block; ' +
    'background-color: #edb77d; background-image: linear-gradient(180deg, #f3c992 0%, #e3a865 100%); padding: 14px 36px; ' +
    'border-radius: 999px; color: #1b1b1b; font-size: 1.05rem; font-weight: bold; letter-spacing: 0.5px; text-decoration: none; ' +
    'box-shadow: 0 4px 14px rgba(237, 183, 125, 0.35);">' + tekst + '</a></p>';
}

function epostRad_(k, v, sist, farge) {
  // Ingen luft ytterst i radene: teksten flukter med kortet, så verdien får all bredden.
  var td = 'padding: 8px 0; color: #F4EADF;' + (sist ? '' : ' border-bottom: 1px solid #555;');
  // Første kolonne er bare så bred som den lengste etiketten, så verdien får resten av plassen.
  return '<tr><td style="' + td + ' width: 1%; white-space: nowrap; padding-right: 12px; vertical-align: top;" bgcolor="#333"><b>' + k + '</b></td>' +
    '<td style="' + td + ' vertical-align: top; overflow-wrap: anywhere;' + (farge ? ' color: ' + farge + ';' : '') + '" bgcolor="#333">' + v + '</td></tr>';
}

function epostTabell_(innhold, margin) {
  return '<table width="100%" cellpadding="0" cellspacing="0" style="' + (margin || '') +
    'color: #F4EADF; font-size: 1rem; text-align: left;">' + innhold + '</table>';
}

function epostHei_(fornavn, ingress) {
  return '<h2 style="color: #edb77d; font-size: 1.5rem; margin-top: 0; text-align: center;">Hei ' + escapeHtml_(fornavn) + ',</h2>' +
    '<p style="font-weight: bold; font-size: 1.1rem; margin: 20px 0 0 0; letter-spacing: 0.5px; text-align: center;">' + ingress + '</p>';
}

function epostAvsnitt_(tekst, liten) {
  return '<p style="font-size: ' + (liten ? '.85rem; color: #bdb3a8;' : '1rem;') + ' line-height: 1.5; margin: 20px 0 0 0; text-align: center;">' +
    tekst + '</p>';
}

/**
 * Oransje Vipps-boks i e-postene for den som ikke har betalt ennå.
 *  Vipps privat: «Åpne Vipps»-knapp med nummeret fylt ut (mobilnummer), og tabell med alt som trengs.
 *  Vipps bedrift: «Betal med Vipps»-knapp til betalingssiden, som sender videre til Vipps.
 */
function vippsBoks_(r, undertekst) {
  var b = betalingsinfo_(r), e = escapeHtml_, side = betalingsside_(r);
  var knapp = function (href, tekst) {
    return '<p style="margin: 18px 0 6px 0; text-align: center;"><a href="' + e(href) + '" class="knapp" style="display: inline-block; ' +
      'background-color: #ff5b24; padding: 14px 30px; border-radius: 999px; color: #ffffff; font-size: 1.05rem; font-weight: bold; ' +
      'letter-spacing: 0.3px; text-decoration: none;">' + tekst + '</a></p>';
  };
  var lenkeStil = 'color: #edb77d; text-decoration: none; border-bottom: 1px dotted #edb77d;';
  var innhold;
  if (b.losning === 'bedrift') {
    innhold = knapp(side, 'Betal ' + r.belop + ' kr med Vipps') +
      '<p style="text-align: center; margin: 10px 0 0 0; font-size: .85rem; color: #bdb3a8;">Knappen åpner betalingssiden, som sender deg videre til Vipps.</p>';
  } else {
    innhold = (b.lenke
        ? knapp(b.lenke, 'Åpne Vipps og betal ' + r.belop + ' kr') +
          // Som på betalingssiden: åpner ikke lenken appen, har betalingssiden flere måter å åpne Vipps på.
          '<p style="text-align: center; margin: 4px 0 0 0; font-size: .75rem;"><a href="' + e(side) + '" style="color: #bdb3a8; text-decoration: none; border-bottom: 1px dotted #8a8178;">Åpnet ikke Vipps?</a></p>' +
          '<p style="text-align: center; margin: 10px 0 15px 0; font-size: .85rem; color: #bdb3a8;">Knappen åpner Vipps med nummeret fylt ut. ' +
          'Er du på PC, kan du skanne QR-koden på <a href="' + e(side) + '" style="' + lenkeStil + '">betalingssiden</a>.</p>'
        : b.nr ? knapp(side, 'Åpne betalingssiden') : '') +
      (b.nr ? epostTabell_(
        epostRad_(b.mobil ? 'Vipps til:' : 'Vipps-nummer:', '<b>' + e(b.mottaker) + '</b>', false, '#edb77d') +
        (b.vippsNavn ? epostRad_('Mottaker:', e(b.vippsNavn), false) : '') +
        epostRad_('Beløp:', '<b>' + r.belop + ' kr</b>', false, '#edb77d') +
        epostRad_('Melding:', '<b>' + e(b.melding) + '</b>', true, '#edb77d')) : '');
  }
  return '<div class="boks" style="border: 1px solid #ff5b24; border-radius: 10px; padding: 14px 12px; margin: 30px 0;">' +
    '<h3 style="font-size: 1.2rem; color: #ff5b24; margin: 0 0 10px 0; text-align: center;">Betal ' + r.belop + ' kr med Vipps</h3>' +
    '<p style="text-align: center; margin: 0;">' + undertekst + '</p>' + innhold + '</div>';
}

/** Samme betalingsinfo som tekst, for e-postapper som ikke viser HTML. */
function vippsTekst_(r) {
  var b = betalingsinfo_(r);
  if (b.losning === 'bedrift') return 'Betal ' + r.belop + ' kr med Vipps her: ' + betalingsside_(r);
  return 'Betal ' + r.belop + ' kr med Vipps' + (b.nr ? ' til ' + b.mottaker + (b.vippsNavn ? ' (' + b.vippsNavn + ')' : '') : '') +
    ' og skriv «' + b.melding + '» i meldingen.' +
    (b.lenke ? '\nÅpne Vipps (på mobilen): ' + b.lenke : '') + '\nBetalingssiden: ' + betalingsside_(r);
}

function sendEpost_(til, emne, tekst, kropp, bunntekst) {
  MailApp.sendEmail(til, emne, tekst, {
    htmlBody: epostRamme_(kropp, bunntekst || 'Spørsmål? Svar på denne e-posten.'),
    name: cfg_('AVSENDER_NAVN', 'Juletreff på KUMI'), replyTo: cfg_('SVAR_EPOST', '') || undefined
  });
}

function sendVentelisteEpost_(r) {
  var a = arrangement_();
  var fb = facebookUrl_();
  try {
    sendEpost_(r.epost, (erTest_(r) ? '[TEST] ' : '') + '✨ Du står på ventelisten: Juletreff på KUMI',
      'Hei ' + r.fornavn + '!\n\nJuletreffet ' + a.dato + ' er fullt akkurat nå, men du står på ventelisten. ' +
      'Blir det ledig plass, sier vi fra på e-post. Du betaler ingenting før du har fått en plass.\n\n' +
      'Følg gjerne Facebook-eventet: ' + fb + '\n\nGod jul!',
      epostHei_(r.fornavn, 'Du står på ventelisten til Juletreff på KUMI 🌿') +
      epostAvsnitt_('Juletreffet ' + escapeHtml_(a.dato.charAt(0).toLowerCase() + a.dato.slice(1)) +
        ' er fullt akkurat nå. Blir det ledig plass, sier vi fra på e-post, og da gjelder først til mølla.') +
      epostAvsnitt_('Du betaler ingenting før du har fått en plass.') +
      epostKnapp_(fb, 'Følg Facebook-eventet 📅') +
      epostAvsnitt_('Vil du ikke lenger stå på ventelisten? Svar på denne e-posten.', true));
  } catch (err) { console.error('Venteliste-e-post feilet: ' + err); }
}

/** Purring på manglende betaling (manuell Vipps). */
function sendPurring_(r) {
  var a = arrangement_();
  var nr = Math.min(MAKS_PURRINGER, antallPurringer_(r) + 1), siste = nr >= MAKS_PURRINGER;
  var sisteTekst = 'Dette er siste påminnelse. Betaler du ikke innen 24 timer, går plassen videre til ventelisten.';
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  sendEpost_(r.epost, (erTest_(r) ? '[TEST] ' : '') + (siste ? 'Siste påminnelse' : 'Påminnelse') + ': betaling for Juletreff på KUMI',
    'Hei ' + r.fornavn + '!\n\nVi har ikke registrert betalingen for påmeldingen din (' + r.id + ') ennå.\n\n' +
    vippsTekst_(r) + '\n\n' +
    (siste ? sisteTekst + '\n\n' : '') +
    'Har du betalt de siste dagene, kan du se bort fra denne e-posten.\n\n' +
    'Påmeldingen er bindende. Salgsvilkår: ' + site + '/#vilkar\n\nGod jul!',
    epostHei_(r.fornavn, siste ? 'Siste påminnelse om betaling' : 'En liten påminnelse om betaling 🌿') +
    epostAvsnitt_('Vi har ikke registrert betalingen for påmeldingen din til juletreffet ' +
      escapeHtml_(a.dato.charAt(0).toLowerCase() + a.dato.slice(1)) + ' ennå.') +
    vippsBoks_(r, 'Plassen din er sikret når betalingen er mottatt.') +
    (siste ? epostAvsnitt_('<b>' + sisteTekst + '</b>') : '') +
    epostAvsnitt_('Har du betalt de siste dagene, kan du se bort fra denne e-posten.') +
    epostKnapp_(site + '/#vilkar', 'Les salgsvilkårene') +
    epostAvsnitt_('Påmeldingen er bindende. Påmeldings-ID: ' + r.id + '.', true),
    'Spørsmål om betalingen? Svar på denne e-posten.');
}

/** Sendes når admin trekker en påmelding. Sier hva som skjer med pengene. */
function sendTrukketEpost_(r, tilbake, refundertNaa, ikkeBetalt) {
  var a = arrangement_();
  var betalt = !!r.betalt || r.status === 'BETALT';
  var penger = !betalt ? ''
    : tilbake <= 0 ? 'Ingenting betales tilbake, i tråd med salgsvilkårene.'
    : refundertNaa ? tilbake + ' kr er betalt tilbake til Vipps-kontoen din.'
    : 'Du får ' + tilbake + ' kr tilbake på Vipps i løpet av noen dager.';
  var gebyr = betalt && tilbake > 0 && tilbake < Number(r.belop)
    ? ' ' + (Number(r.belop) - tilbake) + ' kr dekker KUMIs no-show-gebyr, siden avmeldingen kom under 48 timer før.' : '';
  sendEpost_(r.epost, (erTest_(r) ? '[TEST] ' : '') + 'Du er meldt av Juletreff på KUMI',
    'Hei ' + r.fornavn + '!\n\nPåmeldingen din (' + r.id + ') til juletreffet ' + a.dato + ' er trukket.' +
    (ikkeBetalt ? '\n\nVi har ikke mottatt betalingen etter ' + MAKS_PURRINGER + ' påminnelser, så plassen går videre til ventelisten.' : '') +
    (penger ? '\n\n' + penger + gebyr : '') + '\n\nStemmer ikke dette? Svar på denne e-posten.\n\nGod jul!',
    epostHei_(r.fornavn, 'Påmeldingen din er trukket') +
    (ikkeBetalt ? epostAvsnitt_('Vi har ikke mottatt betalingen etter ' + MAKS_PURRINGER + ' påminnelser, så plassen går videre til ventelisten.') : '') +
    epostAvsnitt_('Du er meldt av juletreffet ' + escapeHtml_(a.dato.charAt(0).toLowerCase() + a.dato.slice(1)) + '.') +
    (penger ? epostAvsnitt_('<b>' + penger + '</b>' + gebyr) : '') +
    epostAvsnitt_('Stemmer ikke dette? Svar på denne e-posten. Påmeldings-ID: ' + r.id + '.', true),
    'Spørsmål? Svar på denne e-posten.');
}

/** Sendes når admin markerer en tilbakebetaling som gjennomført. */
function sendRefundertEpost_(r, belop) {
  sendEpost_(r.epost, (erTest_(r) ? '[TEST] ' : '') + 'Pengene er betalt tilbake: Juletreff på KUMI',
    'Hei ' + r.fornavn + '!\n\nVi har betalt tilbake ' + belop + ' kr for påmeldingen din (' + r.id + ') på Vipps.\n\n' +
    'Ser du ikke pengene i løpet av et par dager? Svar på denne e-posten.\n\nGod jul!',
    epostHei_(r.fornavn, belop + ' kr er betalt tilbake 🌿') +
    epostAvsnitt_('Vi har betalt tilbake ' + belop + ' kr for påmeldingen din på Vipps.') +
    epostAvsnitt_('Ser du ikke pengene i løpet av et par dager? Svar på denne e-posten. Påmeldings-ID: ' + r.id + '.', true),
    'Spørsmål? Svar på denne e-posten.');
}

var STANDARD_PROGRAM = '18.30 Ankomst på KUMI\n19.00 Middag serveres\n19.30 Birger\n21.30 Vi går videre til MUNCH bar';
var STANDARD_TAKK = 'Tusen takk for at du var med på juletreffet på KUMI! Vi håper du koste deg like mye som oss.\n\nGod jul og godt nytt år!';
var MUNCH_BAR_URL = 'https://www.munch.no/mat-drikke-MUNCH/munch-bar/';
var MUNCH_MENY_URL = 'https://www.munch.no/globalassets/foto-munch/mat-og-drikke/menyer/munch-bar-13th-17.10.pdf';
var MAKS_PURRINGER = 3;
function takk_() { return cfg_('TAKK_TEKST', STANDARD_TAKK); }
function antallPurringer_(r) { return Number(r.purringer) || (r.purret ? 1 : 0); }
function program_() { return cfg_('PROGRAM_TEKST', STANDARD_PROGRAM); }

/** Fellesmail før arrangementet: kort program og praktisk info. */
function sendProgramEpost_(r) {
  var a = arrangement_(), e = escapeHtml_;
  var linjer = program_().split('\n').map(function (l) { return l.trim(); }).filter(String);
  var rader = linjer.map(function (l, i) {
    var m = l.match(/^(\d{1,2}[.:]\d{2})\s*[-–:]?\s*(.+)$/);
    return m ? epostRad_(e(m[1]), e(m[2]), i === linjer.length - 1)
      : '<tr><td colspan="2" style="padding: 8px; color: #F4EADF;" bgcolor="#333">' + e(l) + '</td></tr>';
  }).join('');
  var kart = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('KUMI Operagata 71B Oslo');
  var ubetalt = r.status === 'UBETALT';
  var tlf = cfg_('KONTAKT_TELEFON', '');
  sendEpost_(r.epost, (erTest_(r) ? '[TEST] ' : '') + '✨ Snart juletreff på KUMI 🥂 Her er programmet',
    'Hei ' + r.fornavn + '!\n\nSnart er det juletreff: ' + a.dato + ' på ' + a.sted + '.\n\nProgram:\n' + linjer.join('\n') +
    (ubetalt ? '\n\nVi har ikke registrert betalingen din ennå. ' + vippsTekst_(r) : '') +
    '\n\nKart: ' + kart + '\nMUNCH bar (20 års aldersgrense): ' + MUNCH_BAR_URL + '\nDrikkemeny på MUNCH bar: ' + MUNCH_MENY_URL +
    (tlf ? '\n\nFinner du ikke fram på dagen? Ring ' + tlf + '.' : '') +
    '\nFacebook-eventet: ' + facebookUrl_() + '\n\nVi gleder oss til å se deg!',
    epostHei_(r.fornavn, 'Snart er det juletreff 🥂') +
    epostAvsnitt_(e(a.dato) + '<br>' + e(a.sted)) +
    '<h3 style="color: #edb77d; font-size: 1.1rem; margin: 30px 0 10px 0; text-align: center;">Program</h3>' +
    epostTabell_(rader) +
    (ubetalt ? vippsBoks_(r, 'Vi har ikke registrert betalingen din ennå.') : '') +
    epostKnapp_(kart, 'Finn veien til KUMI 📍') +
    (tlf ? epostAvsnitt_('Finner du ikke fram på dagen? Ring <a href="tel:+47' + tlf.replace(/\D/g, '') + '" style="color: #edb77d;"><b>' + e(tlf) + '</b></a>.') : '') +
    epostAvsnitt_('Etterpå går vi videre til <a href="' + MUNCH_BAR_URL + '" style="color: #edb77d;">MUNCH bar</a> i 13. etasje på MUNCH (20 års aldersgrense). ' +
      'Drikkemenyen finner du <a href="' + MUNCH_MENY_URL + '" style="color: #edb77d;">her</a>.') +
    epostAvsnitt_('Følg med på <a href="' + facebookUrl_() + '" style="color: #edb77d;">Facebook-eventet</a> for siste nytt. Vi gleder oss til å se deg!'),
    Date.now() > a.start.getTime() - 48 * 36e5
      ? 'Kan du ikke komme likevel? Svar på denne e-posten. Det er under 48 timer igjen, så ved avmelding med legeerklæring beholder vi ' + a.noshow + ' kr til KUMIs no-show-gebyr.'
      : 'Kan du ikke komme likevel? Svar på denne e-posten. Avmelding krever legeerklæring, og under 48 timer før beholder vi ' + a.noshow + ' kr til KUMIs no-show-gebyr.');
}

/** Takk for sist. Sendes manuelt fra admin etter arrangementet. */
function sendTakkEpost_(r) {
  var avsnitt = takk_().split(/\n\s*\n/).map(function (t) { return t.trim(); }).filter(String);
  sendEpost_(r.epost, (erTest_(r) ? '[TEST] ' : '') + '✨ Takk for sist! Juletreff på KUMI',
    'Hei ' + r.fornavn + '!\n\n' + avsnitt.join('\n\n'),
    epostHei_(r.fornavn, 'Takk for sist 🥂') +
    avsnitt.map(function (t) { return epostAvsnitt_(escapeHtml_(t).replace(/\n/g, '<br>')); }).join('') +
    epostKnapp_(facebookUrl_(), 'Del bilder i Facebook-eventet 📸'),
    'Vi sletter opplysningene dine senest tre måneder etter arrangementet.');
}

/* ------------------------------------------------------------------ */
/* Besøksstatistikk                                                    */
/* ------------------------------------------------------------------ */

function hit_(p) {
  var ref = String(p.ref || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '').slice(0, 60);
  // Anonym daglig besøks-ID fra sessionStorage. Ingen informasjonskapsler og ingen IP-adresse.
  sheet_(BESOK_ARK).appendRow([new Date(), String(p.v || '').slice(0, 16), ref || 'direkte', p.mobil === '1' ? 'mobil' : 'pc'].map(celle_));
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Adminsiden                                                          */
/* ------------------------------------------------------------------ */

function hashPassord_(passord, salt) {
  var h = String(salt || '') + String(passord || '');
  for (var i = 0; i < 2000; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return h;
}

function adminLogin_(passord) {
  var cache = CacheService.getScriptCache();
  var forsok = Number(cache.get('admin_feil') || 0);
  if (forsok >= 10) return { ok: false, error: 'For mange forsøk. Vent 15 minutter.' };
  hentNyttAdminPassord_();
  var salt = cfg_('ADMIN_SALT', ''), hash = cfg_('ADMIN_PASSORD_HASH', '');
  if (!salt || !hash) {
    return { ok: false, error: 'Adminpassordet er ikke satt ennå. Legg det inn som skriptegenskapen ADMIN_PASSORD i Apps Script (Prosjektinnstillinger → Skriptegenskaper).' };
  }
  if (!passord || hashPassord_(passord, salt) !== hash) {
    cache.put('admin_feil', String(forsok + 1), 900);
    Utilities.sleep(800);
    return { ok: false, error: 'Feil passord' };
  }
  cache.remove('admin_feil');
  var okt = nyNokkel_(48);
  cache.put('admin_okt_' + okt, '1', 2 * 3600); // innloggingen varer i 2 timer
  return { ok: true, okt: okt };
}

/** Et passord lagt inn som skriptegenskapen ADMIN_PASSORD gjøres om til salt + hash, og klarteksten slettes. */
function hentNyttAdminPassord_() {
  var props = PropertiesService.getScriptProperties();
  var nytt = props.getProperty('ADMIN_PASSORD');
  if (!nytt) return;
  if (nytt.length < 12) throw new Brukerfeil('Adminpassordet i ADMIN_PASSORD må ha minst 12 tegn.');
  var salt = nyNokkel_(32);
  props.setProperty('ADMIN_SALT', salt);
  props.setProperty('ADMIN_PASSORD_HASH', hashPassord_(nytt, salt));
  props.deleteProperty('ADMIN_PASSORD');
}

function adminLogout_(okt) {
  if (okt) CacheService.getScriptCache().remove('admin_okt_' + okt);
  return { ok: true };
}

function sjekkOkt_(okt) {
  return /^[a-f0-9]{48}$/.test(okt || '') && !!CacheService.getScriptCache().get('admin_okt_' + okt);
}

function adminOversikt_(okt) {
  if (!sjekkOkt_(okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  sikreRapportUtloser_();
  var a = arrangement_();
  var rader = alle_();
  var antall = { BETALT: 0, UBETALT: 0, VENTER: 0, AVBRUTT: 0, VENTELISTE: 0, TRUKKET: 0 };
  var innbetalt = 0, refundert = 0;
  var tester = 0;
  rader.forEach(function (r) {
    if (erTest_(r)) { tester++; return; }
    antall[r.status] = (antall[r.status] || 0) + 1;
    if (r.betalt) innbetalt += Number(r.belop) || 0;
    if (r.refundert) refundert += r.refusjon === '' || r.refusjon == null ? Number(r.belop) || 0 : Number(r.refusjon) || 0;
  });

  var tz = Session.getScriptTimeZone();
  var dag = function (d) { return Utilities.formatDate(new Date(d), tz, 'yyyy-MM-dd'); };
  var perDag = {}, kilder = {}, unikeTotalt = {}, besok = 0;
  sheet_(BESOK_ARK).getDataRange().getValues().slice(1).forEach(function (r) {
    var d = dag(r[0]);
    var x = perDag[d] = perDag[d] || { dag: d, besok: 0, unike: {}, pameldinger: 0 };
    x.besok++; besok++;
    if (r[1]) { x.unike[r[1]] = 1; unikeTotalt[d + r[1]] = 1; }
    kilder[r[2] || 'direkte'] = (kilder[r[2] || 'direkte'] || 0) + 1;
  });
  rader.forEach(function (r) {
    if (erTest_(r)) return;
    var d = dag(r.opprettet);
    var x = perDag[d] = perDag[d] || { dag: d, besok: 0, unike: {}, pameldinger: 0 };
    x.pameldinger++;
  });

  var iBanken = pameldingerIBanken_();
  return {
    ok: true,
    testlenke: testlenkeInfo_(),
    arrangement: { dato: a.dato, pris: a.pris, kapasitet: a.kapasitet, fristTekst: a.fristTekst, vippsAktiv: a.vippsAktiv,
      vippsModus: a.vippsModus, harVippsNokler: harVippsNokler_(), vippsMiljo: cfg_('VIPPS_ENV', 'test'),
      vippsNummer: a.vippsNummer, vippsNavn: a.vippsNavn, skjulteNavn: skjulteNavn_(), start: a.start.toISOString(), noshow: a.noshow, rapportTil: rapportMottaker_(),
      facebookUrl: facebookUrl_(), epostKvote: epostKvote_(), svarEpost: cfg_('SVAR_EPOST', ''), program: program_(), takk: takk_(), telefon: cfg_('KONTAKT_TELEFON', ''),
      maksPurringer: MAKS_PURRINGER, betaling: a.vippsAktiv ? 'bedrift' : 'privat',
      gebyrProsent: GEBYR_PROSENT, gebyrKr: GEBYR_KR, varselEpost: varselEpost_(),
      frist: a.frist.toISOString() },
    bank: bankStatus_(),
    bankrader: bankRader_(),
    perBetaling: perBetaling_(rader),
    antall: antall, tester: tester,
    ledige: Math.max(0, a.kapasitet - opptatte_(rader)),
    innbetalt: innbetalt, refundert: refundert,
    besok: { totalt: besok, unike: Object.keys(unikeTotalt).length,
      kilder: Object.keys(kilder).map(function (k) { return { kilde: k, besok: kilder[k] }; })
        .sort(function (x, y) { return y.besok - x.besok; }).slice(0, 10) },
    dager: Object.keys(perDag).sort().reverse().slice(0, 21).map(function (k) {
      var x = perDag[k]; return { dag: k, besok: x.besok, unike: Object.keys(x.unike).length, pameldinger: x.pameldinger };
    }),
    deltakere: rader.slice().reverse().map(function (r) {
      return { id: r.id, opprettet: r.opprettet, status: r.status, navn: r.fornavn + ' ' + r.etternavn, epost: r.epost,
        telefon: r.telefon, kommentar: r.kommentar, belop: r.belop, betaling: r.betaling, betalt: r.betalt,
        trukket: r.trukket, refundert: r.refundert, refusjon: r.refusjon, notat: r.notat, test: erTest_(r), varslet: r.varslet, purret: r.purret,
        program: r.program, purringer: antallPurringer_(r), mott: r.mott, takket: r.takket,
        vippsNavn: r.vipps_navn, vippsApnet: r.vipps_apnet, gebyr: r.gebyr, bankId: r.bank_id, vippsNaa: !!aktivRef_(r),
        iBanken: !!iBanken[r.id] || (!!r.bank_id && r.bank_id !== 'manuell'),
        utenEpost: HOLDER_PLASS.indexOf(r.status) >= 0 && !r.epost_sendt && !epostVenter_(r) };
    })
  };
}

/** Salg, omsetning, gebyr og netto per betalingsløsning (betalte, ikke-test). Refusjoner trekkes fra omsetningen. */
function perBetaling_(rader) {
  var ut = { bedrift: { salg: 0, omsetning: 0, gebyr: 0, netto: 0 }, privat: { salg: 0, omsetning: 0, gebyr: 0, netto: 0 } };
  rader.forEach(function (r) {
    if (erTest_(r) || !r.betalt) return;
    var x = ut[r.betaling === 'vipps' ? 'bedrift' : 'privat'];
    var inn = Number(r.belop) || 0;
    var ut_ = r.refundert ? (r.refusjon === '' || r.refusjon == null ? inn : Number(r.refusjon) || 0) : 0;
    x.salg++;
    x.omsetning += inn - ut_;
    x.gebyr += Number(r.gebyr) || 0;
  });
  ['bedrift', 'privat'].forEach(function (k) {
    var x = ut[k];
    x.omsetning = Math.round(x.omsetning * 100) / 100;
    x.gebyr = Math.round(x.gebyr * 100) / 100;
    x.netto = Math.round((x.omsetning - x.gebyr) * 100) / 100;
  });
  return ut;
}

/** Bankstatus til adminsiden. Hemmeligheter sendes aldri tilbake, bare om de er lagt inn. */
function bankStatus_() {
  return {
    klientId: !!cfg_('BANK_CLIENT_ID', ''), hemmelighet: !!cfg_('BANK_CLIENT_SECRET', ''), finInst: cfg_('BANK_FININST', ''),
    tilkoblet: !!cfg_('BANK_REFRESH_TOKEN', ''), klar: bankKlar_(), konto: cfg_('BANK_KONTO_NAVN', ''),
    sistSjekket: cfg_('BANK_SIST_SJEKKET', ''), tilkobletTid: cfg_('BANK_TILKOBLET', ''),
    utloper: cfg_('BANK_REFRESH_UTLOPER', ''), feil: cfg_('BANK_FEIL', ''),
    pause: !!CacheService.getScriptCache().get('bank_pause')
  };
}

/** Påmeldinger som har en innbetaling i banken knyttet til seg (også de som først ble markert betalt for hånd). */
function pameldingerIBanken_() {
  var sh = SpreadsheetApp.openById(cfg_('SHEET_ID', STANDARD_SHEET_ID)).getSheetByName(BANK_ARK), ut = {};
  if (!sh) return ut;
  var s = BANK_KOLONNER.indexOf('status'), p = BANK_KOLONNER.indexOf('pamelding');
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    if (r[p] && ['KOBLET', 'BOKFORT', 'MANUELT', 'RESERVERT'].indexOf(r[s]) >= 0) ut[r[p]] = 1;
  });
  return ut;
}

/** Innbetalinger som venter på deg: ikke koblet, feil beløp eller mulig dobbel betaling. */
function bankRader_() {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID', STANDARD_SHEET_ID));
  var sh = ss.getSheetByName(BANK_ARK);
  if (!sh) return [];
  var B = {}; BANK_KOLONNER.forEach(function (k, i) { B[k] = i; });
  var skjult = skjulteNavn_(), forst = {};
  return sh.getDataRange().getValues().slice(1).filter(function (r) {
    // Før ID-en ble laget av innholdet, ble samme transaksjon lagret på nytt ved hver sjekk. Gjentakelsene vises ikke.
    // Ukoblede ble lagret på nytt og de forrige merket BORTE, så de siste ukoblede er ekte, selv når flere er like
    // (to reservasjoner uten navn samme dag). Bare en gammel koblet eller avgjort rad gjør senere like rader til gjentakelser.
    // shortcut: gjelder bare de gamle radene (ID uten «i»-format). Kan fjernes når de er nullstilt.
    var k = [r[B.dato], r[B.belop], r[B.bokforing], r[B.type], r[B.tekst]].join('|'), gammel = gammelBankId_(r[B.bank_id]);
    var gjentatt = gammel && forst[k];
    if (gammel && ['UMATCHET', 'BORTE'].indexOf(r[B.status]) < 0) forst[k] = 1;
    return !gjentatt && ['UMATCHET', 'FEIL_BELOP', 'DUPLIKAT', 'SJEKK', 'NULLSTILT'].indexOf(r[B.status]) >= 0 &&
      !skjult.some(function (n) { return navnTreff_(n, r[B.navn] + ' ' + r[B.tekst]); });
  }).map(function (r) {
    var d = r[B.dato] instanceof Date ? Utilities.formatDate(r[B.dato], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[B.dato]);
    return { bankId: String(r[B.bank_id]), sett: r[B.sett], dato: d, belop: Number(r[B.belop]), navn: String(r[B.navn]),
      tekst: String(r[B.tekst]), status: r[B.status], forslag: String(r[B.pamelding] || ''), bokforing: String(r[B.bokforing]) };
  }).reverse().slice(0, 50);
}

/**
 * Endringer fra adminsiden:
 *  betalt     markerer en manuell Vipps-betaling som mottatt (og sender bekreftelse)
 *  trekk      trekker påmeldingen (legeerklæring), og refunderer i Vipps hvis den ble betalt der.
 *             Under 48 timer før start (sent=true) beholdes no-show-gebyret, ellers refunderes alt.
 *  refundert  markerer at pengene er sendt tilbake manuelt
 *  angre      betalt (manuell Vipps) tilbake til ubetalt, og den koblede innbetalingen tilbake i listen over ukoblede
 *  tilbud     gir en plass fra ventelisten: settes til UBETALT, eller får Vipps-lenke på e-post
 */
function adminEndre_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var o = finn_('id', p.id);
    if (!o) return { ok: false, error: 'Fant ikke påmeldingen' };
    var notat = tekst_(p.notat, 200);
    var stempel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM HH:mm');
    var nyttNotat = function (t) { return [o.notat, stempel + ' ' + t].filter(String).join(' | ').slice(-500); };
    var varsle = !(p.varsle === false || p.varsle === 'false');

    if (p.handling === 'betalt') {
      if (o.status !== 'UBETALT') return { ok: false, error: 'Bare ubetalte påmeldinger kan markeres som betalt' };
      // Betalt av noen andre: banken skal se etter det navnet, så betalingen blir gjenkjent når den kommer
      var betaler = tekst_(p.betaler, 80).replace(/\s+/g, ' ');
      if (betaler && navnOrd_(betaler).length < 2) return { ok: false, error: 'Skriv fullt navn på den som betalte, slik det står i Vipps.' };
      oppdater_(o._rad, { status: 'BETALT', betalt: new Date(), betaling: 'manuell', bank_id: 'manuell', gebyr: 0,
        notat: nyttNotat('Markert betalt' + (betaler ? ': betalt av ' + betaler : '') + (notat ? ': ' + notat : '')),
        vipps_navn: betaler || o.vipps_navn });
      o.betaling = 'manuell';
      o.status = 'BETALT';
      var kvittert = sendBekreftelse_(o);
      return { ok: true, melding: 'Markert som betalt.' + (kvittert ? ' ' + o.fornavn + ' har fått bekreftelse på e-post.' : ' Bekreftelsen ble ikke sendt, prøv «Send bekreftelsen på nytt» senere.') };
    }
    if (p.handling === 'angre') {
      if (o.status !== 'BETALT') return { ok: false, error: 'Bare betalte påmeldinger kan settes tilbake til ikke betalt' };
      if (o.betaling === 'vipps') return { ok: false, error: 'Betalt med Vipps bedrift. Bruk «Trekk påmeldingen» for å betale tilbake.' };
      oppdater_(o._rad, { status: 'UBETALT', betalt: '', bank_id: '', notat: nyttNotat('Betaling angret' + (notat ? ': ' + notat : '')) });
      // Innbetalingen som ble koblet, tilbake i listen over ukoblede. Varslet nå, så det ikke kommer et varsel om den.
      var bAngre = o.bank_id && o.bank_id !== 'manuell' && finnBankRad_(String(o.bank_id));
      if (bAngre) oppdaterBankRad_(bAngre.row, { status: 'UMATCHET', pamelding: '', varslet: new Date() });
      venterPaBank_();
      return { ok: true, melding: o.fornavn + ' står som ikke betalt igjen og beholder plassen.' +
        (bAngre ? ' Innbetalingen er tilbake i listen over ukoblede innbetalinger.' : '') + ' Ingen e-post er sendt.' };
    }
    if (p.handling === 'trekk') {
      if (['BETALT', 'UBETALT', 'VENTELISTE'].indexOf(o.status) < 0) return { ok: false, error: 'Påmeldingen kan ikke trekkes' };
      var felt = { status: 'TRUKKET', trukket: new Date(), notat: nyttNotat('Trukket' + (notat ? ': ' + notat : '')) };
      var melding = 'Påmeldingen er trukket.';
      if (o.status === 'BETALT') {
        var aa = arrangement_();
        var sent = p.sent === true || p.sent === 'true' ||
          (p.sent === undefined && Date.now() > aa.start.getTime() - 48 * 36e5);
        var tilbake = sent ? Math.max(0, Number(o.belop) - aa.noshow) : Number(o.belop);
        felt.refusjon = tilbake;
        felt.notat = nyttNotat('Trukket ' + (sent ? 'under' : 'mer enn') + ' 48 t før, refusjon ' + tilbake + ' kr' + (notat ? ': ' + notat : ''));
        if (tilbake > 0 && o.betaling === 'vipps' && (p.refunder === true || p.refunder === 'true')) {
          vipps_('post', '/epayment/v1/payments/' + encodeURIComponent(betaltRef_(o)) + '/refund',
            { modificationAmount: { currency: 'NOK', value: Math.round(tilbake * 100) } }, 'refund-' + betaltRef_(o));
          felt.refundert = new Date();
          melding += ' ' + tilbake + ' kr er refundert i Vipps.';
        } else if (tilbake > 0) {
          melding += ' Husk å betale tilbake ' + tilbake + ' kr, og marker som refundert.';
        } else {
          melding += ' Ingenting skal betales tilbake.';
        }
      }
      oppdater_(o._rad, felt);
      if (varsle) {
        try {
          sendTrukketEpost_(o, o.status === 'BETALT' ? felt.refusjon : 0, !!felt.refundert);
          melding += ' ' + o.fornavn + ' har fått e-post om det.';
        } catch (err) { console.error('E-post om trekk feilet for ' + o.id + ': ' + err); melding += ' E-posten til deltakeren ble ikke sendt.'; }
      }
      return { ok: true, melding: melding };
    }
    if (p.handling === 'refundert') {
      if (o.status !== 'TRUKKET' || !o.betalt) return { ok: false, error: 'Bare trukne, betalte påmeldinger kan markeres som refundert' };
      if (o.refundert) return { ok: false, error: 'Påmeldingen er allerede markert som refundert' };
      oppdater_(o._rad, { refundert: new Date(), notat: nyttNotat('Refundert manuelt') });
      var belopTilbake = o.refusjon === '' || o.refusjon == null ? Number(o.belop) : Number(o.refusjon);
      var refMelding = 'Markert som refundert.';
      if (varsle) {
        try { sendRefundertEpost_(o, belopTilbake); refMelding += ' ' + o.fornavn + ' har fått e-post om at ' + belopTilbake + ' kr er betalt tilbake.'; }
        catch (err) { console.error('E-post om refusjon feilet for ' + o.id + ': ' + err); refMelding += ' E-posten til deltakeren ble ikke sendt.'; }
      }
      return { ok: true, melding: refMelding };
    }
    if (p.handling === 'tilbud') {
      if (o.status !== 'VENTELISTE') return { ok: false, error: 'Bare påmeldinger på ventelisten kan få plass' };
      var a = arrangement_();
      if (!erTest_(o) && opptatte_(alle_()) >= a.kapasitet) {
        return { ok: false, error: 'Det er ingen ledige plasser. Øk antall plasser under Innstillinger først, hvis du vil gi plass likevel.' };
      }
      oppdater_(o._rad, { status: 'UBETALT', betaling: a.vippsAktiv ? 'vipps' : 'manuell', notat: nyttNotat('Fikk plass fra ventelisten') });
      o.status = 'UBETALT';
      if (!a.vippsAktiv) venterPaBank_();
      sendBekreftelse_(o);
      return { ok: true, melding: o.fornavn + ' har fått plass og fått e-post med betalingsinfo' +
        (a.vippsAktiv ? ' (betal med Vipps-knappen)' : a.vippsNummer ? ' (Vipps til ' + vippsTil_(a.vippsNummer) + ')' : '') + '.' };
    }
    if (p.handling === 'overdra') {
      if (['BETALT', 'UBETALT'].indexOf(o.status) < 0) return { ok: false, error: 'Bare påmeldte kan gi plassen videre' };
      var ny = {
        fornavn: tekst_(p.fornavn, 60), etternavn: tekst_(p.etternavn, 60),
        epost: tekst_(p.epost, 120).toLowerCase(), telefon: formatPhone_(tekst_(p.telefon, 20))
      };
      if (!ny.fornavn || !ny.etternavn) return { ok: false, error: 'Skriv inn fornavn og etternavn på den nye deltakeren' };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ny.epost)) return { ok: false, error: 'Skriv inn en gyldig e-postadresse' };
      if (String(ny.telefon).replace(/\D/g, '').length < 8) return { ok: false, error: 'Skriv inn et gyldig telefonnummer' };
      var opptattEpost = alle_().some(function (x) { return x.id !== o.id && x.epost === ny.epost && !erTest_(x) && HOLDER_PLASS.indexOf(x.status) >= 0; });
      if (opptattEpost) return { ok: false, error: ny.epost + ' er allerede påmeldt' };
      var fra = o.fornavn + ' ' + o.etternavn;
      // Den nye deltakeren får ny nøkkel, så den gamle bekreftelseslenken ikke virker lenger.
      Object.assign(ny, { nokkel: nyNokkel_(), kommentar: '', epost_sendt: '', purret: '', purringer: '', program: '', mott: '', takket: '',
        vipps_navn: '', vipps_apnet: '',
        notat: nyttNotat('Overtatt fra ' + fra + ' (' + o.epost + ')' + (notat ? ': ' + notat : '')) });
      oppdater_(o._rad, ny);
      Object.assign(o, ny);
      var sendtNy = sendBekreftelse_(o);
      return { ok: true, melding: 'Plassen er gitt videre fra ' + fra + ' til ' + ny.fornavn + ' ' + ny.etternavn + '.' +
        (sendtNy ? ' ' + ny.fornavn + ' har fått bekreftelse på e-post.' : ' Bekreftelsen ble ikke sendt, prøv «Send bekreftelsen på nytt» senere.') +
        (o.status === 'UBETALT' ? ' Plassen er ikke betalt ennå.' : '') };
    }
    if (p.handling === 'bekreftelse') {
      if (['BETALT', 'UBETALT'].indexOf(o.status) < 0) return { ok: false, error: 'Bekreftelse kan bare sendes til påmeldte' };
      oppdater_(o._rad, { epost_sendt: '' });
      sendBekreftelse_(o);
      var etter = finn_('id', o.id);
      if (!etter || !etter.epost_sendt) return { ok: false, error: 'E-posten ble ikke sendt. Sjekk adressen, og at dagens e-postkvote ikke er brukt opp.' };
      return { ok: true, melding: 'Bekreftelsen er sendt på nytt til ' + o.epost + '.' };
    }
    if (p.handling === 'purring') {
      if (o.status !== 'UBETALT') return { ok: false, error: 'Bare ubetalte påmeldinger kan purres' };
      var np = antallPurringer_(o);
      if (np >= MAKS_PURRINGER) return { ok: false, error: o.fornavn + ' har fått ' + MAKS_PURRINGER + ' purringer. Velg «Frigi plassen» hvis betalingen ikke kommer.' };
      sendPurring_(o);
      venterPaBank_();
      oppdater_(o._rad, { purret: new Date(), purringer: np + 1, notat: nyttNotat('Purring ' + (np + 1) + (notat ? ': ' + notat : '')) });
      return { ok: true, melding: 'Purring ' + (np + 1) + ' av ' + MAKS_PURRINGER + ' er sendt til ' + o.fornavn + ' ' + o.etternavn + '.' +
        (np + 1 >= MAKS_PURRINGER ? ' Det var den siste. Kommer ikke betalingen, kan du frigi plassen.' : '') };
    }
    if (p.handling === 'frigi') {
      if (o.status !== 'UBETALT') return { ok: false, error: 'Bare ubetalte påmeldinger kan miste plassen' };
      if (antallPurringer_(o) < MAKS_PURRINGER) return { ok: false, error: 'Plassen kan frigis etter ' + MAKS_PURRINGER + ' purringer. ' + o.fornavn + ' har fått ' + antallPurringer_(o) + '.' };
      oppdater_(o._rad, { status: 'TRUKKET', trukket: new Date(), notat: nyttNotat('Mistet plassen: ikke betalt etter ' + MAKS_PURRINGER + ' purringer' + (notat ? ': ' + notat : '')) });
      var fm = 'Plassen til ' + o.fornavn + ' er frigitt.';
      if (varsle) {
        try { sendTrukketEpost_(o, 0, false, true); fm += ' ' + o.fornavn + ' har fått e-post om det.'; }
        catch (err) { console.error('E-post om frigitt plass feilet for ' + o.id + ': ' + err); fm += ' E-posten til deltakeren ble ikke sendt.'; }
      }
      return { ok: true, melding: fm };
    }
    if (p.handling === 'mott' || p.handling === 'ikkemott') {
      if (HOLDER_PLASS.indexOf(o.status) < 0) return { ok: false, error: 'Bare påmeldte kan sjekkes inn' };
      oppdater_(o._rad, { mott: p.handling === 'mott' ? new Date() : '' });
      return { ok: true, melding: p.handling === 'mott'
        ? o.fornavn + ' ' + o.etternavn + ' er sjekket inn.' + (o.status === 'UBETALT' ? ' OBS: har ikke betalt.' : '')
        : 'Innsjekkingen av ' + o.fornavn + ' ' + o.etternavn + ' er angret.' };
    }
    if (p.handling === 'slett') {
      if (!erTest_(o)) return { ok: false, error: 'Bare testpåmeldinger kan slettes' };
      if (o.status === 'BETALT' && o.betaling === 'vipps' && !o.refundert) {
        return { ok: false, error: 'Testen er betalt i Vipps. Trekk den og refunder først, så kan den slettes.' };
      }
      if (o.status === 'VENTER' || aktivRef_(o)) avbrytVipps_(aktivRef_(o) || o.id);
      sheet_(PAMELDING_ARK).deleteRow(o._rad);
      return { ok: true, melding: 'Testpåmeldingen ' + o.id + ' er slettet.' };
    }
    return { ok: false, error: 'Ukjent handling' };
  } finally { lock.releaseLock(); }
}

/**
 * Innstillinger fra adminsiden. Lagres i Skriptegenskaper, så de gjelder overalt:
 * nettsiden, skjemaet, ventelisten og e-postene.
 *  kapasitet   antall plasser (1–500)
 *  betaling    'privat' (deltakerne vippser til nummeret) eller 'bedrift' (Vipps-avtalen).
 *              Lagres som VIPPS_MODUS ('nummer' / 'api'). Det gamle feltet vippsModus virker fortsatt.
 *  skjulNavn   skjuler alle innbetalinger fra navnet under ukoblede (SKJUL_NAVN). visNavn viser dem igjen.
 */
function adminInnstillinger_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  var props = PropertiesService.getScriptProperties();
  var meldinger = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (p.kapasitet !== undefined && p.kapasitet !== '') {
      var k = Number(p.kapasitet);
      if (!(k >= 1 && k <= 500 && Math.floor(k) === k)) return { ok: false, error: 'Antall plasser må være et helt tall mellom 1 og 500' };
      var rader = alle_();
      var opptatt = opptatte_(rader);
      props.setProperty('KAPASITET', String(k));
      meldinger.push('Antall plasser er nå ' + k + '.');
      if (k < opptatt) meldinger.push(opptatt + ' har allerede plass. Ingen blir fjernet, men nye påmeldinger havner på ventelisten.');
      var venter = rader.filter(function (r) { return r.status === 'VENTELISTE' && !erTest_(r); }).length;
      if (k > opptatt && venter) meldinger.push(venter + ' står på ventelisten. Gi dem plass fra listen under hvis de skal få de nye plassene.');
    }
    if (p.vippsNummer !== undefined) {
      var vn = String(p.vippsNummer == null ? '' : p.vippsNummer).replace(/\D/g, '');
      if (vn.length === 10 && vn.indexOf('47') === 0) vn = vn.slice(2);
      if ([5, 6, 8].indexOf(vn.length) < 0) return { ok: false, error: 'Skriv inn et Vipps-nummer (5–6 sifre) eller et mobilnummer (8 sifre)' };
      props.setProperty('VIPPS_NUMMER', vn);
      props.setProperty('VIPPS_NAVN', tekst_(p.vippsNavn, 60));
      meldinger.push('Nye e-poster og betalingssiden viser nå Vipps til ' + vippsTil_(vn) + '. De som allerede har fått betalingsinfo, har det gamle nummeret i e-posten sin.');
    }
    if (p.skjulNavn !== undefined || p.visNavn !== undefined) {
      var liste = skjulteNavn_(), sn = tekst_(p.skjulNavn !== undefined ? p.skjulNavn : p.visNavn, 80);
      if (p.skjulNavn !== undefined) {
        if (navnOrd_(sn).length < 2) return { ok: false, error: 'Navnet må ha både fornavn og etternavn' };
        if (liste.indexOf(sn) < 0) liste.push(sn);
        meldinger.push('Innbetalinger fra ' + sn + ' vises ikke lenger i listen. De kobles som vanlig.');
      } else {
        liste = liste.filter(function (n) { return n !== sn; });
        meldinger.push('Innbetalinger fra ' + sn + ' vises i listen igjen.');
      }
      props.setProperty('SKJUL_NAVN', JSON.stringify(liste.slice(-50)));
    }
    if (p.svarEpost !== undefined) {
      var se = tekst_(p.svarEpost, 120).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(se)) return { ok: false, error: 'Skriv inn en gyldig e-postadresse' };
      props.setProperty('SVAR_EPOST', se);
      meldinger.push('Svaradressen er lagret. Den brukes i e-postene, på nettsiden og i vilkårene.');
    }
    if (p.telefon !== undefined) {
      var tl = tekst_(p.telefon, 20);
      if (tl && tl.replace(/\D/g, '').length < 8) return { ok: false, error: 'Skriv inn et gyldig telefonnummer, eller la feltet stå tomt' };
      if (tl) props.setProperty('KONTAKT_TELEFON', tl); else props.deleteProperty('KONTAKT_TELEFON');
      meldinger.push(tl ? 'Telefonnummeret er lagret. Det står i fellesmailen med programmet.' : 'Telefonnummeret er fjernet.');
    }
    if (p.takk !== undefined) {
      var tt = String(p.takk == null ? '' : p.takk).replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, 1500);
      if (!tt) return { ok: false, error: 'Takketeksten kan ikke være tom' };
      props.setProperty('TAKK_TEKST', tt);
      meldinger.push('Takketeksten er lagret.');
    }
    if (p.program !== undefined) {
      var pt = String(p.program == null ? '' : p.program).replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, 1500);
      if (!pt) return { ok: false, error: 'Programmet kan ikke være tomt' };
      props.setProperty('PROGRAM_TEKST', pt);
      meldinger.push('Programmet er lagret.');
    }
    if (p.facebookUrl !== undefined) {
      var fbu = tekst_(p.facebookUrl, 320).split('#')[0];
      if (!gyldigFacebookUrl_(fbu)) return { ok: false, error: 'Lenken må være en Facebook-adresse som starter med https://www.facebook.com/ eller https://fb.me/' };
      props.setProperty('FACEBOOK_URL', fbu);
      meldinger.push('Facebook-lenken er lagret. Den brukes i e-postene og på nettsiden.');
    }
    if (p.betaling === 'bedrift') p.vippsModus = 'api';
    if (p.betaling === 'privat') p.vippsModus = 'nummer';
    if (p.vippsModus === 'api' || p.vippsModus === 'nummer') {
      if (p.vippsModus === 'nummer' && !String(cfg_('VIPPS_NUMMER', STANDARD_VIPPS_NUMMER)).replace(/\D/g, '')) {
        return { ok: false, error: 'Legg inn nummeret deltakerne skal vippse til før du bytter til Vipps privat.' };
      }
      if (p.vippsModus === 'api') {
        if (!harVippsNokler_()) {
          return { ok: false, error: 'Vipps bedrift kan ikke velges før Vipps-nøklene er lagt inn i Apps Script (VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY og VIPPS_MSN). Til da brukes Vipps privat.' };
        }
        try { CacheService.getScriptCache().remove('vipps_token'); vippsToken_(); }
        catch (err) { return { ok: false, error: 'Fikk ikke kontakt med Vipps med nøklene som er lagt inn, så Vipps privat brukes fortsatt. ' + vippsFeilForklart_(String(err.message)) + ' (' + String(err.message).slice(0, 160) + ')' }; }
      }
      props.setProperty('VIPPS_MODUS', p.vippsModus);
      if (p.vippsModus === 'nummer') { try { sikreBankUtloser_(); } catch (err) { console.error(err); } }
      meldinger.push(p.vippsModus === 'api'
        ? 'Vipps bedrift er i bruk' + (cfg_('VIPPS_ENV', 'test') === 'prod' ? '.' : ' i TESTMILJØET (VIPPS_ENV er ikke «prod»).') + ' Nye påmeldinger sendes rett til Vipps. De som ikke har betalt ennå, får «Betal med Vipps» på betalingssiden.'
        : 'Vipps privat er i bruk. Nye påmeldinger betaler med Vipps til ' + vippsTil_(cfg_('VIPPS_NUMMER', STANDARD_VIPPS_NUMMER)) + '.' +
          (bankKlar_() ? ' Banken er koblet til, så betalingene finnes automatisk.' : ' Banken er ikke koblet til, så du markerer betalingene som mottatt her.'));
    }
  } finally { lock.releaseLock(); }
  return { ok: true, melding: meldinger.join(' ') || 'Ingen endringer.' };
}

/**
 * «Test Vipps bedrift» i adminsiden: henter nøkkel, lager en betaling på 1 kr og avbryter den med en gang.
 * Ingen penger trekkes, men det viser om nøkler og salgsstedsnummer er i orden.
 */
function adminVippsSjekk_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('vippssjekk', 5);
  var miljo = cfg_('VIPPS_ENV', 'test') === 'prod' ? 'prod' : 'test';
  if (!harVippsNokler_()) return { ok: false, error: 'Mangler Vipps-nøkler i Skriptegenskaper (VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY, VIPPS_MSN).' };
  var steg = 'nokkel';
  try {
    CacheService.getScriptCache().remove('vipps_token');
    vippsToken_();
    steg = 'betaling';
    var ref = 'TEST-' + nyNokkel_(12);
    vipps_('post', '/epayment/v1/payments', {
      amount: { currency: 'NOK', value: 100 }, paymentMethod: { type: 'WALLET' }, reference: ref, userFlow: 'WEB_REDIRECT',
      returnUrl: cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '') + '/#admin',
      paymentDescription: 'Test fra adminsiden (avbrytes med en gang)'
    }, 'sjekk-' + ref);
    try { vipps_('post', '/epayment/v1/payments/' + ref + '/cancel', null, 'avbryt-' + ref); } catch (err) { console.warn('Avbryt testbetaling: ' + err); }
    return { ok: true, miljo: miljo, melding: 'Vipps bedrift virker (' + (miljo === 'prod' ? 'produksjon' : 'testmiljø') + '). Nøklene ble godtatt, og en testbetaling på 1 kr ble laget og avbrutt med en gang.' };
  } catch (err) {
    var m = String(err.message || err);
    return { ok: false, miljo: miljo, steg: steg, error: (steg === 'nokkel' ? 'Fikk ikke nøkkel fra Vipps. ' : 'Vipps avviste testbetalingen. ') + vippsFeilForklart_(m) + ' (' + m.slice(0, 400) + ')' };
  }
}

/** Lagrer klientopplysningene og gir lenken til BankID-innloggingen hos SpareBank 1. */
function adminBankStart_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  var props = PropertiesService.getScriptProperties();
  var rens = function (v) { return String(v || '').trim().slice(0, 200); };
  if (rens(p.klientId)) props.setProperty('BANK_CLIENT_ID', rens(p.klientId));
  if (rens(p.hemmelighet)) props.setProperty('BANK_CLIENT_SECRET', rens(p.hemmelighet));
  if (p.finInst !== undefined) props.setProperty('BANK_FININST', rens(p.finInst));
  var redirect = String(p.redirect || '');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec\?action=bank$/.test(redirect)) {
    return { ok: false, error: 'Ugyldig redirect-adresse. Sjekk API_URL i src/config.js.' };
  }
  props.setProperty('BANK_REDIRECT', redirect);
  if (!cfg_('BANK_CLIENT_ID', '') || !cfg_('BANK_CLIENT_SECRET', '')) return { ok: false, error: 'Lim inn klient-ID og hemmelighet fra SpareBank 1 først.' };
  var state = nyNokkel_(32);
  CacheService.getScriptCache().put('bank_state_' + state, '1', 900);
  var url = SB1_AUTH + '/oauth/authorize?' + qs_({ client_id: cfg_('BANK_CLIENT_ID'), state: state, redirect_uri: redirect,
    finInst: cfg_('BANK_FININST', ''), response_type: 'code' });
  return { ok: true, url: url, redirect: redirect, melding: 'Logg inn med BankID i fanen som åpnet seg. Kom tilbake hit når den sier at banken er koblet til.' };
}

/** Kontoene i banken. Med p.key velges kontoen Vipps-pengene kommer inn på. */
function adminBankKontoer_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  if (!cfg_('BANK_REFRESH_TOKEN', '')) return { ok: false, error: 'Koble til banken først.' };
  var kontoer = bankKontoer_();
  if (p.key) {
    var k = kontoer.filter(function (x) { return x.key === p.key; })[0];
    if (!k) return { ok: false, error: 'Fant ikke kontoen' };
    PropertiesService.getScriptProperties().setProperties({ BANK_ACCOUNT_KEY: k.key, BANK_KONTO_NAVN: k.navn + ' ' + k.nummer });
    sikreBankUtloser_();
  }
  return { ok: true, melding: p.key ? 'Kontoen er valgt.' : 'Velg kontoen Vipps-pengene kommer inn på.',
    kontoer: kontoer.map(function (x) { return { key: x.key, navn: x.navn, nummer: x.nummer, valgt: x.key === cfg_('BANK_ACCOUNT_KEY', '') }; }),
    bank: bankStatus_() };
}

/** Sjekker banken nå og viser de siste innbetalingene slik banken sender dem, så feltene kan kontrolleres. */
function adminBankTest_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  if (!bankKlar_()) return { ok: false, error: 'Koble til banken og velg konto først.' };
  var raa = bankRaa_(7);
  var inn = raa.filter(function (t) { return normTrans_(t).belop > 0; }).slice(0, 5);
  var sjekk = sjekkBank_();
  return { ok: true, antall: raa.length, eksempler: inn.map(function (t) { return { tolket: normTrans_(t), raa: t }; }), sjekk: sjekk,
    melding: 'Banken svarte med ' + raa.length + ' transaksjoner de siste 7 dagene.' +
      (sjekk && sjekk.koblet ? ' ' + sjekk.koblet + ' betaling(er) ble koblet til påmeldinger nå.' : '') +
      (inn.length ? ' Under ser du de siste innbetalingene slik banken sender dem. Sjekk at navnet på den som betalte står der.' : ' Ingen innbetalinger de siste 7 dagene.'),
    bank: bankStatus_() };
}

/** Kobler en innbetaling fra banken til en påmelding som ikke er betalt. */
function adminKoble_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var o;
  try {
    o = finn_('id', p.id);
    if (!o) return { ok: false, error: 'Fant ikke påmeldingen' };
    var allerede = o.status === 'BETALT' && o.betaling === 'manuell';
    if (o.status === 'BETALT' && !allerede) return { ok: false, error: o.id + ' er allerede betalt med Vipps bedrift' };
    if (o.status !== 'UBETALT' && !allerede) return { ok: false, error: o.id + ' har ikke plass (status ' + o.status + ')' };
    var bankId = String(p.bankId || '');
    var b = finnBankRad_(bankId);
    if (!b) return { ok: false, error: 'Fant ikke innbetalingen' };
    // Allerede markert betalt (for eksempel betalt av en annen): bare innbetalingen kobles, ingen ny e-post
    if (allerede) {
      if (o.bank_id === 'manuell') oppdater_(o._rad, { bank_id: bankId });
      oppdaterBankRad_(b.row, { status: 'MANUELT', pamelding: o.id });
      return { ok: true, melding: 'Innbetalingen er koblet til ' + o.id + ' (' + o.fornavn + ' ' + o.etternavn + '), som allerede var betalt. Ingen e-post er sendt.' };
    }
    var stempel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd.MM HH:mm');
    var felt = { status: 'BETALT', betalt: new Date(), bank_id: bankId, gebyr: 0, betaling: 'manuell',
      notat: [o.notat, stempel + ' Innbetaling koblet i adminsiden'].filter(String).join(' | ').slice(-500) };
    oppdater_(o._rad, felt);
    Object.assign(o, felt);
    oppdaterBankRad_(b.row, { status: 'MANUELT', pamelding: o.id });
  } finally { lock.releaseLock(); }
  var sendt = sendBekreftelse_(o);
  return { ok: true, melding: 'Betalingen er koblet til ' + o.id + ' (' + o.fornavn + ' ' + o.etternavn + ').' +
    (sendt ? ' ' + o.fornavn + ' har fått bekreftelse på e-post.' : ' Bekreftelsen ble ikke sendt, prøv «Send bekreftelsen på nytt» senere.') };
}

function adminIgnorer_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  var b = finnBankRad_(String(p.bankId || ''));
  if (!b) return { ok: false, error: 'Fant ikke innbetalingen' };
  oppdaterBankRad_(b.row, { status: 'IGNORERT' });
  return { ok: true, melding: 'Innbetalingen er skjult.' };
}

function finnBankRad_(bankId) {
  if (!bankId) return null;
  var vals = sheet_(BANK_ARK).getDataRange().getValues(), col = BANK_KOLONNER.indexOf('bank_id');
  for (var i = vals.length - 1; i >= 1; i--) if (String(vals[i][col]) === bankId) return { row: i + 1 };
  return null;
}

function oppdaterBankRad_(row, fields) {
  var sh = sheet_(BANK_ARK);
  Object.keys(fields).forEach(function (k) { sh.getRange(row, BANK_KOLONNER.indexOf(k) + 1).setValue(celle_(fields[k])); });
}

/**
 * Sender e-post til mange etter at låsen er sluppet. Hver e-post tar omtrent et sekund, og en påmelding venter
 * høyst 15 sekunder på låsen. Mottakerne er merket under låsen, så to trykk samtidig ikke sender dobbelt.
 * Feiler en e-post, settes merket tilbake med «angre».
 */
function sendTilAlle_(liste, send, angre) {
  var svar = { sendt: 0, feilet: 0 };
  liste.forEach(function (r) {
    try { send(r); svar.sendt++; }
    catch (err) {
      svar.feilet++;
      console.error('E-post feilet for ' + r.id + ': ' + err);
      if (angre) { try { oppdater_(r._rad, angre(r)); } catch (e) { console.error(e); } }
    }
  });
  return svar;
}

/**
 * Sender «ledig plass» til alle på ventelisten. Kan bare brukes når det er ledige plasser
 * og fristen ikke har gått ut. Den som melder seg på først, får plassen.
 */
function adminVarsleVenteliste_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  var a = arrangement_();
  if (Date.now() > a.frist.getTime()) return { ok: false, error: 'Påmeldingsfristen har gått ut. Gi plass direkte fra ventelisten i stedet.' };
  var ledige, venter;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rader = alle_();
    ledige = a.kapasitet - opptatte_(rader);
    if (ledige <= 0) return { ok: false, error: 'Det er ingen ledige plasser. Knappen virker når antallet påmeldte er under ' + a.kapasitet + '.' };
    venter = rader.filter(function (r) { return r.status === 'VENTELISTE' && !erTest_(r); });
    if (!venter.length) return { ok: false, error: 'Ingen står på ventelisten.' };
  } finally { lock.releaseLock(); }
  var sendt = sendTilAlle_(venter, function (r) { sendLedigPlassEpost_(r, ledige); oppdater_(r._rad, { varslet: new Date() }); }).sendt;
  if (!sendt) return { ok: false, error: 'Ingen e-poster ble sendt. Dagens e-postkvote kan være brukt opp.' };
  return { ok: true, melding: 'E-post om ' + (ledige === 1 ? 'en ledig plass' : ledige + ' ledige plasser') + ' er sendt til ' +
    sendt + ' på ventelisten. Den som melder seg på først, får plassen.' };
}

/**
 * Nullstiller før lansering: tømmer påmeldinger og besøksstatistikk og starter ID-ene på JT-1001 igjen.
 * Begge arkene kopieres først til «Arkiv …»-faner i regnearket, så ingenting går tapt.
 * Stopper hvis det finnes ekte betalte påmeldinger. Innstillinger og passord beholdes.
 */
function adminNullstill_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  if (p.bekreft !== 'NULLSTILL') return { ok: false, error: 'Skriv NULLSTILL for å bekrefte.' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rader = alle_();
    var betalte = rader.filter(function (r) { return (r.status === 'BETALT' || r.betalt) && !erTest_(r); }).length;
    if (betalte) return { ok: false, error: 'Det finnes ' + betalte + ' påmeldinger med registrert betaling. Nullstilling er bare ment for bruk før lansering.' };
    var vippsTest = rader.filter(function (r) { return erTest_(r) && r.status === 'BETALT' && r.betaling === 'vipps' && !r.refundert; }).length;
    if (vippsTest) return { ok: false, error: 'En testpåmelding er betalt i Vipps og ikke refundert. Trekk og refunder den først.' };
    var stempel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH.mm');
    // Innbetalingene banken har vist til nå, og dagen i dag: sjekkBank_ kobler ingen av dem til nye påmeldinger.
    // Reservasjonene som ikke er bokført ennå, huskes med beløp, for de kan komme igjen under en ny ID.
    // Høyst 200 ID-er, så det får plass i én skriptegenskap.
    var K = {}; BANK_KOLONNER.forEach(function (k, i) { K[k] = i; });
    var bankRader = sheet_(BANK_ARK).getDataRange().getValues().slice(1).slice(-200);
    var ider = bankRader.map(function (r) { return String(r[K.bank_id]); });
    var reservert = bankRader.filter(function (r) {
      return /pending/i.test(r[K.bokforing]) && ['UMATCHET', 'RESERVERT'].indexOf(r[K.status]) >= 0;
    }).map(function (r) { return { id: String(r[K.bank_id]), belop: r[K.belop] }; });
    var tomt = 0;
    [PAMELDING_ARK, BESOK_ARK, BANK_ARK].forEach(function (navn) {
      var sh = sheet_(navn);
      if (sh.getLastRow() > 1) {
        sh.copyTo(sh.getParent()).setName('Arkiv ' + navn.toLowerCase() + ' ' + stempel);
        tomt += tomArk_(sh);
      }
    });
    PropertiesService.getScriptProperties().setProperties({ NESTE_ID: '1001', BANK_NULLSTILT: JSON.stringify({
      dag: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), ider: ider, reservert: reservert }) });
    return { ok: true, melding: 'Alt er nullstilt: ' + rader.length + ' påmeldinger og ' + (tomt - rader.length) +
      ' besøk og innbetalinger er fjernet, og neste påmelding får JT-1001. En kopi ligger i «Arkiv»-faner i regnearket.' };
  } finally { lock.releaseLock(); }
}

/** Purring til alle som ikke har betalt. Hopper over dem som ble purret det siste døgnet. */
function adminPurring_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  var grense = Date.now() - 20 * 36e5;
  var hoppet = 0, ferdig = 0, ut = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ubetalte = alle_().filter(function (r) { return r.status === 'UBETALT' && !erTest_(r); });
    if (!ubetalte.length) return { ok: false, error: 'Alle har betalt.' };
    ubetalte.forEach(function (r) {
      if (antallPurringer_(r) >= MAKS_PURRINGER) { ferdig++; return; }
      if (r.purret && new Date(r.purret).getTime() > grense) { hoppet++; return; }
      // Trykket «Åpne Vipps» det siste døgnet: har trolig betalt, og betalingen er bare ikke kommet til banken ennå
      if (r.vipps_apnet && new Date(r.vipps_apnet).getTime() > Date.now() - 24 * 36e5) { hoppet++; return; }
      oppdater_(r._rad, { purret: new Date(), purringer: antallPurringer_(r) + 1 });
      ut.push(r);
    });
  } finally { lock.releaseLock(); }
  var res = sendTilAlle_(ut, sendPurring_, function (r) { return { purret: r.purret, purringer: r.purringer }; });
  var sendt = res.sendt, feilet = res.feilet;
  if (sendt) venterPaBank_();
  if (feilet && !sendt) return { ok: false, error: 'Ingen purringer ble sendt. Dagens e-postkvote kan være brukt opp.' };
  if (!sendt && !hoppet && ferdig) return { ok: false, error: 'Alle ubetalte har fått ' + MAKS_PURRINGER + ' purringer. Frigi plassene deres hvis betalingen ikke kommer.' };
  return { ok: true, melding: 'Purring sendt til ' + sendt + (sendt === 1 ? ' person' : ' personer') + '.' +
    (hoppet ? ' ' + hoppet + ' ble hoppet over fordi de fikk purring eller trykket «Åpne Vipps» det siste døgnet.' : '') +
    (ferdig ? ' ' + ferdig + ' har fått ' + MAKS_PURRINGER + ' purringer og kan miste plassen.' : '') +
    (feilet ? ' ' + feilet + ' feilet.' : '') };
}

/** Fellesmail med program til alle som har betalt (og eventuelt de som ikke har betalt ennå). Sendes én gang per person. */
function adminFellesmail_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  var med = p.medUbetalte === true || p.medUbetalte === 'true';
  var hadde = 0, ut = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var mottakere = alle_().filter(function (r) {
      return !erTest_(r) && (r.status === 'BETALT' || (med && r.status === 'UBETALT'));
    });
    if (!mottakere.length) return { ok: false, error: med ? 'Ingen er påmeldt ennå.' : 'Ingen har betalt ennå.' };
    mottakere.forEach(function (r) {
      if (r.program) { hadde++; return; }
      oppdater_(r._rad, { program: new Date() });
      ut.push(r);
    });
  } finally { lock.releaseLock(); }
  var res = sendTilAlle_(ut, sendProgramEpost_, function () { return { program: '' }; });
  var sendt = res.sendt, feilet = res.feilet;
  if (!sendt && feilet) return { ok: false, error: 'Ingen e-poster ble sendt. Dagens e-postkvote kan være brukt opp. Prøv igjen i morgen.' };
  if (!sendt) return { ok: false, error: 'Alle ' + hadde + ' har fått programmet fra før.' };
  return { ok: true, melding: 'Programmet er sendt til ' + sendt + (sendt === 1 ? ' person' : ' personer') + '.' +
    (hadde ? ' ' + hadde + ' hadde fått det fra før.' : '') +
    (feilet ? ' ' + feilet + ' feilet. Trykk på nytt senere, så får bare de som mangler.' : '') };
}

/** Takkemail etter arrangementet. Går til de som ble sjekket inn, eller til alle betalte hvis innsjekk ikke ble brukt. */
function adminTakkemail_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  if (Date.now() < arrangement_().start.getTime()) return { ok: false, error: 'Takkemailen kan sendes når arrangementet har startet.' };
  var hadde = 0, ut = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ekte = alle_().filter(function (r) { return !erTest_(r) && HOLDER_PLASS.indexOf(r.status) >= 0; });
    var brukteInnsjekk = ekte.some(function (r) { return r.mott; });
    var mottakere = ekte.filter(function (r) { return brukteInnsjekk ? r.mott : r.status === 'BETALT'; });
    if (!mottakere.length) return { ok: false, error: 'Ingen å sende til.' };
    mottakere.forEach(function (r) {
      if (r.takket) { hadde++; return; }
      oppdater_(r._rad, { takket: new Date() });
      ut.push(r);
    });
  } finally { lock.releaseLock(); }
  var res = sendTilAlle_(ut, sendTakkEpost_, function () { return { takket: '' }; });
  var sendt = res.sendt, feilet = res.feilet;
  if (!sendt && feilet) return { ok: false, error: 'Ingen e-poster ble sendt. Dagens e-postkvote kan være brukt opp. Prøv igjen i morgen.' };
  if (!sendt) return { ok: false, error: 'Alle ' + hadde + ' har fått takkemailen fra før.' };
  return { ok: true, melding: 'Takkemailen er sendt til ' + sendt + (sendt === 1 ? ' person' : ' personer') + '.' +
    (hadde ? ' ' + hadde + ' hadde fått den fra før.' : '') +
    (feilet ? ' ' + feilet + ' feilet. Trykk på nytt senere, så får bare de som mangler.' : '') };
}

/**
 * Sletter alle persondata etter arrangementet (personvernerklæringen lover sletting innen 3 måneder):
 * påmeldinger, besøksstatistikk og «Arkiv»-fanene. Ingen kopi lagres.
 */
function adminSlettData_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  if (p.bekreft !== 'SLETT') return { ok: false, error: 'Skriv SLETT for å bekrefte.' };
  var a = arrangement_();
  if (Date.now() < a.start.getTime()) return { ok: false, error: 'Persondata kan først slettes etter arrangementet. Før lansering bruker du «Nullstill».' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var rader = alle_().filter(function (r) { return !erTest_(r); });
    var skylder = rader.filter(function (r) {
      var b = r.refusjon === '' || r.refusjon == null ? Number(r.belop) || 0 : Number(r.refusjon) || 0;
      return r.status === 'TRUKKET' && r.betalt && !r.refundert && b > 0;
    }).length;
    if (skylder) return { ok: false, error: skylder + (skylder === 1 ? ' person' : ' personer') + ' skal fortsatt ha penger tilbake. Marker dem som refundert først.' };
    var slettet = 0, arkiv = 0;
    [PAMELDING_ARK, BESOK_ARK, BANK_ARK].forEach(function (navn) {
      var n = tomArk_(sheet_(navn));
      if (navn === PAMELDING_ARK) slettet = n;
    });
    var ss = SpreadsheetApp.openById(cfg_('SHEET_ID', STANDARD_SHEET_ID));
    ss.getSheets().forEach(function (sh) {
      if (/^Arkiv /.test(sh.getName())) { ss.deleteSheet(sh); arkiv++; }
    });
    PropertiesService.getScriptProperties().setProperty('DATA_SLETTET', String(Date.now()));
    return { ok: true, melding: 'Slettet ' + slettet + ' påmeldinger, besøksstatistikken og ' + arkiv + ' arkivfaner. Ingen persondata ligger igjen i regnearket.' };
  } finally { lock.releaseLock(); }
}

/** «Legg til deltaker» i admin: en ekte påmelding, for eksempel for noen som har betalt for en annen. */
function adminLeggTil_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  var epost = tekst_(p.epost, 120).toLowerCase();
  var fra = alle_().filter(function (r) { return r.epost === epost && !erTest_(r) && HOLDER_PLASS.indexOf(r.status) >= 0; })[0];
  if (fra) {
    return { ok: false, error: fra.fornavn + ' ' + fra.etternavn + ' (' + fra.id + ') er allerede påmeldt med denne e-posten.' +
      (fra.status === 'UBETALT' ? ' Bruk «Marker som betalt» på påmeldingen.' : '') };
  }
  var betalt = p.betalt === true || p.betalt === 'true';
  var res = pamelding_({ fornavn: p.fornavn, etternavn: p.etternavn, epost: p.epost, telefon: p.telefon, kommentar: p.kommentar,
    betalt: betalt }, false, true);
  if (!res.ok) return res;
  if (res.duplicate) return { ok: false, error: 'Noen er allerede påmeldt med denne e-posten.' };
  res.melding = res.id + ' er lagt til' + (betalt
    ? ' som betalt.' + (res.sendt ? ' Bekreftelsen er sendt på e-post.' : ' Bekreftelsen ble ikke sendt, prøv «Send bekreftelsen på nytt».')
    : ' og får betalingsinfo på e-post.');
  return res;
}

/** Testpåmelding fra adminsiden: går gjennom samme løp som en ekte påmelding, men teller ikke. */
function adminTestpamelding_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  var type = p.type || 'pamelding';
  if (type !== 'pamelding') return testEpost_(type, p);
  var res = pamelding_({
    fornavn: p.fornavn || 'Test', etternavn: p.etternavn || 'Testesen',
    epost: p.epost, telefon: p.telefon || '12345678', kommentar: p.kommentar || 'Testpåmelding'
  }, true);
  if (!res.ok) return res;
  res.melding = res.status === 'VENTER'
    ? 'Testpåmeldingen ' + res.id + ' er laget. Åpne Vipps-lenken for å teste betalingen.'
    : 'Testpåmeldingen ' + res.id + ' er laget, og bekreftelsen er sendt til ' + String(p.epost) + '.';
  return res;
}

/**
 * Sender én av e-postene som test, uten å lage en påmelding. Innholdet er det samme som
 * deltakerne får, med [TEST] i emnet og eksempelverdier for navn og påmeldings-ID.
 */
var TEST_EPOSTER = {
  ubetalt: 'Bekreftelse med betalingsinfo',
  betalt: 'Bekreftelse når betalingen er mottatt',
  venteliste: 'Du står på ventelisten',
  ledig: 'Det er ledig plass (til ventelisten)',
  purring: 'Påminnelse om betaling',
  trukket: 'Påmeldingen er trukket',
  refundert: 'Pengene er betalt tilbake',
  program: 'Fellesmail med program',
  takk: 'Takkemail etter arrangementet',
  frigitt: 'Plassen er frigitt (ikke betalt etter tre purringer)',
  sistepurring: 'Siste påminnelse om betaling',
  rapport: 'Daglig statusmail til admin',
  feilbelop: 'Varsel til deg: betaling med feil beløp',
  ikkekoblet: 'Varsel til deg: betaling som ikke ble koblet',
  vippsfeil: 'Varsel til deg: Vipps bedrift virker ikke',
  utloper: 'Varsel til deg: banktilgangen går snart ut',
  frakoblet: 'Varsel til deg: banken må kobles til på nytt'
};
function testEpost_(type, p) {
  if (!TEST_EPOSTER[type]) return { ok: false, error: 'Ukjent e-posttype' };
  if (type === 'rapport') return adminRapport_(p);
  var epost = tekst_(p.epost, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)) return { ok: false, error: 'Skriv inn en gyldig e-postadresse' };
  var a = arrangement_();
  var r = { id: 'JT-TEST', test: 'ja', fornavn: tekst_(p.fornavn, 60) || 'Test', etternavn: tekst_(p.etternavn, 60) || 'Testesen',
    epost: epost, telefon: '123 45 678', kommentar: 'Testpåmelding', belop: a.pris, betaling: 'manuell',
    status: type === 'betalt' ? 'BETALT' : type === 'venteliste' || type === 'ledig' ? 'VENTELISTE' : 'UBETALT' };
  var sendt = true;
  try {
    if (type === 'ubetalt' || type === 'betalt') sendt = sendBekreftelse_(r);
    else if (type === 'venterbetaling') sendt = sendBekreftelse_(r, true);
    else if (type === 'ledig') sendLedigPlassEpost_(r, 1);
    else if (type === 'purring') sendPurring_(r);
    else if (type === 'trukket') { r.betalt = new Date(); sendTrukketEpost_(r, Math.max(0, a.pris - a.noshow), false); }
    else if (type === 'refundert') sendRefundertEpost_(r, a.pris);
    else if (type === 'program') { r.status = 'BETALT'; sendProgramEpost_(r); }
    else if (type === 'takk') sendTakkEpost_(r);
    else if (type === 'frigitt') sendTrukketEpost_(r, 0, false, true);
    else if (type === 'sistepurring') { r.purringer = MAKS_PURRINGER - 1; sendPurring_(r); }
    else if (['feilbelop', 'ikkekoblet', 'vippsfeil', 'utloper', 'frakoblet'].indexOf(type) >= 0) {
      var idag = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      var v = type === 'feilbelop' ? varselFeilBelop_({ belop: a.pris - 100, navn: r.fornavn + ' ' + r.etternavn, dato: idag }, r)
        : type === 'ikkekoblet' ? varselIkkeKoblet_({ belop: a.pris, navn: 'Kris Olsen', dato: idag }, false, [r])
        : type === 'vippsfeil' ? { emne: 'Vipps bedrift virker ikke', tekst: 'Noen prøvde å melde seg på, men Vipps svarte med en feil (eksempel).\n\n' +
            vippsFeilForklart_('Vipps token feilet: 401') + '\n\nI adminsiden kan du trykke «Test Vipps bedrift» under Betaling, eller bytte til Vipps privat så lenge.' }
        : type === 'utloper' ? varselUtloper_(new Date(Date.now() + 13 * 864e5))
        : varselFrakoblet_('invalid_grant (eksempel)');
      sendt = varsle_(v.emne, v.tekst, epost, true);
    }
    else if (type === 'venteliste') {
      var for_ = epostKvote_();
      sendVentelisteEpost_(r);
      var etter = epostKvote_();
      if (for_ !== null && etter !== null && etter >= for_) sendt = false;
    }
  } catch (err) { console.error('Test-e-post feilet: ' + err); sendt = false; }
  if (!sendt) return { ok: false, error: 'E-posten ble ikke sendt. Sjekk adressen, og at dagens e-postkvote ikke er brukt opp.' };
  return { ok: true, melding: '«' + TEST_EPOSTER[type] + '» er sendt som test til ' + epost + '. Ingen påmelding ble laget.' };
}

/* ------------------------------------------------------------------ */
/* Daglig statusmail til admin                                         */
/* ------------------------------------------------------------------ */

/** Hvor mange e-poster Google lar kontoen sende resten av døgnet (vanlig Gmail: 100 per døgn). */
function epostKvote_() {
  try { return MailApp.getRemainingDailyQuota(); } catch (err) { return null; }
}

function rapportMottaker_() {
  return cfg_('ADMIN_EPOST', '') || cfg_('SVAR_EPOST', '');
}

/** Lager utløseren for den daglige statusmailen (kl. 08) hvis den mangler. */
function sikreRapportUtloser_() {
  if (cfg_('RAPPORT_UTLOSER', '') === '1') return;
  try {
    var finnes = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'dagligRapport'; });
    if (!finnes) ScriptApp.newTrigger('dagligRapport').timeBased().everyDays(1).atHour(8).create();
    PropertiesService.getScriptProperties().setProperty('RAPPORT_UTLOSER', '1');
  } catch (err) { console.error('Kunne ikke lage utløser for statusmail: ' + err); }
}

/**
 * Status til admin. Kjøres hver morgen. Sendes bare når noe er nytt siden forrige rapport,
 * eller når noe må følges opp (ubetalte, refusjoner, ledig plass med venteliste).
 */
function dagligRapport(tvungen) {
  // Bekreftelser som ikke gikk ut (for eksempel fordi e-postkvoten var brukt opp) prøves på nytt hver morgen.
  var sendtPaNytt = 0;
  if (tvungen !== true) {
    try {
      alle_().forEach(function (r) {
        if (!erTest_(r) && HOLDER_PLASS.indexOf(r.status) >= 0 && !r.epost_sendt && !epostVenter_(r) && sendBekreftelse_(r)) sendtPaNytt++;
      });
    } catch (err) { console.error('Nytt forsøk på bekreftelser feilet: ' + err); }
  }
  var til = rapportMottaker_();
  if (!til) { console.log('Ingen ADMIN_EPOST eller SVAR_EPOST, statusmail sendes ikke.'); return { sendt: false, grunn: 'mottaker' }; }
  var a = arrangement_();
  var props = PropertiesService.getScriptProperties();
  var sist = Number(props.getProperty('RAPPORT_SIST') || 0);
  // Tidspunktet tas før radene leses, så noe som skjer mens rapporten lages kommer med neste gang.
  var naa = Date.now();
  var siden = function (d) { var t = new Date(d).getTime(); return t > sist && t <= naa; };
  var rader = alle_().filter(function (r) { return !erTest_(r); });
  var tz = Session.getScriptTimeZone();
  var dato = function (d) { return d ? Utilities.formatDate(new Date(d), tz, 'dd.MM HH:mm') : ''; };
  var navn = function (r) { return escapeHtml_(r.fornavn + ' ' + r.etternavn) + ' <span style="color:#999">(' + r.id + ')</span>'; };

  var antall = {}; rader.forEach(function (r) { antall[r.status] = (antall[r.status] || 0) + 1; });
  var opptatt = opptatte_(rader), ledige = Math.max(0, a.kapasitet - opptatt);
  var nye = rader.filter(function (r) { return siden(r.opprettet); });
  var nyeBetalt = rader.filter(function (r) { return r.betalt && siden(r.betalt); });
  var nyeTrukket = rader.filter(function (r) { return r.trukket && siden(r.trukket); });

  var dogn = 24 * 36e5;
  var ubetalte = rader.filter(function (r) { return r.status === 'UBETALT' && Date.now() - new Date(r.opprettet).getTime() > 2 * dogn; });
  var skyldig = function (r) { return r.refusjon === '' || r.refusjon == null ? Number(r.belop) || 0 : Number(r.refusjon) || 0; };
  var refusjon = rader.filter(function (r) { return r.status === 'TRUKKET' && r.betalt && !r.refundert && skyldig(r) > 0; });
  var utenEpost = rader.filter(function (r) { return HOLDER_PLASS.indexOf(r.status) >= 0 && !r.epost_sendt && !epostVenter_(r); });
  var venteliste = (antall.VENTELISTE || 0) > 0 && ledige > 0;
  var ukoblet = [];
  try { ukoblet = bankRader_().filter(function (b) { return b.status !== 'DUPLIKAT' && b.status !== 'NULLSTILT'; }); } catch (err) { console.error(err); }
  var bankFeil = cfg_('BANK_FEIL', '') && a.vippsModus !== 'api';

  // Etter arrangementet er det bare penger som skal tilbake og sletting av persondata som følges opp.
  var etterArr = naa > a.start.getTime();
  if (etterArr) { ubetalte = []; utenEpost = []; venteliste = false; }
  var ferdigPurret = etterArr ? [] : rader.filter(function (r) {
    return r.status === 'UBETALT' && antallPurringer_(r) >= MAKS_PURRINGER && Date.now() - new Date(r.purret).getTime() > dogn;
  });
  var utenProgram = rader.filter(function (r) { return r.status === 'BETALT' && !r.program; });
  var sendProgram = !etterArr && naa > a.start.getTime() - 36 * 36e5 && utenProgram.length > 0;
  var slettNaa = naa > a.start.getTime() + 90 * dogn && rader.length > 0;

  var harNytt = nye.length || nyeBetalt.length || nyeTrukket.length || sendtPaNytt;
  var harOppfolging = ubetalte.length || refusjon.length || venteliste || utenEpost.length || sendProgram || slettNaa || ferdigPurret.length ||
    ukoblet.length || bankFeil;
  // En tidsstyrt utløser sender med et hendelsesobjekt, så bare en ekte «true» teller som tvungen.
  if (tvungen !== true && !harNytt && !harOppfolging) {
    props.setProperty('RAPPORT_SIST', String(naa));
    return { sendt: false, grunn: 'ingenting' };
  }

  var liste = function (tittel, ting) {
    if (!ting.length) return '';
    return '<h3 style="font-size: 1.05rem; color: #edb77d; margin: 26px 0 8px;">' + tittel + '</h3>' +
      '<ul style="margin: 0; padding-left: 18px; line-height: 1.6;">' + ting.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>';
  };
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  var kropp =
    '<h2 style="color: #edb77d; font-size: 1.4rem; margin-top: 0; text-align: center;">Status for juletreffet</h2>' +
    epostTabell_(
      epostRad_('Plasser:', opptatt + ' av ' + a.kapasitet + ' tatt (' + ledige + ' ledige)') +
      epostRad_('Betalt:', String(antall.BETALT || 0)) +
      epostRad_('Ikke betalt:', String(antall.UBETALT || 0)) +
      epostRad_('Venteliste:', String(antall.VENTELISTE || 0)) +
      epostRad_('Trukket:', String(antall.TRUKKET || 0), true), 'margin: 20px 0 0; ') +
    liste('Nytt siden sist', [].concat(
      nye.map(function (r) { return 'Ny påmelding: ' + navn(r) + (r.status === 'VENTELISTE' ? ' – venteliste' : ''); }),
      nyeBetalt.map(function (r) { return 'Betalt: ' + navn(r); }),
      nyeTrukket.map(function (r) { return 'Trukket: ' + navn(r); }))) +
    liste('Må følges opp', [].concat(
      ubetalte.map(function (r) { return 'Ikke betalt etter mer enn to døgn: ' + navn(r) + (r.purret ? ', purret ' + dato(r.purret) : ', ikke purret'); }),
      refusjon.map(function (r) { return 'Skal ha ' + skyldig(r) + ' kr tilbake: ' + navn(r); }),
      utenEpost.map(function (r) { return 'Fikk ikke bekreftelsen på e-post: ' + navn(r) + '. Send den på nytt fra admin.'; }),
      ferdigPurret.map(function (r) { return 'Ikke betalt etter ' + MAKS_PURRINGER + ' purringer: ' + navn(r) + '. Frigi plassen i admin.'; }),
      sendProgram ? ['Det er under 36 timer igjen. Send programmet til de ' + utenProgram.length + ' som har betalt, fra «Fellesmail med program» i admin.'] : [],
      slettNaa ? ['Det er 3 måneder siden juletreffet. Slett persondataene fra «Slett persondata» nederst i admin, slik personvernerklæringen lover.'] : [],
      ukoblet.map(function (b) { return (b.status === 'FEIL_BELOP' ? 'Betaling med feil beløp: ' : 'Betaling som ikke ble koblet: ') +
        escapeHtml_(kroner_(b.belop) + ' fra ' + (b.navn || 'ukjent') + (b.dato ? ' (' + b.dato + ')' : '')) + '. Koble den i admin.'; }),
      bankFeil ? ['Banken må kobles til på nytt, så Vipps-betalinger blir funnet automatisk. Trykk «Koble til banken» i admin.'] : [],
      sendtPaNytt ? ['Bekreftelsen ble sendt på nytt til ' + sendtPaNytt + (sendtPaNytt === 1 ? ' person' : ' personer') + ' i dag.'] : [],
      venteliste ? [ledige + (ledige === 1 ? ' ledig plass' : ' ledige plasser') + ' og ' + antall.VENTELISTE + ' på ventelisten. Varsle ventelisten eller gi plass i admin.'] : [])) +
    epostKnapp_(site + '/#admin', 'Åpne admin');
  var tekst = 'Status: ' + opptatt + ' av ' + a.kapasitet + ' plasser tatt, ' + (antall.BETALT || 0) + ' betalt, ' +
    (antall.UBETALT || 0) + ' ikke betalt, ' + (antall.VENTELISTE || 0) + ' på venteliste.\n' +
    (harNytt ? nye.length + ' nye påmeldinger, ' + nyeBetalt.length + ' nye betalinger, ' + nyeTrukket.length + ' trukket siden sist.\n' : '') +
    (harOppfolging ? 'Noe må følges opp. ' : '') + 'Åpne admin: ' + site + '/#admin';
  sendEpost_(til, 'Juletreff KUMI: ' + (harOppfolging ? 'status og ting å følge opp' : 'status'), tekst, kropp, 'Sendes hver morgen når noe er nytt eller må følges opp.');
  props.setProperty('RAPPORT_SIST', String(naa));
  return { sendt: true };
}

/** «Send statusmail nå» fra admin. */
function adminRapport_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  var til = rapportMottaker_();
  if (!til) return { ok: false, error: 'Legg inn ADMIN_EPOST (eller SVAR_EPOST) i Skriptegenskaper først.' };
  dagligRapport(true);
  return { ok: true, melding: 'Statusmail sendt til ' + til + '.' };
}

/* ------------------------------------------------------------------ */
/* Hjelpere for regnearket                                             */
/* ------------------------------------------------------------------ */

function alle_() {
  var vals = sheet_(PAMELDING_ARK).getDataRange().getValues();
  var ut = [];
  for (var i = 1; i < vals.length; i++) {
    var r = { _rad: i + 1 };
    // celle_ setter en apostrof foran tekst som ligner en formel. Den fjernes igjen her.
    KOLONNER.forEach(function (k, j) {
      var v = vals[i][j];
      r[k] = (typeof v === 'string' && /^'[=+\-@\t\r]/.test(v)) ? v.slice(1) : v;
    });
    r.epost = String(r.epost || '').toLowerCase();
    ut.push(r);
  }
  return ut;
}

function finn_(felt, verdi) {
  var hit = alle_().filter(function (r) { return String(r[felt]) === String(verdi); });
  return hit.length ? hit[hit.length - 1] : null;
}

/**
 * Sletter alle radene under overskriften og gir antallet. Google nekter å slette alle radene under en frosset rad
 * («not possible to delete all non-frozen rows»), så en tom rad legges til først når fanen ikke har noen.
 */
function tomArk_(sh) {
  var sist = sh.getLastRow();
  if (sist < 2) return 0;
  if (sh.getMaxRows() <= sist) sh.insertRowAfter(sist);
  sh.deleteRows(2, sist - 1);
  return sist - 1;
}

function oppdater_(rad, felt) {
  var sh = sheet_(PAMELDING_ARK);
  Object.keys(felt).forEach(function (k) {
    sh.getRange(rad, KOLONNER.indexOf(k) + 1).setValue(celle_(felt[k]));
  });
}

function nesteId_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('NESTE_ID') || 1001);
  props.setProperty('NESTE_ID', String(n + 1));
  return 'JT-' + n;
}

/** Hindrer at tekst fra nettet (f.eks. «=IMPORTDATA(...)») blir tolket som formel i regnearket. */
function celle_(v) {
  return (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) ? "'" + v : v;
}

function tekst_(v, maks) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, maks);
}

function nyNokkel_(len) {
  var s = '';
  while (s.length < (len || 32)) s += Utilities.getUuid().replace(/-/g, '');
  return s.slice(0, len || 32);
}

/** Enkel bremse mot misbruk: maks antall kall per minutt for hele løsningen. */
function begrens_(navn, maksPerMinutt) {
  var cache = CacheService.getScriptCache();
  var key = 'rate_' + navn + '_' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 120);
  if (n > maksPerMinutt) throw new Brukerfeil('Mange forespørsler akkurat nå. Prøv igjen om et minutt.');
}

function maskEmail_(e) {
  e = String(e || '');
  var at = e.indexOf('@');
  return at > 1 ? e[0] + '•••' + e.slice(at - 1) : e;
}

function formatPhone_(p) {
  var d = String(p).replace(/\D/g, '');
  if (d.length === 10 && d.indexOf('47') === 0) d = d.slice(2);
  return d.length === 8 ? d.replace(/(\d{3})(\d{2})(\d{3})/, '$1 $2 $3') : String(p);
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

/* ------------------------------------------------------------------ */
/* Engangsoppsett – kjør fra redigeringsvinduet                        */
/* ------------------------------------------------------------------ */

/** 1) Lager regnearket og utløseren. Kjør én gang. */
function oppsett() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SHEET_ID')) props.setProperty('SHEET_ID', STANDARD_SHEET_ID);
  sheet_(PAMELDING_ARK); sheet_(BESOK_ARK);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollPending') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollPending').timeBased().everyMinutes(5).create();
  PropertiesService.getScriptProperties().deleteProperty('RAPPORT_UTLOSER');
  sikreRapportUtloser_();
  console.log('Regneark: ' + SpreadsheetApp.openById(props.getProperty('SHEET_ID')).getUrl());
}

/** 2) Sett adminpassord: skriv passordet inn her, kjør funksjonen, og slett passordet fra koden etterpå. */
function settAdminPassord() {
  var passord = 'SKRIV-PASSORDET-HER';
  if (passord === 'SKRIV-PASSORDET-HER' || passord.length < 12) throw new Error('Velg et passord på minst 12 tegn');
  var salt = nyNokkel_(32);
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ADMIN_SALT', salt);
  props.setProperty('ADMIN_PASSORD_HASH', hashPassord_(passord, salt));
  console.log('Passord lagret. Husk å fjerne det fra koden nå.');
}
