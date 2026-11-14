import { useState } from "react"
import {
  PRICE_NOK,
  VIPPS_NUMBER,
  VIPPS_PAYMENT_URL,
  VIPPS_QR_IMAGE,
  formatPrice,
} from "./payment.js"

// Betalingskort som vises etter vellykket påmelding.
export default function VippsPayment() {
  const [copied, setCopied] = useState(false)
  const hasDetails = VIPPS_NUMBER || VIPPS_PAYMENT_URL

  const copyNumber = async () => {
    try {
      await navigator.clipboard.writeText(VIPPS_NUMBER)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Utklippstavle ikke tilgjengelig, nummeret står uansett synlig
    }
  }

  return (
    <div className="vipps-card">
      <div className="vipps-step">Siste steg</div>
      <h3>Betal {formatPrice(PRICE_NOK)} med Vipps</h3>

      {hasDetails ? (
        <>
          <p className="vipps-lead">
            Plassen din er sikret når betalingen er mottatt.
          </p>

          {VIPPS_PAYMENT_URL && (
            <a
              className="vipps-button"
              href={VIPPS_PAYMENT_URL}
              target="_blank"
              rel="noreferrer"
            >
              Betal {formatPrice(PRICE_NOK)} med Vipps
            </a>
          )}

          {VIPPS_QR_IMAGE && (
            <img
              className="vipps-qr"
              src={VIPPS_QR_IMAGE}
              alt="QR-kode for betaling med Vipps"
            />
          )}

          {VIPPS_NUMBER && (
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
                  #{VIPPS_NUMBER}
                </button>
                {copied && <span className="vipps-copied">Kopiert</span>}
              </li>
              <li>
                Beløp: <b>{formatPrice(PRICE_NOK)}</b>
              </li>
              <li>
                Melding: <b>«Juletreff» + ditt navn</b>
              </li>
            </ol>
          )}
        </>
      ) : (
        <p className="vipps-lead">
          Du får betalingsinformasjon for Vipps på e-post.
        </p>
      )}
    </div>
  )
}
