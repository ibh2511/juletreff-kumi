import { API_URL } from "./config.js"

const qs = (o) =>
  Object.keys(o)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(o[k] ?? "")}`)
    .join("&")

export async function apiGet(params) {
  if (!API_URL) throw new Error("API ikke satt opp")
  const r = await fetch(`${API_URL}?${qs(params)}`, { redirect: "follow" })
  return r.json()
}

// text/plain gjør at nettleseren ikke trenger CORS-forhåndssjekk mot Apps Script
// keepalive: forespørselen fullføres selv om siden går i bakgrunnen (f.eks. når Vipps åpnes)
export async function apiPost(params, { keepalive = false } = {}) {
  if (!API_URL) throw new Error("API ikke satt opp")
  const r = await fetch(API_URL, {
    method: "POST",
    keepalive,
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(params),
  })
  return r.json()
}

// Hvilken nettside besøkende kom fra (bare domenet), husket for økten
export function kilde() {
  let ref =
    document.referrer && !document.referrer.includes(location.host)
      ? document.referrer.replace(/^https?:\/\//, "").split("/")[0]
      : ""
  try {
    if (ref) sessionStorage.setItem("jt_ref", ref)
    else ref = sessionStorage.getItem("jt_ref") || ""
  } catch {
    // privat modus
  }
  return ref
}

// Anonym besøkstelling: tilfeldig ID per dag i sessionStorage. Ingen informasjonskapsler.
export function trackVisit() {
  if (!API_URL || /^(localhost|127\.)/.test(location.hostname)) return
  let v = ""
  try {
    const d = new Date().toISOString().slice(0, 10)
    let s = JSON.parse(sessionStorage.getItem("jt_v") || "{}")
    if (s.d !== d) {
      s = { d, v: Math.random().toString(36).slice(2, 10) }
      sessionStorage.setItem("jt_v", JSON.stringify(s))
    }
    v = s.v
  } catch {
    // privat modus
  }
  apiGet({
    action: "hit",
    ref: kilde(),
    mobil: /Mobi|Android/i.test(navigator.userAgent) ? 1 : 0,
    v,
  }).catch(() => {})
}
