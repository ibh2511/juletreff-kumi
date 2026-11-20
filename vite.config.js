import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { lagIcs } from "./src/kalender.js"

// «Legg i kalenderen» lenker til juletreff.ics. Fila lages fra src/kalender.js, som også lager
// lenken til Google Kalender, så de to alltid viser samme tid og sted.
const kalenderfil = () => ({
  name: "kalenderfil",
  configureServer(server) {
    server.middlewares.use("/juletreff-kumi/juletreff.ics", (_req, res) => {
      res.setHeader("Content-Type", "text/calendar; charset=utf-8")
      res.end(lagIcs())
    })
  },
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "juletreff.ics", source: lagIcs() })
  },
})

export default defineConfig({
  plugins: [react(), kalenderfil()],
  base: "/juletreff-kumi/",
  build: { outDir: "dist", emptyOutDir: true },
})
