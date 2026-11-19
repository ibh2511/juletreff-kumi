// Vipps privat: lenker som åpner Vipps med mottakeren ferdig utfylt, kopiering og QR-kode.
// Lenken lages i backend (vippsLenke_) i formatet Vipps dokumenterer for personlige QR-koder.
// At den åpner appen fra en nettside, er ikke dokumentert, så betalingssiden har alltid en reservelenke
// og en kopier-knapp.
import qrcode from "qrcode-generator"

// Nettleseren inne i Instagram, Facebook, Messenger, TikTok, Snapchat o.l.
export function inApp() {
  const ua = navigator.userAgent || ""
  const ios =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  // Messenger må sjekkes før Facebook, fordi Messenger også har Facebook-merker i nettleser-ID-en.
  // Threads heter «Barcelona» i nettleser-ID-en.
  const app = /Instagram/i.test(ua)
    ? "Instagram"
    : /Barcelona/.test(ua)
      ? "Threads"
      : /Messenger|Orca-Android|FBAN\/(MessengerForiOS|MessengerLiteForiOS)/i.test(ua)
        ? "Messenger"
        : /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)
          ? "Facebook"
          : /TikTok|musical_ly|Bytedance/i.test(ua)
            ? "TikTok"
            : /Snapchat/i.test(ua)
              ? "Snapchat"
              : /LinkedInApp/i.test(ua)
                ? "LinkedIn"
                : /Pinterest/i.test(ua)
                  ? "Pinterest"
                  : /; wv\)/.test(ua)
                    ? "appen"
                    : // Andre apper på iPhone: vanlige nettlesere har «Safari/» i nettleser-ID-en, nettleseren inne i apper har det ikke.
                      ios && !/Safari\//.test(ua) && !navigator.standalone
                      ? "appen"
                      : ""
  return app ? { app, ios } : null
}

export function miljo() {
  const ua = navigator.userAgent || ""
  const ios =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
  const android = /Android/i.test(ua)
  const app = inApp()
  return { ios, android, mobil: ios || android, inApp: app ? app.app : "" }
}

/** Samme lenke i tre varianter: vanlig nettadresse, Vipps-appens egen adresse og Android-«intent». */
export function lenker(https) {
  const uten = https.replace(/^https:\/\//, "")
  return {
    https,
    vipps: `vipps://${uten}`,
    intent: `intent://${uten}#Intent;scheme=vipps;package=no.dnb.vipps;S.browser_fallback_url=${encodeURIComponent(https)};end`,
  }
}

/**
 * Hvilken variant «Åpne Vipps»-knappen bruker, og hvilken som er reserve («Åpnet ikke Vipps?»).
 * Android: «intent» åpner appen direkte, også inne i Facebook og Instagram, og faller tilbake til nettadressen.
 * iPhone inne i apper: nettleseren der åpner ikke alltid apper fra vanlige lenker, så vipps:// prøves først.
 * Samme valg som på vegansk juleribbe, der variantene ble testet på iPhone, Android og PC.
 */
export function valg(m = miljo()) {
  if (m.android) return { hoved: "intent", reserve: "https" }
  if (m.ios && m.inApp) return { hoved: "vipps", reserve: "https" }
  return { hoved: "https", reserve: "vipps" }
}

// Nettleseren inne i apper (særlig på Android) nekter ofte navigator.clipboard. Da prøver vi den gamle måten.
export async function kopier(tekst) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(tekst)
      return
    } catch {
      // prøv den gamle måten under
    }
  }
  const t = document.createElement("textarea")
  t.value = tekst
  t.setAttribute("readonly", "")
  t.style.cssText = "position:fixed;top:0;left:0;opacity:0"
  document.body.appendChild(t)
  t.select()
  t.setSelectionRange(0, tekst.length)
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  document.body.removeChild(t)
  if (!ok) throw new Error("Kunne ikke kopiere")
}

/** QR-kode som SVG-tekst. */
export function qrSvg(tekst) {
  const q = qrcode(0, "M")
  q.addData(tekst)
  q.make()
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: "QR-kode som åpner Vipps" })
}
