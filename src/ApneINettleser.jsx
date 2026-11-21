import { useEffect, useState } from "react"
import { inApp } from "./vipps.js"

// Åpnet i nettleseren inne i Instagram, Facebook, Messenger o.l.? Der virker Vipps, «Legg i kalenderen» og
// autoutfylling dårligere, så vi sender folk til standardnettleseren.
//  - Android: siden åpnes i standardnettleseren med en gang (intent-lenke), én gang per økt, så det ikke går i ring.
//  - iPhone: apper kan ikke åpnes i Safari automatisk. Øverst står en stripe med «Åpne i Safari»
//    (x-safari-https, iOS 17 og nyere) og hvordan man gjør det selv via menyen.
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
  return (
    <div className="nettleser-stripe" role="note">
      <p>
        Du er i nettleseren til {app.app}. Vipps og kalenderen virker best i{" "}
        {app.ios ? "Safari" : "nettleseren din"}.
      </p>
      <a className="nettleser-knapp" href={lenke}>
        Åpne i {app.ios ? "Safari" : "nettleseren"}
      </a>
      <small>Eller trykk {app.ios ? "⋯" : "⋮"} øverst og velg «Åpne i nettleser».</small>
      <button type="button" className="nettleser-lukk" aria-label="Lukk" onClick={() => setLukket(true)}>
        ×
      </button>
    </div>
  )
}
