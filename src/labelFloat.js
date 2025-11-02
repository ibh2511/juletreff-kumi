const FIELDS = ".form-group input, .form-group textarea"

function toggleHasContent(field) {
  if (field.value.trim()) field.classList.add("has-content")
  else field.classList.remove("has-content")
}

export function setupFloatingLabels() {
  const fields = Array.from(document.querySelectorAll(FIELDS))
  const cleanups = fields.map((field) => {
    const handler = () => toggleHasContent(field)
    handler() // initial synk
    field.addEventListener("input", handler)
    field.addEventListener("blur", handler)
    return () => {
      field.removeEventListener("input", handler)
      field.removeEventListener("blur", handler)
    }
  })
  return () => cleanups.forEach((off) => off())
}
