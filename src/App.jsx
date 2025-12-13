import { useEffect, useRef, useState } from "react"
import "./App.css"
import { setupFloatingLabels } from "./labelFloat.js"
import { setupFaqAccordion } from "./faqAccordion.js"
import { setupVisitorTracking } from "./visitorTracking.js"
import AdminStats from "./AdminStats.jsx"
import AdminLogin from "./AdminLogin.jsx"

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbzxQuQ6ROWU8dwb_jLSajcpgSL3E8ip8QsyMnfTr1DUbu4NnH0R6D0OWX2G4S8Dg51Z/exec"
const IMAGES = ["images/kumi.jpeg", "images/munch.jpg"]

export default function App() {
  const [status, setStatus] = useState(null) // null | "ok" | "waitlist" | "duplicate" | "error"
  // Hjelpefunksjon: kun sett status hvis ikke allerede waitlist/duplicate/error
  const setStatusOnce = (newStatus) => {
    setStatus((prev) => {
      if (prev === "waitlist" || prev === "duplicate" || prev === "error")
        return prev
      return newStatus
    })
  }
  const [sending, setSending] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [visitorInfo, setVisitorInfo] = useState(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false)
  const iframeRef = useRef(null)

  // Sjekk om admin-siden skal vises
  useEffect(() => {
    const checkAdminRoute = () => {
      const hash = window.location.hash
      const pathname = window.location.pathname
      const shouldShowAdmin = hash === "#admin" || pathname.includes("/admin")
      setShowAdmin(shouldShowAdmin)

      // Sjekk autentisering ved admin-tilgang
      if (shouldShowAdmin) {
        const isAuth = sessionStorage.getItem("juletreff-admin-auth") === "true"
        setIsAdminAuthenticated(isAuth)
      }
    }

    checkAdminRoute()
    window.addEventListener("hashchange", checkAdminRoute)
    return () => window.removeEventListener("hashchange", checkAdminRoute)
  }, [])

  // Fade mellom bilder hvert 4 sekund
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % IMAGES.length)
    }, 4000) // 4000ms = 4 sekunder

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const teardownLabels = setupFloatingLabels()
    const teardownFaq = setupFaqAccordion()

    // Sett opp visitor tracking
    const visitor = setupVisitorTracking()
    setVisitorInfo(visitor)

    return () => {
      teardownLabels?.()
      teardownFaq?.()
    }
  }, [])

  useEffect(() => {
    function onMessage(evt) {
      // Tillat bare Apps Script-domener
      if (!/script\.google\.com|googleusercontent\.com/.test(evt.origin)) return

      const data = evt.data || {}
      setSending(false)

      if (data.duplicate) setStatusOnce("duplicate")
      else if (data.ok && data.waitlist) setStatusOnce("waitlist")
      else if (data.ok) setStatusOnce("ok")
      else setStatusOnce("error")
    }

    // iOS fallback: Sjekk iframe innhold etter en forsinkelse
    function checkIframeContent() {
      if (!iframeRef.current || !sending) return

      try {
        const iframeDoc =
          iframeRef.current.contentDocument ||
          iframeRef.current.contentWindow?.document
        if (iframeDoc) {
          const bodyText = iframeDoc.body?.innerText || ""

          // Prøv å parse respons fra iframe innhold
          if (
            bodyText.includes('"duplicate"') ||
            bodyText.includes("duplicate")
          ) {
            setSending(false)
            setStatusOnce("duplicate")
          } else if (
            bodyText.includes('"waitlist"') &&
            bodyText.includes('"ok"')
          ) {
            setSending(false)
            setStatusOnce("waitlist")
          } else if (
            bodyText.includes('"ok"') ||
            bodyText.includes("success")
          ) {
            setSending(false)
            setStatusOnce("ok")
          } else if (
            bodyText.includes('"error"') ||
            bodyText.includes("error")
          ) {
            setSending(false)
            setStatusOnce("error")
          }
        }
      } catch (error) {
        // Cross-origin eller andre feil - bruk timeout fallback
        console.log("Iframe content check failed, using timeout fallback")
      }
    }

    window.addEventListener("message", onMessage)

    // iOS fallback: Sjekk iframe innhold hver 500ms når vi sender
    let pollInterval
    if (sending) {
      pollInterval = setInterval(checkIframeContent, 500)

      // Timeout fallback hvis ingenting skjer etter 10 sekunder
      setTimeout(() => {
        if (sending) {
          setSending(false)
          setStatus((prev) => {
            // Kun sett ok hvis status fortsatt er null
            if (prev === null) return "ok"
            return prev
          })
        }
      }, 10000)
    }

    return () => {
      window.removeEventListener("message", onMessage)
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [sending])

  const handleFormSubmit = () => {
    setSending(true)

    // iOS Safari fallback: Legg til onload listener på iframe
    if (iframeRef.current) {
      const handleIframeLoad = () => {
        // Vent litt for at innholdet skal være klart
        setTimeout(() => {
          try {
            const iframeDoc =
              iframeRef.current?.contentDocument ||
              iframeRef.current?.contentWindow?.document
            if (iframeDoc) {
              const bodyText = iframeDoc.body?.innerText || ""

              if (bodyText.includes("duplicate")) {
                setSending(false)
                setStatusOnce("duplicate")
              } else if (
                bodyText.includes("waitlist") &&
                bodyText.includes("ok")
              ) {
                setSending(false)
                setStatusOnce("waitlist")
              } else if (
                bodyText.includes("ok") ||
                bodyText.includes("success")
              ) {
                setSending(false)
                setStatusOnce("ok")
              } else if (bodyText.includes("error")) {
                setSending(false)
                setStatusOnce("error")
              }
            }
          } catch (error) {
            // Fallback til suksess etter timeout hvis vi ikke kan lese iframe
            setTimeout(() => {
              if (sending) {
                setSending(false)
                setStatus((prev) => {
                  if (prev === null) return "ok"
                  return prev
                })
              }
            }, 5000)
          }
        }, 1000)
      }

      iframeRef.current.onload = handleIframeLoad
    }
  }

  const handleAdminLogin = () => {
    setIsAdminAuthenticated(true)
  }

  return (
    <>
      {showAdmin ? (
        isAdminAuthenticated ? (
          <AdminStats />
        ) : (
          <AdminLogin onLoginSuccess={handleAdminLogin} />
        )
      ) : (
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
                    alt={`Juletreff 2025`}
                    loading={index === currentImageIndex ? undefined : "lazy"}
                  />
                ))}
              </div>

              {/* Skjema */}
              <div className="booking-form">
                <h2>✨Juletreff på KUMI🥂</h2>
                <div className="subheader">19. desember kl 19.00</div>

                {/* Vis kun venteliste-melding hvis status er 'waitlist' */}
                {status === "waitlist" ? (
                  <div className="msg wait">
                    <h3>⚠️ Juletreffet er fullt</h3>
                    <p>
                      Du kan sette deg på venteliste ved å sende oss en e-post.
                    </p>
                    <p>
                      <a
                        href={`mailto:isabelle.haugan@gmail.com?subject=Venteliste%20juletreff%20KUMI%20🥂`}
                      >
                        Sett meg på venteliste 🥳
                      </a>
                    </p>
                  </div>
                ) : (
                  <>
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
                    {status === "ok" && (
                      <div className="msg thanks">
                        <h3>🎉 Takk for påmeldingen! 🎉</h3>
                        <p>Bekreftelse sendt på e-post 📬</p>
                        <p>
                          <small>Sjekk søppelpost/spam</small>
                        </p>
                      </div>
                    )}
                    {status === "error" && (
                      <div className="msg error">
                        <h3>⚠️ Noe gikk galt</h3>
                        <p>Prøv igjen senere eller kontakt oss.</p>
                      </div>
                    )}
                  </>
                )}

                {/* Skjult iframe: mottar Apps Script-responsen */}
                <iframe
                  name="hidden_iframe"
                  title="hidden_iframe"
                  ref={iframeRef}
                  style={{ display: "none", width: 0, height: 0, border: 0 }}
                />

                {/* IMPORTANT: action = GAS_URL, target = hidden_iframe */}
                <form
                  action={GAS_URL}
                  method="POST"
                  target="hidden_iframe"
                  onSubmit={handleFormSubmit}
                  style={{ display: status ? "none" : "block" }}
                >
                  <div className="form-group-row">
                    <div className="form-group">
                      <input
                        type="text"
                        name="Fornavn"
                        id="firstName"
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
                        required
                      />
                      <label htmlFor="lastName" className="form-label">
                        Etternavn
                      </label>
                    </div>
                  </div>

                  <div className="form-group-row">
                    <div className="form-group">
                      <input type="tel" name="Telefon" id="phone" required />
                      <label htmlFor="phone" className="form-label">
                        Telefon
                      </label>
                    </div>
                    <div className="form-group">
                      <input type="email" name="Email" id="email" required />
                      <label htmlFor="email" className="form-label">
                        E-post
                      </label>
                    </div>
                  </div>

                  <div className="form-group">
                    <textarea name="Message" id="comment" rows="4"></textarea>
                    <label htmlFor="comment" className="form-label">
                      Kommentar
                    </label>
                  </div>

                  <div className="form-submit">
                    <button type="submit" disabled={sending}>
                      {sending ? "Sender …" : "Send"}
                    </button>
                  </div>
                </form>
              </div>

              {/* Kart */}
              <div className="map-container">
                <iframe
                  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d7990.0!2d10.689846816215897!3d59.90700408187198!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x46416e62c48b6a31%3A0xdbadeeb694f9f437!2sOperagata%2071B%2C%200194%20Oslo!5e0!3m2!1sen!2sno!4v1600000000000!5m2!1sen!2sno"
                  allowFullScreen=""
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
                      Oslo vegansamfunn og Vegan Norway arrangerer juletreff på
                      KUMI i Oslobukta <b>fredag 19. desember kl. 19.00,</b>{" "}
                      hvor vi har lokalet for oss selv.
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
                      Cocktailbar i 13. etasje på <b>MUNCH,</b> ca. 200 meter
                      unna (<i>23 års aldersgrense</i>).
                    </p>
                    <p>
                      Ønsker du å bli med? Meld deg på via skjemaet over innen{" "}
                      <b>tirsdag 16. desember,</b> og du vil motta en
                      bekreftelse per e-post.
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
                    <p>
                      🍫 Marinerte Appelsiner med Sjokolade- og Appelsinkrem
                    </p>
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
                      Menyen serveres i sharing-stil, med seks utvalgte retter
                      til 590 kr per person.{" "}
                      <b>Du betaler selv der og da til KUMI.</b>{" "}
                    </p>
                    <p>
                      <i>
                        Du må gi beskjed innen <b>16. desember</b> dersom du
                        likevel ikke skal være med. Hvis du ikke melder deg av
                        innen fristen (se e-post for mer), vil du få et
                        Vipps-krav på 300 kr i no-show gebyr, som betales videre
                        til KUMI.
                      </i>
                    </p>
                    <p>
                      Ønsker du vin, øl, eller annen drikke på KUMI kommer dette
                      i tillegg, snakk med personalet 🍷🍾
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
                      Har du andre spørsmål om pris eller tilbud, kontakt KUMI
                      på <a href="mailto:kumi@kumi.no">kumi@kumi.no</a> eller{" "}
                      <a href="tel:+4797302866">973 02 866</a>
                    </p>
                  </div>
                </details>
              </div>
            </div>
          </div>

          <div className="robot-footer" aria-hidden="true">
            🦾
          </div>
        </>
      )}
    </>
  )
}
