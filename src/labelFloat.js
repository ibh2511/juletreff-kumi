const SELECTOR = ".form-group input, .form-group textarea"

function sync(el) {
  if (el.value.trim()) {
    el.classList.add("has-content")
  } else {
    el.classList.remove("has-content")
  }
}

function wire(el) {
  const handler = () => sync(el)
  sync(el)
  el.addEventListener("input", handler)
  el.addEventListener("blur", handler)
  return () => {
    el.removeEventListener("input", handler)
    el.removeEventListener("blur", handler)
  }
}

function hydrate() {
  const fields = document.querySelectorAll(SELECTOR)
  if (!fields.length) return () => {}

  const cleanups = Array.from(fields).map(wire)
  return () => cleanups.forEach((off) => off())
}

function init() {
  const teardown = hydrate()
  document.addEventListener("unload", teardown, { once: true })
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true })
} else {
  init()
}
