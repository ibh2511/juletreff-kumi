// Smooth FAQ toggle without flicker + icon swap

function initFaqToggles() {
  const detailsList = document.querySelectorAll(".faq-section details")

  detailsList.forEach((details) => {
    const body = details.querySelector(".faq-body")
    const icon = details.querySelector(".icon")
    if (!body || !icon) return

    // Set initial state
    if (details.open) {
      body.style.height = "auto"
      body.style.opacity = "1"
      body.style.overflow = "visible"
      icon.textContent = "−" // minus when open
    } else {
      body.style.height = "0px"
      body.style.opacity = "0"
      body.style.overflow = "hidden"
      body.style.paddingTop = "0"
      body.style.paddingBottom = "0"
      icon.textContent = "+" // plus when closed
    }

    details.addEventListener("toggle", () => {
      if (details.open) {
        // Opening
        icon.textContent = "−"
        body.style.overflow = "hidden"
        body.style.height = "0px"
        body.style.opacity = "0"
        body.style.paddingTop = "0"
        body.style.paddingBottom = "0"

        // Force reflow
        body.offsetHeight

        const fullHeight = body.scrollHeight + "px"
        body.style.transition =
          "height 260ms cubic-bezier(0.2,0.8,0.2,1), opacity 200ms ease, padding 260ms cubic-bezier(0.2,0.8,0.2,1)"
        body.style.height = fullHeight
        body.style.opacity = "1"
        body.style.paddingTop = "15px"
        body.style.paddingBottom = "15px"

        const onOpen = (e) => {
          if (e.propertyName === "height") {
            body.style.height = "auto"
            body.style.overflow = "visible"
            body.removeEventListener("transitionend", onOpen)
          }
        }
        body.addEventListener("transitionend", onOpen)
      } else {
        // Closing
        icon.textContent = "+"

        // If height is auto, measure and lock it first
        if (body.style.height === "auto" || !body.style.height) {
          body.style.height = body.scrollHeight + "px"
        }
        body.style.overflow = "hidden"

        // Force reflow
        body.offsetHeight

        body.style.transition =
          "height 260ms cubic-bezier(0.2,0.8,0.2,1), opacity 200ms ease, padding 260ms cubic-bezier(0.2,0.8,0.2,1)"
        body.style.height = "0px"
        body.style.opacity = "0"
        body.style.paddingTop = "0"
        body.style.paddingBottom = "0"
      }
    })
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFaqToggles)
} else {
  initFaqToggles()
}

export {}
