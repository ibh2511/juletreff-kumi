import { useState } from "react"
import { apiPost } from "./api.js"
import "./AdminStats.css"

// Passordet sjekkes i backend (Apps Script). Nettleseren får bare en tidsbegrenset
// innloggingsnøkkel tilbake, og passordet lagres aldri her.
export default function AdminLogin({ onLoginSuccess }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")
    try {
      const d = await apiPost({ action: "admin", passord: password })
      if (d.ok && d.okt) {
        onLoginSuccess(d.okt)
        return
      }
      setError(d.error || "Feil passord")
    } catch {
      setError(
        "Fikk ikke kontakt med backend. Sjekk at Apps Script er publisert med tilgang «Alle»."
      )
    }
    setPassword("")
    setIsLoading(false)
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>🔐 Admin</h1>
        <a className="back-btn" href="#">
          ← Tilbake til påmelding
        </a>
      </div>

      <div className="login-form">
        <form onSubmit={handleSubmit}>
          <label htmlFor="admin-password">Passord</label>
          <input
            type="password"
            id="admin-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isLoading}
            autoFocus
            autoComplete="current-password"
          />

          {error && <div className="error-message">⚠️ {error}</div>}

          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="login-btn"
          >
            {isLoading ? "Logger inn …" : "Logg inn"}
          </button>
        </form>
      </div>
    </div>
  )
}
