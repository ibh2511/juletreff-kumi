import { useEffect, useMemo, useRef, useState } from "react"
import { apiPost } from "./api.js"
import { formatPrice } from "./config.js"
import { kopier, lenker, miljo, qrSvg, valg } from "./vipps.js"

// Betalingsboksen for den som har plass, men ikke har betalt ennå.
//  Vipps privat: kopier nummeret, «Åpne Vipps» med nummeret fylt ut, eller QR-kode på PC.
//  Vipps bedrift: «Betal med Vipps» sender deltakeren til Vipps og tilbake hit.
// Siden sjekker betalingen i bakgrunnen (se App.jsx), og bytter til «Du er påmeldt» når den er kommet.
//
// Siden kan ikke vite at noen har betalt før banken viser betalingen. Fram til da er det én tilstand,
// «ikke registrert ennå», og den vises på to måter:
//  - Betalingsstegene, som er det man trenger før man har betalt.
//  - «Vi ser etter betalingen din», når deltakeren kommer tilbake til siden etter å ha åpnet Vipps eller
//    kopiert nummeret. Da har de mest sannsynlig betalt, og stegene med «Åpne Vipps» øverst kunne fått dem
//    til å betale igjen. Teksten sier «Har du betalt …», så den stemmer også for den som ikke betalte,
//    og stegene er ett trykk unna.
// Stegene er bare for å betale. At siden følger med og oppdaterer seg selv, står i det siste steget (og i QR-teksten
// på PC), og nederst i betalingsboksen står en liten «Venter på betalingen» med en rolig puls, en mindre
// utgave av radaren i venteboksen. Etter 5 minutter står det «Venter fortsatt på betalingen».

// Så lenge betalingsstegene kan stå på skjermen før den lille linjen nederst sier «Venter fortsatt på betalingen»
const FORTSATT = 5 * 60000

const VENT_KEY = (id) => `jt_betalt_${id}`
// null: ikke lagret i denne nettleseren. 0: deltakeren valgte å vise betalingen igjen.
function lesVent(id) {
  try {
    const v = sessionStorage.getItem(VENT_KEY(id))
    return v == null ? null : Number(v) || 0
  } catch {
    return null
  }
}
function lagreVent(id, t) {
  try {
    sessionStorage.setItem(VENT_KEY(id), String(t || 0))
  } catch {
    // privat modus: gjelder til siden lastes på nytt
  }
}
export default function VippsPayment({ info, id, k, lead, notis, onBytt, onVenter }) {
  const m = useMemo(() => miljo(), [])
  const [kopiert, setKopiert] = useState("")
  const [fraNavn, setFraNavn] = useState(info?.fraNavn || "")
  const [endrer, setEndrer] = useState(false)
  const [nyttNavn, setNyttNavn] = useState("")
  const [navnFeil, setNavnFeil] = useState("")
  const [sender, setSender] = useState(false)
  const [betalFeil, setBetalFeil] = useState("")
  // Når deltakeren kom tilbake fra Vipps (tidspunkt), eller 0 mens betalingsstegene vises. Backend husker når
  // de trykket «Åpne Vipps» (vippsApnet), så kvitteringen vises også fra e-postlenken eller en annen telefon.
  const [venterFra, setVenterFra] = useState(() => (id ? (lesVent(id) ?? (Number(info?.vippsApnet) || 0)) : 0))
  const [avbrot, setAvbrot] = useState(false)
  const [naa, setNaa] = useState(() => Date.now())
  // Når betalingsstegene ble vist (ved start, eller etter «Vis betalingen»)
  const [stegFra, setStegFra] = useState(() => Date.now())
  const forlot = useRef(false)
  const meldt = useRef(false)
  // Sier fra til backend én gang: de har trolig betalt, så e-posten med betalingsinfo venter lenger (VIPPS_VENT_MIN)
  const meldVipps = () => {
    if (meldt.current || !id || !k) return
    meldt.current = true
    apiPost({ action: "vipps", id, k }, { keepalive: true }).catch(() => {})
  }

  const visVenting = () => {
    const t = Date.now()
    setVenterFra(t)
    lagreVent(id, t)
  }
  const visBetalingen = () => {
    setAvbrot(false)
    setVenterFra(0)
    lagreVent(id, 0)
    setStegFra(Date.now())
  }

  // Når stegene og venteboksen bytter plass, ber vi siden rulle det nye opp i skjermen (på mobil)
  const varVenting = useRef(!!venterFra)
  useEffect(() => onVenter?.(!!venterFra), [venterFra, onVenter])
  useEffect(() => {
    if (varVenting.current === !!venterFra) return
    varVenting.current = !!venterFra
    onBytt?.()
  }, [venterFra, onBytt])

  // Trykket «Åpne Vipps» eller kopierte nummeret og forlot siden: når den vises igjen, viser vi ventingen.
  useEffect(() => {
    const synlig = () => {
      if (document.visibilityState === "hidden") return
      if (forlot.current) {
        forlot.current = false
        visVenting()
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

  // Med betalingsstegene på skjermen: én oppdatering når det har gått 5 minutter, så linjen nederst kan bytte tekst
  useEffect(() => {
    if (venterFra) return
    const t = setTimeout(() => setNaa(Date.now()), Math.max(0, stegFra + FORTSATT - Date.now()) + 100)
    return () => clearTimeout(t)
  }, [venterFra, stegFra])

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
        <p className="vipps-ref vipps-ref-topp">Påmeldings-ID: {info.id}</p>
        <h3>Betal {kr} med Vipps</h3>
        <p className="vipps-lead">{lead || "Plassen din er sikret når betalingen er mottatt."}</p>
        <button type="button" className="vipps-btn" onClick={betal} disabled={sender}>
          {sender ? "Sender deg til Vipps …" : `Betal ${kr} med Vipps`}
        </button>
        {betalFeil && <p className="vipps-feil">{betalFeil}</p>}
      </div>
    )
  }

  const nr = info.nr || ""
  const l = info.lenke ? lenker(info.lenke) : null
  const v = valg(m)

  const kopierTekst = (tekst, hva) => {
    forlot.current = true // nummeret eller meldingen skal limes inn i Vipps, så de går trolig dit nå
    meldVipps()
    return kopier(tekst)
      .then(() => {
        setKopiert(hva)
        setTimeout(() => setKopiert(""), 2500)
      })
      .catch(() => setKopiert(`feil-${hva}`))
  }

  // «Åpne Vipps» kopierer beløpet: nummeret fylles ut av lenken, men beløpet må de skrive selv, så da kan
  // de lime det inn i Vipps. Går kopieringen ikke, sier vi ingenting: beløpet står i steg 2.
  const apneVipps = () => {
    forlot.current = true
    meldVipps()
    kopier(String(Math.round(Number(info.belop) || 0))).catch(() => {})
  }

  // PC: vi ser ikke når QR-koden skannes, så deltakeren sier selv fra. Samme signal som «Åpne Vipps» på mobil.
  const harBetalt = () => {
    meldVipps()
    visVenting()
  }

  // «Kopier» og «Kopiert!» ligger oppå hverandre, og bare den ene vises. Da er knappen like bred før og
  // etter trykket, og den hopper ikke ned under nummeret når teksten blir lengre.
  const kopiKnapp = (tekst, hva) => (
    <button
      type="button"
      className={`vipps-kopier ${kopiert === hva ? "ok" : ""}`}
      onClick={() => kopierTekst(tekst, hva)}
    >
      {kopiert === `feil-${hva}` ? (
        "Hold inne for å kopiere"
      ) : (
        <span className="vipps-kopier-tekst">
          <span>Kopier</span>
          <span>Kopiert!</span>
        </span>
      )}
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
    ? "Siden oppdaterer seg selv når betalingen er kommet."
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
        <li className="knapp">
          <span className="nr">1</span>
          <div>
            <a className="vipps-btn" href={l[v.hoved]} onClick={apneVipps}>
              Åpne Vipps
            </a>
            <p className="vipps-under-knapp">
              <a className="vipps-reserve" href={l[v.reserve]} onClick={apneVipps}>
                Åpnet ikke Vipps?
              </a>
            </p>
          </div>
        </li>
        <li className="nummer">
          <span className="nr">2</span>
          <div>
            <b>Skriv inn {kr} og betal</b>
            <small>
              Nummeret er fylt ut, og beløpet er kopiert. Mangler nummeret?
            </small>
            {nummerRad}
          </div>
        </li>
        <li>
          <span className="nr">3</span>
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
            <b>Skann QR-koden med mobilen</b>
            <small>
              Vipps åpnes med nummeret fylt ut. Skriv inn {kr} og betal
              {info.automatisk
                ? ", så oppdateres siden."
                : ". Du får bekreftelse på e-post når betalingen er registrert."}
            </small>
          </div>
        </div>
        <ol className="vipps-trinn">
          <li className="enkel">
            <div>
              <b>Eller betal selv i Vipps</b>
              <dl className="vipps-fakta">
                <div>
                  <dt>Mobilnummer</dt>
                  <dd>
                    <span className="vipps-tlf">{info.mottaker}</span>
                    {kopiKnapp(nr, "nr")}
                  </dd>
                </div>
                <div>
                  <dt>Beløp</dt>
                  <dd>{kr}</dd>
                </div>
              </dl>
            </div>
          </li>
        </ol>
        <button type="button" className="vipps-endre vipps-har-betalt" onClick={harBetalt}>
          Jeg har betalt
        </button>
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
    // Samme tid som backend venter før den rolige e-posten (VIPPS_VENT_MIN i Code.gs)
    const lenge = naa - venterFra > 90 * 60000
    return (
      <div className="vipps-card vipps-sjekker">
        <p className="vipps-ref vipps-ref-topp">Påmeldings-ID: {info.id}</p>
        <div className="vipps-radar" aria-hidden="true">
          <span />
        </div>
        <h3 role="status">Takk! Nå venter vi på banken</h3>
        <p className="vipps-lead">
          <span className="setning">Plassen din er holdt av.</span>{" "}
          <span className="setning">Ikke betal på nytt.</span>
        </p>
        <p className="vipps-bekreftes">Vanligvis noen minutter, lengre ved mye trafikk i Vipps.</p>
        <dl className="vipps-fakta vipps-sjekker-kort">
          <div>
            <dt>Beløp</dt>
            <dd>{kr}</dd>
          </div>
          <div>
            <dt>Til</dt>
            <dd>{info.mottaker}</dd>
          </div>
          <div>
            <dt>Fra</dt>
            <dd>
              <span className="vipps-fra-navn">{fraNavn}</span>
              <button
                type="button"
                className="vipps-endre"
                aria-expanded={endrer}
                onClick={() => setEndrer(!endrer)}
              >
                Endre
              </button>
            </dd>
          </div>
        </dl>
        {endrer && navnSkjema}
        {navnFeil && <p className="vipps-feil">{navnFeil}</p>}
        <p className="vipps-sjekker-tekst">
          Du kan lukke siden. Du får <span className="nowrap">e-post</span> når betalingen er bekreftet.
        </p>
        {lenge && (
          <div className="vipps-hjelp">
            <b>Tar det lang tid?</b>
            Sjekk i Vipps at du betalte {kr} til <span className="nowrap">{info.mottaker}</span>. Brukte du
            en annens Vipps, trykk «Endre». Ellers kan du svare på <span className="nowrap">e-posten</span> fra oss.
          </div>
        )}
        {/* Ingen knapp tilbake til betalingen her: den fikk noen til å betale to ganger mens banken ennå ikke
            hadde vist den første. Den som avbrøt i Vipps, kommer dit via en sjekk. */}
        <p className="vipps-tilbake-rad">
          <button type="button" className="vipps-tilbake" aria-expanded={avbrot} onClick={() => setAvbrot(!avbrot)}>
            Avbrøt du i Vipps?
          </button>
        </p>
        {avbrot && (
          <div className="vipps-hjelp vipps-avbrot">
            Sjekk under <b className="inline">Aktivitet</b> i Vipps at betalingen ikke gikk gjennom, så du ikke
            betaler to ganger.
            <button type="button" className="vipps-endre" onClick={visBetalingen}>
              Vis betalingen
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="vipps-card">
        <p className="vipps-ref vipps-ref-topp">Påmeldings-ID: {info.id}</p>
        <h3>Betal {kr} med Vipps</h3>
        <p className="vipps-lead">
          {lead || "Plassen din er reservert."} Betal fra <span className="nowrap">Vipps-kontoen</span> til{" "}
          <b className="vipps-fra-lead">{fraNavn}</b>, så finner vi betalingen.
        </p>
        {info.vippsNavn && l && <p className="vipps-mottaker">Mottaker: {info.vippsNavn}</p>}
        {trinn}
        <button
          type="button"
          className="vipps-annen"
          aria-expanded={endrer}
          onClick={() => setEndrer(!endrer)}
        >
          Betaler du fra en annens Vipps?
        </button>
        {endrer && navnSkjema}
        {navnFeil && <p className="vipps-feil">{navnFeil}</p>}
        <p className="vipps-venter" role="status">
          <span className="vipps-venter-prikk" aria-hidden="true" />
          {naa - stegFra >= FORTSATT ? "Venter fortsatt på betalingen" : "Venter på betalingen"}
        </p>
      </div>
      {notis && <p className="epost-notis">{notis}</p>}
    </>
  )
}
