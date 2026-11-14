import { useState } from "react"
import { formatPrice } from "./config.js"

// Betalingskort når Vipps-avtalen (ePayment) ikke er satt opp: deltakeren betaler
// selv til Vipps-nummeret. Admin markerer betalingen som mottatt i adminsiden.
export default function VippsPayment({ belop, vippsNummer, navn, id }) {
  const [copied, setCopied] = useState(false)
  const melding = `Juletreff ${navn || ""}`.trim()

  // Nettleseren i Facebook, Instagram og Messenger mangler ofte navigator.clipboard,
  // så vi faller tilbake til den gamle kopieringsmåten.
  const copyNumber = async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(vippsNummer)
      ok = true
    } catch {
      try {
        const t = document.createElement("textarea")
        t.value = vippsNummer
        t.setAttribute("readonly", "")
        t.style.position = "fixed"
        t.style.opacity = "0"
        document.body.appendChild(t)
        t.select()
        t.setSelectionRange(0, t.value.length)
        ok = document.execCommand("copy")
        document.body.removeChild(t)
      } catch {
        // Nummeret står uansett synlig
      }
    }
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="vipps-card">
      <div className="vipps-step">Siste steg</div>
      <h3>Betal {formatPrice(belop)} med Vipps</h3>

      {vippsNummer ? (
        <>
          <p className="vipps-lead">
            Plassen din er sikret når betalingen er mottatt.
          </p>
          <ol className="vipps-steps">
            <li>Åpne Vipps og velg «Betal»</li>
            <li>
              Søk opp Vipps-nummer{" "}
              <button
                type="button"
                className="vipps-number"
                onClick={copyNumber}
                title="Kopier Vipps-nummer"
              >
                #{vippsNummer}
              </button>
              {copied && <span className="vipps-copied">Kopiert</span>}
            </li>
            <li>
              Beløp: <b>{formatPrice(belop)}</b>
            </li>
            <li>
              Melding: <b>«{melding}»</b>
            </li>
          </ol>
        </>
      ) : (
        <p className="vipps-lead">
          Du får betalingsinformasjon for Vipps på e-post.
        </p>
      )}
      {id && <p className="vipps-ref">Påmeldings-ID: {id}</p>}
    </div>
  )
}
