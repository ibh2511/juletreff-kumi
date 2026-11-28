import { useState } from "react"
import { apiPost } from "./api.js"
import { API_URL, formatPrice } from "./config.js"
import { kopier } from "./vipps.js"

const kr2 = (v) =>
  `${Number(v || 0).toLocaleString("nb-NO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kr`

const tid = (v) =>
  v
    ? new Date(v).toLocaleString("nb-NO", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : ""

const BANKSTATUS = {
  UMATCHET: { tekst: "Ikke koblet", klasse: "warn" },
  FEIL_BELOP: { tekst: "Feil beløp", klasse: "warn" },
  DUPLIKAT: { tekst: "Mulig dobbel betaling", klasse: "info" },
  SJEKK: { tekst: "Koblet automatisk, sjekk", klasse: "warn" },
  NULLSTILT: { tekst: "Trolig test fra før nullstillingen", klasse: "info" },
}

// Salg per betalingsløsning, innbetalinger fra banken som ikke ble koblet, og tilkoblingen til SpareBank 1.
export default function AdminBetaling({ data, okt, onLogout, last }) {
  const [melding, setMelding] = useState(null) // { tekst, sted, feil }
  const [jobber, setJobber] = useState(false)
  const [valgt, setValgt] = useState({}) // bankId → påmeldings-ID
  const [bekreft, setBekreft] = useState("") // bankId som venter på andre trykk på «Koble»
  const [klient, setKlient] = useState({ klientId: "", hemmelighet: "", finInst: null })
  const [kontoer, setKontoer] = useState(null)
  const [raa, setRaa] = useState("")
  const [kopiert, setKopiert] = useState(false)
  const [nyttNavn, setNyttNavn] = useState("")

  const arr = data.arrangement
  const bank = data.bank || {}
  const pb = data.perBetaling || {
    bedrift: { salg: 0, omsetning: 0, gebyr: 0, netto: 0 },
    privat: { salg: 0, omsetning: 0, gebyr: 0, netto: 0 },
  }
  const sum = ["salg", "omsetning", "gebyr", "netto"].reduce(
    (o, k) => ({ ...o, [k]: (pb.bedrift[k] || 0) + (pb.privat[k] || 0) }),
    {}
  )
  // Nyeste først, etter når betalingen dukket opp i banken
  const rader = [...(data.bankrader || [])].sort((a, b) => new Date(b.sett) - new Date(a.sett))
  const ubetalte = data.deltakere.filter((r) => r.status === "UBETALT")
  // Markert betalt for hånd: innbetalingen kan kobles til dem uten ny e-post
  const markertBetalt = data.deltakere.filter((r) => r.status === "BETALT" && r.betaling === "manuell")
  const redirect = `${API_URL}?action=bank`

  const kall = async (body, sted, etter) => {
    setJobber(true)
    setMelding(null)
    try {
      const d = await apiPost({ ...body, okt })
      if (d.utlogget) return onLogout()
      if (!d.ok) throw new Error(d.error || "Noe gikk galt")
      if (d.melding) setMelding({ tekst: d.melding, sted })
      await etter?.(d)
      return d
    } catch (err) {
      setMelding({ tekst: err.message, sted, feil: true })
    } finally {
      setJobber(false)
    }
  }

  const vis = (sted) =>
    melding?.sted === sted && (
      <div className={`admin-note lokal ${melding.feil ? "feil" : "ok"}`} role="status">
        {melding.feil ? "⚠️ " : "✓ "}
        {melding.tekst}
      </div>
    )

  const kobleTilBanken = async () => {
    // Fanen åpnes med en gang, ellers stopper nettleseren den fordi den kommer etter et nettverkskall.
    const fane = window.open("", "_blank")
    const d = await kall(
      {
        action: "bankstart",
        klientId: klient.klientId,
        hemmelighet: klient.hemmelighet,
        finInst: klient.finInst ?? bank.finInst ?? "",
        redirect,
      },
      "bank"
    )
    if (d?.url) {
      if (fane) fane.location.href = d.url
      else window.location.href = d.url
      setKlient({ klientId: "", hemmelighet: "", finInst: null })
    } else fane?.close()
  }

  const kopierRedirect = () =>
    kopier(redirect)
      .then(() => {
        setKopiert(true)
        setTimeout(() => setKopiert(false), 2500)
      })
      .catch(() => setMelding({ tekst: "Fikk ikke kopiert. Merk adressen og kopier den selv.", sted: "bank", feil: true }))

  const tilstand = bank.feil ? "feil" : bank.klar ? "ok" : bank.tilkoblet ? "halv" : "av"
  const status = {
    feil: ["Tilkoblingen virker ikke lenger", "Logg inn med BankID på nytt under «Koble til på nytt»."],
    ok: ["Koblet til banken", "Backend finner betalingene selv."],
    halv: ["Koblet til, men ingen konto er valgt", "Trykk «Velg konto» og velg kontoen Vipps-pengene kommer inn på."],
    av: ["Ikke koblet til", "Følg stegene under. Uten banken markerer du betalingene som mottatt selv."],
  }[tilstand]
  const fakta = [
    bank.konto && ["Konto", bank.konto],
    bank.sistSjekket && ["Sist sjekket", tid(bank.sistSjekket)],
    bank.pause && ["Pause", "Banken sa at vi spurte for ofte. Den spørres igjen om noen minutter."],
    bank.utloper && [
      "BankID gyldig til",
      new Date(bank.utloper).toLocaleDateString("nb-NO", { dateStyle: "long" }),
    ],
    ["Varsler til", arr.varselEpost || "VARSEL_EPOST, ADMIN_EPOST eller SVAR_EPOST"],
  ].filter(Boolean)

  return (
    <section className="panel">
      <h2>Vipps og bank</h2>

      <h3 className="under-tittel">Salg per betalingsløsning</h3>
      <div className="tabell">
        <table className="salg">
          <thead>
            <tr>
              <th>Løsning</th>
              <th className="tall">Salg</th>
              <th className="tall">Omsetning</th>
              <th className="tall">Gebyr</th>
              <th className="tall">Netto</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                Vipps privat {arr.betaling === "privat" && <span className="badge ok">I bruk</span>}
              </td>
              <td data-label="Salg" className="tall">{pb.privat.salg}</td>
              <td data-label="Omsetning" className="tall">{kr2(pb.privat.omsetning)}</td>
              <td data-label="Gebyr" className="tall liten">Ingen</td>
              <td data-label="Netto" className="tall">{kr2(pb.privat.netto)}</td>
            </tr>
            <tr>
              <td>
                Vipps bedrift {arr.betaling === "bedrift" && <span className="badge ok">I bruk</span>}
              </td>
              <td data-label="Salg" className="tall">{pb.bedrift.salg}</td>
              <td data-label="Omsetning" className="tall">{kr2(pb.bedrift.omsetning)}</td>
              <td data-label="Gebyr" className="tall">{kr2(pb.bedrift.gebyr)}</td>
              <td data-label="Netto" className="tall">{kr2(pb.bedrift.netto)}</td>
            </tr>
            <tr className="sum">
              <td>
                <b>Sum</b>
              </td>
              <td data-label="Salg" className="tall">
                <b>{sum.salg}</b>
              </td>
              <td data-label="Omsetning" className="tall">
                <b>{kr2(sum.omsetning)}</b>
              </td>
              <td data-label="Gebyr" className="tall">
                <b>{kr2(sum.gebyr)}</b>
              </td>
              <td data-label="Netto" className="tall">
                <b>{kr2(sum.netto)}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="liten">
        Betalte påmeldinger, uten tester. Refusjoner er trukket fra omsetningen.
        Gebyret gjelder bare Vipps bedrift.
      </div>

      <h3 className="under-tittel">Innbetalinger som ikke ble koblet</h3>
      <div className="liten">
        Betalinger backend ikke kunne koble sikkert. Velg påmeldingen og trykk
        «Koble», så får deltakeren bekreftelsen. Har du alt markert påmeldingen som
        betalt (for eksempel betalt av en annen), velger du den under «Allerede betalt».
        Gjelder den ikke juletreffet,
        trykker du «Ignorer». Ser du en betaling i nettbanken som mangler her,
        bruker du «Marker som betalt» i påmeldingslisten.
      </div>
      <form
        className="skjulte-navn"
        onSubmit={(e) => {
          e.preventDefault()
          kall({ action: "innstillinger", skjulNavn: nyttNavn }, "egne", () => {
            setNyttNavn("")
            return last()
          })
        }}
      >
        <span className="liten">Navn som er skjult i listen, uansett beløp. De kobles som vanlig:</span>
        {arr.skjulteNavn?.length ? (
          arr.skjulteNavn.map((n) => (
            <button
              key={n}
              type="button"
              className="mini"
              disabled={jobber}
              title="Vis i listen igjen"
              onClick={() => kall({ action: "innstillinger", visNavn: n }, "egne", last)}
            >
              {n} ✕
            </button>
          ))
        ) : (
          <span className="liten">ingen ennå.</span>
        )}
        <input
          type="text"
          aria-label="Navn som skal skjules"
          placeholder="Fornavn Etternavn"
          value={nyttNavn}
          onChange={(e) => setNyttNavn(e.target.value)}
        />
        <button type="submit" className="mini" disabled={jobber || !nyttNavn.trim()}>
          Skjul
        </button>
      </form>
      {vis("egne")}
      {rader.length === 0 ? (
        <div className="tom">Ingen innbetalinger venter på kobling.</div>
      ) : (
        <div className="tabell">
          <table className="bankrader">
            <thead>
              <tr>
                <th>Dato</th>
                <th className="tall">Beløp</th>
                <th>Fra</th>
                <th>Status</th>
                <th>Påmelding</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rader.map((b) => {
                const s = BANKSTATUS[b.status] || { tekst: b.status, klasse: "" }
                const v = valgt[b.bankId] ?? (ubetalte.some((r) => r.id === b.forslag) ? b.forslag : "")
                return (
                  <tr key={b.bankId}>
                    <td className="liten c-dato">
                      {/* Banken gir bare datoen, ikke klokkeslettet */}
                      {`${b.dato.slice(8, 10)}.${b.dato.slice(5, 7)}.`}
                    </td>
                    <td className="tall c-belop">{kr2(b.belop)}</td>
                    <td className="c-fra">
                      {b.navn ||
                        (/pending/i.test(b.bokforing) &&
                          "Reservert i banken. Navnet kommer når banken bokfører den.")}
                      <div className="liten">{b.tekst}</div>
                    </td>
                    <td className="c-status">
                      <span className={`badge ${s.klasse}`}>{s.tekst}</span>
                    </td>
                    <td className="c-velg">
                      <select
                        className="handling-velger"
                        aria-label="Påmelding betalingen hører til"
                        value={v}
                        onChange={(e) => {
                          setValgt({ ...valgt, [b.bankId]: e.target.value })
                          setBekreft("")
                        }}
                      >
                        <option value="">Velg påmelding …</option>
                        {ubetalte.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.id} · {r.vippsNavn || r.navn} · {formatPrice(r.belop)}
                            {r.test ? " · test" : ""}
                          </option>
                        ))}
                        {markertBetalt.length > 0 && (
                          <optgroup label="Allerede betalt (ingen ny e-post)">
                            {markertBetalt.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.id} · {r.navn}
                                {r.vippsNavn ? ` (betalt av ${r.vippsNavn})` : ""}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </td>
                    <td className="handlinger">
                      <button
                        className={`mini ${bekreft === b.bankId ? "ok" : ""}`}
                        disabled={jobber || !v}
                        onClick={() => {
                          if (bekreft !== b.bankId) return setBekreft(b.bankId)
                          setBekreft("")
                          kall({ action: "koble", id: v, bankId: b.bankId }, "kobling", last)
                        }}
                      >
                        {bekreft === b.bankId ? "Trykk igjen for å koble" : "Koble"}
                      </button>
                      <button
                        className="mini"
                        disabled={jobber}
                        onClick={() => kall({ action: "ignorer", bankId: b.bankId }, "kobling", last)}
                      >
                        Ignorer
                      </button>
                      {b.navn.trim().split(/\s+/).length > 1 && (
                        <button
                          className="mini"
                          disabled={jobber}
                          title="Skjul alle innbetalinger fra dette navnet i listen. De kobles som vanlig."
                          onClick={() => kall({ action: "innstillinger", skjulNavn: b.navn }, "egne", last)}
                        >
                          Skjul navnet
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {vis("kobling")}

      <h3 className="under-tittel">Banken (SpareBank 1)</h3>
      <div className="liten">
        Med banken koblet til finner Vipps privat betalingene selv. Backend leser
        bare innbetalinger på kontoen du velger, og flytter aldri penger.
      </div>

      <div className={`bank-kort ${tilstand}`}>
        <div className="bank-hode">
          <span className="bank-prikk" aria-hidden="true" />
          <div className="bank-tittel">
            <b>{status[0]}</b>
            <span>{status[1]}</span>
          </div>
          <button className="mini" disabled={jobber} onClick={last}>
            Oppdater
          </button>
        </div>

        <dl className="bank-fakta">
          {fakta.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        {bank.tilkoblet && (
          <div className="bank-knapper">
            <button
              className={`mini ${tilstand === "halv" ? "ok" : ""}`}
              disabled={jobber}
              onClick={() => kall({ action: "bankkontoer" }, "bank", (d) => setKontoer(d.kontoer))}
            >
              Velg konto
            </button>
            {bank.klar && (
              <button
                className="mini"
                disabled={jobber}
                onClick={() =>
                  kall({ action: "banktest" }, "bank", async (d) => {
                    setRaa(d.eksempler.map((x) => JSON.stringify(x.raa, null, 2)).join("\n\n"))
                    await last()
                  })
                }
              >
                Test banken
              </button>
            )}
          </div>
        )}
        {kontoer && (
          <select
            className="handling-velger bank-konto"
            aria-label="Konto for Vipps-innbetalinger"
            value={kontoer.find((x) => x.valgt)?.key || ""}
            onChange={(e) =>
              kall({ action: "bankkontoer", key: e.target.value }, "bank", async (d) => {
                setKontoer(d.kontoer)
                await last()
              })
            }
          >
            <option value="">Velg kontoen Vipps-pengene kommer inn på …</option>
            {kontoer.map((x) => (
              <option key={x.key} value={x.key}>
                {x.navn} {x.nummer}
              </option>
            ))}
          </select>
        )}
        {vis("bank")}
        {raa && <pre className="bank-raa">{raa}</pre>}
      </div>

      <details className="bank-oppsett" open={!bank.tilkoblet || bank.feil}>
        <summary>{bank.tilkoblet ? "Koble til på nytt eller bytt klient" : "Slik kobler du til banken"}</summary>
        <ol className="bank-steg">
          <li>
            <b>Lag en klient hos SpareBank 1</b>
            <span>
              Gå til{" "}
              <a href="https://developer.sparebank1.no" target="_blank" rel="noreferrer">
                developer.sparebank1.no
              </a>
              , trykk «Create new client» og velg banken kontoen din er i. Bruk en
              egen klient for juletreffet.
            </span>
          </li>
          <li>
            <b>Lim inn denne redirect-adressen på klienten</b>
            <div className="kopi-rad">
              <code>{redirect}</code>
              <button type="button" className={`mini ${kopiert ? "ok" : ""}`} onClick={kopierRedirect}>
                {kopiert ? "Kopiert!" : "Kopier"}
              </button>
            </div>
          </li>
          <li>
            <b>Lim inn opplysningene fra klienten</b>
            <div className="bank-felt">
              <label>
                Klient-ID
                <input
                  type="text"
                  autoComplete="off"
                  placeholder={bank.klientId ? "Lagret. Lim inn for å bytte" : "Client ID"}
                  value={klient.klientId}
                  onChange={(e) => setKlient({ ...klient, klientId: e.target.value })}
                />
              </label>
              <label>
                Klienthemmelighet
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={bank.hemmelighet ? "Lagret. Lim inn for å bytte" : "Client secret"}
                  value={klient.hemmelighet}
                  onChange={(e) => setKlient({ ...klient, hemmelighet: e.target.value })}
                />
              </label>
              <label>
                <span>
                  Bank-ID <i>(valgfritt)</i>
                </span>
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="Tom hvis portalen ikke viser en"
                  value={klient.finInst ?? bank.finInst ?? ""}
                  onChange={(e) => setKlient({ ...klient, finInst: e.target.value })}
                />
              </label>
            </div>
          </li>
          <li>
            <b>Logg inn med BankID</b>
            <span>Det åpnes en ny fane. Kom tilbake hit når den sier at banken er koblet til.</span>
            <div>
              <button className="mini ok stor" disabled={jobber} onClick={kobleTilBanken}>
                Koble til banken
              </button>
            </div>
          </li>
        </ol>
      </details>
    </section>
  )
}
