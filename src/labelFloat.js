const FIELDS = ".form-group input, .form-group textarea"
const HENDELSER = ["input", "change", "focus", "blur"]

function toggleHasContent(field) {
  if (field.value.trim()) field.classList.add("has-content")
  else field.classList.remove("has-content")
}

// Autoutfylling fyller ofte flere felt på én gang, men sier bare fra om ett av dem, eller ingen.
// Derfor sjekkes alle feltene når noe skjer i ett av dem, og en gang til litt etterpå.
export function setupFloatingLabels() {
  const fields = Array.from(document.querySelectorAll(FIELDS))
  const synkAlle = () => fields.forEach(toggleHasContent)
  let timer
  const synk = () => {
    synkAlle()
    clearTimeout(timer)
    timer = setTimeout(synkAlle, 300)
  }
  synkAlle() // første synk
  fields.forEach((f) => HENDELSER.forEach((h) => f.addEventListener(h, synk)))
  return () => {
    clearTimeout(timer)
    fields.forEach((f) => HENDELSER.forEach((h) => f.removeEventListener(h, synk)))
  }
}
