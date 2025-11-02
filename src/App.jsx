import { useEffect, useRef, useState } from "react"
import "./App.css"
import "./labelFloat.js"

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbzDH2lXegWdaV9LASi_7y7aTTYIHKhr7VBJrSAJeSAtbhrqQ6fT3lkqL-bQkreVp-7b/exec"

// Bildene som skal veksle mellom
const IMAGES = ["images/kumi.jpeg", "images/munch.jpg"]

export default function App() {
  const [status, setStatus] = useState(null) // null | "ok" | "waitlist" | "duplicate" | "error"
  const [sending, setSending] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const iframeRef = useRef(null)

  // Fade mellom bilder hvert 4.5 sekund
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % IMAGES.length)
    }, 4500) // 4500ms = 4.5 sekunder

    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    function onMessage(evt) {
      // Tillat bare Apps Script-domener
      if (!/script\.google\.com|googleusercontent\.com/.test(evt.origin)) return

      const data = evt.data || {}
      setSending(false)

      if (data.duplicate) setStatus("duplicate")
      else if (data.ok && data.waitlist) setStatus("waitlist")
      else if (data.ok) setStatus("ok")
      else setStatus("error")
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

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
                alt={`Juletreff 2025`}
                loading="lazy"
              />
            ))}
          </div>

          {/* Skjema */}
          <div className="booking-form">
            <h2>✨Juletreff på KUMI🥂</h2>
            <div className="subheader">19. desember kl 17.00</div>

            {status === "duplicate" && (
              <div className="msg error">
                <h3>⚠️ E-post allerede påmeldt!</h3>
                <p>Det ser ut til at denne e-posten er registrert.</p>
                <p>
                  <a
                    href="https://www.facebook.com/events/1536821710285210"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Har du trykket «Skal» på Facebook-eventet? 📅
                  </a>
                </p>
              </div>
            )}

            {status === "waitlist" && (
              <div className="msg wait">
                <h3>⚠️ Juletreffet er fullt</h3>
                <p>Du kan sette deg på venteliste ved å sende oss en e-post.</p>
                <p>
                  <a
                    href={`mailto:isabelle.haugan@gmail.com?subject=Venteliste%20juletreff%20KUMI%20🥂`}
                  >
                    Sett meg på venteliste 🥳
                  </a>
                </p>
              </div>
            )}

            {status === "ok" && (
              <div className="msg thanks">
                <h3>🎉 Takk for påmeldingen! 🎉</h3>
                <p>Sjekk e-posten din for bekreftelse 📬</p>
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
              onSubmit={() => setSending(true)}
              style={{ display: status ? "none" : "block" }}
            >
              <div className="form-group-row">
                <div className="form-group">
                  <input type="text" name="Fornavn" id="firstName" required />
                  <label htmlFor="firstName" className="form-label">
                    Navn
                  </label>
                </div>
                <div className="form-group">
                  <input type="text" name="Etternavn" id="lastName" required />
                  <label htmlFor="lastName" className="form-label">
                    Etternavn
                  </label>
                </div>
              </div>

              <div className="form-group">
                <input type="email" name="Email" id="email" required />
                <label htmlFor="email" className="form-label">
                  E-post
                </label>
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
              loading="lazy"
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
                  Oslo vegansamfunn arrangerer juletreff på KUMI i Oslobukta,{" "}
                  <b>fredag 19. desember kl 19.00,</b> hvor vi har lokalet for
                  oss selv.
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
                  cocktailbar i 13. etasje på <b>MUNCH,</b> ca. 200 meter unna (
                  <i>23 års aldersgrense</i>)
                </p>
                <p>
                  Ønsker du å bli med? Meld deg på via skjemaet over innen{" "}
                  <b>tirsdag 16. desember,</b> og du vil motta en bekreftelse
                  per e-post.
                </p>
                <p>Inviter gjerne med deg en venn 💚</p>
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
                  Har du andre spørsmål om meny, kontakt KUMI på{" "}
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
                  Menyen serveres i sharing-stil, med seks utvalgte retter til
                  590,- per person. <b>Du betaler selv der og da til KUMI.</b>
                </p>
                <p>
                  Ønsker du en vinpakke, ølpakke, eller annen drikke på KUMI
                  kommer dette i tillegg, hør med personalet 🍷🍾
                </p>
                <p>
                  På Kranen, hvor det er det 23 års aldersgrense, må du være
                  forberedt på å vise legitimasjon.{" "}
                </p>
                <p>
                  Du kjøper det du ønsker på Kranen, drikkemeny finner du{" "}
                  <a
                    href="https://drive.google.com/file/d/1ZhKilxdVjzNH5u9K0xigndzo7pTYUKle/view?usp=sharing"
                    target="_blank"
                    rel="noreferrer"
                  >
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
          </div>
        </div>
      </div>

      {/* Fixed footer with robot arm emoji, centered */}
      <div className="robot-footer" aria-hidden="true">
        🦾
      </div>
    </>
  )
}
