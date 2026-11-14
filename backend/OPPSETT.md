# Oppsett av påmelding, Vipps og admin

```
Deltaker → påmeldingssiden (GitHub Pages) → Vipps → tilbake til siden
                    ↕
        Google Apps Script (backend/Code.gs)
        ├─ Google Regneark: påmeldinger og besøk
        └─ Gmail: bekreftelse på e-post
```

Ingen hemmeligheter ligger i repoet eller i nettsiden. Vipps-nøkler og adminpassord ligger bare i Skriptegenskaper i Apps Script.

Løsningen virker på to måter:

- **Med Vipps-avtale (ePayment API):** deltakeren sendes rett til Vipps når hen melder seg på. Betalingen sjekkes direkte hos Vipps, beløpet trekkes, og bekreftelsen sendes automatisk.
- **Uten Vipps-avtale:** deltakeren får et Vipps-kort med beløp, Vipps-nummer og hva som skal stå i meldingen. Du markerer betalingen som mottatt i adminsiden, og da sendes bekreftelsen.

## 1. Lag backend i Apps Script

1. Gå til [script.google.com](https://script.google.com) → **Nytt prosjekt**, og kall det «Juletreff KUMI». Bruk gjerne en egen Google-konto for arrangementet, fordi e-postene sendes fra den.
2. Lim inn hele [`Code.gs`](Code.gs). Under ⚙️ **Prosjektinnstillinger**: huk av for «Vis appsscript.json» og lim inn [`appsscript.json`](appsscript.json).
3. Under **Prosjektinnstillinger → Skriptegenskaper**, legg til:

| Egenskap | Verdi |
|---|---|
| `SITE_URL` | `https://ibh2511.github.io/juletreff-kumi` |
| `PRIS` | `600` |
| `DATO_TEKST` | `Fredag 18. desember kl. 18.30` |
| `STED` | `KUMI, Operagata 71B, Oslobukta` |
| `PAMELDINGSFRIST` | `2026-12-17T23:59:59+01:00` (påmeldingen stenger automatisk) |
| `FRIST_TEKST` | `torsdag 17. desember` |
| `KAPASITET` | `30` |
| `VIPPS_NUMMER` | Vipps-nummeret (brukes uten Vipps-avtale, og når noen får plass fra ventelisten) |
| `AVSENDER_NAVN` | `Juletreff på KUMI` |
| `SVAR_EPOST` | e-posten deltakerne svarer til (spørsmål og legeerklæring) |
| `FACEBOOK_URL` | lenken til årets Facebook-event (knappen i bekreftelses-e-posten) |

Med Vipps-avtale legger du også til (hentes fra portal.vippsmobilepay.com → Utvikler):

| Egenskap | Verdi |
|---|---|
| `VIPPS_ENV` | `test` først, `prod` ved lansering |
| `VIPPS_CLIENT_ID` | Client ID |
| `VIPPS_CLIENT_SECRET` | Client Secret |
| `VIPPS_SUBSCRIPTION_KEY` | Ocp-Apim-Subscription-Key |
| `VIPPS_MSN` | Merchant Serial Number |

Så lenge `VIPPS_CLIENT_ID` er tom, brukes Vipps-nummeret.

4. Kjør funksjonen **`oppsett`** én gang. Den kobler til regnearket i Drive-mappen «Juletreff KUMI 2026» (`1uAHLTHwgjCizlvYMFi_SO28o5bhb1j6KD86dYPxc-4g`), lager fanene «Påmeldinger» og «Besøk», og lager en utløser som sjekker ubetalte Vipps-betalinger hvert 5. minutt.
5. Sett adminpassordet: gå til **Prosjektinnstillinger** (tannhjulet) → **Skriptegenskaper** → **Legg til skriptegenskap**, navn `ADMIN_PASSORD`, verdi = passordet (minst 12 tegn). Første gang noen logger inn, gjøres det om til en saltet hash og klarteksten slettes. (Alternativt: kjør `settAdminPassord` med passordet skrevet inn i koden, og slett det etterpå.)

## 2. Publiser backend

1. **Implementer → Ny implementering → Nettapp**. «Kjør som»: **Meg**. «Hvem har tilgang»: **Alle**.
2. Kopier adressen som slutter på `/exec`.
3. Kopier `.env.example` til `.env` i repoet og sett `VITE_API_URL` til adressen, `VITE_KONTAKT_EPOST` til kontakt-e-posten, og eventuelt `VITE_VIPPS_NUMBER`.
4. `npm run deploy`.

Når du endrer koden senere: **Implementer → Administrer implementeringer → ✏️ → Ny versjon**, så beholder du adressen.

## 3. Adminsiden

Gå til `…/juletreff-kumi/#admin` og logg inn. Passordet sjekkes i backend, og nettleseren får bare en innloggingsnøkkel som varer i 2 timer. Etter 10 feil forsøk stenges innloggingen i 15 minutter.

Her ser du plasser tatt, betalt, ikke betalt, venteliste, trukket, innbetalt beløp og besøk, og du kan:

- **Marker som betalt:** når noen har betalt til Vipps-nummeret. Deltakeren får bekreftelse.
- **Trekk påmeldingen:** bare når legeerklæring er mottatt. Betalt med Vipps-avtale: kan refunderes i Vipps med en gang. Betalt til Vipps-nummer: send pengene tilbake selv og trykk **Marker som refundert**.
- **Gi plass fra ventelisten:** deltakeren får e-post med betalingsinfo (Vipps-nummeret).
- **Deltakerliste (CSV):** navn, telefon, e-post og kommentarer (allergier) for de påmeldte.

## 4. Før lansering

1. Fyll inn arrangør, org.nr., kontaktperson og dato i `src/LegalPage.jsx` (står i hakeparentes).
2. Test med `VIPPS_ENV=test` og Vipps MT-appen, og sjekk at bekreftelsen kommer.
3. Bytt til produksjonsnøkler, sett `VIPPS_ENV=prod` og lag en ny versjon av implementeringen.

## Grenser

- Gmail sender 100 e-poster i døgnet fra Apps Script.
- En påbegynt Vipps-betaling holder plassen i 30 minutter.
- Regnearket er beskyttet mot formel-injeksjon, og det er en bremse på 30 påmeldinger per minutt.

## Innstillinger i adminsiden

- **Antall plasser** lagres som skriptegenskapen `KAPASITET`.
- **Vipps-API av/på** lagres som `VIPPS_MODUS` (`nummer` eller `api`). API-et kan bare slås på når `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY` og `VIPPS_MSN` er lagt inn, og adminsiden sjekker at nøklene virker før det slås på. `VIPPS_ENV=prod` må være satt for ekte betalinger.
- **Testpåmelding** lager en påmelding merket «test» (kolonnen `test` i regnearket). Den tar ikke plass, telles ikke og kan slettes fra adminsiden.
