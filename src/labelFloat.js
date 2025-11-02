// Legger til/fjerner .has-content basert på input-verdi slik at label flytter seg.
document.addEventListener("DOMContentLoaded", () => {
  const fields = document.querySelectorAll(
    ".form-group input, .form-group textarea"
  )

  const sync = (el) => {
    if (el.value.trim()) {
      el.classList.add("has-content")
    } else {
      el.classList.remove("has-content")
    }
  }

  const hydrate = () => {
    fields.forEach((field) => {
      sync(field)
      field.addEventListener("input", () => sync(field))
      field.addEventListener("blur", () => sync(field))
    })
  }

  hydrate()
})
