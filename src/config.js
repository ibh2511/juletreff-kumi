// Oppsett for juletreffet. Ingen hemmeligheter her: alt i denne fila havner i koden
// som sendes til nettleseren. Vipps-nøkler og adminpassord ligger bare i Apps Script.
// Verdiene settes ved bygging i en .env-fil (se .env.example).

// Adressen til Apps Script-backenden (backend/Code.gs), slutter på /exec
export const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://script.google.com/macros/s/AKfycby96iLN04Wscf4Y73WyVeLGcHGIQisuefsv-p7_cXogQ4Yo7IDFf8_WEDCYY2h_Mj8QTw/exec"

// Visningsverdier før backend har svart. Backend (Skriptegenskaper) bestemmer det som gjelder.
export const DEFAULTS = {
  pris: Number(import.meta.env.VITE_PRIS || 600),
  dato: import.meta.env.VITE_DATO_TEKST || "Fredag 18. desember kl. 18.30",
  fristTekst: import.meta.env.VITE_FRIST_TEKST || "onsdag 16. desember",
  // Vipps-nummeret vises bare til den som har meldt seg på. Det settes i adminsiden.
  vippsNummer: "",
  // Beholdes ved trekk med legeerklæring under 48 timer før start (KUMIs no-show-gebyr)
  noshow: 300,
}

// Kontakt for spørsmål, venteliste og legeerklæring (settes i .env)
export const KONTAKT_EPOST = import.meta.env.VITE_KONTAKT_EPOST || ""

// «#12345» for Vipps-nummer, «12 34 56 78» for mobilnummer
export const vippsTil = (nr) => {
  const d = String(nr || "").replace(/\D/g, "")
  return d.length === 8 ? d.replace(/(\d{2})(?=\d)/g, "$1 ") : `#${d}`
}

export const formatPrice = (nok) => `${Number(nok).toLocaleString("nb-NO")} kr`

// Telefonnummeret i skjemaet: 8 sifre. Mellomrom, bindestrek og +47 eller 0047 foran går fint.
// Gir de 8 sifrene, eller null når nummeret ikke kan være et norsk nummer.
export const telefonSifre = (verdi) => {
  const v = String(verdi || "").trim()
  if (/[^\d\s+().-]/.test(v)) return null
  let d = v.replace(/\D/g, "")
  if (d.length === 10 && d.startsWith("47")) d = d.slice(2)
  else if (d.length === 12 && d.startsWith("0047")) d = d.slice(4)
  return d.length === 8 ? d : null
}
