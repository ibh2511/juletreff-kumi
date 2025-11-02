import { useState } from "react"
import "./AdminStats.css"

// Enkelt passord (kan endres her)
const ADMIN_PASSWORD = "juletreff2025"

export default function AdminLogin({ onLoginSuccess }) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setError("")

    // Simuler litt loading-tid for sikkerhet
    await new Promise((resolve) => setTimeout(resolve, 500))

    if (password === ADMIN_PASSWORD) {
      // Lagre autentisering i sessionStorage (forsvinner ved browser-lukking)
      sessionStorage.setItem("juletreff-admin-auth", "true")
      onLoginSuccess()
    } else {
      setError("Feil passord")
      setPassword("")
    }
    setIsLoading(false)
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>🔐 Admin Login</h1>
        <button
          className="back-btn"
          onClick={() => (window.location.href = "/juletreff-kumi/")}
        >
          ← Tilbake til påmelding
        </button>
      </div>

      <div className="login-form">
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="admin-password">Passord:</label>
            <input
              type="password"
              id="admin-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              autoFocus
              placeholder="Skriv inn admin-passord"
            />
          </div>

          {error && <div className="error-message">⚠️ {error}</div>}

          <button
            type="submit"
            disabled={isLoading || !password.trim()}
            className="login-btn"
          >
            {isLoading ? "Logger inn..." : "Logg inn"}
          </button>
        </form>

        <div className="login-info">
          <p>
            <small>💡 Tips: Kontakt admin for passord</small>
          </p>
        </div>
      </div>
    </div>
  )
}
