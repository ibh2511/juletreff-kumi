// «Legg i kalenderen» etter betalingen: samme hendelse i .ics-fila og i lenken til Google Kalender.
// vite.config.js lager /juletreff.ics fra denne fila når siden bygges, så her kan ikke import.meta.env brukes.
// Tidene må stemme med ARR_START og ARR_SLUTT i backend, som legger samme hendelse i bekreftelsen på e-post.

export const KVELDEN = {
  tittel: "Juletreff på KUMI",
  start: "2026-12-18T18:30:00+01:00",
  // Middagen på KUMI og MUNCH bar etterpå
  slutt: "2026-12-18T23:00:00+01:00",
  sted: "KUMI, Operagata 71B, Oslo",
  beskrivelse: "Vegansk julebord med seks retter, underholdning og MUNCH bar etterpå.",
  url: "https://ibh2511.github.io/juletreff-kumi/",
  // Samme UID her og i e-posten, så kalenderen kjenner igjen hendelsen i stedet for å lage en til
  uid: "juletreff-kumi-2026-12-18@ibh2511.github.io",
}

// 2026-12-18T18:30:00+01:00 → 20261218T173000Z
const utc = (tid) => new Date(tid).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")

// Tekst i .ics: \ ; , og linjeskift må skrives med \ foran (RFC 5545)
const tekst = (s) => String(s).replace(/[\\;,]/g, "\\$&").replace(/\r?\n/g, "\\n")

// Linjer over 75 byte brytes, og fortsettelsen starter med et mellomrom. Æ, ø og å er to byte og deles aldri.
const brett = (linje) => {
  let ut = ""
  let n = 0
  for (const tegn of linje) {
    const k = tegn.codePointAt(0)
    const b = k < 0x80 ? 1 : k < 0x800 ? 2 : k < 0x10000 ? 3 : 4
    if (n + b > 75) {
      ut += "\r\n "
      n = 1
    }
    ut += tegn
    n += b
  }
  return ut
}

export const lagIcs = (k = KVELDEN, laget = new Date()) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//juletreff-kumi//NO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${k.uid}`,
    `DTSTAMP:${utc(laget)}`,
    `DTSTART:${utc(k.start)}`,
    `DTEND:${utc(k.slutt)}`,
    `SUMMARY:${tekst(k.tittel)}`,
    `LOCATION:${tekst(k.sted)}`,
    `DESCRIPTION:${tekst(`${k.beskrivelse}\n\n${k.url}`)}`,
    `URL:${k.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(brett)
    .join("\r\n") + "\r\n"

export const googleKalender = (k = KVELDEN) =>
  "https://calendar.google.com/calendar/render?action=TEMPLATE" +
  `&text=${encodeURIComponent(k.tittel)}` +
  `&dates=${utc(k.start)}/${utc(k.slutt)}` +
  `&details=${encodeURIComponent(`${k.beskrivelse}\n\n${k.url}`)}` +
  `&location=${encodeURIComponent(k.sted)}` +
  "&ctz=Europe%2FOslo"
