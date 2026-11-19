# Oppsett av påmelding, Vipps og admin

```
Deltaker → påmeldingssiden (GitHub Pages) → Vipps → tilbake til siden
                    ↕
        Google Apps Script (backend/Code.gs)
        ├─ Google Regneark: påmeldinger og besøk
        └─ Gmail: bekreftelse på e-post
```

Ingen hemmeligheter ligger i repoet eller i nettsiden. Vipps-nøkler og adminpassord ligger bare i Skriptegenskaper i Apps Script.

Du velger betalingsløsning i adminsiden under **Innstillinger → Betalingsløsning**. Byttet gjelder med en gang.

- **Vipps bedrift (Vipps-avtalen, ePayment API):** deltakeren sendes rett til Vipps når hen melder seg på. Betalingen sjekkes direkte hos Vipps, beløpet trekkes, og bekreftelsen sendes automatisk. Vipps tar et gebyr per salg.
- **Vipps privat (til mobilnummer):** deltakeren får betalingssiden med «Åpne Vipps» (nummer, beløp og melding fylt ut), kopier-knapp og QR-kode på PC, og det samme på e-post. Er banken koblet til (se steg 5), finner backend betalingen selv og sender bekreftelsen. Ellers markerer du betalingen som mottatt i adminsiden.

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
| `PAMELDINGSFRIST` | `2026-12-16T23:59:59+01:00` (påmeldingen stenger automatisk) |
| `FRIST_TEKST` | `onsdag 16. desember` |
| `KAPASITET` | `30` |
| `VIPPS_NUMMER` | Vipps-nummeret eller mobilnummeret det betales til uten Vipps-avtale. Settes enklest i adminsiden |
| `AVSENDER_NAVN` | `Juletreff på KUMI` |
| `SVAR_EPOST` | e-posten deltakerne svarer til (spørsmål og legeerklæring). Vises også som kontaktadresse på nettsiden |
| `FACEBOOK_URL` | lenken til årets Facebook-event. Settes enklest i adminsiden under Innstillinger |

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
3. Adressen ligger allerede i `src/config.js`. Bytter du til en ny implementering med ny adresse, må den oppdateres der.

Nettsiden publiseres av seg selv når noe merges til `main`. Kontakt-e-posten på siden og i vilkårene hentes fra `SVAR_EPOST` i Skriptegenskaper, og Facebook-lenken settes i adminsiden.

Når du endrer koden senere: **Implementer → Administrer implementeringer → ✏️ → Ny versjon**, så beholder du adressen.

## Vipps privat og banken (SpareBank 1)

Betalingssiden er `…/juletreff-kumi/?betaling=JT-1001&k=…`. Deltakeren havner der etter påmeldingen, og knappen i e-posten går dit. Den virker også i nettleseren inne i Facebook, Instagram, Messenger og andre apper:

- På mobil: kopier nummeret, «Åpne Vipps», skriv inn beløpet og betal, kom tilbake. Android bruker en «intent»-lenke som åpner Vipps-appen direkte, også inne i apper. iPhone inne i apper bruker `vipps://`, ellers vanlig lenke. Det er alltid en reservelenke under knappen. Samme valg som i vegansk juleribbe.
- På PC: QR-kode som åpner Vipps med nummeret fylt ut.
- Meldingen fylles ut med «Juletreff JT-1001 Fornavn Etternavn». Lenkeformatet er ikke offisielt dokumentert. Virker det ikke, tar du bort haken for «fyller ut beløp og melding» i adminsiden, så fylles bare nummeret ut.
- Betaler noen fra en annens Vipps (for eksempel en partner), kan de skrive det navnet på betalingssiden.
- Bruk et mobilnummer (8 sifre). Et Vipps-nummer (5–6 sifre) virker også, men da må deltakerne søke det opp selv, og det blir ingen «Åpne Vipps» eller QR-kode.

**Slik kobler du til banken (gjøres én gang):**

1. Velg gjerne en egen konto i nettbanken som konto for innbetalinger i Vipps-appen.
2. Gå til [developer.sparebank1.no](https://developer.sparebank1.no), logg inn og lag en ny klient (eller bruk den fra vegansk juleribbe og legg til en redirect-adresse til). Redirect-adressen står i adminsiden under **Vipps og bank → Banken** (backendadressen med `?action=bank` bak).
3. I adminsiden: lim inn klient-ID og klienthemmelighet, og bank-ID hvis portalen viser en. Trykk **Koble til banken** og logg inn med BankID i fanen som åpnes.
4. Velg kontoen Vipps-pengene kommer inn på, og trykk **Test banken**. Da ser du de siste innbetalingene slik banken sender dem.

Tilgangen lagres bare i Skriptegenskaper (`BANK_CLIENT_ID`, `BANK_CLIENT_SECRET`, `BANK_REFRESH_TOKEN` m.fl.) og sendes aldri til nettleseren. Backend leser bare konto- og transaksjonsoppslag og flytter aldri penger.

**Slik fungerer koblingen:**

- Innbetalinger kobles på påmeldings-ID-en i meldingen, ellers på fornavn, etternavn og beløp. Mellomnavn i Vipps gjør ingenting. Venter bare én på beløpet, holder det at ett av navnene stemmer.
- Bare innbetalinger med juletreffets beløp lagres (fanen **Bank**). Unntaket er når noen som ikke har betalt, betaler feil beløp (navnet eller ID-en står i bankteksten). Den lagres som «Feil beløp» med påmeldingen som forslag.
- Det som ikke kan kobles sikkert, står i adminsiden under **Innbetalinger som ikke ble koblet**, og du får e-post om det. Velg påmeldingen og trykk «Koble», eller «Ignorer».
- Mens deltakeren står på betalingssiden, spør siden hvert 10. sekund, og backend spør banken høyst hvert 20. sekund. En utløser spør banken hvert minutt de første 2 timene etter en ny ubetalt påmelding eller purring, hvert 5. minutt resten av de 48 timene, og ellers hvert 15. minutt så lenge noen ikke har betalt. Har alle betalt, spør den ikke banken i det hele tatt. Det holder kjøretiden godt under Googles grense på 90 minutter i døgnet for utløsere på en vanlig Gmail-konto. Grensen deles med andre skript på samme konto, som vegansk juleribbe. Utløseren lages når du kobler til banken eller velger Vipps privat.
- Går banktilgangen ut eller slutter å virke, får du e-post med beskjed om å koble til på nytt. Varslene går til `VARSEL_EPOST`, ellers `ADMIN_EPOST`, ellers `SVAR_EPOST`.

## Vipps bedrift

- **Test Vipps bedrift** i adminsiden lager en betaling på 1 kr, avbryter den med en gang, og sier hva som er galt hvis noe ikke virker. Den vanligste feilen er produksjonsnøkler mens `VIPPS_ENV` ikke er `prod`.
- Feiler Vipps når noen melder seg på, får du e-post med feilen (høyst én i timen).
- Gebyret (2,99 % + 1 kr per salg) står i `GEBYR_PROSENT` og `GEBYR_KR` øverst i `Code.gs`. Sjekk at det stemmer med avtalen for juletreffet. Adminsiden viser salg, omsetning, gebyr og netto per løsning.
- Har noen plass uten å ha betalt (fra ventelisten, eller fordi du byttet løsning), får de «Betal med Vipps» på betalingssiden og i e-posten, og plassen beholdes mens de betaler.

## 3. Adminsiden

Gå til `…/juletreff-kumi/#admin` og logg inn. Passordet sjekkes i backend, og nettleseren får bare en innloggingsnøkkel som varer i 2 timer. Etter 10 feil forsøk stenges innloggingen i 15 minutter.

Her ser du plasser tatt, betalt, ikke betalt, venteliste, trukket, innbetalt beløp og besøk, og du kan:

- **Marker som betalt:** når noen har betalt til Vipps-nummeret. Deltakeren får bekreftelse.
- **Trekk påmeldingen:** bare når legeerklæring er mottatt. Betalt med Vipps-avtale: kan refunderes i Vipps med en gang. Betalt til Vipps-nummer: send pengene tilbake selv og trykk **Marker som refundert**.
- **Gi plass fra ventelisten:** deltakeren får e-post med betalingsinfo (Vipps-nummeret).
- **Deltakerliste (CSV):** navn, telefon, e-post og kommentarer (allergier) for de påmeldte.

## Test hele løpet med 1 kr

I adminsiden under **Test hele løpet med 1 kr** trykker du **Lag testlenke**. Åpne lenken på mobilen (gjerne inne i Facebook eller Instagram også) og meld deg på som en vanlig deltaker. Siden viser «Testmodus: 1 kr», og alt kjøres som for ekte: skjemaet, betalingssiden, Vipps, banken og e-postene (merket [TEST]). Påmeldingen merkes som test, tar ikke plass og telles ikke. Lenken virker i 2 timer, bare for den som har den, også når det er fullt eller fristen er ute. Lager du en ny lenke, slutter den gamle å virke. Lenken lagres i skriptegenskapen `TESTLENKE`.

Etterpå betaler du 1 kr-en tilbake til deg selv i Vipps (Vipps privat), eller velger «Trekk påmeldingen» med refusjon (Vipps bedrift). Slett testen i påmeldingslisten.

**Samme Vipps-nummer og konto som vegansk juleribbe:** Vipps privat sender alt til kontoen som er valgt i Vipps-appen, så juletreff og juleribbe må lese samme konto, og begge ser alle innbetalingene. Det går bra fordi:

- Beløpene er forskjellige (600 kr mot juleribbes priser). Hver backend ser bare etter sine egne beløp.
- Meldingen fra «Åpne Vipps» har nummeret: «Juletreff JT-1001 …» og «Juleribbe VJ-…». En betaling med den andres nummer eller navn hoppes over, også når navn og beløp passer, og gir ingen «Feil beløp» eller varsel.
- Den eneste måten å blande dem på er to 1 kr-tester fra samme navn samtidig, uten melding i Vipps. Ta derfor én test om gangen, og betal med «Åpne Vipps», så meldingen kommer med.

## 4. Før lansering

1. Fyll inn arrangør, org.nr., kontaktperson og dato i `src/LegalPage.jsx` (står i hakeparentes).
2. Test med `VIPPS_ENV=test` og Vipps MT-appen, og sjekk at bekreftelsen kommer.
3. Bytt til produksjonsnøkler, sett `VIPPS_ENV=prod` og lag en ny versjon av implementeringen.

## Automatisk deploy til Apps Script (valgfritt)

Når dette er satt opp, sendes `backend/Code.gs` og `appsscript.json` til Apps Script og implementeringen får en ny versjon hver gang `backend/` endres på main. Nettadressen til backenden blir den samme.

1. Slå på «Google Apps Script API» på https://script.google.com/home/usersettings
2. Kjør `npx @google/clasp@2.4.2 login` på din egen maskin og logg inn med Google-kontoen som eier skriptet. Det lager filen `~/.clasprc.json` (på Mac: `cat ~/.clasprc.json | pbcopy` kopierer innholdet).
3. I GitHub: Settings → Secrets and variables → Actions.
   - Under **Secrets**: lag `CLASPRC_JSON` med innholdet i `.clasprc.json`.
   - Under **Variables**: lag `APPS_SCRIPT_ID` (Apps Script → Prosjektinnstillinger → Skript-ID) og `APPS_SCRIPT_DEPLOYMENT_ID` (Implementer → Administrer implementeringer → Implementerings-ID).
4. Kjør workflowen «Deploy Apps Script» én gang under Actions for å teste.

Merk: Secret-et gir tilgang til Apps Script-prosjektene på kontoen din. Koden i repoet overskriver det som ligger i Apps Script, så gjør endringer her og ikke i Apps Script-editoren.

## Grenser

- Gmail sender 100 e-poster i døgnet fra Apps Script.
- En påbegynt Vipps-betaling holder plassen i 30 minutter.
- Regnearket er beskyttet mot formel-injeksjon, og det er en bremse på 30 påmeldinger per minutt.

## Innstillinger i adminsiden

- **Antall plasser** lagres som skriptegenskapen `KAPASITET`.
- **Betalingsløsning** lagres som `VIPPS_MODUS` (`nummer` = Vipps privat, `api` = Vipps bedrift). Vipps bedrift kan bare velges når `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY` og `VIPPS_MSN` er lagt inn, og adminsiden sjekker at nøklene virker først. `VIPPS_ENV=prod` må være satt for ekte betalinger.
- **«Åpne Vipps» fyller ut beløp og melding** lagres som `VIPPS_LENKE_UTFYLT` (`ja` eller `nei`).
- **Testpåmelding** lager en påmelding merket «test» (kolonnen `test` i regnearket). Den tar ikke plass, telles ikke og kan slettes fra adminsiden.
