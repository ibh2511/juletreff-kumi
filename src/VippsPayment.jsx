import { useEffect, useMemo, useRef, useState } from "react"
import { apiPost } from "./api.js"
import { formatPrice } from "./config.js"
import { kopier, lenker, miljo, qrSvg, valg } from "./vipps.js"

// Betalingsboksen for den som har plass, men ikke har betalt ennå.
//  Vipps privat: kopier nummeret, «Åpne Vipps» med nummer, beløp og melding fylt ut, eller QR-kode på PC.
//  Vipps bedrift: «Betal med Vipps» sender deltakeren til Vipps og tilbake hit.
// Siden sjekker betalingen i bakgrunnen (se App.jsx), og bytter til «Du er påmeldt» når den er kommet.
// Har deltakeren åpnet Vipps (eller trykket «Jeg har betalt»), viser boksen at vi venter på betalingen,
// så ingen tror de må betale igjen mens banken bruker noen minutter.

const VENT_KEY = (id) => `jt_betalt_${id}`
function lesVent(id) {
  try {
    return Number(sessionStorage.getItem(VENT_KEY(id))) || 0
  } catch {
    return 0
  }
}
function lagreVent(id, t) {
  try {
    if (t) sessionStorage.setItem(VENT_KEY(id), String(t))
    else sessionStorage.removeItem(VENT_KEY(id))
  } catch {
    // privat modus: gjelder til siden lastes på nytt
  }
}
export default function VippsPayment({ info, id, k, venter, lead }) {
  const m = useMemo(() => miljo(), [])
  const [kopiert, setKopiert] = useState("")
  const [fraNavn, setFraNavn] = useState(info?.fraNavn || "")
  const [endrer, setEndrer] = useState(false)
  const [nyttNavn, setNyttNavn] = useState("")
  const [navnFeil, setNavnFeil] = useState("")
  const [sender, setSender] = useState(false)
  const [betalFeil, setBetalFeil] = useState("")
  // Når deltakeren trolig har betalt (åpnet Vipps eller trykket «Jeg har betalt»), som tidspunkt
  const [venterFra, setVenterFra] = useState(() => (id ? lesVent(id) : 0))
  const [naa, setNaa] = useState(() => Date.now())
  const forlot = useRef(false)

  const harBetalt = () => {
    const t = Date.now()
    setVenterFra(t)
    lagreVent(id, t)
  }
  const visBetalingen = () => {
    setVenterFra(0)
    lagreVent(id, 0)
  }

  // Kopierte nummeret og gikk til Vipps selv: når siden vises igjen, regner vi med at det er betalt.
  useEffect(() => {
    const synlig = () => {
      if (document.visibilityState === "hidden") return
      if (forlot.current) {
        forlot.current = false
        harBetalt()
      }
    }
    document.addEventListener("visibilitychange", synlig)
    return () => document.removeEventListener("visibilitychange", synlig)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Klokke for «det har gått en stund»-teksten
  useEffect(() => {
    if (!venterFra) return
    const t = setInterval(() => setNaa(Date.now()), 30000)
    return () => clearInterval(t)
  }, [venterFra])

  if (!info) {
    return (
      <div className="vipps-card">
        <p className="vipps-lead">Du får betalingsinformasjon for Vipps på e-post.</p>
      </div>
    )
  }

  const kr = formatPrice(info.belop)

  if (info.losning === "bedrift") {
    const betal = async () => {
      setSender(true)
      setBetalFeil("")
      try {
        const d = await apiPost({ action: "betal", id, k })
        if (d.status === "BETALT") return window.location.reload()
        if (!d.ok || !d.redirectUrl) throw new Error(d.error || "Noe gikk galt")
        window.location.href = d.redirectUrl
      } catch (err) {
        setBetalFeil(err.message)
        setSender(false)
      }
    }
    return (
      <div className="vipps-card">
        <h3>Betal {kr} med Vipps</h3>
        <p className="vipps-lead">{lead || "Plassen din er sikret når betalingen er mottatt."}</p>
        <button type="button" className="vipps-btn" onClick={betal} disabled={sender}>
          {sender ? "Sender deg til Vipps …" : `Betal ${kr} med Vipps`}
        </button>
        {betalFeil && <p className="vipps-feil">{betalFeil}</p>}
        <p className="vipps-ref">Påmeldings-ID: {info.id}</p>
      </div>
    )
  }

  const nr = info.nr || ""
  const l = info.lenke ? lenker(info.lenke) : null
  const v = valg(m)

  const kopierTekst = (tekst, hva) => {
    if (hva === "nr") forlot.current = true // går trolig til Vipps nå
    return kopier(tekst)
      .then(() => {
        setKopiert(hva)
        setTimeout(() => setKopiert(""), 2500)
      })
      .catch(() => setKopiert(`feil-${hva}`))
  }

  const kopiKnapp = (tekst, hva) => (
    <button
      type="button"
      className={`vipps-kopier ${kopiert === hva ? "ok" : ""}`}
      onClick={() => kopierTekst(tekst, hva)}
    >
      {kopiert === hva
        ? "Kopiert!"
        : kopiert === `feil-${hva}`
          ? "Hold inne for å kopiere"
          : "Kopier"}
    </button>
  )

  const lagreNavn = async (e) => {
    e.preventDefault()
    setNavnFeil("")
    try {
      const d = await apiPost({ action: "navn", id, k, navn: nyttNavn })
      if (!d.ok) throw new Error(d.error || "Noe gikk galt")
      setFraNavn(d.navn)
      setEndrer(false)
    } catch (err) {
      setNavnFeil(err.message === "Failed to fetch" ? "Fikk ikke lagret navnet. Prøv igjen." : err.message)
    }
  }

  const navnSkjema = (
    <form className="vipps-nytt-navn" onSubmit={lagreNavn}>
      <input
        value={nyttNavn}
        onChange={(e) => setNyttNavn(e.target.value)}
        placeholder="Fullt navn på Vipps-kontoen"
        aria-label="Fullt navn på Vipps-kontoen"
        maxLength={80}
        autoComplete="off"
        required
      />
      <button type="submit">Lagre</button>
    </form>
  )

  const naar = info.automatisk
    ? "Siden oppdaterer seg selv når betalingen er kommet, vanligvis i løpet av kort tid."
    : "Du får bekreftelse på e-post når betalingen er registrert."

  const nummerRad = (
    <div className="vipps-nummer-rad">
      <span className="vipps-tlf">{info.mottaker}</span>
      {kopiKnapp(nr, "nr")}
    </div>
  )

  const meldingRad = (
    <div className="vipps-nummer-rad">
      <b className="vipps-melding">«{info.melding}»</b>
      {kopiKnapp(info.melding, "melding")}
    </div>
  )

  let trinn
  if (m.mobil && l) {
    trinn = (
      <ol className="vipps-trinn">
        <li>
          <span className="nr">1</span>
          <div>
            <b>Kopier mobilnummeret</b>
            {nummerRad}
          </div>
        </li>
        <li>
          <span className="nr">2</span>
          <div>
            <b>Åpne Vipps</b>
            <a className="vipps-btn" href={l[v.hoved]} onClick={() => (forlot.current = true)}>
              Åpne Vipps
            </a>
            <a className="vipps-reserve" href={l[v.reserve]} onClick={() => (forlot.current = true)}>
              Åpnet ikke Vipps? Prøv denne lenken
            </a>
            <small>
              Virker ingen av dem, åpner du Vipps-appen selv og limer inn
              nummeret.
            </small>
          </div>
        </li>
        <li>
          <span className="nr">3</span>
          <div>
            <b>Skriv inn {kr} og betal</b>
            <small>
              Nummeret er fylt ut, men beløpet skriver du selv. Mangler
              nummeret, limer du det inn fra steg 1.
            </small>
          </div>
        </li>
        <li>
          <span className="nr">4</span>
          <div>
            <b>Kom tilbake hit</b>
            <small>{naar}</small>
          </div>
        </li>
      </ol>
    )
  } else if (l) {
    trinn = (
      <>
        <div className="vipps-qr">
          <div
            className="vipps-qr-kode"
            dangerouslySetInnerHTML={{ __html: qrSvg(info.lenke) }}
          />
          <div>
            <b>Skann QR-koden med kameraet på mobilen</b>
            <small>
              Da åpnes Vipps med nummeret fylt ut. Skriv inn {kr} og betal, så
              oppdateres denne siden.
            </small>
          </div>
        </div>
        <ol className="vipps-trinn">
          <li className="enkel">
            <div>
              <b>Eller betal selv i Vipps på mobilen</b>
              {nummerRad}
              <div className="vipps-belop">{kr}</div>
              <small>{naar}</small>
            </div>
          </li>
        </ol>
      </>
    )
  } else {
    // Vipps-nummer (5–6 sifre): ingen lenke som fyller ut, så deltakeren søker det opp selv.
    trinn = (
      <ol className="vipps-trinn">
        <li>
          <span className="nr">1</span>
          <div>
            <b>Åpne Vipps og velg «Betal»</b>
          </div>
        </li>
        <li>
          <span className="nr">2</span>
          <div>
            <b>Søk opp Vipps-nummeret</b>
            {nummerRad}
            {info.vippsNavn && <small>{info.vippsNavn}</small>}
          </div>
        </li>
        <li>
          <span className="nr">3</span>
          <div>
            <b>Skriv inn {kr} og betal</b>
            <small>Skriv gjerne dette i meldingen:</small>
            {meldingRad}
          </div>
        </li>
        <li>
          <span className="nr">4</span>
          <div>
            <b>Kom tilbake hit</b>
            <small>{naar}</small>
          </div>
        </li>
      </ol>
    )
  }

  if (!nr) {
    return (
      <div className="vipps-card">
        <p className="vipps-lead">Du får betalingsinformasjon for Vipps på e-post.</p>
        <p className="vipps-ref">Påmeldings-ID: {info.id}</p>
      </div>
    )
  }

  if (venterFra) {
    const lenge = naa - venterFra > 20 * 60000
    return (
      <div className="vipps-card vipps-sjekker" role="status">
        <div className="vipps-sjekker-ikon" aria-hidden="true">
          <span className="prikk" />
        </div>
        <h3>Vi ser etter betalingen din</h3>
        <p className="vipps-lead">
          Har du betalt {kr}, er du ferdig og trenger ikke betale igjen.{" "}
          {info.automatisk
            ? "Siden oppdaterer seg selv når betalingen er registrert, som regel innen noen minutter. Du får også bekreftelse på e-post."
            : "Du får bekreftelse på e-post når betalingen er registrert."}
        </p>
        {info.automatisk && venter && <div className="vipps-venter">{venter}</div>}
        {lenge && (
          <p className="vipps-fra">
            Har det gått mer enn 20 minutter? Betalte du fra en annens Vipps, kan du skrive
            navnet under. Ellers svarer du på e-posten fra oss, så ser vi på det.
          </p>
        )}
        <p className="vipps-fra">
          Vi ser etter betaling fra Vipps-kontoen til <b>{fraNavn}</b>.{" "}
          <button type="button" className="link-btn" onClick={() => setEndrer(!endrer)}>
            Betalte du fra en annens Vipps?
          </button>
        </p>
        {endrer && navnSkjema}
        {navnFeil && <p className="vipps-feil">{navnFeil}</p>}
        <p className="vipps-fra">
          <button type="button" className="link-btn" onClick={visBetalingen}>
            Har du ikke betalt ennå? Vis betalingen
          </button>
        </p>
        <p className="vipps-ref">Påmeldings-ID: {info.id}</p>
      </div>
    )
  }

  return (
    <div className="vipps-card">
      <h3>Betal {kr} med Vipps</h3>
      <p className="vipps-lead">
        {lead || "Plassen din er sikret når betalingen er mottatt."}
        {info.vippsNavn && l && <> Mottaker: {info.vippsNavn}.</>}
      </p>
      {trinn}
      <p className="vipps-fra">
        Betal fra Vipps-kontoen til <b>{fraNavn}</b>, så finner vi betalingen
        din.{" "}
        <button type="button" className="link-btn" onClick={() => setEndrer(!endrer)}>
          Betaler du fra en annens Vipps?
        </button>
      </p>
      {endrer && navnSkjema}
      {navnFeil && <p className="vipps-feil">{navnFeil}</p>}
      <button type="button" className="vipps-har-betalt" onClick={harBetalt}>
        Jeg har betalt
      </button>
      <p className="vipps-ref">Påmeldings-ID: {info.id}</p>
    </div>
  )
}
