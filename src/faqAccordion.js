function initFaqAccordion() {
  const allDetails = document.querySelectorAll(".faq-section details")

  allDetails.forEach((details) => {
    const summary = details.querySelector("summary")
    if (!summary) return

    summary.addEventListener("click", (event) => {
      // 1. Stopp standard-oppførselen. Vi tar kontrollen selv.
      event.preventDefault()

      // 2. Hvis den du klikket på allerede er åpen, bare lukk den og stopp.
      if (details.open) {
        details.open = false
        return
      }

      // 3. Hvis den du klikket på er lukket:
      // Først, lukk alle andre som måtte være åpne.
      allDetails.forEach((otherDetails) => {
        if (otherDetails.open) {
          otherDetails.open = false
        }
      })

      // 4. Til slutt, åpne den du faktisk klikket på.
      details.open = true
    })
  })
}

// Kjør funksjonen når siden er ferdig lastet
document.addEventListener("DOMContentLoaded", initFaqAccordion)
