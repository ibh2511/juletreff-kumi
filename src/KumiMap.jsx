import { useEffect, useRef, useState } from "react"
import "./KumiMap.css"

const MAP_SRC =
  "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d7990.0!2d10.689846816215897!3d59.90700408187198!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x46416e62c48b6a31%3A0xdbadeeb694f9f437!2sOperagata%2071B%2C%200194%20Oslo!5e0!3m2!1sen!2sno!4v1600000000000!5m2!1sen!2sno"
const MAPS_LINK = "https://www.google.com/maps/search/?api=1&query=KUMI%2C%20Operagata%2071B%2C%200194%20Oslo"

// Google-kartet er tungt (rundt 1–2 MB og mange forespørsler) og bruker ofte noen
// sekunder. Mens det lastes vises adressen og en lenke til Google Maps med en gang,
// så det aldri står en tom grå flate. Kartet tones inn over når det er klart.
// Det hentes så snart siden har tegnet seg første gang, ikke først når alt annet er
// ferdig, og med «spar data» på først når kartet er i nærheten.
export default function KumiMap() {
  const ref = useRef(null)
  const [src, setSrc] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (src) return
    let done = false
    const start = () => {
      if (done) return
      done = true
      setSrc(MAP_SRC)
    }

    let io
    if ("IntersectionObserver" in window && ref.current) {
      io = new IntersectionObserver(
        (entries) => entries.some((e) => e.isIntersecting) && start(),
        { rootMargin: "600px 0px" },
      )
      io.observe(ref.current)
    } else {
      start()
    }

    // Etter første tegning: hent kartet uten å vente på resten av siden
    const timer = navigator.connection?.saveData ? null : setTimeout(start, 50)

    return () => {
      done = true
      io?.disconnect()
      clearTimeout(timer)
    }
  }, [src])

  return (
    <div ref={ref} className={`map-container kumi-map${loaded ? " is-loaded" : ""}`}>
      <a className="kumi-map-plass" href={MAPS_LINK} target="_blank" rel="noreferrer" tabIndex={loaded ? -1 : 0}>
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
          <path
            d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"
            fill="currentColor"
          />
        </svg>
        <b>KUMI</b>
        <span>Operagata 71B, Oslobukta</span>
        <span className="kumi-map-lenke">Åpne i Google Maps</span>
      </a>
      {src && (
        <iframe
          src={src}
          allowFullScreen=""
          referrerPolicy="no-referrer-when-downgrade"
          title="KUMI kart"
          onLoad={() => setLoaded(true)}
        />
      )}
    </div>
  )
}
