import { useCallback, useEffect, useMemo, useState } from "react"
import { apiPost } from "./api.js"
import { formatPrice } from "./config.js"
import AdminBetaling from "./AdminBetaling.jsx"
import { kopier } from "./vipps.js"
import "./AdminStats.css"

const vippsErMobil = (nr) => String(nr || "").replace(/\D/g, "").length === 8

const STATUS = {
  BETALT: { tekst: "Betalt", klasse: "ok" },
  UBETALT: { tekst: "Ikke betalt", klasse: "warn" },
  VENTER: { tekst: "I Vipps nå", klasse: "info" },
  VENTELISTE: { tekst: "Venteliste", klasse: "info" },
  TRUKKET: { tekst: "Trukket", klasse: "muted" },
  AVBRUTT: { tekst: "Avbrutt", klasse: "muted" },
}

const FILTRE = [
  { id: "aktive", tekst: "Påmeldt", match: ["BETALT", "UBETALT", "VENTER"] },
  { id: "ubetalt", tekst: "Ikke betalt", match: ["UBETALT"] },
  { id: "venteliste", tekst: "Venteliste", match: ["VENTELISTE"] },
  { id: "trukket", tekst: "Trukket", match: ["TRUKKET"] },
  { id: "avbrutt", tekst: "Avbrutt", match: ["AVBRUTT"] },
  { id: "alle", tekst: "Alle", match: null },
  { id: "test", tekst: "Test", match: null, test: true },
]

const dato = (v) =>
  v
    ? new Date(v).toLocaleString("nb-NO", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : ""

function lastNedCsv(rader) {
  const kol = ["id", "navn", "telefon", "epost", "status", "belop", "kommentar"]
  // Tekst som starter med = + - @ tolkes som formel i Excel og Sheets, så den får en apostrof foran
  const esc = (v) => {
    const t = String(v ?? "")
    return `"${(/^[=+\-@\t\r]/.test(t) ? "'" + t : t).replace(/"/g, '""')}"`
  }
  const csv = [kol.join(";")]
    .concat(rader.map((r) => kol.map((k) => esc(r[k])).join(";")))
    .join("\n")
  const url = URL.createObjectURL(
    new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
  )
  const a = document.createElement("a")
  a.href = url
  a.download = "juletreff-deltakere.csv"
  a.click()
  URL.revokeObjectURL(url)
}

export default function AdminStats({ okt, onLogout }) {
  const [data, setData] = useState(null)
  const [feil, setFeil] = useState("")
  const [filter, setFilter] = useState("aktive")
  const [sok, setSok] = useState("")
  const [aapen, setAapen] = useState(null) // { id, handling }
  const [notat, setNotat] = useState("")
  const [ny, setNy] = useState({ fornavn: "", etternavn: "", epost: "", telefon: "" })
  const [refunder, setRefunder] = useState(true)
  const [sent, setSent] = useState(false) // trukket under 48 timer før start
  const [jobber, setJobber] = useState(false)
  const [melding, setMelding] = useState(null) // { tekst, sted, feil }
  const [plasser, setPlasser] = useState("")
  const [fb, setFb] = useState(null) // null = ikke endret
  const [test, setTest] = useState({ fornavn: "Test", etternavn: "Testesen", epost: "" })
  const [testType, setTestType] = useState("pamelding")
  const [lenkeKopiert, setLenkeKopiert] = useState(false)
  const [svar, setSvar] = useState(null)
  const [vipps, setVipps] = useState(null) // { nummer, navn } når noe er endret
  const [tlf, setTlf] = useState(null)
  const [program, setProgram] = useState(null)
  const [takk, setTakk] = useState(null)
  const [medUbetalte, setMedUbetalte] = useState(false)
  const [bekreftProgram, setBekreftProgram] = useState(false)
  const [bekreftTakk, setBekreftTakk] = useState(false)
  const [slett, setSlett] = useState(null) // null = lukket, ellers teksten som er skrevet
  const [varsle, setVarsle] = useState(true) // send e-post til deltakeren ved trekk og refusjon
  const [innsjekk, setInnsjekk] = useState(false)
  const [innsjekkSok, setInnsjekkSok] = useState("")
  const [testLenke, setTestLenke] = useState("")
  const [bekreftVarsel, setBekreftVarsel] = useState(false)
  const [bekreftPurring, setBekreftPurring] = useState(false)
  const [nullstill, setNullstill] = useState(null) // null = lukket, ellers teksten som er skrevet

  const last = useCallback(async () => {
    try {
      const d = await apiPost({ action: "oversikt", okt })
      if (d.utlogget) return onLogout()
      if (!d.ok) throw new Error(d.error)
      setData(d)
      setFeil("")
    } catch (err) {
      setFeil(err.message || "Fikk ikke hentet data")
    }
  }, [okt, onLogout])

  useEffect(() => {
    last()
    const t = setInterval(last, 30000)
    return () => clearInterval(t)
  }, [last])

  const deltakere = useMemo(() => {
    if (!data) return []
    const f = FILTRE.find((x) => x.id === filter)
    const q = sok.trim().toLowerCase()
    return data.deltakere.filter(
      (r) =>
        (f.test ? r.test : !r.test) &&
        (!f.match || f.match.includes(r.status)) &&
        (!q ||
          [r.navn, r.epost, r.telefon, r.id]
            .join(" ")
            .toLowerCase()
            .includes(q))
    )
  }, [data, filter, sok])

  const apne = (id, handling) => {
    setAapen({ id, handling })
    setNotat("")
    setNy({ fornavn: "", etternavn: "", epost: "", telefon: "" })
    setRefunder(true)
    setVarsle(true)
    // Standard: under 48 timer hvis det er mindre enn 48 timer igjen nå
    const start = data?.arrangement?.start
    setSent(!!start && Date.now() > new Date(start).getTime() - 48 * 36e5)
    setMelding(null)
  }

  const utfor = async (r) => {
    setJobber(true)
    try {
      const d = await apiPost({
        action: "endre",
        okt,
        id: r.id,
        handling: aapen.handling,
        notat,
        refunder,
        sent,
        varsle,
        ...(aapen.handling === "overdra" ? ny : {}),
      })
      if (d.utlogget) return onLogout()
      if (!d.ok) throw new Error(d.error)
      setMelding({ tekst: d.melding || "Lagret.", sted: "liste" })
      setAapen(null)
      await last()
    } catch (err) {
      setMelding({ tekst: err.message, sted: "liste", feil: true })
    }
    setJobber(false)
  }

  // Innstillinger og testpåmelding lagres i backend og gjelder for hele løsningen
  const send = async (body, sted, etter) => {
    setJobber(true)
    setMelding(null)
    try {
      const d = await apiPost({ ...body, okt })
      if (d.utlogget) return onLogout()
      if (!d.ok) throw new Error(d.error)
      if (!d.melding)
        throw new Error(
          "Backend kjenner ikke denne funksjonen ennå. Lim inn den nye Code.gs og lag en ny versjon."
        )
      setMelding({ tekst: d.melding, sted })
      etter?.(d)
      await last()
    } catch (err) {
      setMelding({ tekst: err.message, sted, feil: true })
    }
    setJobber(false)
  }

  // Innsjekk på kvelden: ett trykk, og meldingen vises i innsjekk-boksen
  const sjekkInn = async (r, mott) => {
    setJobber(true)
    try {
      const d = await apiPost({ action: "endre", okt, id: r.id, handling: mott ? "mott" : "ikkemott" })
      if (d.utlogget) return onLogout()
      if (!d.ok) throw new Error(d.error)
      setMelding({ tekst: d.melding, sted: "innsjekk", feil: /OBS/.test(d.melding) })
      if (mott) setInnsjekkSok("")
      await last()
    } catch (err) {
      setMelding({ tekst: err.message, sted: "innsjekk", feil: true })
    }
    setJobber(false)
  }

  // Meldingen vises ved funksjonen som ga den
  const vis = (sted) =>
    melding?.sted === sted && (
      <div className={`admin-note lokal ${melding.feil ? "feil" : "ok"}`} role="status">
        {melding.feil ? "⚠️ " : "✓ "}
        {melding.tekst}
      </div>
    )

  if (!data) {
    return (
      <div className="admin-container">
        <div className="admin-loading">
          {feil ? `⚠️ ${feil}` : "Laster påmeldinger …"}
        </div>
      </div>
    )
  }

  const a = data.antall
  const noshow = data.arrangement.noshow ?? 300
  const arr = data.arrangement
  const bank = data.bank || {}
  const opptatt = a.BETALT + a.UBETALT
  // Samme regel som backend: nullstilling er låst når en ekte påmelding har registrert betaling
  const medBetaling = data.deltakere.filter(
    (r) => !r.test && (r.status === "BETALT" || r.betalt)
  ).length

  const maksPurringer = arr.maksPurringer || 3
  const startet = Date.now() > new Date(arr.start).getTime()
  const ekte = data.deltakere.filter((r) => !r.test)
  const utenProgram = ekte.filter((r) => r.status === "BETALT" && !r.program).length
  const ubetalteUtenProgram = ekte.filter((r) => r.status === "UBETALT" && !r.program).length
  const paameldte = ekte.filter((r) => ["BETALT", "UBETALT"].includes(r.status))
  const mott = paameldte.filter((r) => r.mott).length
  const siffer = (v) => String(v || "").replace(/\D/g, "")
  const iq = innsjekkSok.trim().toLowerCase()
  const innsjekkListe = paameldte
    .filter(
      (r) =>
        !iq ||
        [r.navn, r.epost, r.id].join(" ").toLowerCase().includes(iq) ||
        (siffer(iq).length >= 3 && siffer(r.telefon).includes(siffer(iq)))
    )
    .sort((x, y) => !!x.mott - !!y.mott || x.navn.localeCompare(y.navn, "nb"))

  const handlingTekst = {
    betalt: "Marker som betalt",
    purring: "Send purring",
    frigi: "Frigi plassen (ikke betalt)",
    bekreftelse: "Send bekreftelsen på nytt",
    overdra: "Gi plassen til en annen",
    tilbud: "Gi plass fra ventelisten",
    refundert: "Marker som refundert",
    trekk: "Trekk påmeldingen",
    slett: "Slett testen",
  }
  // Fargekoder: grønn = betaling inn, blå = plass, gul = penger ut, rød = fjerner påmeldingen
  const handlingIkon = {
    betalt: "🟢",
    purring: "🟠",
    frigi: "🔴",
    bekreftelse: "✉️",
    overdra: "🔵",
    tilbud: "🔵",
    refundert: "🟡",
    trekk: "🔴",
    slett: "⚫",
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>🎄 Juletreff KUMI · admin</h1>
          <div className="admin-sub">
            {arr.dato} · {formatPrice(arr.pris)} · frist {arr.fristTekst}
          </div>
        </div>
        <div className="header-actions">
          <button className="back-btn" onClick={last}>
            ↻ Oppdater
          </button>
          <a className="back-btn" href="#">
            Til siden
          </a>
          <button className="logout-btn" onClick={onLogout}>
            Logg ut
          </button>
        </div>
      </div>

      {feil && <div className="admin-note feil">⚠️ {feil}</div>}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-number">
            {opptatt}
            <small> / {arr.kapasitet}</small>
          </div>
          <div className="stat-label">Plasser tatt</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{a.BETALT}</div>
          <div className="stat-label">Betalt</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{a.UBETALT}</div>
          <div className="stat-label">Ikke betalt</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{data.ledige}</div>
          <div className="stat-label">Ledige plasser</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{a.VENTELISTE}</div>
          <div className="stat-label">Venteliste</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{a.TRUKKET}</div>
          <div className="stat-label">Trukket</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">
            {formatPrice(data.innbetalt - data.refundert)}
          </div>
          <div className="stat-label">
            Innbetalt
            {data.refundert > 0 &&
              ` (etter ${formatPrice(data.refundert)} refundert)`}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{data.besok.unike}</div>
          <div className="stat-label">Unike besøk ({data.besok.totalt} totalt)</div>
        </div>
      </div>

      <section className="panel">
        <h2>Innstillinger</h2>
        <div className="innstillinger">
          <div className="innstilling">
            <div className="innstilling-tittel">Antall plasser</div>
            <div className="innstilling-rad">
              <input
                type="number"
                min="1"
                max="500"
                inputMode="numeric"
                value={plasser === "" ? arr.kapasitet : plasser}
                onChange={(e) => setPlasser(e.target.value)}
              />
              <button
                className="mini ok"
                disabled={
                  jobber || plasser === "" || Number(plasser) === arr.kapasitet
                }
                onClick={() =>
                  send({ action: "innstillinger", kapasitet: Number(plasser) }, "plasser", () =>
                    setPlasser("")
                  )
                }
              >
                Lagre
              </button>
            </div>
            <div className="liten">
              {opptatt} har plass nå. Siden, skjemaet og ventelisten følger
              tallet med en gang.
            </div>
            {vis("plasser")}
          </div>

          <div className="innstilling betaling-innstilling">
            <div className="innstilling-tittel">Betalingsløsning</div>
            <div className="valgkort-rad" role="radiogroup" aria-label="Betalingsløsning">
              <label className={`valgkort ${arr.betaling === "privat" ? "valgt" : ""}`}>
                <input
                  type="radio"
                  name="betaling"
                  checked={arr.betaling === "privat"}
                  disabled={jobber}
                  onChange={() => send({ action: "innstillinger", betaling: "privat" }, "vipps")}
                />
                <b>Vipps privat</b>
                <span>
                  Deltakerne vippser til nummeret under, uten gebyr. «Åpne Vipps»
                  fyller ut nummeret, og PC viser QR-kode.
                </span>
                <em className={arr.vippsNummer ? (bank.klar ? "ok" : "") : "mangler"}>
                  {!arr.vippsNummer
                    ? "Mangler nummer"
                    : bank.klar
                      ? "Banken er koblet til: betalinger finnes automatisk"
                      : "Banken er ikke koblet til: du markerer betalinger som mottatt"}
                </em>
              </label>
              <label className={`valgkort ${arr.betaling === "bedrift" ? "valgt" : ""}`}>
                <input
                  type="radio"
                  name="betaling"
                  checked={arr.betaling === "bedrift"}
                  disabled={jobber || !arr.harVippsNokler}
                  onChange={() => send({ action: "innstillinger", betaling: "bedrift" }, "vipps")}
                />
                <b>Vipps bedrift</b>
                <span>
                  Vipps-avtalen. Deltakerne sendes rett til Vipps, og betalingen
                  sjekkes og trekkes automatisk. Vipps tar et gebyr per salg.
                </span>
                <em className={arr.harVippsNokler ? "ok" : "mangler"}>
                  {arr.harVippsNokler
                    ? `Nøklene er lagt inn${arr.vippsMiljo !== "prod" ? " (testmiljø)" : " (produksjon)"}`
                    : "Mangler Vipps-nøkler i Apps Script"}
                </em>
              </label>
            </div>
            {vis("vipps")}

            <div className="innstilling-tittel">Nummer for Vipps privat</div>
            <div className="innstilling-rad to-felt">
              <input
                type="text"
                inputMode="numeric"
                aria-label="Mobilnummer eller Vipps-nummer"
                placeholder="Mobilnummer"
                value={vipps ? vipps.nummer : arr.vippsNummer || ""}
                onChange={(e) =>
                  setVipps({ navn: arr.vippsNavn || "", ...vipps, nummer: e.target.value })
                }
              />
              <input
                type="text"
                aria-label="Navn på mottaker"
                placeholder="Mottakers navn"
                value={vipps ? vipps.navn : arr.vippsNavn || ""}
                onChange={(e) =>
                  setVipps({ nummer: arr.vippsNummer || "", ...vipps, navn: e.target.value })
                }
              />
              <button
                className="mini ok"
                disabled={jobber || !vipps}
                onClick={() =>
                  send(
                    { action: "innstillinger", vippsNummer: vipps.nummer, vippsNavn: vipps.navn },
                    "vippsnr",
                    () => setVipps(null)
                  )
                }
              >
                Lagre
              </button>
            </div>
            <div className="liten">
              Bruk et mobilnummer (8 sifre), så får deltakerne «Åpne Vipps» og
              QR-kode. Et Vipps-nummer (5–6 sifre) må de søke opp selv. Nummeret
              vises bare til den som har meldt seg på, og navnet står ved
              siden av, så folk ser at de betaler til riktig person.
              {arr.vippsNummer && !vippsErMobil(arr.vippsNummer) && " ⚠️ Nummeret er ikke et mobilnummer, så «Åpne Vipps» og QR-koden vises ikke."}
            </div>
            {vis("vippsnr")}

            <div className="innstilling-tittel">Vipps bedrift</div>
            <div className="liten">
              Vipps tar {String(arr.gebyrProsent ?? 2.99).replace(".", ",")} % +{" "}
              {String(arr.gebyrKr ?? 1).replace(".", ",")} kr per salg. Gebyret
              lagres på hvert salg og trekkes fra i oversikten under.
              Får deltakerne «Vi fikk ikke kontakt med Vipps», får du e-post om
              det, og knappen under sier hva som er galt.
            </div>
            <div className="innstilling-rad">
              <button
                className="mini"
                disabled={jobber || !arr.harVippsNokler}
                onClick={() => send({ action: "vippssjekk" }, "vippssjekk")}
              >
                Test Vipps bedrift
              </button>
              <span className="liten">Lager en betaling på 1 kr og avbryter den med en gang.</span>
            </div>
            {vis("vippssjekk")}
          </div>

          <div className="innstilling">
            <div className="innstilling-tittel">Test hele løpet med 1 kr</div>
            <div className="liten">
              Lag en lenke, åpne den på mobilen og meld deg på som en vanlig
              deltaker. Du betaler 1 kr med {arr.betaling === "bedrift" ? "Vipps bedrift" : "Vipps privat"}, og
              alt kjøres som for ekte: skjemaet, betalingssiden, Vipps
              {arr.betaling === "bedrift" ? "" : ", banken"} og e-postene. Påmeldingen
              merkes som test og tar ikke plass. Lenken virker i 2 timer, og bare
              for den som har den.
            </div>
            {data.testlenke ? (
              <>
                <div className="kopi-rad">
                  <code>{data.testlenke.url}</code>
                  <button
                    type="button"
                    className={`mini ${lenkeKopiert ? "ok" : ""}`}
                    onClick={() =>
                      kopier(data.testlenke.url)
                        .then(() => {
                          setLenkeKopiert(true)
                          setTimeout(() => setLenkeKopiert(false), 2500)
                        })
                        .catch(() => {})
                    }
                  >
                    {lenkeKopiert ? "Kopiert!" : "Kopier"}
                  </button>
                </div>
                <div className="innstilling-rad">
                  <a className="mini ok" href={data.testlenke.url} target="_blank" rel="noreferrer">
                    Åpne
                  </a>
                  <button className="mini" disabled={jobber} onClick={() => send({ action: "testlenke" }, "testlenke")}>
                    Lag ny
                  </button>
                  <button
                    className="mini"
                    disabled={jobber}
                    onClick={() => send({ action: "testlenke", stopp: true }, "testlenke")}
                  >
                    Stopp lenken
                  </button>
                </div>
                <div className="liten">
                  Virker til kl.{" "}
                  {new Date(data.testlenke.utloper).toLocaleTimeString("nb-NO", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Europe/Oslo",
                  })}
                  . Lager du en ny, slutter den gamle å virke.
                </div>
              </>
            ) : (
              <div className="innstilling-rad">
                <button className="mini ok" disabled={jobber} onClick={() => send({ action: "testlenke" }, "testlenke")}>
                  Lag testlenke
                </button>
              </div>
            )}
            {vis("testlenke")}
            <div className="liten">
              Etterpå: {arr.betaling === "bedrift" ? "velg «Trekk påmeldingen» med refusjon på testen" : "betal 1 kr-en tilbake til deg selv i Vipps"}, og slett testen.
            </div>
          </div>

          <div className="innstilling">
            <div className="innstilling-tittel">Testpåmelding</div>
            <div className="innstilling-rad">
              <select
                className="bred"
                aria-label="Hva skal testes"
                value={testType}
                onChange={(e) => setTestType(e.target.value)}
              >
                <option value="pamelding">Hel testpåmelding (lager en rad)</option>
                <option value="ubetalt">E-post: bekreftelse med betalingsinfo</option>
                <option value="venterbetaling">E-post: vi har ikke sett betalingen ennå (trykket Vipps)</option>
                <option value="betalt">E-post: bekreftelse når betalingen er mottatt</option>
                <option value="venteliste">E-post: du står på ventelisten</option>
                <option value="ledig">E-post: det er ledig plass</option>
                <option value="purring">E-post: påminnelse om betaling</option>
                <option value="sistepurring">E-post: siste påminnelse (nr. 3)</option>
                <option value="frigitt">E-post: plassen er frigitt</option>
                <option value="trukket">E-post: påmeldingen er trukket</option>
                <option value="refundert">E-post: pengene er betalt tilbake</option>
                <option value="program">E-post: fellesmail med program</option>
                <option value="takk">E-post: takkemail</option>
                <option value="rapport">E-post: daglig statusmail til admin</option>
                <option value="feilbelop">Varsel til deg: betaling med feil beløp</option>
                <option value="ikkekoblet">Varsel til deg: betaling som ikke ble koblet</option>
                <option value="vippsfeil">Varsel til deg: Vipps bedrift virker ikke</option>
                <option value="utloper">Varsel til deg: banktilgangen går snart ut</option>
                <option value="frakoblet">Varsel til deg: banken må kobles til på nytt</option>
              </select>
            </div>
            <div className="innstilling-rad">
              <input
                type="text"
                placeholder="Fornavn"
                value={test.fornavn}
                onChange={(e) => setTest({ ...test, fornavn: e.target.value })}
              />
              <input
                type="text"
                placeholder="Etternavn"
                value={test.etternavn}
                onChange={(e) => setTest({ ...test, etternavn: e.target.value })}
              />
            </div>
            <div className="innstilling-rad">
              <input
                type="email"
                placeholder="E-post til bekreftelsen"
                value={test.epost}
                onChange={(e) => setTest({ ...test, epost: e.target.value })}
              />
              <button
                className="mini ok"
                disabled={jobber || (testType !== "rapport" && !test.epost.includes("@"))}
                onClick={() =>
                  send({ action: "testpamelding", type: testType, ...test }, "test", (d) => {
                    setTestLenke(d.redirectUrl || "")
                    if (testType === "pamelding") setFilter("test")
                  })
                }
              >
                {testType === "pamelding" ? "Lag test" : "Send test"}
              </button>
            </div>
            {vis("test")}
            {testLenke && (
              <div className="liten">
                <a href={testLenke} target="_blank" rel="noreferrer">
                  Åpne Vipps-betalingen for testen
                </a>
              </div>
            )}
            <div className="liten">
              {testType === "pamelding"
                ? "Går gjennom det samme som en ekte påmelding, med e-post merket [TEST]. Den tar ikke plass, telles ikke og er ikke med i deltakerlisten. Slett den når du er ferdig."
                : testType === "rapport"
                  ? `Sendes til ${arr.rapportTil || "adressen i ADMIN_EPOST"}, med tallene slik de er nå.`
                  : "Sender bare denne e-posten, merket [TEST], til adressen over. Ingen påmelding lages."}
            </div>
          </div>

          <div className="innstilling">
            <div className="innstilling-tittel">Kontakt</div>
            <div className="innstilling-rad">
              <input
                type="email"
                aria-label="Svaradresse"
                placeholder="Svaradresse (e-post)"
                value={svar === null ? arr.svarEpost || "" : svar}
                onChange={(e) => setSvar(e.target.value)}
              />
              <button
                className="mini ok"
                disabled={jobber || svar === null || svar.trim() === (arr.svarEpost || "")}
                onClick={() =>
                  send({ action: "innstillinger", svarEpost: svar.trim() }, "kontakt", () => setSvar(null))
                }
              >
                Lagre
              </button>
            </div>
            <div className="innstilling-rad">
              <input
                type="text"
                inputMode="tel"
                aria-label="Telefon på dagen"
                placeholder="Telefon på dagen"
                value={tlf === null ? arr.telefon || "" : tlf}
                onChange={(e) => setTlf(e.target.value)}
              />
              <button
                className="mini ok"
                disabled={jobber || tlf === null || tlf.trim() === (arr.telefon || "")}
                onClick={() =>
                  send({ action: "innstillinger", telefon: tlf.trim() }, "kontakt", () => setTlf(null))
                }
              >
                Lagre
              </button>
            </div>
            <div className="liten">
              Deltakerne svarer til e-postadressen, og den vises på nettsiden
              og i vilkårene. Telefonnummeret står bare i fellesmailen med
              programmet.
            </div>
            {vis("kontakt")}
          </div>

          <div className="innstilling">
            <div className="innstilling-tittel">Facebook-event</div>
            <div className="innstilling-rad">
              <input
                type="url"
                className="bred"
                placeholder="https://www.facebook.com/events/…"
                value={fb === null ? arr.facebookUrl || "" : fb}
                onChange={(e) => setFb(e.target.value)}
              />
              <button
                className="mini ok"
                disabled={jobber || fb === null || fb.trim() === (arr.facebookUrl || "")}
                onClick={() =>
                  send({ action: "innstillinger", facebookUrl: fb.trim() }, "facebook", () =>
                    setFb(null)
                  )
                }
              >
                Lagre
              </button>
            </div>
            <div className="liten">
              Lenken brukes i bekreftelsen, ventelistemailen og på nettsiden.{" "}
              {arr.facebookUrl && (
                <a href={arr.facebookUrl} target="_blank" rel="noreferrer">
                  Åpne eventet
                </a>
              )}
            </div>
            {vis("facebook")}
          </div>

          <div className="innstilling">
            <div className="innstilling-tittel">Daglig statusmail</div>
            <div className="liten">
              {arr.rapportTil
                ? `Sendes kl. 08 til ${arr.rapportTil} når noe er nytt siden i går, eller når noe må følges opp (ubetalte, refusjoner, ledig plass med venteliste).`
                : "Legg inn ADMIN_EPOST i Skriptegenskaper for å få en statusmail hver morgen."}
            </div>
            <div className="innstilling-rad">
              <button
                className="mini ok"
                disabled={jobber || !arr.rapportTil}
                onClick={() => send({ action: "rapport" }, "rapport")}
              >
                Send statusmail nå
              </button>
            </div>
            {vis("rapport")}
            {arr.epostKvote != null && (
              <div className={`liten ${arr.epostKvote < 20 ? "varsel" : ""}`}>
                {arr.epostKvote < 20 ? "⚠️ " : ""}
                {arr.epostKvote} e-poster igjen av dagens kvote hos Google.
              </div>
            )}
          </div>
        </div>
      </section>

      <AdminBetaling data={data} okt={okt} onLogout={onLogout} last={last} />

      <section className="panel">
        <h2>Utsendelser</h2>
        <div className="innstillinger">
          <div className="innstilling">
            <div className="innstilling-tittel">Fellesmail med program</div>
            <textarea
              rows={6}
              aria-label="Program"
              value={program === null ? arr.program || "" : program}
              onChange={(e) => setProgram(e.target.value)}
            />
            <div className="liten">
              Én linje per punkt, med klokkeslett først. Sendes én gang per
              person, så du kan trykke på nytt når flere har betalt.
              E-posten har også kart, Facebook-lenke, MUNCH bar og
              telefonnummeret ditt.
            </div>
            {ubetalteUtenProgram > 0 && (
              <label className="sjekk">
                <input
                  type="checkbox"
                  checked={medUbetalte}
                  onChange={(e) => setMedUbetalte(e.target.checked)}
                />
                Ta også med {ubetalteUtenProgram} som ikke har betalt (de får
                betalingsinfo i samme e-post)
              </label>
            )}
            <div className="innstilling-rad">
              <button
                className="mini ok"
                disabled={jobber || program === null || program.trim() === (arr.program || "")}
                onClick={() =>
                  send({ action: "innstillinger", program }, "program", () => setProgram(null))
                }
              >
                Lagre programmet
              </button>
              {bekreftProgram ? (
                <>
                  <button
                    className="mini ok"
                    disabled={jobber}
                    onClick={() =>
                      send({ action: "fellesmail", medUbetalte }, "program", () =>
                        setBekreftProgram(false)
                      )
                    }
                  >
                    {jobber ? "Sender …" : `Ja, send til ${utenProgram + (medUbetalte ? ubetalteUtenProgram : 0)}`}
                  </button>
                  <button className="mini" onClick={() => setBekreftProgram(false)}>
                    Avbryt
                  </button>
                </>
              ) : (
                <button
                  className="mini ok"
                  disabled={
                    jobber ||
                    program !== null ||
                    utenProgram + (medUbetalte ? ubetalteUtenProgram : 0) === 0
                  }
                  onClick={() => setBekreftProgram(true)}
                >
                  ✉️ Send programmet
                </button>
              )}
            </div>
            <div className="liten">
              {utenProgram === 0
                ? "Alle som har betalt har fått programmet."
                : `${utenProgram} som har betalt har ikke fått programmet ennå.`}{" "}
              Du får en påminnelse i statusmailen 36 timer før.
            </div>
            {vis("program")}
          </div>

          <div className="innstilling">
            <div className="innstilling-tittel">Takkemail</div>
            <textarea
              rows={6}
              aria-label="Takketekst"
              value={takk === null ? arr.takk || "" : takk}
              onChange={(e) => setTakk(e.target.value)}
            />
            <div className="liten">
              Sendes etter arrangementet til de som ble sjekket inn. Har du
              ikke brukt innsjekk, går den til alle som har betalt.
            </div>
            <div className="innstilling-rad">
              <button
                className="mini ok"
                disabled={jobber || takk === null || takk.trim() === (arr.takk || "")}
                onClick={() =>
                  send({ action: "innstillinger", takk }, "takk", () => setTakk(null))
                }
              >
                Lagre teksten
              </button>
              {bekreftTakk ? (
                <>
                  <button
                    className="mini ok"
                    disabled={jobber}
                    onClick={() =>
                      send({ action: "takkemail" }, "takk", () => setBekreftTakk(false))
                    }
                  >
                    {jobber ? "Sender …" : "Ja, send takkemailen"}
                  </button>
                  <button className="mini" onClick={() => setBekreftTakk(false)}>
                    Avbryt
                  </button>
                </>
              ) : (
                <button
                  className="mini ok"
                  disabled={jobber || !startet || takk !== null}
                  onClick={() => setBekreftTakk(true)}
                >
                  ✉️ Send takkemail
                </button>
              )}
            </div>
            {!startet && (
              <div className="liten">🔒 Kan sendes når arrangementet har startet.</div>
            )}
            {vis("takk")}
          </div>
        </div>
      </section>

      <section className="panel innsjekk">
        <div className="panel-head">
          <h2>
            Innsjekk{" "}
            <small>
              {mott} av {paameldte.length} møtt
            </small>
          </h2>
          <div className="panel-tools">
            <button className="back-btn" onClick={() => setInnsjekk(!innsjekk)}>
              {innsjekk ? "Lukk innsjekk" : "🎟 Åpne innsjekk"}
            </button>
          </div>
        </div>
        {innsjekk && (
          <>
            <input
              type="search"
              className="innsjekk-sok"
              autoFocus
              placeholder="Søk navn, telefon eller JT-nr."
              value={innsjekkSok}
              onChange={(e) => setInnsjekkSok(e.target.value)}
            />
            {vis("innsjekk")}
            {innsjekkListe.length === 0 ? (
              <div className="tom">Ingen påmeldte passer med søket.</div>
            ) : (
              <ul className="innsjekk-liste">
                {innsjekkListe.map((r) => (
                  <li key={r.id} className={r.mott ? "er-mott" : ""}>
                    <div>
                      <b>{r.navn}</b>
                      <div className="liten">
                        {r.id} · {r.telefon}
                        {r.status === "UBETALT" && (
                          <span className="badge warn">Ikke betalt</span>
                        )}
                      </div>
                      {r.kommentar && <div className="liten">💬 {r.kommentar}</div>}
                    </div>
                    {r.mott ? (
                      <button className="mini" disabled={jobber} onClick={() => sjekkInn(r, false)}>
                        ✓ Møtt {dato(r.mott).slice(-5)} · angre
                      </button>
                    ) : (
                      <button className="mini ok" disabled={jobber} onClick={() => sjekkInn(r, true)}>
                        Sjekk inn
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Påmeldinger</h2>
          <div className="panel-tools">
            <input
              type="search"
              placeholder="Søk navn, e-post, telefon"
              value={sok}
              onChange={(e) => setSok(e.target.value)}
            />
            <button
              className="back-btn"
              onClick={() =>
                lastNedCsv(
                  data.deltakere.filter(
                    (r) => !r.test && ["BETALT", "UBETALT"].includes(r.status)
                  )
                )
              }
            >
              ⬇ Deltakerliste (CSV)
            </button>
          </div>
        </div>
        <div className="filters">
          {FILTRE.map((f) => {
            const n = f.test
              ? data.tester || 0
              : f.match
                ? f.match.reduce((s, k) => s + (a[k] || 0), 0)
                : data.deltakere.length - (data.tester || 0)
            return (
              <button
                key={f.id}
                className={filter === f.id ? "active" : ""}
                onClick={() => setFilter(f.id)}
              >
                {f.tekst} <span>{n}</span>
              </button>
            )
          })}
        </div>

        {a.UBETALT > 0 && (
          <div className="venteliste-varsel purring-boks">
            <div>
              <b>
                {a.UBETALT} har ikke betalt
              </b>
              <div className="liten">
                Send en påminnelse med Vipps-info til alle som ikke har betalt.
                De som fikk purring det siste døgnet, hoppes over.
              </div>
            </div>
            {bekreftPurring ? (
              <div className="varsel-knapper">
                <button
                  className="mini ok"
                  disabled={jobber}
                  onClick={() =>
                    send({ action: "purring" }, "purring", () =>
                      setBekreftPurring(false)
                    )
                  }
                >
                  {jobber ? "Sender …" : `Send til ${a.UBETALT}`}
                </button>
                <button className="mini" onClick={() => setBekreftPurring(false)}>
                  Avbryt
                </button>
              </div>
            ) : (
              <button
                className="mini ok"
                disabled={jobber}
                onClick={() => setBekreftPurring(true)}
              >
                ✉️ Send purring
              </button>
            )}
          </div>
        )}
        {vis("purring")}
        {a.VENTELISTE > 0 && (
          <div className="venteliste-varsel">
            <div>
              <b>
                {a.VENTELISTE} på ventelisten · {data.ledige}{" "}
                {data.ledige === 1 ? "ledig plass" : "ledige plasser"}
              </b>
              <div className="liten">
                {data.ledige > 0
                  ? "Send e-post til alle på ventelisten om at det er ledig plass. Den som melder seg på først, får plassen."
                  : "Knappen blir aktiv når noen trekker seg, eller når du øker antall plasser."}
              </div>
            </div>
            {bekreftVarsel ? (
              <div className="varsel-knapper">
                <button
                  className="mini ok"
                  disabled={jobber}
                  onClick={() =>
                    send({ action: "varsleventeliste" }, "venteliste", () =>
                      setBekreftVarsel(false)
                    )
                  }
                >
                  {jobber ? "Sender …" : `Send til ${a.VENTELISTE}`}
                </button>
                <button className="mini" onClick={() => setBekreftVarsel(false)}>
                  Avbryt
                </button>
              </div>
            ) : (
              <button
                className="mini ok"
                disabled={jobber || data.ledige <= 0}
                onClick={() => setBekreftVarsel(true)}
              >
                ✉️ Varsle om ledig plass
              </button>
            )}
          </div>
        )}
        {vis("venteliste")}
        {vis("liste")}

        {deltakere.length === 0 ? (
          <div className="tom">Ingen påmeldinger her.</div>
        ) : (
          <div className="tabell">
            <table className="deltakere">
              <thead>
                <tr>
                  <th>Navn</th>
                  <th>Kontakt</th>
                  <th>Status</th>
                  <th>Påmeldt</th>
                  <th>Kommentar</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deltakere.map((r) => {
                  const s = STATUS[r.status] || { tekst: r.status, klasse: "" }
                  const valg = []
                  if (r.status === "UBETALT") {
                    valg.push("betalt")
                    valg.push(r.purringer >= maksPurringer ? "frigi" : "purring")
                  }
                  if (["BETALT", "UBETALT"].includes(r.status)) valg.push("bekreftelse", "overdra")
                  if (r.status === "VENTELISTE") valg.push("tilbud")
                  if (["BETALT", "UBETALT", "VENTELISTE"].includes(r.status))
                    valg.push("trekk")
                  if (r.status === "TRUKKET" && r.betalt && !r.refundert)
                    valg.push("refundert")
                  if (r.test) valg.push("slett")
                  const erAapen = aapen?.id === r.id
                  return [
                    <tr key={r.id} className="deltaker">
                      <td className="c-navn">
                        <b>{r.navn}</b>
                        <div className="liten">{r.id}</div>
                      </td>
                      <td className="c-kontakt">
                        <a href={`mailto:${r.epost}`}>{r.epost}</a>
                        <div className="liten">{r.telefon}</div>
                      </td>
                      <td className="c-status">
                        <span className={`badge ${s.klasse}`}>{s.tekst}</span>
                        {r.test && <span className="badge test">Test</span>}
                        <div className="liten">
                          {formatPrice(r.belop)}
                          {r.betaling === "vipps" ? " · Vipps bedrift" : ""}
                          {r.betaling === "manuell" ? " · Vipps privat" : ""}
                          {r.vippsNaa ? " · i Vipps nå" : ""}
                          {r.bankId && r.bankId !== "manuell" ? " · funnet i banken" : ""}
                          {r.refundert
                            ? ` · refundert ${formatPrice(r.refusjon === "" || r.refusjon == null ? r.belop : r.refusjon)}`
                            : r.status === "TRUKKET" && r.betalt
                              ? ` · skal ha ${formatPrice(r.refusjon === "" || r.refusjon == null ? r.belop : r.refusjon)} tilbake`
                              : ""}
                        </div>
                      </td>
                      <td className="liten c-dato">{dato(r.opprettet)}</td>
                      <td className="kommentar c-kommentar">
                        {r.kommentar}
                        {r.vippsNavn && r.vippsNavn !== r.navn && (
                          <div className="liten">💳 Betaler fra Vipps-kontoen til {r.vippsNavn}</div>
                        )}
                        {r.notat && <div className="liten">📝 {r.notat}</div>}
                        {r.utenEpost && (
                          <div className="liten varsel">
                            ⚠️ Fikk ikke bekreftelsen på e-post. Send den på nytt.
                          </div>
                        )}
                        {r.purringer > 0 && r.status === "UBETALT" && (
                          <div className={`liten ${r.purringer >= maksPurringer ? "varsel" : ""}`}>
                            {r.purringer >= maksPurringer
                              ? `🔴 Purret ${r.purringer} ganger, sist ${dato(r.purret)}. Kan miste plassen.`
                              : `✉️ Purret ${r.purringer} av ${maksPurringer}, sist ${dato(r.purret)}`}
                          </div>
                        )}
                        {r.program && <div className="liten">✉️ Program sendt {dato(r.program)}</div>}
                        {r.mott && <div className="liten mott">✓ Møtt {dato(r.mott)}</div>}
                        {r.varslet && r.status === "VENTELISTE" && (
                          <div className="liten">✉️ Varslet om ledig plass {dato(r.varslet)}</div>
                        )}
                      </td>
                      <td className="handlinger">
                        {valg.length > 0 && (
                          <select
                            className={`handling-velger ${erAapen ? `h-${aapen.handling}` : ""}`}
                            aria-label={`Handling for ${r.navn}`}
                            value={erAapen ? aapen.handling : ""}
                            onChange={(e) =>
                              e.target.value
                                ? apne(r.id, e.target.value)
                                : setAapen(null)
                            }
                          >
                            <option value="">Velg handling …</option>
                            {valg.map((h) => (
                              <option key={h} value={h}>
                                {handlingIkon[h]} {handlingTekst[h]}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>,
                    erAapen && (
                      <tr key={`${r.id}-handling`} className="handling-rad">
                        <td colSpan={6}>
                          <div className={`handling h-${aapen.handling}`}>
                            <b>
                              {handlingTekst[aapen.handling]}: {r.navn}
                            </b>
                            {aapen.handling === "overdra" && (
                              <>
                                <p>
                                  Plassen{r.status === "BETALT" ? ", og betalingen," : ""} går
                                  over til den nye deltakeren, som får en ny
                                  bekreftelse. Pengene gjøres opp mellom dem selv.
                                </p>
                                <div className="overdra-felt">
                                  {[
                                    ["fornavn", "Fornavn", "text"],
                                    ["etternavn", "Etternavn", "text"],
                                    ["epost", "E-post", "email"],
                                    ["telefon", "Telefon", "tel"],
                                  ].map(([k, tekst, type]) => (
                                    <input
                                      key={k}
                                      type={type}
                                      placeholder={tekst}
                                      aria-label={tekst}
                                      value={ny[k]}
                                      onChange={(e) => setNy({ ...ny, [k]: e.target.value })}
                                    />
                                  ))}
                                </div>
                              </>
                            )}
                            {aapen.handling === "frigi" && (
                              <p>
                                {r.navn} har fått {r.purringer} purringer uten
                                å betale. Påmeldingen trekkes, og plassen blir
                                ledig for ventelisten.
                              </p>
                            )}
                            {["trekk", "refundert", "frigi"].includes(aapen.handling) && (
                              <label className="sjekk">
                                <input
                                  type="checkbox"
                                  checked={varsle}
                                  onChange={(e) => setVarsle(e.target.checked)}
                                />
                                Send e-post til {r.epost} om dette
                              </label>
                            )}
                            {aapen.handling === "purring" && (
                              <p>
                                Sender en vennlig påminnelse til {r.epost} med
                                «Betal med Vipps»-knapp, beløp og lenke til
                                betalingssiden.
                              </p>
                            )}
                            {aapen.handling === "trekk" && (
                              <p>
                                Påmeldingen er bindende og skal bare trekkes
                                når legeerklæring er mottatt.
                              </p>
                            )}
                            {aapen.handling === "trekk" &&
                              r.status === "BETALT" && (
                                <div className="valg">
                                  <label className="sjekk">
                                    <input
                                      type="radio"
                                      checked={!sent}
                                      onChange={() => setSent(false)}
                                    />
                                    Mer enn 48 timer før: hele{" "}
                                    {formatPrice(r.belop)} tilbake
                                  </label>
                                  <label className="sjekk">
                                    <input
                                      type="radio"
                                      checked={sent}
                                      onChange={() => setSent(true)}
                                    />
                                    Under 48 timer før:{" "}
                                    {formatPrice(Math.max(0, r.belop - noshow))}{" "}
                                    tilbake, {formatPrice(noshow)} beholdes
                                  </label>
                                </div>
                              )}
                            {aapen.handling === "trekk" &&
                              r.status === "BETALT" &&
                              r.betaling === "vipps" && (
                                <label className="sjekk">
                                  <input
                                    type="checkbox"
                                    checked={refunder}
                                    onChange={(e) =>
                                      setRefunder(e.target.checked)
                                    }
                                  />
                                  Refunder{" "}
                                  {formatPrice(
                                    sent ? Math.max(0, r.belop - noshow) : r.belop
                                  )}{" "}
                                  i Vipps nå
                                </label>
                              )}
                            {aapen.handling === "trekk" &&
                              r.status === "BETALT" &&
                              r.betaling !== "vipps" && (
                                <p>
                                  Betalt med Vipps privat: send{" "}
                                  {formatPrice(
                                    sent ? Math.max(0, r.belop - noshow) : r.belop
                                  )}{" "}
                                  tilbake selv, og
                                  marker som refundert etterpå.
                                </p>
                              )}
                            <input
                              type="text"
                              placeholder={
                                aapen.handling === "trekk"
                                  ? "Notat, f.eks. «Legeerklæring mottatt 12.12»"
                                  : "Notat (valgfritt)"
                              }
                              value={notat}
                              onChange={(e) => setNotat(e.target.value)}
                            />
                            <div className="handling-knapper">
                              <button
                                className={`mini bekreft h-${aapen.handling}`}
                                disabled={jobber}
                                onClick={() => utfor(r)}
                              >
                                {jobber ? "Lagrer …" : "Bekreft"}
                              </button>
                              <button
                                className="mini"
                                onClick={() => setAapen(null)}
                              >
                                Avbryt
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="to-kol">
        <section className="panel">
          <h2>Siste dager</h2>
          {data.dager.length === 0 ? (
            <div className="tom">Ingen besøk ennå.</div>
          ) : (
            <div className="tabell">
              <table>
                <thead>
                  <tr>
                    <th>Dag</th>
                    <th className="tall">Besøk</th>
                    <th className="tall">Unike</th>
                    <th className="tall">Påmeldinger</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dager.map((d) => (
                    <tr key={d.dag}>
                      <td>{d.dag}</td>
                      <td className="tall">{d.besok}</td>
                      <td className="tall">{d.unike}</td>
                      <td className="tall">{d.pameldinger}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <h2>Hvor besøkende kommer fra</h2>
          {data.besok.kilder.length === 0 ? (
            <div className="tom">Ingen besøk ennå.</div>
          ) : (
            <table>
              <tbody>
                {data.besok.kilder.map((k) => (
                  <tr key={k.kilde}>
                    <td>{k.kilde}</td>
                    <td className="tall">{k.besok}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="panel faresone">
        <h2>Nullstill før lansering</h2>
        <p className="liten">
          Fjerner alle påmeldinger (også tester) og besøksstatistikken, og neste
          påmelding får JT-1001. En kopi lagres i «Arkiv»-faner i regnearket.
          Antall plasser, Vipps-innstilling og passord beholdes.
        </p>
        {medBetaling > 0 ? (
          <p className="liten">
            🔒 Låst fordi det finnes {medBetaling} påmeldinger med registrert betaling.
          </p>
        ) : nullstill === null ? (
          <button className="mini fare" onClick={() => setNullstill("")}>
            Nullstill alt …
          </button>
        ) : (
          <div className="nullstill-bekreft">
            <input
              type="text"
              placeholder="Skriv NULLSTILL"
              value={nullstill}
              autoCapitalize="characters"
              onChange={(e) => setNullstill(e.target.value)}
            />
            <button
              className="mini bekreft h-trekk"
              disabled={jobber || nullstill.trim().toUpperCase() !== "NULLSTILL"}
              onClick={() =>
                send(
                  { action: "nullstill", bekreft: "NULLSTILL" },
                  "nullstill",
                  () => {
                    setNullstill(null)
                    setFilter("aktive")
                  }
                )
              }
            >
              {jobber ? "Nullstiller …" : "Nullstill nå"}
            </button>
            <button className="mini" onClick={() => setNullstill(null)}>
              Avbryt
            </button>
          </div>
        )}
        {vis("nullstill")}

        <h2 className="faresone-neste">Slett persondata etter arrangementet</h2>
        <p className="liten">
          Sletter alle påmeldinger, besøksstatistikken og «Arkiv»-fanene, uten
          kopi. Personvernerklæringen lover sletting senest tre måneder etter
          arrangementet, og du får en påminnelse i statusmailen når tiden er
          inne. Last ned deltakerlisten først hvis regnskapet trenger den.
        </p>
        {!startet ? (
          <p className="liten">🔒 Låst til arrangementet har vært.</p>
        ) : slett === null ? (
          <button className="mini fare" onClick={() => setSlett("")}>
            Slett persondata …
          </button>
        ) : (
          <div className="nullstill-bekreft">
            <input
              type="text"
              placeholder="Skriv SLETT"
              value={slett}
              autoCapitalize="characters"
              onChange={(e) => setSlett(e.target.value)}
            />
            <button
              className="mini bekreft h-trekk"
              disabled={jobber || slett.trim().toUpperCase() !== "SLETT"}
              onClick={() =>
                send({ action: "slettdata", bekreft: "SLETT" }, "slett", () => setSlett(null))
              }
            >
              {jobber ? "Sletter …" : "Slett nå"}
            </button>
            <button className="mini" onClick={() => setSlett(null)}>
              Avbryt
            </button>
          </div>
        )}
        {vis("slett")}
      </section>
    </div>
  )
}
