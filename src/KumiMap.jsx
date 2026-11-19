import { useEffect, useRef, useState } from "react"
import "./KumiMap.css"

const MAP_SRC =
  "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d7990.0!2d10.689846816215897!3d59.90700408187198!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x46416e62c48b6a31%3A0xdbadeeb694f9f437!2sOperagata%2071B%2C%200194%20Oslo!5e0!3m2!1sen!2sno!4v1600000000000!5m2!1sen!2sno"

// Kartet fra Google er tungt (rundt 1–2 MB og mange forespørsler). Det hentes derfor
// først når resten av siden er ferdig lastet, så det ikke konkurrerer med bildet,
// fonten og skjemaet. Det starter likevel før folk scroller ned, så det er klart
// når de kommer dit. Kommer kartet i syne før det, hentes det med en gang.
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

    // Kartet er (nesten) synlig: hent det nå
    let io
    if ("IntersectionObserver" in window && ref.current) {
      io = new IntersectionObserver(
        (entries) => entries.some((e) => e.isIntersecting) && start(),
        { rootMargin: "400px 0px" },
      )
      io.observe(ref.current)
    } else {
      start()
    }

    // Ellers: når siden er ferdig og nettleseren har ledig tid.
    // Med «spar data» på venter vi til kartet faktisk er i nærheten.
    const saveData = navigator.connection?.saveData
    let idleId, timer
    const whenIdle = () => {
      if (saveData) return
      if ("requestIdleCallback" in window) idleId = requestIdleCallback(start, { timeout: 2000 })
      else timer = setTimeout(start, 300)
    }
    if (document.readyState === "complete") whenIdle()
    else window.addEventListener("load", whenIdle, { once: true })

    return () => {
      done = true
      io?.disconnect()
      window.removeEventListener("load", whenIdle)
      if (idleId) cancelIdleCallback(idleId)
      clearTimeout(timer)
    }
  }, [src])

  return (
    <div ref={ref} className={`map-container kumi-map${loaded ? " is-loaded" : ""}`}>
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
