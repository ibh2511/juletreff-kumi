// Betalingsoppsett for juletreffet.
// Ingen hemmeligheter her: Vipps-nummer og betalingslenke er offentlig info.
// Verdiene kan også settes ved bygging i en .env-fil (se .env.example).

export const PRICE_NOK = 570

// Vipps-nummeret deltakerne skal betale til (f.eks. "123456").
export const VIPPS_NUMBER = import.meta.env.VITE_VIPPS_NUMBER || ""

// Valgfritt: lenke som åpner Vipps direkte (betalingslenke eller qr.vipps.no-lenke).
export const VIPPS_PAYMENT_URL = import.meta.env.VITE_VIPPS_PAYMENT_URL || ""

// Valgfritt: QR-kode fra Vipps-portalen, lagt i public/images/.
export const VIPPS_QR_IMAGE = import.meta.env.VITE_VIPPS_QR_IMAGE || ""

export const formatPrice = (nok) => `${nok.toLocaleString("nb-NO")} kr`
