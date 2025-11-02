# Oppsett Guide: Visitor Tracking for Juletreff KUMI

## 🎯 Steg 1: Opprett Google Sheets

1. Gå til [sheets.google.com](https://sheets.google.com)
2. Klikk "Blankt" for å lage nytt regneark
3. Gi navnet: **"Juletreff KUMI - Visitor Stats"**
4. Kopier **Sheets ID** fra URL-en (den lange tekststrengen mellom `/d/` og `/edit`)
   ```
   Eksempel URL: https://docs.google.com/spreadsheets/d/1A2B3C4D5E6F7G8H9I0J/edit
   Sheets ID: 1A2B3C4D5E6F7G8H9I0J
   ```

## 🎯 Steg 2: Opprett Google Apps Script

1. Gå til [script.google.com](https://script.google.com)
2. Klikk "Nytt prosjekt"
3. Gi navnet: **"Juletreff KUMI - Visitor Tracking"**
4. Slett all eksisterende kode
5. Kopier og lim inn hele innholdet fra `google-apps-script-visitor-tracking.js`
6. **VIKTIG:** Erstatt `SETT_INN_DIN_GOOGLE_SHEETS_ID_HER` med din Sheets ID fra steg 1

## 🎯 Steg 3: Deploy Google Apps Script

1. I Apps Script editoren, klikk "Deploy" → "New deployment"
2. Velg type: **"Web app"**
3. Innstillinger:
   - Description: "Visitor Tracking API"
   - Execute as: **"Me"**
   - Who has access: **"Anyone"**
4. Klikk "Deploy"
5. Kopier **Web app URL** (slutter på .../exec)

## 🎯 Steg 4: Oppdater Frontend

1. Åpne `src/visitorTracking.js`
2. Finn linjen med `const GAS_VISITOR_URL = "..."`
3. Erstatt URL-en med din Web app URL fra steg 3

## 🎯 Steg 5: Test oppsettet

1. I Google Apps Script editoren:
   - Gå til funksjonen `testVisitorTracking`
   - Klikk "Run" (kjør)
   - Sjekk at det ikke kommer feilmeldinger
2. Sjekk Google Sheets:
   - Det skal automatisk ha opprettet et "VisitorStats" sheet
   - Første rad skal ha headers
   - Andre rad skal ha testdata

## 🎯 Steg 6: Deploy website

1. Kjør `npm run deploy` i terminalen
2. Gå til websiden og besøk admin-panelet (#admin)
3. Sjekk at statistikken viser riktige tall

## 🔧 Feilsøking

### Hvis statistikk ikke oppdateres:

1. Åpne browser console (F12)
2. Se etter feilmeldinger
3. Sjekk at GAS_VISITOR_URL er riktig satt

### Hvis Google Apps Script feiler:

1. I Apps Script, gå til "Executions"
2. Sjekk for error messages
3. Kontroller at Sheets ID er riktig

### Hvis ingen data lagres:

1. Sjekk at Google Apps Script har tilgang til Google Sheets
2. Kjør `testVisitorTracking()` manuelt i Apps Script
3. Sjekk at web app er deployet med "Anyone" access

## 📊 Resultat

Når alt er satt opp riktig vil du få:

- ✅ Ekte global visitor tracking på tvers av alle enheter
- ✅ Data lagret sikkert i Google Sheets
- ✅ Real-time statistikk i admin-panelet
- ✅ Detaljert data om hver besøkende (browser, språk, osv.)
