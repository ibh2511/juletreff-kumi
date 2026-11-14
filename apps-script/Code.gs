// Google Apps Script for juletreffet: påmelding, bekreftelse med Vipps-info
// og besøksstatistikk i ett prosjekt med én utrulling.
// Fanene «Påmeldinger» og «Besøk» lages automatisk første gang.
// Se apps-script/README.md for oppsett.

// ---------- Innstillinger: endre her hvert år ----------
var PRICE_NOK = 570
var VIPPS_NUMBER = "" // f.eks. "123456". Tomt = e-posten sier at betalingsinfo kommer.
var EVENT_TIME_TEXT = "Fredag 19. desember kl 19.00"
var DEADLINE_TEXT = "16. desember"
var FACEBOOK_EVENT_URL = "https://www.facebook.com/events/664624256515915"
var SENDER_NAME = "Oslo vegansamfunn"
var MAX_PLACES = 32
// --------------------------------------------------------

function doGet() {
  return HtmlService.createHtmlOutput(
    "<!doctype html><html><body>OK</body></html>"
  )
}

var SIGNUP_HEADERS = ["Tidspunkt", "Fornavn", "Etternavn", "Telefon", "E-post", "Kommentar", "Betalt"]
var VISIT_HEADERS = ["Tidspunkt", "Besøks-ID", "Første besøk", "Nettleser", "Språk"]

function getOrCreateSheet(name, headers) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  var sheet = spreadsheet.getSheetByName(name)
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name)
    sheet.appendRow(headers)
    sheet.setFrozenRows(1)
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold")
  }
  return sheet
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  )
}

function doPost(e) {
  var p = (e && e.parameter) || {}
  if (p.action === "track_visitor") return trackVisitor(p)
  if (p.action === "get_stats") return getStats()
  return handleSignup(p)
}

// ---------- Besøksstatistikk ----------
function trackVisitor(p) {
  try {
    var lock = LockService.getScriptLock()
    lock.waitLock(10000)
    try {
      getOrCreateSheet("Besøk", VISIT_HEADERS).appendRow([
        new Date(),
        String(p.visitorId || "").slice(0, 100),
        String(p.isFirstVisit) === "true" ? "Ja" : "Nei",
        String(p.userAgent || "").slice(0, 300),
        String(p.language || "").slice(0, 20),
      ])
    } finally {
      lock.releaseLock()
    }
    return jsonResponse({ ok: true })
  } catch (err) {
    return jsonResponse({ ok: false, msg: String(err) })
  }
}

function getStats() {
  var sheet = getOrCreateSheet("Besøk", VISIT_HEADERS)
  var lastRow = sheet.getLastRow()
  if (lastRow < 2) {
    return jsonResponse({ totalUniqueVisitors: 0, totalVisits: 0, firstVisit: null, lastVisit: null })
  }
  var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues()
  var ids = {}
  rows.forEach(function (r) {
    if (r[1]) ids[r[1]] = true
  })
  return jsonResponse({
    totalUniqueVisitors: Object.keys(ids).length,
    totalVisits: rows.length,
    firstVisit: new Date(rows[0][0]).getTime(),
    lastVisit: new Date(rows[rows.length - 1][0]).getTime(),
  })
}

// ---------- Påmelding ----------
function handleSignup(p) {
  var lock = LockService.getScriptLock()
  try {
    lock.waitLock(20000)
    // 1) Hent data
    var formData = {
      Fornavn: (p.Fornavn || "").trim(),
      Etternavn: (p.Etternavn || "").trim(),
      Telefon: (p.Telefon || "").trim(),
      Email: (p.Email || "").trim().toLowerCase(),
      Message: (p.Message || "").trim(),
    }

    if (!formData.Fornavn || !formData.Email) {
      return pmResponse({ ok: false, error: true, msg: "Mangler navn eller e-post" })
    }

    // 2) Finn (eller lag) arket
    var sheet = getOrCreateSheet("Påmeldinger", SIGNUP_HEADERS)

    var lastRow = sheet.getLastRow()
    var emailCol = 5 // e-post ligger i kolonne E

    var emails =
      lastRow > 1
        ? sheet
            .getRange(2, emailCol, lastRow - 1, 1)
            .getValues()
            .flat()
            .map(function (x) {
              return String(x).trim().toLowerCase()
            })
        : []

    // 3) Duplikat?
    if (emails.indexOf(formData.Email) !== -1) {
      return pmResponse({
        ok: false,
        duplicate: true,
        waitlist: false,
        msg: "E-post allerede påmeldt",
      })
    }

    // 4) Venteliste etter MAX_PLACES påmeldte
    var isWaitlist = lastRow > MAX_PLACES

    if (!isWaitlist) {
      // 5) Skriv rad. «Betalt» endres til «Ja» manuelt når Vipps-betalingen er mottatt.
      sheet.appendRow([
        new Date(),
        formData.Fornavn,
        formData.Etternavn,
        formData.Telefon,
        formData.Email,
        formData.Message,
        "Nei",
      ])
      // 6) Send bekreftelse med betalingsinfo
      sendConfirmationEmail(formData)
      return pmResponse({ ok: true, duplicate: false, waitlist: false })
    } else {
      return pmResponse({ ok: true, duplicate: false, waitlist: true })
    }
  } catch (err) {
    return pmResponse({ ok: false, error: true, msg: String(err) })
  } finally {
    lock.releaseLock()
  }
}

// Hindrer at tekst fra skjemaet blir tolket som HTML i e-posten
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function vippsBlock(fornavn, etternavn) {
  var payTitle =
    '<h3 style="font-size: 1.2rem; color: #ff5b24; margin: 0 0 10px 0; text-align: center;">Betal ' +
    PRICE_NOK +
    " kr med Vipps</h3>"

  if (!VIPPS_NUMBER) {
    return (
      '<div style="border: 1px solid #ff5b24; border-radius: 10px; padding: 20px; margin: 30px 0;">' +
      payTitle +
      '<p style="text-align: center; margin: 0;">Du får betalingsinformasjon for Vipps i en egen e-post.</p></div>'
    )
  }

  var row = function (label, value, last) {
    return (
      '<tr><td style="padding: 8px; width: 110px; color: #F4EADF;' +
      (last ? "" : " border-bottom: 1px solid #555;") +
      '" bgcolor="#333"><b>' +
      label +
      '</b></td><td style="padding: 8px; color: #edb77d;' +
      (last ? "" : " border-bottom: 1px solid #555;") +
      '" bgcolor="#333"><b>' +
      value +
      "</b></td></tr>"
    )
  }

  return (
    '<div style="border: 1px solid #ff5b24; border-radius: 10px; padding: 20px; margin: 30px 0;">' +
    payTitle +
    '<p style="text-align: center; margin: 0 0 15px 0;">Plassen din er sikret når betalingen er mottatt.</p>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="color: #F4EADF; font-size: 1rem; text-align: left;">' +
    row("Vipps-nummer:", "#" + esc(VIPPS_NUMBER)) +
    row("Beløp:", PRICE_NOK + " kr") +
    row("Melding:", "Juletreff " + esc(fornavn) + " " + esc(etternavn), true) +
    "</table></div>"
  )
}

function sendConfirmationEmail(formData) {
  var fornavn = esc(formData.Fornavn)
  var etternavn = esc(formData.Etternavn)
  var telefon = esc(formData.Telefon)
  var email = esc(formData.Email)
  var message = esc(formData.Message)
  var subject = "✨ Juletreff på KUMI 🥂 Betal " + PRICE_NOK + " kr med Vipps"

  var htmlMessage = `
      <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
      <html xmlns="http://www.w3.org/1999/xhtml">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
        <meta name="color-scheme" content="light only">
        <style>
          @media only screen and (max-width: 600px) {
            .outer-padding { padding: 10px !important; }
            .reduced-padding { padding: 12px !important; }
            .half-width { width: 45px !important; }
            .responsive-link {
              font-size: .7rem !important;
              padding: 8px 15px !important;
              border-radius: 6px !important;
              margin: 20px 0 !important;
            }
          }
        </style>
      </head>

      <body>
        <table align="center" width="100%" cellpadding="0" cellspacing="0" class="outer-padding" style="background-color: #ffd9b0; font-family: 'Poppins', sans-serif; color: #333; max-width: 600px; margin: auto; padding: 30px;" bgcolor="#ffd9b0">

          <!-- Header Image -->
          <tr>
            <td style="background-color: #ffd9b0; border-radius: 15px 15px 0 0; overflow: hidden; padding: 0;" bgcolor="#ffd9b0">
              <img src="https://drive.google.com/thumbnail?id=11NlX0Gf5hyNIJV8LoTFkAzUkRx4DtrwN&sz=w1000"
                  alt="Juletreff Header" style="width: 100%; height: 175px; object-fit: cover; display: block; border-radius: 15px 15px 0 0;">
            </td>
          </tr>

          <!-- Email Body -->
          <tr>
            <td class="reduced-padding" style="background-color: #333; color: #F4EADF; padding: 30px;" bgcolor="#333">
              <h2 style="color: #edb77d; font-size: 1.5rem; margin-top: 0; text-align: center;">Hei ${fornavn},</h2>
              <p style="font-weight: bold; font-size: 1.1rem; margin: 20px 0 0 0; letter-spacing: 0.5px; text-align: center;">
                Takk for din påmelding til Juletreff på KUMI 🌿
              </p>

              <!-- Vipps -->
              ${vippsBlock(formData.Fornavn, formData.Etternavn)}

              <p style="font-size: 1rem; margin: 20px 0 30px 0; letter-spacing: 0.5px; text-align: center;">
                Kan du likevel ikke komme? Gi beskjed <b>innen ${DEADLINE_TEXT}</b> ved å svare på denne e-posten.
              </p>

              <!-- Event Details -->
              <table width="100%" cellpadding="0" cellspacing="0" class="table-padding" style="margin: 30px 0; color: #F4EADF; font-size: 1rem; text-align: left;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #555; width: 100px; color: #F4EADF;" bgcolor="#333"><b>Sted:</b></td>
                  <td style="padding: 8px; border-bottom: 1px solid #555; color: #F4EADF;" bgcolor="#333">
                    <a href="https://www.google.com/maps/place//data=!4m2!3m1!1s0x46416f9ec478cb49:0xc80a0f71e2f84fcf?sa=X&ved=1t:8290&ictx=111"
                      style="color: #edb77d; text-decoration: none; border-bottom: 1px dotted #edb77d;">KUMI Oslobukta, Operagata 71B</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 8px; width: 100px; color: #F4EADF;" bgcolor="#333"><b>Tid:</b></td>
                  <td style="padding: 8px; color: #F4EADF;" bgcolor="#333">${EVENT_TIME_TEXT}</td>
                </tr>
              </table>

              <!-- Facebook Event Link -->
              <p style="font-size: 1.2rem; font-weight: bold; margin: 40px 0; text-align: center;">
                <a href="${FACEBOOK_EVENT_URL}"
                  class="responsive-link btn-bg"
                  style="display: inline-block; background-color: #edb77d; padding: 10px 20px; border-radius: 8px; color: #333; font-weight: bold; text-decoration: none; border: 2px dashed #333;">
                  Trykk «Skal» på Facebook-eventet! 📅
                </a>
              </p>

              <!-- Personal Details -->
              <h3 style="font-size: 1.2rem; color: #edb77d; margin-bottom: 10px; text-align: left;">Dine detaljer:</h3>
              <table width="100%" cellpadding="0" cellspacing="0" class="table-padding" style="color: #F4EADF; font-size: 1rem; text-align: left;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #555; width: 100px; color: #F4EADF;" bgcolor="#333"><b>Navn:</b></td>
                  <td style="padding: 8px; border-bottom: 1px solid #555; color: #F4EADF;" bgcolor="#333">${fornavn} ${etternavn}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #555; width: 100px; color: #F4EADF;" bgcolor="#333"><b>Telefon:</b></td>
                  <td style="padding: 8px; border-bottom: 1px solid #555; color: #F4EADF;" bgcolor="#333">${telefon}</td>
                </tr>
                <tr>
                  <td class="half-width light-text" style="padding: 8px; ${message ? "border-bottom: 1px solid #555;" : ""} width: 100px;"><b>E-post:</b></td>
                  <td style="padding: 8px; ${message ? "border-bottom: 1px solid #555;" : ""}"><span style="color: #F4EADF; text-decoration: none;">${email.replace("@", "&#8203;@").replace(/\./g, "&#8203;.")}</span></td>
                </tr>
                ${
                  message
                    ? `
                <tr>
                  <td style="padding: 8px; width: 100px; color: #F4EADF;" bgcolor="#333"><b>Melding:</b></td>
                  <td style="padding: 8px; color: #F4EADF;" bgcolor="#333">${message}</td>
                </tr>`
                    : ""
                }
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #111; padding: 20px; text-align: center; color: #777; border-radius: 0 0 15px 15px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);" bgcolor="#111">
              <p style="font-weight: bold; font-size: .8rem; margin: 0;">Vil du melde deg av? Svar på denne e-posten.</p>
            </td>
          </tr>

        </table>
      </body>
      </html>
`

  MailApp.sendEmail({
    to: formData.Email,
    name: SENDER_NAME,
    subject: subject,
    htmlBody: htmlMessage,
  })
}

// Lager et lite HTML-svar som kjører postMessage opp til React-siden
function pmResponse(obj) {
  var payload = JSON.stringify(obj)
  var html =
    "<!doctype html><html><body><script>window.top.postMessage(" +
    payload +
    ', "*");</script></body></html>'
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(
    HtmlService.XFrameOptionsMode.ALLOWALL
  )
}
