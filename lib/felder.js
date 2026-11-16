// Felder der Einträge (Fahrrad, Anhänger, Gespann): eine einzige Beschreibung, aus der der Server prüft und die Oberfläche die
// Formulare und Anzeigen baut. Keine Node-Abhängigkeiten, damit der Browser dieselbe Datei nutzen kann.
//
// Feldtypen:
//   text, langtext      Zeichenkette (max = Höchstlänge)
//   zahl                Dezimalzahl (min, max, einheit)
//   ganzzahl            ganze Zahl (min, max)
//   auswahl             einer der Werte aus optionen
//   email               E-Mail-Adresse (wird klein geschrieben, max = Höchstlänge)
//   verweis             ID eines Eintrags einer anderen Art (verweis: 'fahrraeder' | 'anhaenger')
// Neue Felder brauchen zusätzlich eine Spalte (neue Migration in lib/migrationen.js); tests/felder.test.js prüft das.

const J = (de, en) => ({ de, en });
const O = (wert, de, en) => ({ wert, de, en });

export const GRUPPEN = {
  allgemein: J('Allgemein', 'General'),
  antrieb: J('Antrieb', 'Drive'),
  akku: J('Akku', 'Battery'),
  raeder: J('Räder und Schaltung', 'Wheels and gears'),
  gewicht: J('Gewicht und Maße', 'Weight and size'),
  zusatz: J('Solar und Zusatzakku', 'Solar and extra battery'),
  notiz: J('Weitere Angaben', 'More details'),
  gespann: J('Zusammenstellung', 'Combination'),
  fahrt: J('Gewicht bei der Fahrt', 'Weight when riding')
};

const FAHRRAD = [
  { key: 'bauart', typ: 'auswahl', gruppe: 'allgemein', label: J('Bauart', 'Type'), optionen: [
    O('fahrrad', 'Fahrrad', 'Bicycle'), O('fahrrad_dach', 'Fahrrad mit Dach', 'Bicycle with roof'),
    O('trike', 'Trike', 'Trike'), O('trike_dach', 'Trike mit Dach', 'Trike with roof'),
    O('quad', 'Quad', 'Quad'), O('quad_dach', 'Quad mit Dach', 'Quad with roof'),
    O('lastenrad', 'Lastenrad', 'Cargo bike'), O('lastenrad_kabine', 'Lastenrad mit Wohnkabine', 'Cargo bike with living cabin')] },
  { key: 'name', typ: 'text', gruppe: 'allgemein', pflicht: true, max: 80, label: J('Name', 'Name'), hinweis: J('Dein Name für das Fahrrad, z. B. „Lastenrad grün“.', 'Your name for the bike, e.g. “green cargo bike”.') },
  { key: 'motor_system', typ: 'text', gruppe: 'antrieb', max: 80, label: J('Motorsystem', 'Motor system'), hinweis: J('Hersteller und Typ, z. B. Bosch Cargo Line.', 'Manufacturer and type, e.g. Bosch Cargo Line.') },
  { key: 'motor_art', typ: 'auswahl', gruppe: 'antrieb', label: J('Bauart des Motors', 'Motor type'), optionen: [
    O('mittelmotor', 'Mittelmotor', 'Mid-drive'), O('nabe_hinten', 'Nabenmotor hinten', 'Rear hub motor'),
    O('nabe_vorn', 'Nabenmotor vorn', 'Front hub motor'), O('ohne', 'Ohne Motor', 'No motor')] },
  { key: 'motor_nennleistung_w', typ: 'zahl', gruppe: 'antrieb', min: 0, max: 2000, einheit: 'W', label: J('Nennleistung', 'Rated power') },
  { key: 'motor_drehmoment_nm', typ: 'zahl', gruppe: 'antrieb', min: 0, max: 250, einheit: 'Nm', label: J('Drehmoment', 'Torque') },
  { key: 'akku_kapazitaet_wh', typ: 'zahl', gruppe: 'akku', min: 0, max: 5000, einheit: 'Wh', label: J('Akkukapazität', 'Battery capacity') },
  { key: 'akku_spannung_v', typ: 'zahl', gruppe: 'akku', min: 0, max: 100, einheit: 'V', label: J('Spannung', 'Voltage') },
  { key: 'schaltung_art', typ: 'auswahl', gruppe: 'raeder', label: J('Schaltung', 'Gears'), optionen: [
    O('kette', 'Kettenschaltung', 'Derailleur'), O('nabe', 'Nabenschaltung', 'Hub gear'), O('getriebe', 'Getriebe (z. B. Pinion)', 'Gearbox (e.g. Pinion)'),
    O('stufenlos', 'Stufenlos', 'Continuously variable'), O('ohne', 'Ohne Schaltung', 'Single speed')] },
  { key: 'gaenge', typ: 'ganzzahl', gruppe: 'raeder', min: 1, max: 50, label: J('Anzahl Gänge', 'Number of gears') },
  { key: 'radgroesse_zoll', typ: 'zahl', gruppe: 'raeder', min: 10, max: 32, einheit: '"', label: J('Radgröße', 'Wheel size'), hinweis: J('In Zoll, z. B. 26 oder 27,5.', 'In inches, e.g. 26 or 27.5.') },
  { key: 'reifenbreite_mm', typ: 'zahl', gruppe: 'raeder', min: 15, max: 200, einheit: 'mm', label: J('Reifenbreite', 'Tire width') },
  { key: 'anzahl_raeder', typ: 'ganzzahl', gruppe: 'raeder', min: 2, max: 4, label: J('Anzahl Räder', 'Number of wheels') },
  { key: 'gewicht_kg', typ: 'zahl', gruppe: 'gewicht', min: 3, max: 150, einheit: 'kg', label: J('Leergewicht', 'Empty weight'), hinweis: J('Mit Hauptakku, ohne Zusatzakku.', 'With main battery, without extra battery.') },
  { key: 'zusatzakku_wh', typ: 'zahl', gruppe: 'zusatz', min: 0, max: 5000, einheit: 'Wh', label: J('Zusatzakku am Fahrrad', 'Extra battery on the bike') },
  { key: 'zusatzakku_gewicht_kg', typ: 'zahl', gruppe: 'zusatz', min: 0, max: 50, einheit: 'kg', label: J('Gewicht des Zusatzakkus', 'Weight of the extra battery') },
  { key: 'notiz', typ: 'langtext', gruppe: 'notiz', max: 500, label: J('Notiz', 'Note') }
];

const ANHAENGER = [
  { key: 'name', typ: 'text', gruppe: 'allgemein', pflicht: true, max: 80, label: J('Name', 'Name'), hinweis: J('Dein Name für den Anhänger, z. B. „Wohnwagen Sommer“.', 'Your name for the trailer, e.g. “summer caravan”.') },
  { key: 'aufbau', typ: 'auswahl', gruppe: 'allgemein', label: J('Art des Anhängers', 'Type of trailer'), optionen: [
    O('einachser', 'Anhänger mit einer Achse', 'Single-axle trailer'), O('doppelachser', 'Anhänger mit Doppelachse', 'Twin-axle trailer'),
    O('drehschemel', 'Anhänger mit Drehschemel', 'Drawbar trailer'), O('lastenanhaenger', 'Lastenrad-Anhänger', 'Cargo bike trailer'),
    O('wohnkabine', 'Lastenrad mit Wohnkabine', 'Cargo bike with living cabin'), O('sonstiges', 'Sonstiges', 'Other')] },
  { key: 'anzahl_raeder', typ: 'ganzzahl', gruppe: 'raeder', min: 1, max: 4, label: J('Anzahl Räder', 'Number of wheels') },
  { key: 'radgroesse_zoll', typ: 'zahl', gruppe: 'raeder', min: 8, max: 32, einheit: '"', label: J('Radgröße', 'Wheel size'), hinweis: J('In Zoll, z. B. 20 oder 26.', 'In inches, e.g. 20 or 26.') },
  { key: 'reifenbreite_mm', typ: 'zahl', gruppe: 'raeder', min: 15, max: 200, einheit: 'mm', label: J('Reifenbreite', 'Tire width') },
  { key: 'leergewicht_kg', typ: 'zahl', gruppe: 'gewicht', min: 1, max: 500, einheit: 'kg', label: J('Leergewicht', 'Empty weight') },
  { key: 'max_zuladung_kg', typ: 'zahl', gruppe: 'gewicht', min: 0, max: 500, einheit: 'kg', label: J('Maximale Zuladung', 'Maximum payload') },
  { key: 'breite_cm', typ: 'zahl', gruppe: 'gewicht', min: 30, max: 250, einheit: 'cm', label: J('Breite', 'Width') },
  { key: 'hoehe_cm', typ: 'zahl', gruppe: 'gewicht', min: 30, max: 300, einheit: 'cm', label: J('Höhe', 'Height') },
  { key: 'laenge_cm', typ: 'zahl', gruppe: 'gewicht', min: 50, max: 600, einheit: 'cm', label: J('Länge', 'Length') },
  { key: 'solar_wp', typ: 'zahl', gruppe: 'zusatz', min: 0, max: 1000, einheit: 'Wp', label: J('Solarleistung', 'Solar power'), hinweis: J('Gesamte Spitzenleistung der Solarmodule.', 'Total peak power of the solar panels.') },
  { key: 'zusatzakku_wh', typ: 'zahl', gruppe: 'zusatz', min: 0, max: 5000, einheit: 'Wh', label: J('Zusatzakku im Anhänger', 'Extra battery in the trailer') },
  { key: 'zusatzakku_gewicht_kg', typ: 'zahl', gruppe: 'zusatz', min: 0, max: 100, einheit: 'kg', label: J('Gewicht des Zusatzakkus', 'Weight of the extra battery') },
  { key: 'notiz', typ: 'langtext', gruppe: 'notiz', max: 500, label: J('Notiz', 'Note') }
];

/**
 * Das aktuelle Gespann einer Garage (genau eines): ein Fahrrad und ein Anhänger aus der Garage, dazu die Gewichte der Fahrt.
 * Die beiden Plätze dürfen leer sein; wird ein Fahrrad oder Anhänger gelöscht, wird sein Platz leer.
 */
export const GESPANN_FELDER = [
  { key: 'fahrer_gewicht_kg', typ: 'zahl', gruppe: 'fahrt', min: 20, max: 250, einheit: 'kg', label: J('Fahrergewicht', 'Rider weight') },
  { key: 'gepaeck_kg', typ: 'zahl', gruppe: 'fahrt', min: 0, max: 500, einheit: 'kg', label: J('Zuladung und Gepäck', 'Payload and luggage'), hinweis: J('Alles, was zusätzlich zum Leergewicht mitfährt.', 'Everything that rides along in addition to the empty weight.') }
];

/** Name der Fahrerin oder des Fahrers einer Garage: wird beim Anlegen abgefragt und steht im Gespann statt „Fahrer“ */
export const FAHRER_NAME_FELD = { key: 'fahrer_name', typ: 'text', pflicht: true, max: 40, label: J('Name der Fahrerin oder des Fahrers', 'Name of the rider'), hinweis: J('Ein Vorname oder Spitzname reicht.', 'A first name or nickname is enough.') };

/** E-Mail-Adresse einer Garage (freiwillig; wird bestätigt, bevor sie gilt) */
export const EMAIL_FELD = { key: 'email', typ: 'email', pflicht: true, max: 254, label: J('E-Mail-Adresse', 'Email address') };

/** Die Arten von Einträgen, die ein Nutzer beliebig oft anlegt. tabelle und Spaltennamen kommen nur von hier, nie aus Eingaben. */
export const ARTEN = {
  fahrraeder: { tabelle: 'fahrraeder', max: 20, felder: FAHRRAD, name: J('Fahrrad', 'Bike') },
  anhaenger: { tabelle: 'anhaenger', max: 20, felder: ANHAENGER, name: J('Anhänger', 'Trailer') }
};

export const ART_NAMEN = Object.keys(ARTEN);

/** Entfernt Steuerzeichen (außer Zeilenumbruch bei langem Text) und trimmt. */
function bereinige(text, mehrzeilig) {
  const ohne = mehrzeilig
    ? text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    : text.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return ohne.trim();
}

function leer(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Zahl aus Zahl oder Text (auch mit Komma); sonst NaN */
function alsZahl(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const s = v.trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/**
 * Prüft die Eingabe gegen die Felder einer Art. Unbekannte Felder werden ignoriert.
 * Ergebnis: { werte, fehler } — werte enthält jedes Feld (nicht ausgefüllt: null), fehler ist null oder { feld: code }.
 * Fehlercodes: pflicht, ungueltig, zu_lang, zu_klein, zu_gross.
 */
export function pruefeEingabe(felder, eingabe) {
  const quelle = eingabe && typeof eingabe === 'object' && !Array.isArray(eingabe) ? eingabe : {};
  const werte = {};
  const fehler = {};

  for (const f of felder) {
    const roh = quelle[f.key];
    if (leer(roh)) {
      werte[f.key] = null;
      if (f.pflicht) fehler[f.key] = 'pflicht';
      continue;
    }

    if (f.typ === 'text' || f.typ === 'langtext') {
      if (typeof roh !== 'string') { fehler[f.key] = 'ungueltig'; continue; }
      const text = bereinige(roh, f.typ === 'langtext');
      if (text.length > f.max) { fehler[f.key] = 'zu_lang'; continue; }
      if (text === '') { werte[f.key] = null; if (f.pflicht) fehler[f.key] = 'pflicht'; continue; }
      werte[f.key] = text;
    } else if (f.typ === 'email') {
      if (typeof roh !== 'string') { fehler[f.key] = 'ungueltig'; continue; }
      const adresse = roh.trim().toLowerCase();
      if (adresse.length > f.max) { fehler[f.key] = 'zu_lang'; continue; }
      // bewusst schlicht: ein @, Text davor und danach, ein Punkt im Teil danach, keine Leerzeichen oder Steuerzeichen
      if (!/^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\.]{2,}$/.test(adresse)) { fehler[f.key] = 'ungueltig'; continue; }
      werte[f.key] = adresse;
    } else if (f.typ === 'zahl' || f.typ === 'ganzzahl') {
      const n = alsZahl(roh);
      if (!Number.isFinite(n) || (f.typ === 'ganzzahl' && !Number.isInteger(n))) { fehler[f.key] = 'ungueltig'; continue; }
      if (n < f.min) { fehler[f.key] = 'zu_klein'; continue; }
      if (n > f.max) { fehler[f.key] = 'zu_gross'; continue; }
      werte[f.key] = f.typ === 'zahl' ? Math.round(n * 100) / 100 : n;
    } else if (f.typ === 'auswahl') {
      if (typeof roh !== 'string' || !f.optionen.some(o => o.wert === roh)) { fehler[f.key] = 'ungueltig'; continue; }
      werte[f.key] = roh;
    } else if (f.typ === 'verweis') {
      const n = alsZahl(roh);
      if (!Number.isInteger(n) || n < 1 || n > 4294967295) { fehler[f.key] = 'ungueltig'; continue; }
      werte[f.key] = n;
    }
  }

  return { werte, fehler: Object.keys(fehler).length ? fehler : null };
}
