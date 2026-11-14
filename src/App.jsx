import { Suspense, lazy, useCallback, useEffect, useState } from "react"
import "./App.css"
import { setupFloatingLabels } from "./labelFloat.js"
import { setupFaqAccordion } from "./faqAccordion.js"
import { apiGet, apiPost, kilde, trackVisit } from "./api.js"
import {
  API_URL,
  DEFAULTS,
  KONTAKT_EPOST,
  formatPrice,
} from "./config.js"
import VippsPayment from "./VippsPayment.jsx"

// Admin og vilkår lastes bare når de åpnes, så forsiden blir mindre og raskere
const AdminStats = lazy(() => import("./AdminStats.jsx"))
const AdminLogin = lazy(() => import("./AdminLogin.jsx"))
const LegalPage = lazy(() => import("./LegalPage.jsx"))

// Bildene i full kvalitet
const IMAGES = ["images/kumi.jpeg", "images/munch.jpg"]

// Teksten i FAQ-en «Blir det underholdning?»
const UNDERHOLDNING =
  "Ja! Underholdning er inkludert i prisen. Mer om hva som skjer i løpet av kvelden kommer snart."
const OKT_KEY = "juletreff-admin-okt"

function viewFromHash() {
  const h = window.location.hash.replace("#", "")
  if (h === "admin" || window.location.pathname.includes("/admin")) return "admin"
  if (h === "vilkar" || h === "personvern") return h
  return "main"
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
  "ubetalt",
  "venter",
  "sjekker",
  "waitlist",
  "duplicate",
  "stengt",
  "redirect",
]

export default function App() {
  const [view, setView] = useState(viewFromHash)
  const [okt, setOkt] = useState(readOkt)
  const [info, setInfo] = useState({ ...DEFAULTS, ledige: null, fullt: false })
  // null | sending | redirect | sjekker | betalt | ubetalt | venter | avbrutt | waitlist | duplicate | stengt | error
  const [status, setStatus] = useState(null)
  const [errorText, setErrorText] = useState("")
  const [detaljer, setDetaljer] = useState(null)
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
    apiGet({ action: "info" })
      .then((d) => {
        if (!d.ok) return
        setInfo((prev) => ({
          ...prev,
          ...d,
          vippsNummer: d.vippsNummer || prev.vippsNummer,
        }))
        if (d.stengt) setStatus((s) => s ?? "stengt")
      })
      .catch(() => {})
  }, [])

  // Tilbake fra Vipps: ?betaling=JT-1001&k=...
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const id = q.get("betaling")
    const k = q.get("k")
    if (!id || !k) return
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.hash
    )
    setStatus("sjekker")
    let forsok = 0
    let timer
    const sjekk = () => {
      apiGet({ action: "status", id, k })
        .then((d) => {
          if (!d.ok) throw new Error(d.error)
          setDetaljer({ ...d, id })
          if (d.status === "BETALT") setStatus("betalt")
          else if (d.status === "UBETALT") setStatus("ubetalt")
          else if (d.status === "VENTER" && forsok++ < 20)
            timer = setTimeout(sjekk, 2500)
          else if (d.status === "VENTER") setStatus("venter")
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
  useEffect(() => {
    if (view !== "main") return
    const teardownLabels = setupFloatingLabels()
    const teardownFaq = setupFaqAccordion()
    return () => {
      teardownLabels?.()
      teardownFaq?.()
    }
  }, [view, skjemaSynlig])

  const handleSubmit = async (e) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    setStatus("sending")
    setErrorText("")
    try {
      if (!API_URL) throw new Error("Påmeldingen er ikke koblet til ennå.")
      const d = await apiPost({
        action: "pamelding",
        fornavn: f.get("Fornavn"),
        etternavn: f.get("Etternavn"),
        telefon: f.get("Telefon"),
        epost: f.get("Email"),
        kommentar: f.get("Message"),
        bindende: f.get("Bindende") === "ja",
        kilde: kilde(),
      })
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

  const pris = formatPrice(detaljer?.belop || info.pris)
  const vippsAktiv = !!info.vippsAktiv
  const knappTekst = info.fullt
    ? "Sett meg på venteliste"
    : vippsAktiv
      ? `Meld meg på og betal ${formatPrice(info.pris)}`
      : `Meld meg på · ${formatPrice(info.pris)}`

  const bindendeBoks = (
    <div className="binding-box">
      Påmeldingen er bindende og kan bare trekkes med legeerklæring. Under 48
      timer før arrangementet beholder vi {formatPrice(info.noshow)} til KUMIs
      no-show-gebyr. Se <a href="#vilkar">salgsvilkårene</a>.
    </div>
  )

  return (
    <>
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
                alt="Juletreff på KUMI"
                decoding="async"
                fetchPriority={index === 0 ? "high" : "low"}
              />
            ))}
          </div>

          {/* Skjema */}
          <div className="booking-form">
            <h2>✨Juletreff på KUMI🥂</h2>
            <div className="subheader">{info.dato}</div>

            {skjemaSynlig && (
              <div className="pris">
                <div className="pris-belop">
                  {formatPrice(info.pris)} <span>per person</span>
                </div>
                <p className="pris-inkl">
                  <span>Seks veganske juleretter</span> ·{" "}
                  <span>underholdning</span> · <span>KUMI for oss selv</span>
                </p>
                <p className="pris-frist">
                  {info.fullt ? (
                    "Fullt nå. Du kan stå på venteliste og betaler bare hvis du får plass."
                  ) : (
                    <span>Påmelding innen {info.fristTekst}</span>
                  )}
                  {!info.fullt && info.ledige !== null && info.ledige <= 10 && (
                    <>
                      {" · "}
                      <strong>
                        {info.ledige} {info.ledige === 1 ? "plass" : "plasser"}{" "}
                        igjen
                      </strong>
                    </>
                  )}
                </p>
              </div>
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
                <div className="msg thanks">
                  <h3>🎉 Du er påmeldt! 🎉</h3>
                  <p>Betalingen på {pris} er mottatt.</p>
                  <p>
                    Bekreftelse sendt til {detaljer?.epost || "e-posten din"} 📬
                  </p>
                  <p>
                    <small>Sjekk søppelpost/spam</small>
                  </p>
                </div>
                {bindendeBoks}
              </>
            )}

            {status === "ubetalt" && (
              <>
                <div className="msg thanks">
                  <h3>🎉 Takk for påmeldingen! 🎉</h3>
                  <p>Bekreftelse sendt på e-post 📬</p>
                  <p>
                    <small>Sjekk søppelpost/spam</small>
                  </p>
                </div>
                <VippsPayment
                  belop={detaljer?.belop || info.pris}
                  vippsNummer={detaljer?.vippsNummer || info.vippsNummer}
                  navn={[detaljer?.fornavn, detaljer?.etternavn]
                    .filter(Boolean)
                    .join(" ")}
                  id={detaljer?.id}
                />
                {bindendeBoks}
              </>
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
              <div className="msg wait">
                <h3>⚠️ Juletreffet er fullt</h3>
                <p>
                  Du står på ventelisten. Blir det ledig plass, får du en
                  e-post. Du betaler ingenting før du har fått plass.
                </p>
              </div>
            )}

            {status === "stengt" && (
              <div className="msg wait">
                <h3>Påmeldingen er stengt</h3>
                <p>Fristen for å melde seg på har gått ut.</p>
                {KONTAKT_EPOST && (
                  <p>
                    Spørsmål? Skriv til{" "}
                    <a href={`mailto:${KONTAKT_EPOST}`}>{KONTAKT_EPOST}</a>
                  </p>
                )}
              </div>
            )}

            {status === "duplicate" && (
              <div className="msg error">
                <h3>⚠️ E-post allerede påmeldt!</h3>
                <p>Det ser ut til at denne e-posten er registrert.</p>
                <p>
                  Har du trykket{" "}
                  <a
                    href="https://www.facebook.com/events/664624256515915"
                    target="_blank"
                    rel="noreferrer"
                  >
                    «Skal»
                  </a>{" "}
                  på Facebook-eventet? 📅
                </p>
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
                  <div className="form-group">
                    <input
                      type="tel"
                      name="Telefon"
                      id="phone"
                      autoComplete="tel"
                      inputMode="tel"
                      required
                    />
                    <label htmlFor="phone" className="form-label">
                      Telefon
                    </label>
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
          <div className="map-container">
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d7990.0!2d10.689846816215897!3d59.90700408187198!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x46416e62c48b6a31%3A0xdbadeeb694f9f437!2sOperagata%2071B%2C%200194%20Oslo!5e0!3m2!1sen!2sno!4v1600000000000!5m2!1sen!2sno"
              allowFullScreen=""
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="KUMI kart"
            />
          </div>

          {/* FAQ */}
          <div className="faq-section">
            <h3 style={{ textAlign: "center" }}>❓ FAQ</h3>

            <details>
              <summary className="faq">
                <span>Hvem arrangerer?</span>
                <span className="icon">+</span>
              </summary>

              <div className="faq-body">
                <p>
                  Oslo vegansamfunn, Vegan Norway og Nordisk vegan arrangerer
                  juletreff på KUMI i Oslobukta <b>{info.dato},</b> hvor vi har lokalet for oss
                  selv.
                </p>
                <p>
                  Etterpå går vi videre til{" "}
                  <a
                    href="https://www.tolvteogkranen.no/kranen"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Kranen
                  </a>{" "}
                  Cocktailbar i 13. etasje på <b>MUNCH,</b> ca. 200 meter unna (
                  <i>23 års aldersgrense</i>).
                </p>
                <p>
                  Ønsker du å bli med? Meld deg på via skjemaet over innen{" "}
                  <b>{info.fristTekst},</b> og du vil motta en bekreftelse per
                  e-post.
                </p>
                <p>
                  Det er begrenset antall plasser, så det lønner seg å være
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
                <br />
                <hr />
                <h3>Dessert</h3>
                <p>🍫 Marinerte Appelsiner med Sjokolade- og Appelsinkrem</p>
                <br />
                <hr />
                <p>
                  Har du andre spørsmål om meny? Kontakt KUMI på{" "}
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
                  {formatPrice(info.pris)} per person for seks utvalgte retter i
                  sharing-stil, og underholdning.
                </p>
                <p>
                  {vippsAktiv
                    ? "Du betaler med Vipps når du melder deg på."
                    : `Du betaler med Vipps til nummer #${info.vippsNummer} når du har meldt deg på.`}{" "}
                  Plassen din er sikret når betalingen er mottatt.
                </p>
                <p>
                  Påmeldingen er bindende og kan bare trekkes med
                  legeerklæring. Trekker du deg mer enn 48 timer før, får du
                  hele beløpet tilbake. Senere enn det beholder vi{" "}
                  {formatPrice(info.noshow)} til KUMIs no-show-gebyr. Les mer i{" "}
                  <a href="#vilkar">salgsvilkårene</a>.
                </p>
                <p>
                  Ønsker du vin, øl, eller annen drikke på KUMI kommer dette i
                  tillegg, snakk med personalet 🍷🍾
                </p>
                <p>
                  Du kjøper det du ønsker på Kranen, drikkemeny finner du{" "}
                  <a href="https://drive.google.com/file/d/1ZhKilxdVjzNH5u9K0xigndzo7pTYUKle/view?usp=sharing">
                    her
                  </a>
                </p>
                <br />
                <hr />
                <p>
                  Har du andre spørsmål om pris eller tilbud, kontakt KUMI på{" "}
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
                <p>{UNDERHOLDNING}</p>
              </div>
            </details>

          </div>
        </div>
      </div>

      <footer className="site-footer">
        <a href="#vilkar">Salgsvilkår</a>
        <span>·</span>
        <a href="#personvern">Personvern</a>
        {KONTAKT_EPOST && (
          <>
            <span>·</span>
            <a href={`mailto:${KONTAKT_EPOST}`}>Kontakt</a>
          </>
        )}
      </footer>

      <div className="robot-footer" aria-hidden="true">
        🦾
      </div>
    </>
  )
}
