// Smoothly animate details -> .faq-body height without layout flicker.
// Adds/removes .is-open on <details> and sets inline heights for transitions.

function initFaqToggles() {
  const detailsList = document.querySelectorAll(".faq-section details")

  detailsList.forEach((details) => {
    const body = details.querySelector(".faq-body")
    if (!body) return

    // helper to collapse instantly (initial state)
    const collapseInstant = () => {
      body.style.display = "none"
      body.style.height = "0px"
      body.style.opacity = "0"
      body.style.padding = "0 16px"
      details.classList.remove("is-open")
    }

    // helper to expand instantly (initial state if already open)
    const expandInstant = () => {
      body.style.display = "block"
      body.style.height = "auto"
      body.style.opacity = "1"
      body.style.padding = "15px 16px"
      details.classList.add("is-open")
    }

    // initialize based on current attribute (works even if script loads after DOMContentLoaded)
    if (details.open) expandInstant()
    else collapseInstant()

    details.addEventListener("toggle", () => {
      // handle opening
      if (details.open) {
        details.classList.add("is-open")
        body.style.display = "block" // allow measurement
        const fullHeight = `${body.scrollHeight}px`
        // ensure start from 0
        body.style.height = "0px"
        body.style.opacity = "0"
        // animate to full
        requestAnimationFrame(() => {
          body.style.transition =
            "height 260ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease, padding 180ms ease, margin 180ms ease"
          body.style.height = fullHeight
          body.style.opacity = "1"
          body.style.padding = "15px 16px"
        })
      } else {
        // handle closing
        const fullHeight = `${body.scrollHeight}px`
        // set fixed height then collapse
        body.style.height = fullHeight
        body.style.opacity = "1"
        requestAnimationFrame(() => {
          body.style.transition =
            "height 260ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease, padding 180ms ease, margin 180ms ease"
          body.style.height = "0px"
          body.style.opacity = "0"
          body.style.padding = "0 16px"
        })
        details.classList.remove("is-open")
      }
    })

    // after transition, tidy inline styles
    body.addEventListener("transitionend", (e) => {
      if (e.propertyName !== "height") return
      if (details.open) {
        body.style.height = "auto"
      } else {
        body.style.display = "none"
      }
    })
  })
}

// Ensure init runs whether DOMContentLoaded already fired or not
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFaqToggles)
} else {
  initFaqToggles()
}

export {} // keep module scope (no globals)
