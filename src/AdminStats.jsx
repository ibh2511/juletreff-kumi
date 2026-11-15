import { useCallback, useEffect, useMemo, useState } from "react"
import { apiPost } from "./api.js"
import { formatPrice } from "./config.js"
import "./AdminStats.css"

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
  const [refunder, setRefunder] = useState(true)
  const [sent, setSent] = useState(false) // trukket under 48 timer før start
  const [jobber, setJobber] = useState(false)
  const [melding, setMelding] = useState(null) // { tekst, sted, feil }
  const [plasser, setPlasser] = useState("")
  const [fb, setFb] = useState(null) // null = ikke endret
  const [test, setTest] = useState({ fornavn: "Test", etternavn: "Testesen", epost: "" })
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
    setRefunder(true)
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
  const opptatt = a.BETALT + a.UBETALT
  // Samme regel som backend: nullstilling er låst når en ekte påmelding har registrert betaling
  const medBetaling = data.deltakere.filter(
    (r) => !r.test && (r.status === "BETALT" || r.betalt)
  ).length

  const handlingTekst = {
    betalt: "Marker som betalt",
    purring: "Send purring",
    bekreftelse: "Send bekreftelsen på nytt",
    tilbud: "Gi plass fra ventelisten",
    refundert: "Marker som refundert",
    trekk: "Trekk påmeldingen",
    slett: "Slett testen",
  }
  // Fargekoder: grønn = betaling inn, blå = plass, gul = penger ut, rød = fjerner påmeldingen
  const handlingIkon = {
    betalt: "🟢",
    purring: "🟠",
    bekreftelse: "✉️",
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

          <div className="innstilling">
            <div className="innstilling-tittel">Betaling</div>
            <label className="bryter">
              <input
                type="checkbox"
                checked={arr.vippsModus === "api"}
                disabled={jobber || (!arr.harVippsNokler && arr.vippsModus !== "api")}
                onChange={(e) =>
                  send(
                    {
                      action: "innstillinger",
                      vippsModus: e.target.checked ? "api" : "nummer",
                    },
                    "vipps"
                  )
                }
              />
              <span className="bryter-spor" aria-hidden="true" />
              Vipps-API {arr.vippsModus === "api" ? "på" : "av"}
            </label>
            <div className="liten">
              {arr.vippsAktiv
                ? `Deltakerne sendes rett til Vipps og betaler med en gang${arr.vippsMiljo !== "prod" ? " (testmiljø)" : ""}.`
                : `Deltakerne betaler til Vipps-nummer #${arr.vippsNummer}, og du markerer betalingen som mottatt her.`}
              {!arr.harVippsNokler &&
                " API-et kan slås på når Vipps-avtalen er på plass og nøklene er lagt inn i Apps Script."}
            </div>
            {vis("vipps")}
          </div>

          <div className="innstilling">
            <div className="innstilling-tittel">Testpåmelding</div>
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
                placeholder="E-post som skal få bekreftelsen"
                value={test.epost}
                onChange={(e) => setTest({ ...test, epost: e.target.value })}
              />
              <button
                className="mini ok"
                disabled={jobber || !test.epost.includes("@")}
                onClick={() =>
                  send({ action: "testpamelding", ...test }, "test", (d) => {
                    setTestLenke(d.redirectUrl || "")
                    setFilter("test")
                  })
                }
              >
                Lag test
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
              Går gjennom det samme som en ekte påmelding, med e-post merket
              [TEST]. Den tar ikke plass, telles ikke og er ikke med i
              deltakerlisten. Slett den når du er ferdig.
            </div>
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
                  if (r.status === "UBETALT") valg.push("betalt", "purring")
                  if (["BETALT", "UBETALT"].includes(r.status)) valg.push("bekreftelse")
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
                          {r.betaling === "vipps" ? " · Vipps" : ""}
                          {r.betaling === "manuell" ? " · Vipps-nr." : ""}
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
                        {r.notat && <div className="liten">📝 {r.notat}</div>}
                        {r.utenEpost && (
                          <div className="liten varsel">
                            ⚠️ Fikk ikke bekreftelsen på e-post. Send den på nytt.
                          </div>
                        )}
                        {r.purret && r.status === "UBETALT" && (
                          <div className="liten">✉️ Purret {dato(r.purret)}</div>
                        )}
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
                            {aapen.handling === "purring" && (
                              <p>
                                Sender en vennlig påminnelse til {r.epost} med
                                Vipps-nummer, beløp og hva som skal stå i
                                meldingen.
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
                                  Betalt til Vipps-nummeret: send{" "}
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
      </section>
    </div>
  )
}
