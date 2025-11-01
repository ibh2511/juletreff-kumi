// Legger til/fjerner .has-content basert på input-verdi slik at label flytter seg.
document.addEventListener("DOMContentLoaded", () => {
  const fields = document.querySelectorAll(
    ".form-group input, .form-group textarea"
  )
  fields.forEach((el) => {
    const toggle = () => {
      if (el.value && el.value.trim() !== "") {
        el.classList.add("has-content")
      } else {
        el.classList.remove("has-content")
      }
    }
    el.addEventListener("input", toggle)
    el.addEventListener("change", toggle)
    // init (for forhåndsutfylte felt/autofill)
    toggle()
  })
})
