import { KONTAKT_EPOST, formatPrice } from "./config.js"

// Fyll inn før lansering (se backend/OPPSETT.md)
const ARRANGOR = "[Arrangør: navn på foreningen som tar imot betalingen]"
const ORGNR = "[org.nr.]"
const KONTAKTPERSON = "[Kontaktperson]"
const OPPDATERT = "[dato]"

function Epost() {
  return KONTAKT_EPOST ? (
    <a href={`mailto:${KONTAKT_EPOST}`}>{KONTAKT_EPOST}</a>
  ) : (
    <span>[kontakt-e-post]</span>
  )
}

function Vilkar({ info }) {
  return (
    <>
      <h1>Salgsvilkår</h1>
      <p className="legal-updated">Sist oppdatert: {OPPDATERT}</p>

      <h2>Arrangør</h2>
      <p>
        Juletreffet arrangeres av Oslo vegansamfunn og Vegan Norway. Betalingen
        tas imot av {ARRANGOR}, org.nr. {ORGNR}. Kontakt: {KONTAKTPERSON},{" "}
        <Epost />.
      </p>

      <h2>Hva du kjøper</h2>
      <p>
        En plass på juletreffet på KUMI i Oslobukta, {info.dato}. Prisen er{" "}
        <b>{formatPrice(info.pris)} per person</b> og gjelder en vegansk
        julemeny med seks retter i sharing-stil. Drikke på KUMI og Kranen
        kommer i tillegg og betales direkte der.
      </p>

      <h2>Påmelding og betaling</h2>
      <p>
        Du melder deg på via skjemaet på nettsiden og betaler med Vipps.
        Plassen din er sikret når betalingen er mottatt, og du får en
        bekreftelse på e-post. Påmeldingsfristen er {info.fristTekst}, eller
        tidligere hvis det blir fullt. Er det fullt, kan du sette deg på
        venteliste. Da betaler du ingenting før du har fått plass.
      </p>

      <h2>Bindende påmelding</h2>
      <p>
        <b>Påmeldingen er bindende.</b> Vi bestiller mat og bord hos KUMI ut
        fra antall påmeldte, så du kan ikke avbestille og få pengene tilbake
        fordi planene dine endrer seg, og du får ikke pengene tilbake hvis du
        ikke møter opp.
      </p>
      <p>
        Påmeldingen kan <b>bare trekkes med legeerklæring</b>. Send
        legeerklæringen til <Epost /> så snart du kan, og senest tre dager
        etter arrangementet. Da får du hele beløpet tilbake til Vipps.
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
        Ta kontakt med oss på <Epost /> først. Kommer vi ikke til enighet, kan
        du klage til Forbrukertilsynet og Forbrukerklageutvalget
        (forbrukertilsynet.no).
      </p>
    </>
  )
}

function Personvern() {
  return (
    <>
      <h1>Personvernerklæring</h1>
      <p className="legal-updated">Sist oppdatert: {OPPDATERT}</p>

      <h2>Behandlingsansvarlig</h2>
      <p>
        {ARRANGOR}, org.nr. {ORGNR}, er ansvarlig for personopplysningene som
        samles inn ved påmelding til juletreffet. Kontaktperson for personvern
        er {KONTAKTPERSON}, <Epost />.
      </p>

      <h2>Hva vi samler inn og hvorfor</h2>
      <ul>
        <li>
          <b>Ved påmelding:</b> navn, e-post, telefonnummer og det du skriver i
          kommentarfeltet, samt tidspunkt og at du har godtatt at påmeldingen er
          bindende. Vi bruker dette til å holde oversikt over hvem som kommer,
          sende bekreftelse og ta kontakt hvis noe endrer seg. Grunnlaget er
          avtalen med deg (personvernforordningen art. 6 nr. 1 b).
        </li>
        <li>
          <b>Betaling:</b> beløp, betalingsstatus og påmeldings-ID. Vi ser ikke
          kortnummer eller kontoopplysninger.
        </li>
        <li>
          <b>Allergier og legeerklæring:</b> skriver du allergier i
          kommentarfeltet, eller sender oss legeerklæring for å trekke
          påmeldingen, er dette helseopplysninger. Vi bruker dem bare til
          formålet, deler dem ikke med flere enn nødvendig, og sletter
          legeerklæringen når saken er ferdig behandlet. Grunnlaget er at du
          selv gir oss opplysningene for dette formålet (art. 9 nr. 2 a).
        </li>
        <li>
          <b>Besøksstatistikk:</b> hvilken nettside du kom fra, om du brukte
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
        Betalingen skjer med <b>Vipps</b> (Vipps MobilePay AS), som behandler
        betalingen etter sine egne vilkår. Vi gir KUMI antall deltakere og
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
        behandlingen. Skriv til <Epost />. Du kan også klage til Datatilsynet
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
        {page === "vilkar" ? <Vilkar info={info} /> : <Personvern />}
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
