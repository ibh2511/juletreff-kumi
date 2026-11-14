import { useState } from "react"
import { formatPrice } from "./config.js"

// Betalingskort når Vipps-avtalen (ePayment) ikke er satt opp: deltakeren betaler
// selv til Vipps-nummeret. Admin markerer betalingen som mottatt i adminsiden.
export default function VippsPayment({ belop, vippsNummer, navn, id }) {
  const [copied, setCopied] = useState(false)
  const melding = `Juletreff ${navn || ""}`.trim()

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(vippsNummer)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Utklippstavle ikke tilgjengelig, nummeret står uansett synlig
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
