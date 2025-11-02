function initFaqAccordion() {
  const allDetails = document.querySelectorAll(".faq-section details")

  allDetails.forEach((details) => {
    const summary = details.querySelector("summary")
    if (!summary) return

    summary.addEventListener("click", (event) => {
      event.preventDefault()

      if (details.open) {
        details.open = false
        return
      }

      allDetails.forEach((otherDetails) => {
        if (otherDetails !== details && otherDetails.open) {
          otherDetails.open = false
        }
      })

      details.open = true
    })
  })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initFaqAccordion)
} else {
  initFaqAccordion()
}
