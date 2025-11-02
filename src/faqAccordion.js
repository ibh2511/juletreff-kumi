export function setupFaqAccordion() {
  const allDetails = document.querySelectorAll(".faq-section details")
  const cleanups = []

  allDetails.forEach((details) => {
    const summary = details.querySelector("summary")
    if (!summary) return

    const handler = (event) => {
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
    }

    summary.addEventListener("click", handler)
    cleanups.push(() => summary.removeEventListener("click", handler))
  })

  return () => cleanups.forEach((off) => off())
}
