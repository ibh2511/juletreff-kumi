# Apps Script for juletreffet

`Code.gs` er hele backenden i ett prosjekt: påmelding, bekreftelse på e-post med Vipps-info, og besøksstatistikk til admin-siden. Den erstatter fjorårets to separate script.

## Sette opp et nytt prosjekt

1. Åpne regnearket for årets juletreff (eller lag et nytt tomt Google-regneark).
2. Velg **Utvidelser → Apps Script**, slett alt i `Code.gs` og lim inn innholdet fra `apps-script/Code.gs`.
3. Fyll inn innstillingene øverst: `VIPPS_NUMBER`, `EVENT_TIME_TEXT`, `DEADLINE_TEXT`, `FACEBOOK_EVENT_URL` og `MAX_PLACES`. Lagre.
4. Velg **Utrull → Ny utrulling → Nettapp**. Kjør som **meg**, tilgang **Alle**. Godkjenn tilgangene Google spør om.
5. Kopier URL-en som slutter på `/exec`, og legg den i `.env` i repoet som `VITE_GAS_URL=...`. Kjør så `npm run deploy`.

Fanene **Påmeldinger** og **Besøk** lages automatisk ved første påmelding eller besøk. Kolonnen **Betalt** står som «Nei» til du endrer den til «Ja» når Vipps-betalingen er mottatt.

## Endre scriptet senere

Lim inn ny kode, og velg **Utrull → Administrer utrullinger → blyanten → Ny versjon → Utrull**. Da beholder du samme URL. «Ny utrulling» gir en ny URL som må inn i `.env` igjen.
