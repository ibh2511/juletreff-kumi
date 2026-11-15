/**
 * Juletreff på KUMI – påmeldingsbackend (Google Apps Script)
 *
 * Gjør dette:
 *  - Tar imot påmeldinger, sjekker ledige plasser og doble påmeldinger
 *  - Oppretter Vipps-betaling (ePayment API), sjekker den og trekker beløpet
 *  - Uten Vipps-avtale: registrerer påmeldingen som «ubetalt» og viser Vipps-nummer i stedet
 *  - Sender bekreftelse på e-post (med beskjed om at påmeldingen er bindende)
 *  - Logger sidebesøk uten informasjonskapsler og uten personopplysninger
 *  - Gir oversikt over påmeldinger, betaling og besøk til adminsiden, bak passord
 *
 * Ingen hemmeligheter ligger i nettsiden. Vipps-nøkler og adminpassord ligger bare i
 * Skriptegenskaper (Prosjektinnstillinger > Skriptegenskaper). Se backend/OPPSETT.md.
 */

// Regnearket i Drive-mappen «Juletreff KUMI 2026». Kan overstyres med SHEET_ID i Skriptegenskaper.
var STANDARD_SHEET_ID = '1uAHLTHwgjCizlvYMFi_SO28o5bhb1j6KD86dYPxc-4g';
// Facebook-eventet. Kan overstyres med FACEBOOK_URL i Skriptegenskaper.
var STANDARD_FACEBOOK_URL = 'https://www.facebook.com/events/664624256515915';

var PAMELDING_ARK = 'Påmeldinger';
var BESOK_ARK = 'Besøk';
var KOLONNER = ['id', 'opprettet', 'status', 'fornavn', 'etternavn', 'epost', 'telefon', 'kommentar',
  'belop', 'betaling', 'nokkel', 'betalt', 'epost_sendt', 'bindende_godtatt', 'trukket', 'refundert', 'notat', 'kilde', 'refusjon', 'test', 'varslet', 'purret'];
var BESOK_KOLONNER = ['tid', 'besokende', 'kilde', 'enhet'];

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
    frist: new Date(cfg_('PAMELDINGSFRIST', '2026-12-17T23:59:59+01:00')),
    fristTekst: cfg_('FRIST_TEKST', 'torsdag 17. desember'),
    kapasitet: Number(cfg_('KAPASITET', '30')),
    // Trekk med legeerklæring under 48 timer før start: vi beholder no-show-gebyret til KUMI
    start: new Date(cfg_('ARR_START', '2026-12-18T18:30:00+01:00')),
    noshow: Number(cfg_('NOSHOW_GEBYR', '300')),
    vippsNummer: cfg_('VIPPS_NUMMER', '76192'),
    // Bryteren i adminsiden. Vipps-API brukes bare når den står på OG nøklene finnes.
    vippsModus: cfg_('VIPPS_MODUS', 'nummer') === 'api' ? 'api' : 'nummer',
    vippsAktiv: cfg_('VIPPS_MODUS', 'nummer') === 'api' && harVippsNokler_()
  };
}

/** Alle fire Vipps-nøklene må ligge i Skriptegenskaper før API-et kan slås på. */
function harVippsNokler_() {
  return ['VIPPS_CLIENT_ID', 'VIPPS_CLIENT_SECRET', 'VIPPS_SUBSCRIPTION_KEY', 'VIPPS_MSN']
    .every(function (k) { return !!cfg_(k, ''); });
}

function vippsBase_() {
  return cfg_('VIPPS_ENV', 'test') === 'prod' ? 'https://api.vipps.no' : 'https://apitest.vipps.no';
}

function sheet_(name) {
  var ss = SpreadsheetApp.openById(cfg_('SHEET_ID', STANDARD_SHEET_ID));
  var sh = ss.getSheetByName(name);
  var kol = name === PAMELDING_ARK ? KOLONNER : BESOK_KOLONNER;
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

function route_(e, body) {
  var p = Object.assign({}, (e && e.parameter) || {}, body || {});
  try {
    switch (p.action) {
      case 'info':      begrens_('info', 300); return json_(info_());
      case 'pamelding': begrens_('pamelding', 30); return json_(pamelding_(p));
      case 'status':    return json_(sjekkBetaling_(p.id, p.k));
      case 'hit':       begrens_('hit', 300); return json_(hit_(p));
      case 'admin':     return json_(adminLogin_(p.passord));
      case 'logout':    return json_(adminLogout_(p.okt));
      case 'oversikt':  return json_(adminOversikt_(p.okt));
      case 'endre':     return json_(adminEndre_(p));
      case 'innstillinger': return json_(adminInnstillinger_(p));
      case 'testpamelding': return json_(adminTestpamelding_(p));
      case 'varsleventeliste': return json_(adminVarsleVenteliste_(p));
      case 'nullstill': return json_(adminNullstill_(p));
      case 'purring': return json_(adminPurring_(p));
      case 'rapport': return json_(adminRapport_(p));
      default:          return json_({ ok: true, info: 'Juletreff KUMI API' });
    }
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Offentlig info: pris, dato og ledige plasser                        */
/* ------------------------------------------------------------------ */

function info_() {
  var a = arrangement_();
  var opptatt = opptatte_(alle_());
  return {
    ok: true, pris: a.pris, dato: a.dato, sted: a.sted, fristTekst: a.fristTekst, kapasitet: a.kapasitet,
    stengt: Date.now() > a.frist.getTime(),
    ledige: Math.max(0, a.kapasitet - opptatt), fullt: opptatt >= a.kapasitet,
    vippsAktiv: a.vippsAktiv, vippsNummer: a.vippsNummer, noshow: a.noshow, start: a.start.toISOString()
  };
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

function pamelding_(p, test) {
  var a = arrangement_();
  var d = {
    fornavn: tekst_(p.fornavn, 60), etternavn: tekst_(p.etternavn, 60),
    epost: tekst_(p.epost, 120).toLowerCase(), telefon: formatPhone_(tekst_(p.telefon, 20)),
    kommentar: tekst_(p.kommentar, 500)
  };
  if (!d.fornavn || !d.etternavn) return { ok: false, error: 'Skriv inn fornavn og etternavn' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.epost)) return { ok: false, error: 'Skriv inn en gyldig e-postadresse' };
  if (String(d.telefon).replace(/\D/g, '').length < 8) return { ok: false, error: 'Skriv inn et gyldig telefonnummer' };
  if (!test && !(p.bindende === true || p.bindende === 'true' || p.bindende === '1')) {
    return { ok: false, error: 'Du må bekrefte at påmeldingen er bindende' };
  }
  if (!test && Date.now() > a.frist.getTime()) return { ok: false, stengt: true, error: 'Påmeldingen er stengt' };

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var rad;
  try {
    var rader = alle_();
    var grense = Date.now() - VENTER_MINUTTER * 60000;
    // Testpåmeldinger sjekkes ikke mot ekte påmeldinger, og ekte påmeldinger ikke mot tester.
    var tidligere = test ? [] : rader.filter(function (r) { return r.epost === d.epost && !erTest_(r); });
    if (tidligere.some(function (r) { return HOLDER_PLASS.indexOf(r.status) >= 0; })) {
      return { ok: true, duplicate: true };
    }
    // En tidligere påbegynt Vipps-betaling som ikke ble fullført, avbrytes før vi lager en ny.
    tidligere.forEach(function (r) {
      if (r.status === 'VENTER') {
        if (new Date(r.opprettet).getTime() > grense) avbrytVipps_(r.id);
        oppdater_(r._rad, { status: 'AVBRUTT' });
        r.status = 'AVBRUTT'; // så plassen ikke telles som opptatt under
      }
    });

    var fullt = !test && opptatte_(rader) >= a.kapasitet;
    if (fullt && tidligere.some(function (r) { return r.status === 'VENTELISTE'; })) {
      return { ok: true, waitlist: true };
    }

    rad = {}; KOLONNER.forEach(function (k) { rad[k] = ''; });
    Object.assign(rad, d);
    rad.id = nesteId_();
    rad.opprettet = new Date();
    rad.belop = a.pris;
    rad.nokkel = nyNokkel_();
    rad.bindende_godtatt = test ? '' : new Date();
    rad.kilde = test ? 'admin-test' : tekst_(p.kilde, 60);
    rad.test = test ? 'ja' : '';
    if (test) rad.notat = 'Testpåmelding fra admin';
    rad.status = fullt ? 'VENTELISTE' : a.vippsAktiv ? 'VENTER' : 'UBETALT';
    rad.betaling = fullt ? '' : a.vippsAktiv ? 'vipps' : 'manuell';
    sheet_(PAMELDING_ARK).appendRow(KOLONNER.map(function (k) { return celle_(rad[k]); }));
    if (rad.status !== 'VENTELISTE') {
      tidligere.forEach(function (r) {
        if (r.status === 'VENTELISTE') oppdater_(r._rad, { status: 'AVBRUTT', notat: [r.notat, 'Meldte seg på igjen og fikk plass (' + rad.id + ')'].filter(String).join(' | ') });
      });
    }
  } finally { lock.releaseLock(); }

  if (rad.status === 'VENTELISTE') {
    sendVentelisteEpost_(rad);
    return { ok: true, waitlist: true };
  }

  if (rad.status === 'UBETALT') {
    sendBekreftelse_(rad);
    return { ok: true, status: 'UBETALT', id: rad.id, k: rad.nokkel, belop: rad.belop, vippsNummer: a.vippsNummer };
  }

  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  try {
    var res = vipps_('post', '/epayment/v1/payments', {
      amount: { currency: 'NOK', value: Math.round(rad.belop * 100) },
      paymentMethod: { type: 'WALLET' },
      reference: rad.id,
      userFlow: 'WEB_REDIRECT',
      returnUrl: site + '/?betaling=' + encodeURIComponent(rad.id) + '&k=' + rad.nokkel,
      paymentDescription: (test ? 'TEST ' : '') + 'Juletreff på KUMI – ' + rad.fornavn + ' ' + rad.etternavn
    }, 'create-' + rad.id);
    return { ok: true, status: 'VENTER', id: rad.id, k: rad.nokkel, redirectUrl: res.redirectUrl };
  } catch (err) {
    var o = finn_('id', rad.id);
    if (o) oppdater_(o._rad, { status: 'AVBRUTT', notat: 'Vipps-feil: ' + String(err.message).slice(0, 200) });
    throw new Error('Vi fikk ikke kontakt med Vipps. Prøv igjen om litt.');
  }
}

/**
 * Kalles når deltakeren kommer tilbake fra Vipps, og fra tidsstyrt utløser. Trygg å kalle mange ganger.
 * Nettsiden må sende med den hemmelige nøkkelen fra returadressen, så ingen kan se andres påmelding.
 */
function sjekkBetaling_(id, nokkel, fraUtloser) {
  if (!/^JT-\d{4,}$/.test(id || '')) throw new Error('Fant ikke påmeldingen');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var o = finn_('id', id);
    if (!o || !(fraUtloser || (nokkel && String(nokkel) === String(o.nokkel)))) throw new Error('Fant ikke påmeldingen');
    var svar = function (status) {
      return { ok: true, status: status, fornavn: o.fornavn, epost: maskEmail_(o.epost), belop: o.belop };
    };
    if (o.status !== 'VENTER') return svar(o.status);

    var pay = vipps_('get', '/epayment/v1/payments/' + encodeURIComponent(id));
    if (pay.state === 'CREATED') return svar('VENTER');
    if (pay.state !== 'AUTHORIZED') {
      oppdater_(o._rad, { status: 'AVBRUTT', notat: 'Vipps: ' + pay.state });
      return svar('AVBRUTT');
    }
    // Plassen er reservert, så beløpet trekkes med en gang.
    vipps_('post', '/epayment/v1/payments/' + encodeURIComponent(id) + '/capture',
      { modificationAmount: { currency: 'NOK', value: pay.amount.value } }, 'capture-' + id);
    oppdater_(o._rad, { status: 'BETALT', betalt: new Date() });
    o.status = 'BETALT';
    sendBekreftelse_(o);
    return svar('BETALT');
  } finally { lock.releaseLock(); }
}

/** Tidsstyrt utløser (hvert 5. minutt): fullfører betalinger der deltakeren lukket Vipps før retur. */
function pollPending() {
  var grense = Date.now() - 2 * 36e5;
  alle_().forEach(function (r) {
    if (r.status === 'VENTER' && new Date(r.opprettet).getTime() > grense) {
      try { sjekkBetaling_(r.id, null, true); } catch (err) { console.error(err); }
    } else if (r.status === 'VENTER') {
      oppdater_(r._rad, { status: 'AVBRUTT', notat: 'Utløpt' });
    }
  });
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

/* ------------------------------------------------------------------ */
/* E-post                                                              */
/* ------------------------------------------------------------------ */

function bindendeTekst_(belop) {
  var a = arrangement_();
  return 'Påmeldingen er bindende og kan bare trekkes med legeerklæring. Trekker du deg mer enn 48 timer før ' +
    'arrangementet, får du hele beløpet tilbake. Trekker du deg senere, får du ' + Math.max(0, belop - a.noshow) +
    ' kr tilbake, fordi vi beholder ' + a.noshow + ' kr til KUMIs no-show-gebyr.';
}

/** Bekreftelse i samme stil som den opprinnelige e-posten: fersken ramme, mørkt kort, bilde øverst. */
function sendBekreftelse_(r) {
  if (!r.epost) return;
  var a = arrangement_();
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  var betalt = r.status === 'BETALT';
  var fb = cfg_('FACEBOOK_URL', STANDARD_FACEBOOK_URL);
  var kart = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('KUMI Operagata 71B Oslo');
  var e = escapeHtml_;
  var fornavn = e(r.fornavn), etternavn = e(r.etternavn);
  var melding = 'Juletreff ' + r.fornavn + ' ' + r.etternavn;

  var rad = epostRad_, tabell = epostTabell_;

  var betaling = betalt
    ? '<div style="border: 1px solid #6fbf73; border-radius: 10px; padding: 20px; margin: 30px 0;">' +
      '<h3 style="font-size: 1.2rem; color: #8fd694; margin: 0 0 6px 0; text-align: center;">Betalt ' + r.belop + ' kr ✓</h3>' +
      '<p style="text-align: center; margin: 0;">Plassen din er sikret.</p></div>'
    : vippsBoks_(r, 'Plassen din er sikret når betalingen er mottatt.');

  var html = epostRamme_(
    '<h2 style="color: #edb77d; font-size: 1.5rem; margin-top: 0; text-align: center;">Hei ' + fornavn + ',</h2>' +
    '<p style="font-weight: bold; font-size: 1.1rem; margin: 20px 0 0 0; letter-spacing: 0.5px; text-align: center;">' +
    (betalt ? 'Du er påmeldt Juletreff på KUMI 🌿' : 'Takk for din påmelding til Juletreff på KUMI 🌿') + '</p>' +

    betaling +

    tabell(
      rad('Sted:', '<a href="' + kart + '" style="color: #edb77d; text-decoration: none; border-bottom: 1px dotted #edb77d;">' +
        e(a.sted) + '</a>') +
      rad('Tid:', e(a.dato)) +
      rad('Påmelding:', r.id, true), 'margin: 30px 0; ') +

    epostKnapp_(fb, 'Trykk «Skal» på Facebook-eventet 📅') +

    '<h3 style="font-size: 1.2rem; color: #edb77d; margin-bottom: 10px; text-align: left;">Dine detaljer:</h3>' +
    tabell(
      rad('Navn:', fornavn + ' ' + etternavn) +
      rad('Telefon:', e(r.telefon)) +
      rad('E-post:', '<span style="color: #F4EADF; text-decoration: none;">' +
        e(r.epost).replace('@', '&#8203;@').replace(/\./g, '&#8203;.') + '</span>', !r.kommentar) +
      (r.kommentar ? rad('Melding:', e(r.kommentar), true) : '')) +

    '<p style="font-size: .85rem; line-height: 1.5; margin: 30px 0 0 0; color: #bdb3a8; text-align: center;">' +
    e(bindendeTekst_(r.belop)) + '</p>',
    'Spørsmål, eller må du melde deg av med legeerklæring? Svar på denne e-posten.');

  var tekst =
    'Hei ' + r.fornavn + '!\n\n' +
    (betalt ? 'Du er påmeldt Juletreff på KUMI. Plassen din er sikret.' : 'Takk for din påmelding til Juletreff på KUMI.') + '\n\n' +
    (betalt ? 'Betalt: ' + r.belop + ' kr.'
      : 'Betal ' + r.belop + ' kr med Vipps' + (a.vippsNummer ? ' til #' + a.vippsNummer : '') +
        ' og skriv «' + melding + '» i meldingen. Plassen din er sikret når betalingen er mottatt.') + '\n\n' +
    'Sted: ' + a.sted + '\nTid: ' + a.dato + '\nPåmelding: ' + r.id + '\n\n' +
    'Trykk «Skal» på Facebook-eventet: ' + fb + '\n\n' +
    bindendeTekst_(r.belop) + '\n\n' +
    'Spørsmål, eller må du melde deg av med legeerklæring? Svar på denne e-posten.\n' +
    'Salgsvilkår: ' + site + '/#vilkar\nPersonvern: ' + site + '/#personvern';

  var emne = (erTest_(r) ? '[TEST] ' : '') +
    (betalt ? '✨ Du er påmeldt Juletreff på KUMI 🥂' : '✨ Juletreff på KUMI 🥂 Betal ' + r.belop + ' kr med Vipps');

  try {
    MailApp.sendEmail(r.epost, emne, tekst,
      { htmlBody: html, name: cfg_('AVSENDER_NAVN', 'Juletreff på KUMI'), replyTo: cfg_('SVAR_EPOST', '') || undefined });
    var o = finn_('id', r.id);
    if (o) oppdater_(o._rad, { epost_sendt: new Date() });
  } catch (err) { console.error('E-post feilet for ' + r.id + ': ' + err); }
}

/** Felles ramme for e-postene: fersken bakgrunn, bilde øverst, mørkt kort og mørk bunntekst. */
function epostRamme_(kropp, bunntekst) {
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  var bilde = cfg_('EPOST_BILDE', site + '/images/kumi.jpeg');
  return '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8">' +
    '<meta name="color-scheme" content="light only"><style>@media only screen and (max-width: 600px) {' +
    '.ytre { padding: 10px !important; } .indre { padding: 14px !important; } }' +
    '@media only screen and (max-width: 420px) { .knapp { font-size: .85rem !important; padding: 8px 15px !important; } }</style></head><body style="margin: 0;">' +
    '<table align="center" width="100%" cellpadding="0" cellspacing="0" class="ytre" style="background-color: #ffd9b0; ' +
    "font-family: 'Poppins', Arial, sans-serif; color: #333; max-width: 600px; margin: auto; padding: 30px;\" bgcolor=\"#ffd9b0\">" +
    '<tr><td style="padding: 0; border-radius: 15px 15px 0 0; overflow: hidden;" bgcolor="#ffd9b0">' +
    '<img src="' + bilde + '" alt="Juletreff på KUMI" style="width: 100%; height: 175px; object-fit: cover; display: block; border-radius: 15px 15px 0 0;">' +
    '</td></tr>' +
    '<tr><td class="indre" style="background-color: #333; color: #F4EADF; padding: 30px;" bgcolor="#333">' + kropp + '</td></tr>' +
    '<tr><td style="background-color: #111; padding: 20px; text-align: center; color: #777; border-radius: 0 0 15px 15px;" bgcolor="#111">' +
    '<p style="font-size: .8rem; margin: 0 0 6px 0;">' + bunntekst + '</p>' +
    '<p style="font-size: .8rem; margin: 0;"><a href="' + site + '/#vilkar" style="color: #999;">Salgsvilkår</a> · ' +
    '<a href="' + site + '/#personvern" style="color: #999;">Personvern</a></p>' +
    '</td></tr></table></body></html>';
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
    '<table width="100%" cellpadding="0" cellspacing="0" style="color: #F4EADF; font-size: 1rem; text-align: left;">' +
    '<tr><td style="padding: 8px; border-bottom: 1px solid #555; width: 110px;"><b>Tid:</b></td>' +
    '<td style="padding: 8px; border-bottom: 1px solid #555;">' + escapeHtml_(a.dato) + '</td></tr>' +
    '<tr><td style="padding: 8px; border-bottom: 1px solid #555;"><b>Sted:</b></td>' +
    '<td style="padding: 8px; border-bottom: 1px solid #555;">' + escapeHtml_(a.sted) + '</td></tr>' +
    '<tr><td style="padding: 8px;"><b>Pris:</b></td><td style="padding: 8px;">' + a.pris + ' kr</td></tr></table>' +
    '<p style="font-size: .85rem; line-height: 1.5; margin: 26px 0 0 0; color: #bdb3a8; text-align: center;">' +
    'Påmeldingsfristen er ' + escapeHtml_(a.fristTekst) + '. Vil du ikke lenger stå på ventelisten, kan du bare svare på denne e-posten.</p>';
  var tekst = 'Hei ' + r.fornavn + '!\n\nNå er det ' + plasser + ' på Juletreff på KUMI (' + a.dato + ').\n' +
    'Du står på ventelisten, og vi sier fra til alle på listen samtidig. Den som melder seg på først, får plassen.\n\n' +
    'Meld deg på her: ' + site + '/\n\nPåmeldingsfristen er ' + a.fristTekst + '.\n\nGod jul!';
  MailApp.sendEmail(r.epost, '✨ Ledig plass på Juletreff på KUMI 🥂', tekst, {
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
  var td = 'padding: 8px; color: #F4EADF;' + (sist ? '' : ' border-bottom: 1px solid #555;');
  return '<tr><td style="' + td + ' width: 110px;" bgcolor="#333"><b>' + k + '</b></td>' +
    '<td style="' + td + (farge ? ' color: ' + farge + ';' : '') + '" bgcolor="#333">' + v + '</td></tr>';
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

/** Oransje Vipps-boks med nummer, beløp og hva som skal stå i meldingen. */
function vippsBoks_(r, undertekst) {
  var a = arrangement_(), e = escapeHtml_;
  return '<div style="border: 1px solid #ff5b24; border-radius: 10px; padding: 20px; margin: 30px 0;">' +
    '<h3 style="font-size: 1.2rem; color: #ff5b24; margin: 0 0 10px 0; text-align: center;">Betal ' + r.belop + ' kr med Vipps</h3>' +
    '<p style="text-align: center; margin: 0 0 15px 0;">' + undertekst + '</p>' +
    epostTabell_(
      (a.vippsNummer ? epostRad_('Vipps-nummer:', '<b>#' + e(a.vippsNummer) + '</b>', false, '#edb77d') : '') +
      epostRad_('Beløp:', '<b>' + r.belop + ' kr</b>', false, '#edb77d') +
      epostRad_('Melding:', '<b>' + e('Juletreff ' + r.fornavn + ' ' + r.etternavn) + '</b>', true, '#edb77d')) +
    '</div>';
}

function sendEpost_(til, emne, tekst, kropp, bunntekst) {
  MailApp.sendEmail(til, emne, tekst, {
    htmlBody: epostRamme_(kropp, bunntekst || 'Spørsmål? Svar på denne e-posten.'),
    name: cfg_('AVSENDER_NAVN', 'Juletreff på KUMI'), replyTo: cfg_('SVAR_EPOST', '') || undefined
  });
}

function sendVentelisteEpost_(r) {
  var a = arrangement_();
  var fb = cfg_('FACEBOOK_URL', STANDARD_FACEBOOK_URL);
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
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  sendEpost_(r.epost, (erTest_(r) ? '[TEST] ' : '') + 'Påminnelse: betaling for Juletreff på KUMI',
    'Hei ' + r.fornavn + '!\n\nVi har ikke registrert betalingen for påmeldingen din (' + r.id + ') ennå.\n\n' +
    'Betal ' + r.belop + ' kr med Vipps' + (a.vippsNummer ? ' til #' + a.vippsNummer : '') +
    ' og skriv «Juletreff ' + r.fornavn + ' ' + r.etternavn + '» i meldingen.\n\n' +
    'Har du betalt de siste dagene, kan du se bort fra denne e-posten.\n\n' +
    'Påmeldingen er bindende. Salgsvilkår: ' + site + '/#vilkar\n\nGod jul!',
    epostHei_(r.fornavn, 'En liten påminnelse om betaling 🌿') +
    epostAvsnitt_('Vi har ikke registrert betalingen for påmeldingen din til juletreffet ' +
      escapeHtml_(a.dato.charAt(0).toLowerCase() + a.dato.slice(1)) + ' ennå.') +
    vippsBoks_(r, 'Plassen din er sikret når betalingen er mottatt.') +
    epostAvsnitt_('Har du betalt de siste dagene, kan du se bort fra denne e-posten.') +
    epostKnapp_(site + '/#vilkar', 'Les salgsvilkårene') +
    epostAvsnitt_('Påmeldingen er bindende. Påmeldings-ID: ' + r.id + '.', true),
    'Spørsmål om betalingen? Svar på denne e-posten.');
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

  return {
    ok: true,
    arrangement: { dato: a.dato, pris: a.pris, kapasitet: a.kapasitet, fristTekst: a.fristTekst, vippsAktiv: a.vippsAktiv,
      vippsModus: a.vippsModus, harVippsNokler: harVippsNokler_(), vippsMiljo: cfg_('VIPPS_ENV', 'test'),
      vippsNummer: a.vippsNummer, start: a.start.toISOString(), noshow: a.noshow, rapportTil: rapportMottaker_() },
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
        trukket: r.trukket, refundert: r.refundert, refusjon: r.refusjon, notat: r.notat, test: erTest_(r), varslet: r.varslet, purret: r.purret };
    })
  };
}

/**
 * Endringer fra adminsiden:
 *  betalt     markerer en manuell Vipps-betaling som mottatt (og sender bekreftelse)
 *  trekk      trekker påmeldingen (legeerklæring), og refunderer i Vipps hvis den ble betalt der.
 *             Under 48 timer før start (sent=true) beholdes no-show-gebyret, ellers refunderes alt.
 *  refundert  markerer at pengene er sendt tilbake manuelt
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

    if (p.handling === 'betalt') {
      if (o.status !== 'UBETALT') return { ok: false, error: 'Bare ubetalte påmeldinger kan markeres som betalt' };
      oppdater_(o._rad, { status: 'BETALT', betalt: new Date(), notat: nyttNotat('Markert betalt' + (notat ? ': ' + notat : '')) });
      o.status = 'BETALT';
      sendBekreftelse_(o);
      return { ok: true };
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
          vipps_('post', '/epayment/v1/payments/' + encodeURIComponent(o.id) + '/refund',
            { modificationAmount: { currency: 'NOK', value: Math.round(tilbake * 100) } }, 'refund-' + o.id);
          felt.refundert = new Date();
          melding += ' ' + tilbake + ' kr er refundert i Vipps.';
        } else if (tilbake > 0) {
          melding += ' Husk å betale tilbake ' + tilbake + ' kr, og marker som refundert.';
        } else {
          melding += ' Ingenting skal betales tilbake.';
        }
      }
      oppdater_(o._rad, felt);
      return { ok: true, melding: melding };
    }
    if (p.handling === 'refundert') {
      if (o.status !== 'TRUKKET' || !o.betalt) return { ok: false, error: 'Bare trukne, betalte påmeldinger kan markeres som refundert' };
      oppdater_(o._rad, { refundert: new Date(), notat: nyttNotat('Refundert manuelt') });
      return { ok: true };
    }
    if (p.handling === 'tilbud') {
      if (o.status !== 'VENTELISTE') return { ok: false, error: 'Bare påmeldinger på ventelisten kan få plass' };
      var a = arrangement_();
      oppdater_(o._rad, { status: 'UBETALT', betaling: 'manuell', notat: nyttNotat('Fikk plass fra ventelisten') });
      o.status = 'UBETALT';
      sendBekreftelse_(o);
      return { ok: true, melding: o.fornavn + ' har fått plass og fått e-post med betalingsinfo' +
        (a.vippsNummer ? ' (Vipps-nummer ' + a.vippsNummer + ')' : '') + '.' };
    }
    if (p.handling === 'purring') {
      if (o.status !== 'UBETALT') return { ok: false, error: 'Bare ubetalte påmeldinger kan purres' };
      sendPurring_(o);
      oppdater_(o._rad, { purret: new Date(), notat: nyttNotat('Purret' + (notat ? ': ' + notat : '')) });
      return { ok: true, melding: 'Purring sendt til ' + o.fornavn + ' ' + o.etternavn + '.' };
    }
    if (p.handling === 'slett') {
      if (!erTest_(o)) return { ok: false, error: 'Bare testpåmeldinger kan slettes' };
      if (o.status === 'BETALT' && o.betaling === 'vipps' && !o.refundert) {
        return { ok: false, error: 'Testen er betalt i Vipps. Trekk den og refunder først, så kan den slettes.' };
      }
      if (o.status === 'VENTER') avbrytVipps_(o.id);
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
 *  vippsModus  'nummer' (deltakerne betaler til Vipps-nummeret) eller 'api' (Vipps-betaling direkte)
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
    if (p.vippsModus === 'api' || p.vippsModus === 'nummer') {
      if (p.vippsModus === 'api') {
        if (!harVippsNokler_()) {
          return { ok: false, error: 'Vipps-API kan ikke slås på før Vipps-nøklene er lagt inn i Apps Script (VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY og VIPPS_MSN). Til da brukes Vipps-nummeret.' };
        }
        try { CacheService.getScriptCache().remove('vipps_token'); vippsToken_(); }
        catch (err) { return { ok: false, error: 'Fikk ikke kontakt med Vipps med nøklene som er lagt inn. Vipps-nummeret brukes fortsatt. (' + String(err.message).slice(0, 160) + ')' }; }
      }
      props.setProperty('VIPPS_MODUS', p.vippsModus);
      meldinger.push(p.vippsModus === 'api'
        ? 'Vipps-API er slått på' + (cfg_('VIPPS_ENV', 'test') === 'prod' ? '.' : ' i TESTMILJØET (VIPPS_ENV er ikke «prod»).') + ' Nye påmeldinger sendes rett til Vipps.'
        : 'Vipps-API er slått av. Nye påmeldinger betaler til Vipps-nummer ' + cfg_('VIPPS_NUMMER', '76192') + '.');
    }
  } finally { lock.releaseLock(); }
  return { ok: true, melding: meldinger.join(' ') || 'Ingen endringer.' };
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
  var rader = alle_();
  var ledige = a.kapasitet - opptatte_(rader);
  if (ledige <= 0) return { ok: false, error: 'Det er ingen ledige plasser. Knappen virker når antallet påmeldte er under ' + a.kapasitet + '.' };
  var venter = rader.filter(function (r) { return r.status === 'VENTELISTE' && !erTest_(r); });
  if (!venter.length) return { ok: false, error: 'Ingen står på ventelisten.' };
  var sendt = 0;
  venter.forEach(function (r) {
    try { sendLedigPlassEpost_(r, ledige); oppdater_(r._rad, { varslet: new Date() }); sendt++; }
    catch (err) { console.error('Ventelistevarsel feilet for ' + r.id + ': ' + err); }
  });
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
    var betalte = rader.filter(function (r) { return r.status === 'BETALT' && !erTest_(r); }).length;
    if (betalte) return { ok: false, error: 'Det finnes ' + betalte + ' betalte påmeldinger. Nullstilling er bare ment for bruk før lansering.' };
    var stempel = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH.mm');
    var tomt = 0;
    [PAMELDING_ARK, BESOK_ARK].forEach(function (navn) {
      var sh = sheet_(navn);
      var sist = sh.getLastRow();
      if (sist > 1) {
        sh.copyTo(sh.getParent()).setName('Arkiv ' + navn.toLowerCase() + ' ' + stempel);
        sh.deleteRows(2, sist - 1);
        tomt += sist - 1;
      }
    });
    PropertiesService.getScriptProperties().setProperty('NESTE_ID', '1001');
    return { ok: true, melding: 'Alt er nullstilt: ' + rader.length + ' påmeldinger og ' + (tomt - rader.length) +
      ' besøk er fjernet, og neste påmelding får JT-1001. En kopi ligger i «Arkiv»-faner i regnearket.' };
  } finally { lock.releaseLock(); }
}

/** Purring til alle som ikke har betalt. Hopper over dem som ble purret det siste døgnet. */
function adminPurring_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
  var grense = Date.now() - 20 * 36e5;
  var ubetalte = alle_().filter(function (r) { return r.status === 'UBETALT' && !erTest_(r); });
  if (!ubetalte.length) return { ok: false, error: 'Alle har betalt.' };
  var sendt = 0, hoppet = 0;
  ubetalte.forEach(function (r) {
    if (r.purret && new Date(r.purret).getTime() > grense) { hoppet++; return; }
    try {
      sendPurring_(r);
      oppdater_(r._rad, { purret: new Date() });
      sendt++;
    } catch (err) { console.error('Purring feilet for ' + r.id + ': ' + err); }
  });
  return { ok: true, melding: 'Purring sendt til ' + sendt + (sendt === 1 ? ' person' : ' personer') + '.' +
    (hoppet ? ' ' + hoppet + ' ble hoppet over fordi de fikk purring det siste døgnet.' : '') };
}

/** Testpåmelding fra adminsiden: går gjennom samme løp som en ekte påmelding, men teller ikke. */
function adminTestpamelding_(p) {
  if (!sjekkOkt_(p.okt)) return { ok: false, utlogget: true, error: 'Logg inn på nytt' };
  begrens_('endre', 60);
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

/* ------------------------------------------------------------------ */
/* Daglig statusmail til admin                                         */
/* ------------------------------------------------------------------ */

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
  var til = rapportMottaker_();
  if (!til) { console.log('Ingen ADMIN_EPOST eller SVAR_EPOST, statusmail sendes ikke.'); return { sendt: false, grunn: 'mottaker' }; }
  var a = arrangement_();
  var props = PropertiesService.getScriptProperties();
  var sist = Number(props.getProperty('RAPPORT_SIST') || 0);
  var rader = alle_().filter(function (r) { return !erTest_(r); });
  var tz = Session.getScriptTimeZone();
  var dato = function (d) { return d ? Utilities.formatDate(new Date(d), tz, 'dd.MM HH:mm') : ''; };
  var navn = function (r) { return escapeHtml_(r.fornavn + ' ' + r.etternavn) + ' <span style="color:#999">(' + r.id + ')</span>'; };

  var antall = {}; rader.forEach(function (r) { antall[r.status] = (antall[r.status] || 0) + 1; });
  var opptatt = opptatte_(rader), ledige = Math.max(0, a.kapasitet - opptatt);
  var nye = rader.filter(function (r) { return new Date(r.opprettet).getTime() > sist; });
  var nyeBetalt = rader.filter(function (r) { return r.betalt && new Date(r.betalt).getTime() > sist; });
  var nyeTrukket = rader.filter(function (r) { return r.trukket && new Date(r.trukket).getTime() > sist; });

  var dogn = 24 * 36e5;
  var ubetalte = rader.filter(function (r) { return r.status === 'UBETALT' && Date.now() - new Date(r.opprettet).getTime() > 2 * dogn; });
  var refusjon = rader.filter(function (r) { return r.status === 'TRUKKET' && r.betalt && !r.refundert && Number(r.refusjon || r.belop) > 0; });
  var venteliste = (antall.VENTELISTE || 0) > 0 && ledige > 0;

  var harNytt = nye.length || nyeBetalt.length || nyeTrukket.length;
  var harOppfolging = ubetalte.length || refusjon.length || venteliste;
  if (!tvungen && !harNytt && !harOppfolging) {
    props.setProperty('RAPPORT_SIST', String(Date.now()));
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
      refusjon.map(function (r) { return 'Skal ha ' + (r.refusjon === '' || r.refusjon == null ? r.belop : r.refusjon) + ' kr tilbake: ' + navn(r); }),
      venteliste ? [ledige + (ledige === 1 ? ' ledig plass' : ' ledige plasser') + ' og ' + antall.VENTELISTE + ' på ventelisten. Varsle ventelisten eller gi plass i admin.'] : [])) +
    epostKnapp_(site + '/#admin', 'Åpne admin');
  var tekst = 'Status: ' + opptatt + ' av ' + a.kapasitet + ' plasser tatt, ' + (antall.BETALT || 0) + ' betalt, ' +
    (antall.UBETALT || 0) + ' ikke betalt, ' + (antall.VENTELISTE || 0) + ' på venteliste.\n' +
    (harNytt ? nye.length + ' nye påmeldinger, ' + nyeBetalt.length + ' nye betalinger, ' + nyeTrukket.length + ' trukket siden sist.\n' : '') +
    (harOppfolging ? 'Noe må følges opp. ' : '') + 'Åpne admin: ' + site + '/#admin';
  sendEpost_(til, 'Juletreff KUMI: ' + (harOppfolging ? 'status og ting å følge opp' : 'status'), tekst, kropp, 'Sendes hver morgen når noe er nytt eller må følges opp.');
  props.setProperty('RAPPORT_SIST', String(Date.now()));
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
    KOLONNER.forEach(function (k, j) { r[k] = vals[i][j]; });
    r.epost = String(r.epost || '').toLowerCase();
    ut.push(r);
  }
  return ut;
}

function finn_(felt, verdi) {
  var hit = alle_().filter(function (r) { return String(r[felt]) === String(verdi); });
  return hit.length ? hit[hit.length - 1] : null;
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
  if (n > maksPerMinutt) throw new Error('Mange forespørsler akkurat nå. Prøv igjen om et minutt.');
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
