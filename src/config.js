// Oppsett for juletreffet. Ingen hemmeligheter her: alt i denne fila havner i koden
// som sendes til nettleseren. Vipps-nøkler og adminpassord ligger bare i Apps Script.
// Verdiene settes ved bygging i en .env-fil (se .env.example).

// Adressen til Apps Script-backenden (backend/Code.gs), slutter på /exec
export const API_URL =
  import.meta.env.VITE_API_URL ||
  "https://script.google.com/macros/s/AKfycby96iLN04Wscf4Y73WyVeLGcHGIQisuefsv-p7_cXogQ4Yo7IDFf8_WEDCYY2h_Mj8QTw/exec"

// Visningsverdier før backend har svart. Backend (Skriptegenskaper) bestemmer det som gjelder.
export const DEFAULTS = {
  pris: Number(import.meta.env.VITE_PRIS || 560),
  dato: import.meta.env.VITE_DATO_TEKST || "Fredag 18. desember kl. 19.00",
  fristTekst: import.meta.env.VITE_FRIST_TEKST || "tirsdag 15. desember",
  vippsNummer: import.meta.env.VITE_VIPPS_NUMBER || "76192",
}

// Kontakt for spørsmål, venteliste og legeerklæring (settes i .env)
export const KONTAKT_EPOST = import.meta.env.VITE_KONTAKT_EPOST || ""

export const formatPrice = (nok) => `${Number(nok).toLocaleString("nb-NO")} kr`

export const BINDENDE_KORT =
  "Påmeldingen er bindende og kan bare trekkes med legeerklæring."
