import { useState, useEffect } from "react"
import {
  getVisitorInfo,
  resetVisitorTracking,
  getGlobalStatistics,
  resetAllStats,
} from "./visitorTracking.js"
import "./AdminStats.css"

export default function AdminStats() {
  const [stats, setStats] = useState(null)
  const [globalStats, setGlobalStats] = useState(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => {
    loadStats()
    // Oppdater stats hvert 5. sekund for live data
    const interval = setInterval(loadStats, 5000)
    return () => clearInterval(interval)
  }, [])

  const loadStats = () => {
    const visitorInfo = getVisitorInfo()
    const globalInfo = getGlobalStatistics()
    setStats(visitorInfo)
    setGlobalStats(globalInfo)
  }

  const handleReset = () => {
    if (showResetConfirm) {
      resetAllStats()
      setShowResetConfirm(false)
      loadStats()
    } else {
      setShowResetConfirm(true)
    }
  }

  if (!stats || !globalStats) {
    return <div className="admin-loading">Laster statistikk...</div>
  }

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString("no-NO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <h1>📊 Juletreff KUMI - Admin Statistikk</h1>
        <button
          className="back-btn"
          onClick={() => (window.location.href = "/juletreff-kumi/")}
        >
          ← Tilbake til påmelding
        </button>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-number">{globalStats.totalVisitors}</div>
          <div className="stat-label">Totalt unike besøkende</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{stats.visitCount || 0}</div>
          <div className="stat-label">Dine besøk</div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Første besøk:</div>
          <div className="stat-detail">
            {formatDate(globalStats.firstVisit)}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-title">Siste aktivitet:</div>
          <div className="stat-detail">{formatDate(globalStats.lastVisit)}</div>
        </div>

        <div className="stat-card current-visitor">
          <div className="stat-title">Din visitor info:</div>
          <div className="visitor-details">
            <p>
              <strong>ID:</strong> {stats.visitorId || "Ikke satt"}
            </p>
            <p>
              <strong>Status:</strong>{" "}
              {stats.isReturning ? "🔄 Tilbakevendende" : "🆕 Ny"}
            </p>
            <p>
              <strong>Totale besøk:</strong> {stats.visitCount}
            </p>
          </div>
        </div>
      </div>

      <div className="admin-actions">
        <button className="refresh-btn" onClick={loadStats}>
          🔄 Oppdater statistikk
        </button>

        <button
          className={`reset-btn ${showResetConfirm ? "confirm" : ""}`}
          onClick={handleReset}
          onBlur={() => setShowResetConfirm(false)}
        >
          {showResetConfirm
            ? "⚠️ Klikk igjen for å bekrefte"
            : "🗑️ Nullstill all tracking"}
        </button>
      </div>

      <div className="admin-info">
        <h3>ℹ️ Hvordan få tilgang til denne siden:</h3>
        <p>
          Legg til <code>#admin</code> på slutten av URL-en:{" "}
          <code>your-domain.com/juletreff-kumi/#admin</code>
        </p>

        <h3>📝 Notater:</h3>
        <ul>
          <li>Data lagres i brukerens localStorage (browser-spesifikt)</li>
          <li>Statistikk oppdateres automatisk hvert 5. sekund</li>
          <li>
            Nullstilling sletter ALL tracking-data (inkludert global statistikk)
          </li>
          <li>Hver unique browser/device telles som egen besøkende</li>
          <li>Global statistikk viser totalt på denne enheten/browseren</li>
        </ul>
      </div>
    </div>
  )
}
