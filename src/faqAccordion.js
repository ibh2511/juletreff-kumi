function initFaqAccordion() {
  // 1. Finn alle <details>-elementene i FAQ-seksjonen
  const allDetails = document.querySelectorAll(".faq-section details")

  // 2. Gå gjennom hvert enkelt <details>-element
  allDetails.forEach((details) => {
    // 3. Legg til en lytter som reagerer når elementet åpnes eller lukkes ('toggle')
    details.addEventListener("toggle", (event) => {
      // Hvis elementet som ble trykket på nå er lukket, gjør ingenting.
      if (!details.open) {
        return
      }

      // 4. Hvis elementet ble åpnet, gå gjennom *alle* de andre elementene
      allDetails.forEach((otherDetails) => {
        // 5. Hvis vi finner et annet element som er åpent, lukk det.
        if (otherDetails !== details && otherDetails.open) {
          otherDetails.open = false
        }
      })
    })
  })
}

// Kjør funksjonen når siden er ferdig lastet
document.addEventListener("DOMContentLoaded", initFaqAccordion)
