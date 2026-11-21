import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react"
import "./App.css"
import { setupFloatingLabels } from "./labelFloat.js"
import { setupFaqAccordion } from "./faqAccordion.js"
import { apiGet, apiPost, kilde, trackVisit } from "./api.js"
import {
  API_URL,
  DEFAULTS,
  KONTAKT_EPOST,
  formatPrice,
  telefonSifre,
} from "./config.js"
import { googleKalender } from "./kalender.js"
import ApneINettleser from "./ApneINettleser.jsx"
import VippsPayment from "./VippsPayment.jsx"
import KumiMap from "./KumiMap.jsx"

// Admin og vilkår lastes bare når de åpnes, så forsiden blir mindre og raskere
const AdminStats = lazy(() => import("./AdminStats.jsx"))
const AdminLogin = lazy(() => import("./AdminLogin.jsx"))
const LegalPage = lazy(() => import("./LegalPage.jsx"))

// Bildene i full kvalitet. Matias på scenen er med i karusellen, siden han underholder.
const IMAGES = ["images/kumi.jpeg", "images/matias-konsert.jpg", "images/munch.jpg"]

// «onsdag 16. desember» → «16. des»
const kortDato = (t) => {
  const m = String(t || "").match(/(\d{1,2})\.\s*([a-zæøå]{3})/i)
  return m ? `${m[1]}. ${m[2].toLowerCase()}` : t
}

const OKT_KEY = "juletreff-admin-okt"

function viewFromHash() {
  const h = window.location.hash.replace("#", "")
  if (h === "admin" || window.location.pathname.includes("/admin")) return "admin"
  if (h === "vilkar" || h === "personvern") return h
  return "main"
}

// Testlenke fra admin (?testpris=…): 1 kr for den som har lenken. Huskes for økten, så den
// virker også om siden lastes på nytt eller deltakeren kommer tilbake fra Vipps.
function readTestpris() {
  const fraLenke = new URLSearchParams(window.location.search).get("testpris") || ""
  try {
    if (fraLenke) sessionStorage.setItem("jt_testpris", fraLenke)
    return fraLenke || sessionStorage.getItem("jt_testpris") || ""
  } catch {
    return fraLenke
  }
}

function readOkt() {
  try {
    return sessionStorage.getItem(OKT_KEY) || ""
  } catch {
    return ""
  }
}

// Statuser som skjuler skjemaet
const FERDIG = [
  "betalt",
  "trukket",
  "ubetalt",
  "venter",
  "sjekker",
  "waitlist",
  "duplicate",
  "igjen",
  "stengt",
  "redirect",
]

// Mobil: bildet står over skjemaet. Når innholdet i kolonnen bytter, rulles toppen av kolonnen opp i
// skjermen, så det nye er det man ser. På PC står bildet ved siden av, og der rulles det ikke.
function rullFram(el) {
  if (!el || window.matchMedia?.("(min-width: 769px)").matches) return
  const rolig = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  el.scrollIntoView({ behavior: rolig ? "auto" : "smooth", block: "start" })
}

export default function App() {
  const [view, setView] = useState(viewFromHash)
  const [okt, setOkt] = useState(readOkt)
  const [testpris] = useState(readTestpris)
  const [info, setInfo] = useState({ ...DEFAULTS, ledige: null, fullt: false })
  // null | sending | redirect | sjekker | betalt | ubetalt | venter | avbrutt | waitlist | duplicate | igjen | stengt | error
  const [status, setStatus] = useState(null)
  const [errorText, setErrorText] = useState("")
  const [detaljer, setDetaljer] = useState(null)
  // «igjen»: påmeldt fra før uten å ha betalt. Backend sender betalingslenken på nytt, og sier om den ble sendt.
  const [igjenSendt, setIgjenSendt] = useState(false)
  // «Del med en venn»: "" | "kopiert" | lenken, når den verken kunne deles eller kopieres
  const [delt, setDelt] = useState("")
  // Feilen under telefonfeltet. Vises når feltet forlates eller skjemaet sendes, og går bort så snart nummeret er riktig.
  const [telefonFeil, setTelefonFeil] = useState("")
  const [currentImageIndex, setCurrentImageIndex] = useState(0)

  // Enkel ruting med #admin, #vilkar og #personvern
  useEffect(() => {
    const onHash = () => {
      setView(viewFromHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  // Pris, dato og ledige plasser fra backend, og anonym besøkstelling
  useEffect(() => {
    trackVisit()
    apiGet(testpris ? { action: "info", testpris } : { action: "info" })
      .then((d) => {
        if (!d.ok) return
        setInfo((prev) => ({
          ...prev,
          ...d,
        }))
        if (d.stengt) setStatus((s) => s ?? "stengt")
      })
      .catch(() => {})
  }, [testpris])

  // Betalingssiden: ?betaling=JT-1001&k=... Hit kommer deltakeren tilbake fra Vipps bedrift, fra
  // betalingslenken i e-posten, og etter påmeldingen med Vipps privat. Adressen beholdes, så siden
  // viser det samme om den lastes på nytt, for eksempel når nettleseren inne i en app kommer tilbake fra Vipps.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const id = q.get("betaling")
    const k = q.get("k")
    if (!id || !k) return
    setStatus("sjekker")
    let forsok = 0
    let timer
    const sjekk = () => {
      apiGet({ action: "status", id, k })
        .then((d) => {
          if (!d.ok) throw new Error(d.error)
          setDetaljer({ ...d, id, k, fraLenke: true })
          if (d.status === "BETALT") setStatus("betalt")
          else if (d.status === "UBETALT") setStatus("ubetalt")
          else if (d.status === "VENTER" && forsok++ < 20)
            timer = setTimeout(sjekk, 2500)
          else if (d.status === "VENTER") setStatus("venter")
          else if (d.status === "VENTELISTE") setStatus("waitlist")
          else if (d.status === "TRUKKET") setStatus("trukket")
          else setStatus("avbrutt")
        })
        .catch(() => {
          if (forsok++ < 5) timer = setTimeout(sjekk, 3000)
          else setStatus("venter")
        })
    }
    sjekk()
    return () => clearTimeout(timer)
  }, [])

  // Vipps privat: mens betalingsboksen vises, spør siden om betalingen er kommet. Backend spør banken
  // høyst hvert 20. sekund. Hvert 10. sekund den første timen, deretter hvert minutt, og med en gang
  // når deltakeren kommer tilbake fra Vipps-appen.
  const ventId = status === "ubetalt" ? detaljer?.id : null
  const ventK = status === "ubetalt" ? detaljer?.k : null
  const automatisk = !!detaljer?.betalingsinfo?.automatisk
  useEffect(() => {
    if (!ventId || !ventK) return
    const startet = Date.now()
    let timer
    let stopp = false
    const planlegg = (ms) => {
      clearTimeout(timer)
      if (!stopp) timer = setTimeout(sjekk, ms)
    }
    const sjekk = () => {
      apiGet({ action: "status", id: ventId, k: ventK, sjekk: automatisk ? "1" : "" })
        .then((d) => {
          if (stopp || !d.ok) return
          if (d.status === "BETALT") {
            setDetaljer((x) => ({ ...x, ...d }))
            setStatus("betalt")
            return
          }
          if (document.visibilityState !== "hidden")
            planlegg(automatisk && Date.now() - startet < 36e5 ? 10000 : 60000)
        })
        .catch(() => planlegg(15000))
    }
    const synlig = () => {
      if (document.visibilityState !== "visible") return
      planlegg(300)
    }
    document.addEventListener("visibilitychange", synlig)
    planlegg(automatisk ? 5000 : 30000)
    return () => {
      stopp = true
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", synlig)
    }
  }, [ventId, ventK, automatisk])

  // Fade mellom bilder hvert 4 sekund (bare på forsiden)
  useEffect(() => {
    if (view !== "main") return
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % IMAGES.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [view])

  // Flytende etiketter og FAQ må kobles på nytt når forsiden vises
  const skjemaSynlig = view === "main" && !FERDIG.includes(status)
  const betalingPagar = ["sjekker", "redirect", "ubetalt", "venter"].includes(status)
  useEffect(() => {
    if (view !== "main") return
    const teardownLabels = setupFloatingLabels()
    const teardownFaq = setupFaqAccordion()
    return () => {
      teardownLabels?.()
      teardownFaq?.()
    }
  }, [view, skjemaSynlig])

  // PC: bildet er like høyt som kolonnen ved siden av. Høyden skjemaet hadde da man meldte seg på, holdes
  // gjennom betalingen, så bildet ikke blir høyere eller lavere, og dermed mer eller mindre zoomet, når innholdet bytter.
  // Kommer man rett til betalingen fra e-posten, har man ikke sett skjemaet, og da er det ingenting å holde.
  const skjemaRef = useRef(null)
  const [skjemaHoyde, setSkjemaHoyde] = useState(0)

  // Mobil: det nye innholdet rulles opp i skjermen når kolonnen bytter: betalingen etter påmeldingen,
  // «Du er påmeldt» når betalingen er kommet, og meldinger som «E-post allerede påmeldt». Kommer man fra
  // betalingslenken i e-posten og har begynt å rulle selv mens siden lastet, blir man der man er.
  const rullTilKolonnen = useCallback(() => rullFram(skjemaRef.current), [])
  const forrigeStatus = useRef(status)
  useEffect(() => {
    const fra = forrigeStatus.current
    forrigeStatus.current = status
    if (fra === status || ["sending", "redirect", "sjekker"].includes(status)) return
    if (fra === "sjekker" && window.scrollY > 40) return
    rullTilKolonnen()
  }, [status, rullTilKolonnen])

  const TELEFON_FEIL = "Telefonnummeret må ha 8 sifre"
  // Tomt felt er ikke en feil her: da sier nettleseren fra ved innsending, som for de andre feltene.
  const sjekkTelefon = (verdi) => {
    const feil = String(verdi || "").trim() && !telefonSifre(verdi) ? TELEFON_FEIL : ""
    setTelefonFeil(feil)
    return !feil
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    // Telefonnummeret sjekkes før noe sendes. Feilen står under feltet, og markøren settes i feltet.
    const telefon = telefonSifre(f.get("Telefon"))
    if (!telefon) {
      setTelefonFeil(TELEFON_FEIL)
      e.currentTarget.elements.namedItem("Telefon")?.focus()
      return
    }
    // Bare med bildet ved siden av skjemaet. På mobil står bildet over og påvirkes ikke.
    const toKolonner = window.matchMedia?.("(min-width: 769px)").matches
    setSkjemaHoyde(toKolonner ? Math.round(skjemaRef.current?.getBoundingClientRect().height || 0) : 0)
    setStatus("sending")
    setErrorText("")
    try {
      if (!API_URL) throw new Error("Påmeldingen er ikke koblet til ennå.")
      const d = await apiPost({
        action: "pamelding",
        fornavn: f.get("Fornavn"),
        etternavn: f.get("Etternavn"),
        telefon,
        epost: f.get("Email"),
        kommentar: f.get("Message"),
        bindende: f.get("Bindende") === "ja",
        kilde: kilde(),
        nettside: f.get("Nettside"), // felle for roboter, skal være tom
        testpris,
      })
      if (d.duplicate && d.ubetalt) {
        setIgjenSendt(!!d.sendt)
        return setStatus("igjen")
      }
      if (d.duplicate) return setStatus("duplicate")
      if (d.waitlist) return setStatus("waitlist")
      if (d.stengt) return setStatus("stengt")
      if (!d.ok) throw new Error(d.error || "Noe gikk galt")
      if (d.redirectUrl) {
        setStatus("redirect")
        window.location.href = d.redirectUrl
        return
      }
      setDetaljer({
        ...d,
        fornavn: f.get("Fornavn"),
        etternavn: f.get("Etternavn"),
      })
      setStatus("ubetalt")
      // Betalingssiden får sin egen adresse, så den kommer tilbake om siden lastes på nytt.
      if (d.id && d.k) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}?betaling=${encodeURIComponent(d.id)}&k=${encodeURIComponent(d.k)}`
        )
      }
      // PC: til toppen, der betalingen står ved siden av bildet. Mobil rulles til betalingen (se over).
      if (toKolonner) window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (err) {
      setErrorText(err.message)
      setStatus("error")
    }
  }

  const loggInn = (nyOkt) => {
    try {
      sessionStorage.setItem(OKT_KEY, nyOkt)
    } catch {
      // privat modus: innloggingen varer til siden lukkes
    }
    setOkt(nyOkt)
  }

  const loggUt = useCallback(() => {
    if (okt) apiPost({ action: "logout", okt }).catch(() => {})
    try {
      sessionStorage.removeItem(OKT_KEY)
    } catch {
      // ignorer
    }
    setOkt("")
  }, [okt])

  if (view === "admin") {
    return (
      <Suspense fallback={null}>
        {okt ? (
          <AdminStats okt={okt} onLogout={loggUt} />
        ) : (
          <AdminLogin onLoginSuccess={loggInn} />
        )}
      </Suspense>
    )
  }

  if (view === "vilkar" || view === "personvern") {
    return (
      <Suspense fallback={null}>
        <LegalPage page={view} info={info} />
      </Suspense>
    )
  }

  const kontakt = info.kontaktEpost || KONTAKT_EPOST
  const pris = formatPrice(detaljer?.belop || info.pris)
  const vippsAktiv = !!info.vippsAktiv
  const knappTekst = info.fullt
    ? "Sett meg på venteliste"
    : vippsAktiv
      ? `Meld meg på og betal ${formatPrice(info.pris)}`
      : `Meld meg på · ${formatPrice(info.pris)}`

  // «Del med en venn»: åpner delingen på telefonen. Uten den (de fleste PC-er) kopieres lenken.
  // Lenken er alltid forsiden, aldri adressen med betalingsnøkkelen som står i nettleseren nå.
  const delMedVenn = async () => {
    const url = new URL(import.meta.env.BASE_URL, window.location.origin).href
    const naar = info.dato ? ` ${info.dato.charAt(0).toLowerCase()}${info.dato.slice(1)}` : ""
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Juletreff på KUMI",
          text: `Jeg skal på Juletreff på KUMI${naar}. Blir du med?`,
          url,
        })
        return
      } catch (err) {
        if (err?.name === "AbortError") return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setDelt("kopiert")
      setTimeout(() => setDelt(""), 3000)
    } catch {
      setDelt(url)
    }
  }

  // Påmeldt → Betal → Plassen er din. Vises over betalingsboksen, så det er tydelig hva som gjenstår.
  const fremdrift = (betalt) => (
    <ol className="fremdrift" aria-label="Påmeldingen">
      <li className="ferdig">
        <span aria-hidden="true">✓</span>Påmeldt
      </li>
      <li className={betalt ? "ferdig" : "aktiv"} aria-current={betalt ? undefined : "step"}>
        <span aria-hidden="true">{betalt ? "✓" : "2"}</span>{betalt ? "Betalt" : "Betal"}
      </li>
      <li className={betalt ? "ferdig" : ""} aria-current={betalt ? "step" : undefined}>
        <span aria-hidden="true">{betalt ? "✓" : "3"}</span>Plassen er din
      </li>
    </ol>
  )

  const bindendeBoks = (
    <div className="binding-box">
      Påmeldingen er bindende og kan bare trekkes med legeerklæring. Under 48
      timer før arrangementet beholder vi {formatPrice(info.noshow)} til KUMIs{" "}
      <span className="nowrap">no-show-gebyr</span>. Se <a href="#vilkar">salgsvilkårene</a>.
    </div>
  )

  return (
    <>
      <ApneINettleser />
      <div className="page">
        <div className="container">
          {/* Bilde med fade */}
          <div className="booking-image">
            {IMAGES.map((src, index) => (
              <img
                key={src}
                className={`booking-img ${
                  index === currentImageIndex ? "active" : ""
                }`}
                src={src}
                alt={src.includes("matias") ? "Matias opptrer med mikrofon" : "Juletreff på KUMI"}
                decoding="async"
                fetchPriority={index === 0 ? "high" : "low"}
              />
            ))}
          </div>

          {/* Skjema */}
          <div
            ref={skjemaRef}
            className={`booking-form${betalingPagar ? " betaling" : ""}`}
            style={!skjemaSynlig && skjemaHoyde ? { "--skjema-h": `${skjemaHoyde}px` } : undefined}
          >
            {/* Mens betalingen pågår, trengs plassen til betalingen. Overskriften og datoen kommer tilbake når den er registrert. */}
            {!betalingPagar && (
              <>
                {/* Hva kvelden er, smått over navnet. Datoen og faktastripen sier resten. */}
                <p className="overtittel">Vegansk julebord</p>
                <h2 className="tittel">✨Juletreff på KUMI🥂</h2>
                <div className="subheader">{info.dato}</div>
              </>
            )}

            {(info.test || detaljer?.test) && (
              <div className="test-banner" role="note">
                <b>Testmodus: {formatPrice(detaljer?.belop || info.pris)}</b>
                <span>
                  Merkes som test, tar ikke plass og telles ikke. Ellers virker alt
                  som for ekte, også Vipps, banken og e-postene.
                </span>
              </div>
            )}

            {skjemaSynlig && (
              <>
                <dl className="fakta">
                  <div>
                    <dt>per person</dt>
                    <dd>{formatPrice(info.pris)}</dd>
                  </div>
                  <div>
                    <dt>+ underholdning</dt>
                    <dd>6 retter</dd>
                  </div>
                  <div>
                    <dt>påmeldingsfrist</dt>
                    <dd>{kortDato(info.fristTekst)}</dd>
                  </div>
                </dl>
                {(info.fullt || (info.ledige !== null && info.ledige <= 10)) && (
                  <p className="fakta-status">
                    {info.fullt
                      ? "Fullt nå. Meld deg på ventelisten, du betaler bare hvis du får plass."
                      : `Bare ${info.ledige} ${info.ledige === 1 ? "plass" : "plasser"} igjen`}
                  </p>
                )}
              </>
            )}

            {status === "sjekker" && (
              <div className="msg">
                <h3>Sjekker betalingen …</h3>
                <p>Dette tar bare noen sekunder.</p>
              </div>
            )}

            {status === "redirect" && (
              <div className="msg">
                <h3>Sender deg til Vipps …</h3>
              </div>
            )}

            {status === "betalt" && (
              <>
                {fremdrift(true)}
                <div className="msg thanks">
                  <h3>🎉 Du er påmeldt! 🎉</h3>
                  <p>Betalingen på {pris} er mottatt.</p>
                  <p>
                    Bekreftelse sendt til {detaljer?.epost || "e-posten din"} 📬
                  </p>
                  <p>
                    <small>Sjekk søppelpost/spam</small>
                  </p>
                  {/* iPhone, Mac og Outlook åpner .ics-fila. Google får sin egen lenke, som også virker på Android. */}
                  <p className="kalender">
                    <span>📅 Legg i kalenderen:</span>{" "}
                    <span className="kalender-valg">
                      <a href={`${import.meta.env.BASE_URL}juletreff.ics`}>Apple</a>
                      {" · "}
                      <a href={googleKalender()} target="_blank" rel="noreferrer">
                        Google
                      </a>
                      {" · "}
                      <a href={`${import.meta.env.BASE_URL}juletreff.ics`}>Outlook</a>
                    </span>
                  </p>
                  <p className="del">
                    <button type="button" className="del-knapp" onClick={delMedVenn} aria-live="polite">
                      {delt === "kopiert" ? "Lenken er kopiert" : "Del med en venn"}
                    </button>
                  </p>
                  {delt && delt !== "kopiert" && <p className="del-lenke">{delt}</p>}
                </div>
                {bindendeBoks}
              </>
            )}

            {status === "ubetalt" && (
              <>
                {fremdrift(false)}
                <VippsPayment
                  onBytt={rullTilKolonnen}
                  info={detaljer?.betalingsinfo}
                  id={detaljer?.id}
                  k={detaljer?.k}
                  lead={
                    detaljer?.fraLenke
                      ? "Plassen din er reservert."
                      : ""
                  }
                  // Bare under betalingsstegene: den som venter på at betalingen skal bli registrert, trenger ikke lese om e-posten.
                  notis={
                    detaljer?.fraLenke
                      ? ""
                      : detaljer?.epostVent
                        ? `📬 Betaler du ikke nå, sender vi betalingsinfoen til ${detaljer?.epost || "e-posten din"} om ${detaljer.epostVent} minutter.`
                        : `📬 Betalingsinfoen er også sendt til ${detaljer?.epost || "e-posten din"} (sjekk søppelpost).`
                  }
                />
              </>
            )}

            {status === "trukket" && (
              <div className="msg wait">
                <h3>Påmeldingen er trukket</h3>
                <p>Denne påmeldingen gjelder ikke lenger.</p>
                {kontakt && (
                  <p>
                    Spørsmål? Skriv til{" "}
                    <a href={`mailto:${kontakt}`}>{kontakt}</a>
                  </p>
                )}
              </div>
            )}

            {status === "venter" && (
              <div className="msg">
                <h3>Betalingen er ikke fullført ennå</h3>
                <p>
                  Godkjente du i Vipps, får du bekreftelsen på e-post i løpet
                  av noen minutter.
                </p>
                <p>
                  <button className="link-btn" onClick={() => setStatus(null)}>
                    Meld deg på på nytt
                  </button>
                </p>
              </div>
            )}

            {status === "avbrutt" && (
              <div className="msg error">
                <h3>Betalingen ble avbrutt</h3>
                <p>Ingen penger er trukket, og du er ikke påmeldt.</p>
              </div>
            )}

            {status === "waitlist" && (
              <div className="msg">
                <span className="msg-hake" aria-hidden="true">✓</span>
                <h3>Du står på ventelisten</h3>
                <p>
                  Juletreffet er fullt akkurat nå. Blir det ledig plass, får du
                  e-post, og du betaler først da.
                </p>
              </div>
            )}

            {status === "stengt" && (
              <div className="msg wait">
                <h3>Påmeldingen er stengt</h3>
                <p>Fristen for å melde seg på har gått ut.</p>
                {kontakt && (
                  <p>
                    Spørsmål? Skriv til{" "}
                    <a href={`mailto:${kontakt}`}>{kontakt}</a>
                  </p>
                )}
              </div>
            )}

            {status === "igjen" && (
              <div className="msg">
                {igjenSendt ? (
                  <>
                    <h3>Sjekk e-posten din</h3>
                    <p>
                      Du er påmeldt, men vi har ikke fått betalingen ennå. Vi har
                      sendt betalingslenken til e-posten din.
                    </p>
                    <p>
                      <small>Sjekk søppelpost/spam</small>
                    </p>
                  </>
                ) : (
                  <>
                    <h3>Du er påmeldt</h3>
                    <p>
                      Men vi har ikke fått betalingen ennå, og vi fikk ikke sendt
                      betalingslenken akkurat nå.{" "}
                      {kontakt ? (
                        <>
                          Skriv til <a href={`mailto:${kontakt}`}>{kontakt}</a>,
                          så hjelper vi deg.
                        </>
                      ) : (
                        "Prøv igjen om litt."
                      )}
                    </p>
                  </>
                )}
              </div>
            )}

            {status === "duplicate" && (
              <div className="msg error">
                <h3>⚠️ E-post allerede påmeldt!</h3>
                <p>Det ser ut til at denne e-posten er registrert.</p>
                {info.facebookUrl && (
                  <p>
                    Har du trykket{" "}
                    <a href={info.facebookUrl} target="_blank" rel="noreferrer">
                      «Skal»
                    </a>{" "}
                    på Facebook-eventet? 📅
                  </p>
                )}
              </div>
            )}

            {status === "error" && (
              <div className="msg error form-error">
                <h3>⚠️ Noe gikk galt</h3>
                <p>{errorText || "Prøv igjen senere eller kontakt oss."}</p>
              </div>
            )}

            {skjemaSynlig && (
              <form onSubmit={handleSubmit}>
                <div className="form-group-row">
                  <div className="form-group">
                    <input
                      type="text"
                      name="Fornavn"
                      id="firstName"
                      autoComplete="given-name"
                      required
                    />
                    <label htmlFor="firstName" className="form-label">
                      Navn
                    </label>
                  </div>
                  <div className="form-group">
                    <input
                      type="text"
                      name="Etternavn"
                      id="lastName"
                      autoComplete="family-name"
                      required
                    />
                    <label htmlFor="lastName" className="form-label">
                      Etternavn
                    </label>
                  </div>
                </div>

                <div className="form-group-row">
                  <div className={`form-group${telefonFeil ? " har-feil" : ""}`}>
                    <input
                      type="tel"
                      name="Telefon"
                      id="phone"
                      autoComplete="tel"
                      inputMode="tel"
                      required
                      aria-invalid={telefonFeil ? "true" : undefined}
                      aria-describedby={telefonFeil ? "phone-feil" : undefined}
                      onBlur={(e) => sjekkTelefon(e.target.value)}
                      onInput={(e) => telefonFeil && sjekkTelefon(e.target.value)}
                    />
                    <label htmlFor="phone" className="form-label">
                      Telefon
                    </label>
                    {/* Står alltid i siden, så skjermlesere leser opp feilen når den kommer */}
                    <p id="phone-feil" className="felt-feil" aria-live="polite">
                      {telefonFeil}
                    </p>
                  </div>
                  <div className="form-group">
                    <input
                      type="email"
                      name="Email"
                      id="email"
                      autoComplete="email"
                      inputMode="email"
                      autoCapitalize="none"
                      spellCheck="false"
                      required
                    />
                    <label htmlFor="email" className="form-label">
                      E-post
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <textarea name="Message" id="comment" rows="4"></textarea>
                  <label htmlFor="comment" className="form-label">
                    Kommentar (f.eks. allergier)
                  </label>
                </div>

                <div className="felle" aria-hidden="true">
                  <label htmlFor="nettside">Nettside (la stå tom)</label>
                  <input type="text" name="Nettside" id="nettside" tabIndex={-1} autoComplete="off" />
                </div>

                <label className="binding-check">
                  <input type="checkbox" name="Bindende" value="ja" required />
                  <span>
                    Jeg godtar <a href="#vilkar">salgsvilkårene</a> og at
                    påmeldingen er bindende (unntak ved legeerklæring).
                  </span>
                </label>

                <div className="form-submit">
                  <button
                    type="submit"
                    className={vippsAktiv && !info.fullt ? "vipps-submit" : ""}
                    disabled={status === "sending"}
                  >
                    {status === "sending" ? "Sender …" : knappTekst}
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Kart */}
          <KumiMap />

          {/* FAQ */}
          <div className="faq-section">
            <h3 style={{ textAlign: "center" }}>❓ FAQ</h3>

            <details>
              <summary className="faq">
                <span>Om kvelden</span>
                <span className="icon">+</span>
              </summary>

              <div className="faq-body">
                <p>
                  Oslo vegansamfunn, Vegan Norway og Nordisk vegan arrangerer
                  juletreff på KUMI i Oslobukta <b>{info.dato},</b> med lokalet for oss selv.
                </p>
                <p>
                  Etterpå går vi til{" "}
                  <a
                    href="https://www.munch.no/mat-drikke-MUNCH/munch-bar/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    MUNCH bar
                  </a>{" "}
                  i 13. etasje på <b>MUNCH,</b> ca. 200 meter unna (
                  <i>20 års aldersgrense</i>).
                </p>
                <p>
                  Meld deg på i skjemaet over innen <b>{info.fristTekst},</b> så
                  får du bekreftelse på <span className="nowrap">e-post</span>. Plassene er begrenset, så vær
                  tidlig ute! Inviter gjerne med deg en venn 💚
                </p>
              </div>
            </details>

            <details>
              <summary className="faq">
                <span>Hva står på menyen?</span>
                <span className="icon">+</span>
              </summary>

              <div className="faq-body">
                <p>
                  Les mer om menyen{" "}
                  <a
                    href="https://kumi.no/christmas-party/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    her
                  </a>
                </p>
                <hr />
                <h3>Hovedretter</h3>
                <p>
                  🌰 Nøttestek
                  <br />
                  🥬 Hjemmelaget Rødkål
                  <br />
                  🍊 Dampede Rosenkål med Appelsinsalat
                  <br />
                  🌱 Veganske Patties
                  <br />
                  🥔 Ovnsbakte Poteter med Urter
                  <br />
                  🍷 Rødvinssaus
                </p>
                <hr />
                <h3>Dessert</h3>
                <p>🍫 Marinerte Appelsiner med Sjokolade- og Appelsinkrem</p>
                <hr />
                <p>
                  Spørsmål om menyen? Kontakt KUMI på{" "}
                  <a href="mailto:kumi@kumi.no">kumi@kumi.no</a> eller{" "}
                  <a href="tel:+4797302866">973 02 866</a>
                </p>
              </div>
            </details>

            <details>
              <summary className="faq">
                <span>Hva koster det?</span>
                <span className="icon">+</span>
              </summary>

              <div className="faq-body">
                <p>
                  {formatPrice(info.pris)} per person for seks retter i{" "}
                  <span className="nowrap">sharing-stil</span> og underholdning.
                </p>
                <p>
                  {vippsAktiv
                    ? "Du betaler med Vipps når du melder deg på."
                    : "Etter påmeldingen får du en knapp som åpner Vipps med nummeret fylt ut (QR-kode på PC), og det samme på e-post."}
                </p>
                <p className="faq-uthevet">
                  <b>Plassen din er sikret når betalingen er mottatt!</b>
                </p>
                <p>
                  Påmeldingen er bindende og kan bare trekkes med legeerklæring. Les mer i{" "}
                  <a href="#vilkar">salgsvilkårene</a>.
                </p>
                <p>
                  Vin, øl og annen drikke på KUMI kommer i tillegg, snakk med
                  personalet 🍷🍾 På MUNCH bar kjøper du det du vil ha, se{" "}
                  <a
                    href="https://www.munch.no/globalassets/foto-munch/mat-og-drikke/menyer/munch-bar-13th-17.10.pdf"
                    target="_blank"
                    rel="noreferrer"
                  >
                    drikkemenyen
                  </a>
                  .
                </p>
                <hr />
                <p>
                  Spørsmål om pris eller tilbud? Kontakt KUMI på{" "}
                  <a href="mailto:kumi@kumi.no">kumi@kumi.no</a> eller{" "}
                  <a href="tel:+4797302866">973 02 866</a>
                </p>
              </div>
            </details>

            <details>
              <summary className="faq">
                <span>Blir det underholdning?</span>
                <span className="icon">+</span>
              </summary>

              <div className="faq-body">
                <p>Ja! Det er inkludert i prisen.</p>
                <img
                  className="faq-bilde"
                  src="images/matias.jpg"
                  alt="Matias i rød VEGAN-genser"
                  width="900"
                  height="600"
                  loading="lazy"
                  decoding="async"
                />
                <h3>🎤 Matias</h3>
                <p>
                  Matias er dyrerettighetsaktivist, youtuber og artist fra
                  Eidsvoll, bosatt i Oslo. Han blander norskspråklig hiphop og
                  reggae og har opptrådt med egen musikk siden tenårene.
                </p>
                <p>
                  Engasjementet for dyr går igjen i mange av låtene, fra
                  debutalbumet <i>Forandrer fryder</i> i fjor sommer til
                  coverlåta <i>Hva er forskjellen?</i> i vår og <i>Dyrisk</i> i
                  høst.
                </p>
                <p>
                  Han vil lage musikk som inspirerer og betyr noe for andre, og
                  som er terapi og underholdning for ham selv. Hør han på{" "}
                  <a
                    href="https://www.youtube.com/@MatiasHamreSveen"
                    target="_blank"
                    rel="noreferrer"
                  >
                    YouTube
                  </a>
                </p>
              </div>
            </details>

          </div>
        </div>
      </div>

      <footer className="site-footer">
        <a href="#vilkar">Salgsvilkår</a>
        <span>·</span>
        <a href="#personvern">Personvern</a>
        {kontakt && (
          <>
            <span>·</span>
            <a href={`mailto:${kontakt}`}>Kontakt</a>
          </>
        )}
      </footer>

      <div className="robot-footer" aria-hidden="true">
        🦾
      </div>
    </>
  )
}
