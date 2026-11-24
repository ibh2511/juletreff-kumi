import { useEffect, useState } from "react"
import { inApp, kopier } from "./vipps.js"

// Åpnet i nettleseren inne i Instagram, Facebook, Messenger o.l.? Der virker Vipps, «Legg i kalenderen» og
// autoutfylling dårligere, så vi sender folk til standardnettleseren.
//  - Android: siden åpnes i standardnettleseren med en gang (intent-lenke), én gang per økt, så det ikke går i ring.
//  - iPhone: apper kan ikke åpnes i Safari automatisk. Øverst står en stripe med «Åpne i Safari»
//    (x-safari-https, iOS 17 og nyere), «Chrome» ved siden av (googlechromes://) og hvordan man gjør det selv
//    via menyen. Siden kan ikke se om Chrome er installert, så skjer det ingenting, sier vi fra etter litt.
//    Appene til Meta stopper både x-safari- og googlechromes://-lenker (testet i Messenger på iPhone 14 med
//    Chrome installert). Der viser vi i stedet hvordan man gjør det via menyen, og en «Kopier lenken»-knapp.
const META = ["Facebook", "Messenger", "Instagram", "Threads"]
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

export default function ApneINettleser() {
  const [app] = useState(() => inApp())
  const [lukket, setLukket] = useState(false)
  const [ingenChrome, setIngenChrome] = useState(false)
  const [kopiert, setKopiert] = useState(false)
  const url = window.location.href
  const uten = url.replace(/^https?:\/\//, "")
  const android = app && !app.ios
  const lenke = android
    ? `intent://${uten}#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(url)};end`
    : `x-safari-${url}`
  const chrome = url.replace(/^http/, "googlechrome")

  // Forlater vi ikke siden innen 1,5 s, åpnet ikke Chrome (ikke installert)
  function provChrome() {
    const t = setTimeout(() => setIngenChrome(true), 1500)
    const borte = () => document.hidden && clearTimeout(t)
    document.addEventListener("visibilitychange", borte, { once: true })
    window.addEventListener("pagehide", () => clearTimeout(t), { once: true })
  }

  useEffect(() => {
    if (!android || lesFlagg()) return
    settFlagg()
    window.location.href = lenke
  }, [android, lenke])

  if (!app || lukket) return null
  const meta = app.ios && META.includes(app.app)
  return (
    <div className="nettleser-stripe" role="note">
      <p>
        Du er i nettleseren til {app.app}. Vipps og kalenderen virker best i{" "}
        {app.ios ? "Safari" : "nettleseren din"}.
      </p>
      {meta ? (
        <>
          <p className="nettleser-steg">
            Trykk <b>⋯</b> øverst til høyre og velg <b>«Åpne i nettleser»</b>.
          </p>
          <button
            type="button"
            className="nettleser-knapp sekundar"
            onClick={async () => {
              try {
                await kopier(url)
                setKopiert(true)
              } catch {
                // kopiering stoppet: instruksen over virker uansett
              }
            }}
          >
            {kopiert ? "Lenken er kopiert ✓" : "Kopier lenken"}
          </button>
        </>
      ) : (
        <>
          <div className="nettleser-knapper">
            <a className="nettleser-knapp" href={lenke}>
              Åpne i {app.ios ? "Safari" : "nettleseren"}
            </a>
            {app.ios && (
              <a className="nettleser-knapp sekundar" href={chrome} onClick={provChrome}>
                Chrome
              </a>
            )}
          </div>
          <small aria-live="polite">
            {ingenChrome
              ? "Fant ikke Chrome. Bruk Safari i stedet."
              : `Eller trykk ${app.ios ? "⋯" : "⋮"} øverst og velg «Åpne i nettleser».`}
          </small>
        </>
      )}
      <button type="button" className="nettleser-lukk" aria-label="Lukk" onClick={() => setLukket(true)}>
        ×
      </button>
    </div>
  )
}
