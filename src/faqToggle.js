// Smooth FAQ toggle: measure actual height and animate without flicker or layout jumps.

function initFaqToggles() {
  const detailsList = document.querySelectorAll(".faq-section details")

  detailsList.forEach((details) => {
    const body = details.querySelector(".faq-body")
    if (!body) return

    // Set initial state based on whether details is already open
    if (details.open) {
      body.style.height = "auto"
      body.style.opacity = "1"
    } else {
      body.style.height = "0px"
      body.style.opacity = "0"
      body.style.overflow = "hidden"
    }

    details.addEventListener("toggle", () => {
      if (details.open) {
        // Opening: measure real height and animate from 0 to full
        body.style.overflow = "hidden"
        body.style.height = "0px"
        body.style.opacity = "0"

        // Force reflow
        body.offsetHeight

        const fullHeight = body.scrollHeight + "px"
        body.style.transition =
          "height 240ms cubic-bezier(0.2,0.8,0.2,1), opacity 180ms ease"
        body.style.height = fullHeight
        body.style.opacity = "1"

        // After transition, set height to auto so content can grow/shrink dynamically
        const onTransitionEnd = (e) => {
          if (e.propertyName === "height") {
            body.style.height = "auto"
            body.style.overflow = "visible"
            body.removeEventListener("transitionend", onTransitionEnd)
          }
        }
        body.addEventListener("transitionend", onTransitionEnd)
      } else {
        // Closing: measure current height, then collapse to 0
        const currentHeight = body.scrollHeight + "px"
        body.style.height = currentHeight
        body.style.overflow = "hidden"

        // Force reflow
        body.offsetHeight

        body.style.transition =
          "height 240ms cubic-bezier(0.2,0.8,0.2,1), opacity 180ms ease"
        body.style.height = "0px"
        body.style.opacity = "0"
      }
    })
  })
}

// Run when DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFaqToggles)
} else {
  initFaqToggles()
}

export {}
