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
  'belop', 'betaling', 'nokkel', 'betalt', 'epost_sendt', 'bindende_godtatt', 'trukket', 'refundert', 'notat', 'kilde', 'refusjon', 'test'];
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
    pris: Number(cfg_('PRIS', '560')),
    dato: cfg_('DATO_TEKST', 'Fredag 18. desember kl. 19.00'),
    sted: cfg_('STED', 'KUMI, Operagata 71B, Oslobukta'),
    frist: new Date(cfg_('PAMELDINGSFRIST', '2026-12-15T23:59:59+01:00')),
    fristTekst: cfg_('FRIST_TEKST', 'tirsdag 15. desember'),
    kapasitet: Number(cfg_('KAPASITET', '30')),
    // Trekk med legeerklæring under 48 timer før start: vi beholder no-show-gebyret til KUMI
    start: new Date(cfg_('ARR_START', '2026-12-18T19:00:00+01:00')),
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

function sendBekreftelse_(r) {
  if (!r.epost) return;
  var a = arrangement_();
  var site = cfg_('SITE_URL', 'https://ibh2511.github.io/juletreff-kumi').replace(/\/$/, '');
  var betalt = r.status === 'BETALT';
  var fb = cfg_('FACEBOOK_URL', STANDARD_FACEBOOK_URL);
  var betalingTekst = betalt
    ? 'Betalt: ' + r.belop + ' kr med Vipps. Plassen din er sikret.'
    : 'Betal ' + r.belop + ' kr med Vipps' + (a.vippsNummer ? ' til Vipps-nummer ' + a.vippsNummer : '') +
      ', og skriv «Juletreff ' + r.fornavn + ' ' + r.etternavn + '» i meldingen. Plassen din er sikret når betalingen er mottatt.';

  var rad = function (k, v) {
    return '<tr><td style="padding:6px 0;color:#bdb3a8">' + k + '</td><td style="padding:6px 0;text-align:right;color:#fff"><b>' + v + '</b></td></tr>';
  };
  var html =
    '<div style="background:#111;padding:24px 12px;font-family:Arial,sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#1c1c1c;border-radius:12px;padding:28px;color:#f4eadf">' +
    '<h1 style="margin:0 0 6px;font-size:24px;color:#edb77d">' + (betalt ? 'Du er påmeldt! 🎄' : 'Takk for påmeldingen!') + '</h1>' +
    '<p style="margin:0 0 18px">Hei ' + escapeHtml_(r.fornavn) + ', vi gleder oss til å se deg på juletreffet.</p>' +
    '<table style="width:100%;border-collapse:collapse;font-size:15px">' +
    rad('Når', escapeHtml_(a.dato)) + rad('Hvor', escapeHtml_(a.sted)) +
    rad('Pris', r.belop + ' kr') + rad('Påmeldings-ID', r.id) + '</table>' +
    '<p style="margin:18px 0 0;padding:12px 14px;border-radius:8px;background:' + (betalt ? '#1f3326' : '#3a2416') + '">' +
    escapeHtml_(betalingTekst) + '</p>' +
    '<p style="margin:18px 0 0;padding:12px 14px;border-radius:8px;border:1px solid #edb77d;color:#fff">' +
    escapeHtml_(bindendeTekst_(r.belop)) + '</p>' +
    '<p style="margin:22px 0 0;text-align:center"><a href="' + fb + '" style="display:inline-block;padding:12px 22px;' +
    'border-radius:8px;background:#1877f2;color:#fff;font-weight:bold;text-decoration:none">Trykk «Skal» på Facebook-eventet 📅</a></p>' +
    '<p style="margin:18px 0 0;font-size:13px;color:#bdb3a8">Spørsmål eller legeerklæring? Svar på denne e-posten. ' +
    '<a style="color:#edb77d" href="' + site + '/#vilkar">Salgsvilkår</a> · ' +
    '<a style="color:#edb77d" href="' + site + '/#personvern">Personvern</a></p>' +
    '</div></div>';

  var tekst =
    'Hei ' + r.fornavn + '!\n\n' +
    (betalt ? 'Du er påmeldt juletreffet på KUMI.' : 'Takk for påmeldingen til juletreffet på KUMI.') + '\n\n' +
    'Når: ' + a.dato + '\nHvor: ' + a.sted + '\nPris: ' + r.belop + ' kr\nPåmeldings-ID: ' + r.id + '\n\n' +
    betalingTekst + '\n\n' + bindendeTekst_(r.belop) + '\n\n' +
    'Trykk «Skal» på Facebook-eventet: ' + fb + '\n\n' +
    'Salgsvilkår: ' + site + '/#vilkar\nPersonvern: ' + site + '/#personvern\n\n' +
    'Har du spørsmål, kan du svare på denne e-posten.\n\nGod jul!';

  try {
    MailApp.sendEmail(r.epost, (erTest_(r) ? '[TEST] ' : '') + (betalt ? 'Du er påmeldt' : 'Påmelding mottatt') + ': Juletreff på KUMI (' + r.id + ')', tekst,
      { htmlBody: html, name: cfg_('AVSENDER_NAVN', 'Juletreff på KUMI'), replyTo: cfg_('SVAR_EPOST', '') || undefined });
    var o = finn_('id', r.id);
    if (o) oppdater_(o._rad, { epost_sendt: new Date() });
  } catch (err) { console.error('E-post feilet for ' + r.id + ': ' + err); }
}

function sendVentelisteEpost_(r) {
  var a = arrangement_();
  try {
    MailApp.sendEmail(r.epost, 'Venteliste: Juletreff på KUMI',
      'Hei ' + r.fornavn + '!\n\nJuletreffet ' + a.dato + ' er dessverre fullt, men du står på ventelisten. ' +
      'Blir det ledig plass, sender vi deg en e-post. Du betaler ingenting før du har fått en plass.\n\nGod jul!',
      { name: cfg_('AVSENDER_NAVN', 'Juletreff på KUMI'), replyTo: cfg_('SVAR_EPOST', '') || undefined });
  } catch (err) { console.error('Venteliste-e-post feilet: ' + err); }
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
      vippsNummer: a.vippsNummer, start: a.start.toISOString(), noshow: a.noshow },
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
        trukket: r.trukket, refundert: r.refundert, refusjon: r.refusjon, notat: r.notat, test: erTest_(r) };
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
