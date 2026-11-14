# Juletreff på KUMI

Påmeldingsside for juletreffet på KUMI, med Vipps-betaling, bindende påmelding og adminside.

- `src/` – React-siden (Vite). `#admin` er adminsiden, `#vilkar` og `#personvern` er salgsvilkår og personvern.
- `backend/` – Google Apps Script som tar imot påmeldinger, håndterer Vipps, sender bekreftelse og gir data til adminsiden.

Se [backend/OPPSETT.md](backend/OPPSETT.md) for oppsett. Kort: `cp .env.example .env`, fyll inn, og `npm run deploy`.
