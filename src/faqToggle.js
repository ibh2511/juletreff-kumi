// Smoothly animate details -> .faq-body height without layout flicker.
// Adds/removes .is-open on <details> and sets inline heights for transitions.

document.addEventListener("DOMContentLoaded", () => {
  const detailsList = document.querySelectorAll(".faq-section details")

  detailsList.forEach((details) => {
    const body = details.querySelector(".faq-body")
    if (!body) return

    // initialize
    if (details.open) {
      details.classList.add("is-open")
      body.style.display = "block"
      body.style.height = "auto"
      body.style.opacity = "1"
      body.style.padding = "15px 16px"
    } else {
      details.classList.remove("is-open")
      body.style.display = "none"
      body.style.height = "0px"
      body.style.opacity = "0"
      body.style.padding = "0 16px"
    }

    details.addEventListener("toggle", () => {
      if (details.open) {
        // opening
        details.classList.add("is-open")
        body.style.display = "block" // make measurable
        const fullHeight = body.scrollHeight + "px"
        body.style.height = "0px"
        body.style.opacity = "0"
        // force reflow then expand
        requestAnimationFrame(() => {
          body.style.transition =
            "height 260ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease, padding 180ms ease, margin 180ms ease"
          body.style.height = fullHeight
          body.style.opacity = "1"
          body.style.padding = "15px 16px"
        })
      } else {
        // closing
        const fullHeight = body.scrollHeight + "px"
        // if height was auto, set to measured height first
        body.style.height = fullHeight
        body.style.opacity = "1"
        // force reflow then collapse
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

    // cleanup after transition: when opened, set height:auto; when closed, hide display
    body.addEventListener("transitionend", (e) => {
      if (e.propertyName !== "height") return
      if (details.open) {
        body.style.height = "auto"
      } else {
        body.style.display = "none"
      }
    })
  })
})
