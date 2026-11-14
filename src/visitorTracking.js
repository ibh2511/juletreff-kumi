// Visitor tracking med localStorage + Google Apps Script backend
const VISITOR_KEY = "juletreff-kumi-visitor"
const VISIT_COUNT_KEY = "juletreff-kumi-visits"
const STATS_KEY = "juletreff-kumi-stats"

// Google Apps Script URL for visitor tracking (se src/gas.js)
import { GAS_VISITOR_URL } from "./gas.js"

// Send visitor data til backend (silent - ingen error handling som forstyrrer UX)
async function sendVisitorToBackend(visitorData) {
  try {
    const formData = new FormData()
    formData.append("action", "track_visitor")
    formData.append("visitorId", visitorData.visitorId)
    formData.append("isFirstVisit", visitorData.isFirstVisit)
    formData.append("timestamp", Date.now())
    formData.append("userAgent", navigator.userAgent)
    formData.append("language", navigator.language)

    // Send async uten å vente på svar (for ikke å påvirke brukeropplevelse)
    fetch(GAS_VISITOR_URL, {
      method: "POST",
      body: formData,
      mode: "no-cors", // Siden vi ikke trenger response
    }).catch(() => {
      // Silent fail - ikke påvirk brukeropplevelse
      console.log("📊 Visitor tracking sendt (backend unavailable)")
    })

    console.log("📊 Visitor data sendt til backend")
  } catch (error) {
    console.log("📊 Backend tracking utilgjengelig")
  }
}

// Hent global statistikk fra backend
async function fetchGlobalStats() {
  try {
    const formData = new FormData()
    formData.append("action", "get_stats")

    const response = await fetch(GAS_VISITOR_URL, {
      method: "POST",
      body: formData,
    })

    if (response.ok) {
      const data = await response.json()
      return {
        totalUniqueVisitors: data.totalUniqueVisitors || 0,
        totalVisits: data.totalVisits || 0,
        firstVisit: data.firstVisit || Date.now(),
        lastVisit: data.lastVisit || Date.now(),
      }
    }
  } catch (error) {
    console.log("📊 Kunne ikke hente global statistikk")
  }

  // Fallback til localStorage hvis backend ikke fungerer
  return getLocalStats()
}

// Lokale statistikker (fallback)
function getLocalStats() {
  const stats = localStorage.getItem(STATS_KEY)
  return stats
    ? JSON.parse(stats)
    : {
        totalUniqueVisitors: 1,
        totalVisits: 1,
        firstVisit: Date.now(),
        lastVisit: Date.now(),
      }
}

function updateLocalStats(isNewVisitor = false) {
  const stats = getLocalStats()
  if (isNewVisitor) {
    stats.totalUniqueVisitors += 1
  }
  stats.totalVisits += 1
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
    // Generer enkel unique ID basert på timestamp + random + browser fingerprint
    const fingerprint = btoa(navigator.userAgent + navigator.language).slice(
      0,
      8
    )
    const visitorId = `${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}-${fingerprint}`
    localStorage.setItem(VISITOR_KEY, visitorId)
    localStorage.setItem(VISIT_COUNT_KEY, "1")

    // Oppdater lokale stats
    updateLocalStats(true)

    // Send til backend (async)
    sendVisitorToBackend({ visitorId, isFirstVisit: true })

    console.log("🆕 Ny besøkende registrert:", visitorId)
    return { isFirstVisit: true, visitCount: 1, visitorId }
  } else {
    // Eksisterende besøkende - øk besøksteller
    const newVisitCount = visitCount + 1
    localStorage.setItem(VISIT_COUNT_KEY, newVisitCount.toString())

    // Oppdater lokale stats (ikke ny visitor)
    updateLocalStats(false)

    const visitorId = localStorage.getItem(VISITOR_KEY)

    // Send til backend (async)
    sendVisitorToBackend({ visitorId, isFirstVisit: false })

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
  // Returner cached stats først, deretter hent fresh data i bakgrunnen
  return fetchGlobalStats()
}

export function getGlobalStatisticsSync() {
  // Synkron versjon for når vi trenger umiddelbar data
  return getLocalStats()
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
