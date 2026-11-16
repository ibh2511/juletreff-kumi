import { KONTAKT_EPOST, formatPrice } from "./config.js"

// Fyll inn før lansering (se backend/OPPSETT.md)
const ARRANGOR = "Nordisk vegan"
const KONTAKTPERSON = "Isabelle Haugan"
const OPPDATERT = "15. november 2026"

// Kontaktadressen kommer fra backend (SVAR_EPOST), med .env som reserve
function Epost({ info }) {
  const epost = info?.kontaktEpost || KONTAKT_EPOST
  return epost ? (
    <a href={`mailto:${epost}`}>{epost}</a>
  ) : (
    <span>[kontakt-e-post]</span>
  )
}

function Vilkar({ info }) {
  return (
    <>
      <h1>Salgsvilkår</h1>
      <p className="legal-updated">Sist oppdatert: {OPPDATERT}</p>

      <h2>Arrangører</h2>
      <p>
        Arrangører: {ARRANGOR}, Vegan Norway og Oslo vegansamfunn (org.nr.{" "}
        929 119 819, Ensjøveien 29 C, 0661 Oslo). Kontakt: {KONTAKTPERSON},{" "}
        <Epost info={info} />.
      </p>

      <h2>Hva du kjøper</h2>
      <p>
        En plass på juletreffet på KUMI i Oslobukta, {info.dato}. Prisen er{" "}
        {formatPrice(info.pris)} per person og gjelder en vegansk
        julemeny med seks retter i sharing-stil og underholdning. Drikke på KUMI og MUNCH bar
        kommer i tillegg og betales direkte der.
      </p>

      <h2>Påmelding og betaling</h2>
      <p>
        Du melder deg på via skjemaet på nettsiden og betaler med Vipps
        {info.vippsAktiv
          ? ", der du sendes rett til betalingen."
          : ". Vipps-nummeret får du i e-posten med påmeldingen, og du vippser beløpet selv."}{" "}
        Plassen din er sikret når betalingen er mottatt, og du får en
        bekreftelse på e-post. Påmeldingsfristen er {info.fristTekst}, eller
        tidligere hvis det blir fullt. Er det fullt, kan du sette deg på
        venteliste. Da betaler du ingenting før du har fått plass.
      </p>

      <h2>Bindende påmelding</h2>
      <p>
        Påmeldingen er bindende. Vi bestiller mat og bord hos KUMI ut
        fra antall påmeldte, så du kan ikke avbestille og få pengene tilbake
        fordi planene dine endrer seg, og du får ikke pengene tilbake hvis du
        ikke møter opp.
      </p>
      <p>
        Påmeldingen kan bare trekkes med legeerklæring, som du sender til{" "}
        <Epost info={info} /> så snart du kan.
      </p>
      <ul>
        <li>
          Trekker du deg mer enn 48 timer før arrangementet starter, får du
          hele beløpet tilbake.
        </li>
        <li>
          Trekker du deg senere enn det, får du{" "}
          {formatPrice(Math.max(0, info.pris - info.noshow))} tilbake. Vi
          beholder {formatPrice(info.noshow)} for å dekke KUMIs
          no-show-gebyr.
        </li>
      </ul>
      <p>Pengene betales tilbake til Vipps.
      </p>

      <h2>Gi plassen til en annen</h2>
      <p>
        Kan du ikke komme, kan du gi plassen din til noen andre i stedet for
        å trekke deg. Da trenger du ingen legeerklæring. Send navn, e-post og
        telefonnummer til den nye deltakeren til <Epost info={info} /> senest
        dagen før arrangementet, så får de en egen bekreftelse. Betalingen
        følger plassen, og dere gjør opp pengene mellom dere.
      </p>

      <h2>Angrerett</h2>
      <p>
        Det er ikke angrerett på påmeldingen, fordi den gjelder en
        fritidsaktivitet på en bestemt dato (angrerettloven § 22 bokstav m).
      </p>

      <h2>Hvis arrangementet blir avlyst</h2>
      <p>
        Blir juletreffet avlyst av arrangøren, får alle hele beløpet tilbake.
      </p>

      <h2>Allergier</h2>
      <p>
        Skriv allergier i kommentarfeltet når du melder deg på, så gir vi
        beskjed til KUMI. Spørsmål om menyen kan du også stille direkte til
        KUMI på <a href="mailto:kumi@kumi.no">kumi@kumi.no</a>.
      </p>

      <h2>Spørsmål og klager</h2>
      <p>
        Ta kontakt med oss på <Epost info={info} /> først. Kommer vi ikke til enighet, kan
        du klage til Forbrukertilsynet og Forbrukerklageutvalget
        (forbrukertilsynet.no).
      </p>
    </>
  )
}

function Personvern({ info }) {
  return (
    <>
      <h1>Personvernerklæring</h1>
      <p className="legal-updated">Sist oppdatert: {OPPDATERT}</p>

      <h2>Behandlingsansvarlig</h2>
      <p>
        Oslo vegansamfunn v/ {KONTAKTPERSON}, org.nr. 929 119 819,
        Ensjøveien 29 C, 0661 Oslo, er ansvarlig for personopplysningene som
        samles inn ved påmelding til juletreffet. Kontakt:{" "}
        <Epost info={info} />.
      </p>

      <h2>Hva vi samler inn og hvorfor</h2>
      <ul>
        <li>
          Ved påmelding: navn, e-post, telefonnummer og det du skriver i
          kommentarfeltet, samt tidspunkt og at du har godtatt at påmeldingen er
          bindende. Vi bruker dette til å holde oversikt over hvem som kommer,
          sende bekreftelse og ta kontakt hvis noe endrer seg. Grunnlaget er
          avtalen med deg (personvernforordningen art. 6 nr. 1 b).
        </li>
        <li>
          Betaling: beløp, betalingsstatus og påmeldings-ID. Vi ser ikke
          kortnummer eller kontoopplysninger.
        </li>
        <li>
          Allergier og legeerklæring: skriver du allergier i
          kommentarfeltet, eller sender oss legeerklæring for å trekke
          påmeldingen, er dette helseopplysninger. Vi bruker dem bare til
          formålet, deler dem ikke med flere enn nødvendig, og sletter
          legeerklæringen når saken er ferdig behandlet. Grunnlaget er at du
          selv gir oss opplysningene for dette formålet (art. 9 nr. 2 a).
        </li>
        <li>
          Besøksstatistikk: hvilken nettside du kom fra, om du brukte
          mobil eller PC, og en tilfeldig kode som byttes hver dag. Vi bruker
          ikke informasjonskapsler, lagrer ikke IP-adresse og kan ikke knytte
          statistikken til deg.
        </li>
      </ul>

      <h2>Hvor opplysningene lagres</h2>
      <p>
        Påmeldingene lagres i et Google-regneark (Google Sheets), og
        bekreftelser sendes med Gmail. Google er vår databehandler. Bare
        arrangørene har tilgang til regnearket og adminsiden.
      </p>

      <h2>Hvem som får opplysningene</h2>
      <p>
        Betalingen skjer med Vipps (Vipps MobilePay AS), som behandler
        betalingen etter sine egne vilkår. Når du vipper til nummeret i
        e-posten, ser mottakeren navnet ditt, telefonnummeret ditt, beløpet og
        meldingen du skriver, slik det alltid er i Vipps. Vi bruker det bare
        til å se hvem som har betalt og til å betale tilbake. Opplysningene
        ligger i mottakerens Vipps-historikk etter Vipps sine egne regler, og
        vi kan ikke slette dem der. Vi gir KUMI antall deltakere og
        eventuelle allergier, men ikke kontaktopplysningene dine. Vi selger
        eller deler aldri opplysningene dine med andre.
      </p>

      <h2>Hvor lenge vi lagrer</h2>
      <p>
        Navn, e-post, telefon og kommentar slettes senest tre måneder etter
        juletreffet. Opplysninger om betaling og refusjon oppbevares i fem år
        fordi bokføringsloven krever det. Besøksstatistikk slettes etter 24
        måneder.
      </p>

      <h2>Dine rettigheter</h2>
      <p>
        Du kan be om innsyn, retting eller sletting, og protestere mot
        behandlingen. Skriv til <Epost info={info} />. Du kan også klage til Datatilsynet
        (datatilsynet.no).
      </p>
    </>
  )
}

export default function LegalPage({ page, info }) {
  return (
    <div className="legal-page">
      <main className="legal">
        <a className="legal-back" href="#">
          ← Tilbake til påmeldingen
        </a>
        {page === "vilkar" ? <Vilkar info={info} /> : <Personvern info={info} />}
      </main>
      <footer className="site-footer">
        <a href="#">Påmelding</a>
        <span>·</span>
        <a href="#vilkar">Salgsvilkår</a>
        <span>·</span>
        <a href="#personvern">Personvern</a>
      </footer>
    </div>
  )
}
