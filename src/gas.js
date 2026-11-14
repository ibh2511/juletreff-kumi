// Google Apps Script-backend.
// Sett VITE_GAS_URL i .env til URL-en for det sammenslåtte scriptet (apps-script/Code.gs),
// så bruker både påmelding og besøksstatistikk samme utrulling.
// Uten VITE_GAS_URL brukes fjorårets to separate script.
const GAS_URL_OVERRIDE = import.meta.env.VITE_GAS_URL || ""

export const GAS_SIGNUP_URL =
  GAS_URL_OVERRIDE ||
  "https://script.google.com/macros/s/AKfycbyk7CuE9vw2mW1cUOux-0kmh0FZYYkM3CQwajDxgholpf3ZWRcb7zpLU8ANCWtNNNB3/exec"

export const GAS_VISITOR_URL =
  GAS_URL_OVERRIDE ||
  "https://script.google.com/macros/s/AKfycbywGzAlQxUVl9UiWvF1b2Ms0-lQNFnz1sui0X-w5JtN6VNacT19yj6KTxurZ-f1-z8c/exec"
