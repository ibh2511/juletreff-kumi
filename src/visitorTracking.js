// Enkel visitor tracking med localStorage
const VISITOR_KEY = "juletreff-kumi-visitor"
const VISIT_COUNT_KEY = "juletreff-kumi-visits"
const STATS_KEY = "juletreff-kumi-stats"

// Globale statistikker (delt mellom alle brukere på samme maskin)
function getGlobalStats() {
  const stats = localStorage.getItem(STATS_KEY)
  return stats
    ? JSON.parse(stats)
    : { totalVisitors: 0, firstVisit: Date.now() }
}

function updateGlobalStats(isNewVisitor = false) {
  const stats = getGlobalStats()
  if (isNewVisitor) {
    stats.totalVisitors += 1
  }
  stats.lastVisit = Date.now()
  if (!stats.firstVisit) {
    stats.firstVisit = Date.now()
  }
  localStorage.setItem(STATS_KEY, JSON.stringify(stats))
  return stats
}

export function setupVisitorTracking() {
  const isFirstVisit = !localStorage.getItem(VISITOR_KEY)
  const visitCount = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || "0", 10)

  if (isFirstVisit) {
    // Generer enkel unique ID basert på timestamp + random
    const visitorId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    localStorage.setItem(VISITOR_KEY, visitorId)
    localStorage.setItem(VISIT_COUNT_KEY, "1")

    // Oppdater globale stats
    updateGlobalStats(true)

    console.log("🆕 Ny besøkende registrert:", visitorId)
    return { isFirstVisit: true, visitCount: 1, visitorId }
  } else {
    // Eksisterende besøkende - øk besøksteller
    const newVisitCount = visitCount + 1
    localStorage.setItem(VISIT_COUNT_KEY, newVisitCount.toString())

    // Oppdater globale stats (ikke ny visitor)
    updateGlobalStats(false)

    const visitorId = localStorage.getItem(VISITOR_KEY)
    console.log(
      "🔄 Tilbakevendende besøkende:",
      visitorId,
      "Besøk #",
      newVisitCount
    )
    return { isFirstVisit: false, visitCount: newVisitCount, visitorId }
  }
}

export function getVisitorInfo() {
  return {
    visitorId: localStorage.getItem(VISITOR_KEY),
    visitCount: parseInt(localStorage.getItem(VISIT_COUNT_KEY) || "0", 10),
    isReturning: !!localStorage.getItem(VISITOR_KEY),
  }
}

export function getGlobalStatistics() {
  return getGlobalStats()
}

// Funksjon for å nullstille tracking (for testing)
export function resetVisitorTracking() {
  localStorage.removeItem(VISITOR_KEY)
  localStorage.removeItem(VISIT_COUNT_KEY)
  console.log("🔄 Visitor tracking nullstilt")
}

export function resetAllStats() {
  localStorage.removeItem(VISITOR_KEY)
  localStorage.removeItem(VISIT_COUNT_KEY)
  localStorage.removeItem(STATS_KEY)
  console.log("🔄 All visitor tracking nullstilt")
}
