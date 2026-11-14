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
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`
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
  const [jobber, setJobber] = useState(false)
  const [melding, setMelding] = useState("")

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
    setMelding("")
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
      })
      if (d.utlogget) return onLogout()
      if (!d.ok) throw new Error(d.error)
      setMelding(d.melding || "Lagret.")
      setAapen(null)
      await last()
    } catch (err) {
      setMelding(`⚠️ ${err.message}`)
    }
    setJobber(false)
  }

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
  const arr = data.arrangement
  const opptatt = a.BETALT + a.UBETALT

  const handlingTekst = {
    betalt: "Marker som betalt",
    trekk: "Trekk påmeldingen",
    refundert: "Marker som refundert",
    tilbud: "Gi plass fra ventelisten",
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

      {!arr.vippsAktiv && (
        <div className="admin-note">
          Vipps-avtalen er ikke koblet til ennå. Deltakerne betaler til
          Vipps-nummeret, og du markerer betalingen som mottatt her.
        </div>
      )}
      {feil && <div className="admin-note feil">⚠️ {feil}</div>}
      {melding && <div className="admin-note">{melding}</div>}

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
                  data.deltakere.filter((r) =>
                    ["BETALT", "UBETALT"].includes(r.status)
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
            const n = f.match
              ? f.match.reduce((s, k) => s + (a[k] || 0), 0)
              : data.deltakere.length
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

        {deltakere.length === 0 ? (
          <div className="tom">Ingen påmeldinger her.</div>
        ) : (
          <div className="tabell">
            <table>
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
                  if (r.status === "UBETALT") valg.push("betalt")
                  if (r.status === "VENTELISTE") valg.push("tilbud")
                  if (["BETALT", "UBETALT", "VENTELISTE"].includes(r.status))
                    valg.push("trekk")
                  if (r.status === "TRUKKET" && r.betalt && !r.refundert)
                    valg.push("refundert")
                  const erAapen = aapen?.id === r.id
                  return [
                    <tr key={r.id}>
                      <td>
                        <b>{r.navn}</b>
                        <div className="liten">{r.id}</div>
                      </td>
                      <td>
                        <a href={`mailto:${r.epost}`}>{r.epost}</a>
                        <div className="liten">{r.telefon}</div>
                      </td>
                      <td>
                        <span className={`badge ${s.klasse}`}>{s.tekst}</span>
                        <div className="liten">
                          {formatPrice(r.belop)}
                          {r.betaling === "vipps" ? " · Vipps" : ""}
                          {r.betaling === "manuell" ? " · Vipps-nr." : ""}
                          {r.refundert ? " · refundert" : ""}
                        </div>
                      </td>
                      <td className="liten">{dato(r.opprettet)}</td>
                      <td className="kommentar">
                        {r.kommentar}
                        {r.notat && <div className="liten">📝 {r.notat}</div>}
                      </td>
                      <td className="handlinger">
                        {valg.map((h) => (
                          <button
                            key={h}
                            className={`mini ${h === "trekk" ? "fare" : ""}`}
                            onClick={() => apne(r.id, h)}
                          >
                            {handlingTekst[h]}
                          </button>
                        ))}
                      </td>
                    </tr>,
                    erAapen && (
                      <tr key={`${r.id}-handling`} className="handling-rad">
                        <td colSpan={6}>
                          <div className="handling">
                            <b>
                              {handlingTekst[aapen.handling]}: {r.navn}
                            </b>
                            {aapen.handling === "trekk" && (
                              <p>
                                Påmeldingen er bindende og skal bare trekkes
                                når legeerklæring er mottatt.
                              </p>
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
                                  Refunder {formatPrice(r.belop)} i Vipps nå
                                </label>
                              )}
                            {aapen.handling === "trekk" &&
                              r.status === "BETALT" &&
                              r.betaling !== "vipps" && (
                                <p>
                                  Betalt til Vipps-nummeret: send{" "}
                                  {formatPrice(r.belop)} tilbake selv, og
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
                                className={`mini ${aapen.handling === "trekk" ? "fare" : "ok"}`}
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
    </div>
  )
}
