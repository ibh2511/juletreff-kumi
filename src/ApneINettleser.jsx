import { useEffect, useRef, useState } from "react"
import { inApp, kopier, META } from "./vipps.js"

// Åpnet i nettleseren inne i Instagram, Facebook, Messenger o.l.? Der virker Vipps, «Legg i kalenderen» og
// autoutfylling dårligere, så vi sender folk til standardnettleseren.
//  - Android: siden åpnes i standardnettleseren med en gang (intent-lenke), én gang per økt, så det ikke går i ring.
//  - iPhone: apper kan ikke åpnes i Safari automatisk. Øverst står en stripe med «Åpne i Safari»
//    (x-safari-https, iOS 17 og nyere). Siden kan ikke se om lenken virket,
//    men forlater vi ikke siden innen 1,5 s, gjorde den det ikke. Da vises stegene for å gjøre det via menyen.
//    Appene til Meta stopper lenken (testet i Messenger på iPhone 14), så der
//    står stegene og «Kopier lenken» i stedet for knappene.
const NOKKEL = "jt_apnet_i_nettleser"

function lesFlagg() {
  try {
    return sessionStorage.getItem(NOKKEL) === "1"
  } catch {
    return false
  }
}
function settFlagg() {
  try {
    sessionStorage.setItem(NOKKEL, "1")
  } catch {
    // privat modus: da prøver vi bare igjen neste gang
  }
}

// Ringer feilet() hvis siden fortsatt er synlig 1,5 s etter at en app-lenke ble trykket
function provLenke(feilet) {
  const t = setTimeout(feilet, 1500)
  document.addEventListener("visibilitychange", () => document.hidden && clearTimeout(t), { once: true })
  window.addEventListener("pagehide", () => clearTimeout(t), { once: true })
}

export default function ApneINettleser() {
  const [app] = useState(() => inApp())
  const [lukket, setLukket] = useState(false)
  const [kopiert, setKopiert] = useState(false)
  const dialog = useRef(null)
  const url = window.location.href
  const uten = url.replace(/^https?:\/\//, "")
  const android = app && !app.ios
  const lenke = android
    ? `intent://${uten}#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end`
    : `x-safari-${url}`

  useEffect(() => {
    if (!android || lesFlagg()) return
    settFlagg()
    window.location.href = lenke
  }, [android, lenke])

  if (!app || lukket) return null
  const meta = app.ios && META.includes(app.app)
  const prikker = app.ios ? "⋯" : "⋮"
  const visSteg = () => dialog.current?.showModal()
  const kopierKnapp = (
    <button
      type="button"
      className="nettleser-knapp sekundar"
      onClick={async () => {
        try {
          await kopier(url)
          setKopiert(true)
        } catch {
          // kopiering stoppet: stegene virker uansett
        }
      }}
    >
      {kopiert ? "Lenken er kopiert ✓" : "Kopier lenken"}
    </button>
  )

  return (
    <div className="nettleser-stripe" role="note">
      <p>
        Du er i nettleseren til {app.app}. Påmeldingen og Vipps virker best i{" "}
        {app.ios ? "Safari" : "nettleseren din"}.
      </p>
      {meta ? (
        <>
          <p className="nettleser-steg">
            Trykk <b>{prikker}</b> øverst til høyre og velg <b>«Åpne i nettleser»</b>.
          </p>
          {kopierKnapp}
        </>
      ) : (
        <>
          <a className="nettleser-knapp" href={lenke} onClick={() => provLenke(visSteg)}>
            Åpne i {app.ios ? "Safari" : "nettleseren"}
          </a>
        </>
      )}
      <button type="button" className="nettleser-lukk" aria-label="Lukk" onClick={() => setLukket(true)}>
        ×
      </button>

      <dialog
        ref={dialog}
        className="nettleser-dialog"
        aria-labelledby="nettleser-dialog-tittel"
        onClick={(e) => e.target === dialog.current && dialog.current.close()}
      >
        <h2 id="nettleser-dialog-tittel">Slik åpner du siden i nettleseren</h2>
        <ol className="nettleser-illustrasjon">
          <li>
            <div className="mock mock-topp" aria-hidden="true">
              <span>×</span>
              <span className="mock-adresse">{window.location.host}</span>
              <span className="mock-mal">{prikker}</span>
            </div>
            <p>
              Trykk <b>{prikker}</b> øverst til høyre i {app.app}.
            </p>
          </li>
          <li>
            <div className="mock mock-meny" aria-hidden="true">
              <span>Kopier lenke</span>
              <span className="mock-mal">Åpne i nettleser</span>
              <span>Del</span>
            </div>
            <p>
              Velg <b>«Åpne i nettleser»</b>. Noen apper kaller det «Åpne i Safari», «Åpne i Chrome» eller
              «Åpne i ekstern nettleser».
            </p>
          </li>
          <li>
            <div className="mock mock-safari" aria-hidden="true">
              <span className="mock-adresse">🔒 {window.location.host}</span>
              <span className="mock-hake">✓</span>
            </div>
            <p>Siden åpnes i nettleseren din, og påmeldingen og Vipps virker.</p>
          </li>
        </ol>
        <p className="nettleser-dialog-reserve">
          Finner du det ikke? Kopier lenken og lim den inn i nettleseren din.
        </p>
        <div className="nettleser-knapper">
          {kopierKnapp}
          <button type="button" className="nettleser-knapp" onClick={() => dialog.current.close()}>
            Lukk
          </button>
        </div>
      </dialog>
    </div>
  )
}
