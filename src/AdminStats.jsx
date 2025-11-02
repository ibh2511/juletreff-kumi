import { useState, useEffect } from "react"
import {
  getVisitorInfo,
  resetVisitorTracking,
  getGlobalStatistics,
  getGlobalStatisticsSync,
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

  const loadStats = async () => {
    const visitorInfo = getVisitorInfo()
    setStats(visitorInfo)

    // Prøv å hente global statistikk fra backend
    try {
      const globalInfo = await getGlobalStatistics()
      setGlobalStats(globalInfo)
    } catch (error) {
      // Fallback til lokal statistikk
      const localInfo = getGlobalStatisticsSync()
      setGlobalStats(localInfo)
    }
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

  const handleLogout = () => {
    sessionStorage.removeItem("juletreff-admin-auth")
    window.location.href = "/juletreff-kumi/"
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
        <div className="header-actions">
          <button
            className="back-btn"
            onClick={() => (window.location.href = "/juletreff-kumi/")}
          >
            ← Tilbake til påmelding
          </button>
          <button className="logout-btn" onClick={handleLogout}>
            🚪 Logg ut
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-number">{globalStats.totalUniqueVisitors}</div>
          <div className="stat-label">Totalt unike besøkende</div>
          <small
            style={{
              color: "var(--muted)",
              fontSize: "12px",
              marginTop: "5px",
              display: "block",
            }}
          >
            🌐 Global statistikk fra alle enheter
          </small>
        </div>

        <div className="stat-card">
          <div className="stat-number">{globalStats.totalVisits || "N/A"}</div>
          <div className="stat-label">Totale besøk</div>
        </div>

        <div className="stat-card">
          <div className="stat-number">{stats.visitCount || 0}</div>
          <div className="stat-label">Dine besøk</div>
          <small
            style={{
              color: "var(--muted)",
              fontSize: "12px",
              marginTop: "5px",
              display: "block",
            }}
          >
            📱 På denne enheten/browseren
          </small>
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

        <h3>� Om statistikken:</h3>
        <ul>
          <li>
            <strong>Totalt unike besøkende:</strong> Ekte globale data fra alle
            enheter/browsere (via Google Apps Script)
          </li>
          <li>
            <strong>Totale besøk:</strong> Alle besøk fra alle brukere
            sammenlagt
          </li>
          <li>
            <strong>Dine besøk:</strong> Kun dine besøk på denne
            enheten/browseren
          </li>
          <li>Data synkroniseres automatisk til Google Sheets backend</li>
        </ul>

        <h3>📝 Tekniske notater:</h3>
        <ul>
          <li>Global statistikk hentes fra Google Apps Script backend</li>
          <li>Fallback til lokal data hvis backend er utilgjengelig</li>
          <li>Visitor tracking fungerer på tvers av enheter og browsere</li>
          <li>Statistikk oppdateres automatisk hvert 5. sekund</li>
          <li>Nullstilling sletter kun lokal tracking-data</li>
        </ul>
      </div>
    </div>
  )
}
