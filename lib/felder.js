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
//   farbe               Hex-Farbe #rrggbb (wird im Gespann und in den Kacheln als Farbe des Icons gezeigt)
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

/** Anzahl der Räder je Art des Anhängers, wenn die Art sie vorgibt */
export const ANZAHL_RAEDER_AUS_AUFBAU = Object.freeze({ einachser: 2, doppelachser: 4 });

/** Setzt die Anzahl der Räder bei Anhängern mit fester Achsenzahl (ändert werte) */
export function anzahlRaederAbleiten(werte) {
  const n = ANZAHL_RAEDER_AUS_AUFBAU[werte?.aufbau];
  if (n !== undefined) werte.anzahl_raeder = n;
  return werte;
}

/** Anzahl der Räder je Bauart des Fahrrads: Fahrrad und Lastenrad 2, Trike 3, Quad 4 */
export const ANZAHL_RAEDER_AUS_BAUART = Object.freeze({
  fahrrad: 2, fahrrad_dach: 2, fahrrad_kabine: 2, lastenrad: 2, lastenrad_kabine: 2,
  trike: 3, trike_dach: 3,
  quad: 4, quad_dach: 4
});

/** Setzt die Anzahl der Räder je Bauart (ändert werte) */
export function anzahlRaederAusBauart(werte) {
  const n = ANZAHL_RAEDER_AUS_BAUART[werte?.bauart];
  if (n !== undefined) werte.anzahl_raeder = n;
  return werte;
}

const FAHRRAD = [
  { key: 'bauart', typ: 'auswahl', gruppe: 'allgemein', label: J('Bauart', 'Type'), optionen: [
    O('fahrrad', 'Fahrrad', 'Bicycle'), O('fahrrad_dach', 'Fahrrad mit Dach', 'Bicycle with roof'),
    O('fahrrad_kabine', 'Fahrrad mit Wohnkabine', 'Bicycle with living cabin'),
    O('trike', 'Trike', 'Trike'), O('trike_dach', 'Trike mit Dach', 'Trike with roof'),
    O('quad', 'Quad', 'Quad'), O('quad_dach', 'Quad mit Dach', 'Quad with roof'),
    O('lastenrad', 'Lastenrad', 'Cargo bike'), O('lastenrad_kabine', 'Lastenrad mit Wohnkabine', 'Cargo bike with living cabin')] },
  { key: 'farbe', typ: 'farbe', gruppe: 'allgemein', label: J('Farbe', 'Colour'), hinweis: J('Das Icon wird in dieser Farbe gezeigt. Ohne Auswahl bleibt es in der Standardfarbe.', 'The icon is shown in this colour. Without a choice it keeps the default colour.') },
  { key: 'name', typ: 'text', gruppe: 'allgemein', max: 80, label: J('Name', 'Name'), hinweis: J('Dein Name für das Fahrrad, z. B. „Lastenrad grün“.', 'Your name for the bike, e.g. “green cargo bike”.') },
  { key: 'schaltung_art', typ: 'auswahl', gruppe: 'raeder', label: J('Schaltung', 'Gears'), optionen: [
    O('kette', 'Kettenschaltung', 'Derailleur'), O('nabe', 'Nabenschaltung', 'Hub gear'), O('getriebe', 'Getriebe (z. B. Pinion)', 'Gearbox (e.g. Pinion)'),
    O('stufenlos', 'Stufenlos', 'Continuously variable'), O('ohne', 'Ohne Schaltung', 'Single speed')] },
  { key: 'gaenge', typ: 'ganzzahl', gruppe: 'raeder', min: 1, max: 50, label: J('Anzahl Gänge', 'Number of gears') },
  { key: 'radgroesse_zoll', typ: 'zahl', gruppe: 'raeder', min: 10, max: 32, einheit: '"', label: J('Radgröße', 'Wheel size'), hinweis: J('In Zoll, z. B. 26 oder 27,5.', 'In inches, e.g. 26 or 27.5.') },
  { key: 'reifenbreite_mm', typ: 'zahl', gruppe: 'raeder', min: 15, max: 200, einheit: 'mm', label: J('Reifenbreite', 'Tire width') },
  { key: 'anzahl_raeder', typ: 'ganzzahl', gruppe: 'raeder', min: 2, max: 4, label: J('Anzahl Räder', 'Number of wheels') },
  { key: 'gewicht_kg', typ: 'zahl', gruppe: 'gewicht', min: 3, max: 150, einheit: 'kg', label: J('Leergewicht', 'Empty weight'), hinweis: J('Mit Hauptakku, ohne Zusatzakku.', 'With main battery, without extra battery.') },
  { key: 'notiz', typ: 'langtext', gruppe: 'notiz', max: 500, label: J('Notiz', 'Note') }
];

const ANHAENGER = [
  { key: 'name', typ: 'text', gruppe: 'allgemein', max: 80, label: J('Name', 'Name'), hinweis: J('Dein Name für den Anhänger, z. B. „Wohnwagen Sommer“.', 'Your name for the trailer, e.g. “summer caravan”.') },
  { key: 'aufbau', typ: 'auswahl', gruppe: 'allgemein', label: J('Art des Anhängers', 'Type of trailer'), optionen: [
    O('einachser', 'Anhänger mit einer Achse', 'Single-axle trailer'), O('doppelachser', 'Anhänger mit Doppelachse', 'Twin-axle trailer'),
    O('drehschemel', 'Anhänger mit Drehschemel', 'Drawbar trailer'), O('lastenanhaenger', 'Lastenrad-Anhänger', 'Cargo bike trailer'),
    O('wohnkabine', 'Lastenrad mit Wohnkabine', 'Cargo bike with living cabin'), O('sonstiges', 'Sonstiges', 'Other')] },
  { key: 'farbe', typ: 'farbe', gruppe: 'allgemein', label: J('Farbe', 'Colour'), hinweis: J('Das Icon wird in dieser Farbe gezeigt. Ohne Auswahl bleibt es in der Standardfarbe.', 'The icon is shown in this colour. Without a choice it keeps the default colour.') },
  { key: 'anzahl_raeder', typ: 'ganzzahl', gruppe: 'raeder', min: 1, max: 4, label: J('Anzahl Räder', 'Number of wheels') },
  { key: 'radgroesse_zoll', typ: 'zahl', gruppe: 'raeder', min: 8, max: 32, einheit: '"', label: J('Radgröße', 'Wheel size'), hinweis: J('In Zoll, z. B. 20 oder 26.', 'In inches, e.g. 20 or 26.') },
  { key: 'reifenbreite_mm', typ: 'zahl', gruppe: 'raeder', min: 15, max: 200, einheit: 'mm', label: J('Reifenbreite', 'Tire width') },
  { key: 'leergewicht_kg', typ: 'zahl', gruppe: 'gewicht', min: 1, max: 500, einheit: 'kg', label: J('Leergewicht', 'Empty weight') },
  { key: 'max_zuladung_kg', typ: 'zahl', gruppe: 'gewicht', min: 0, max: 500, einheit: 'kg', label: J('Maximale Zuladung', 'Maximum payload') },
  { key: 'breite_cm', typ: 'zahl', gruppe: 'gewicht', min: 30, max: 250, einheit: 'cm', label: J('Breite', 'Width') },
  { key: 'hoehe_cm', typ: 'zahl', gruppe: 'gewicht', min: 30, max: 300, einheit: 'cm', label: J('Höhe', 'Height') },
  { key: 'laenge_cm', typ: 'zahl', gruppe: 'gewicht', min: 50, max: 600, einheit: 'cm', label: J('Länge', 'Length') },
  { key: 'solar_wp', typ: 'zahl', gruppe: 'zusatz', min: 0, max: 1000, einheit: 'Wp', label: J('Solarleistung', 'Solar power'), hinweis: J('Gesamte Spitzenleistung der Solarmodule.', 'Total peak power of the solar panels.') },
  { key: 'notiz', typ: 'langtext', gruppe: 'notiz', max: 500, label: J('Notiz', 'Note') }
];

/**
 * Das aktuelle Gespann einer Garage (genau eines): ein Fahrrad und ein Anhänger aus der Garage, dazu die Gewichte der Fahrt.
 * Die beiden Plätze dürfen leer sein; wird ein Fahrrad oder Anhänger gelöscht, wird sein Platz leer.
 */
/** Gepäck (Zuladung) als eigene Kachel; das Gewicht zählt im Gespann, wenn die Kachel dazugehört */
const GEPAECK = [
  { key: 'name', typ: 'text', gruppe: 'allgemein', max: 80, label: J('Name', 'Name'), hinweis: J('z. B. „Einkauf“ oder „Zelt“.', 'e.g. “shopping” or “tent”.') },
  { key: 'typ', typ: 'auswahl', gruppe: 'allgemein', label: J('Art', 'Type'), optionen: [
    O('tasche', 'Tasche', 'Bag'), O('kiste', 'Kiste', 'Box'), O('lenkertasche', 'Lenkertasche', 'Handlebar bag'),
    O('rahmentasche', 'Rahmentasche', 'Frame bag'), O('satteltasche', 'Satteltasche', 'Saddle bag'),
    O('gepaecktraeger', 'Gepäckträgertasche', 'Rear rack bag'), O('rucksack', 'Rucksack', 'Backpack'), O('sonstiges', 'Sonstiges', 'Other')] },
  { key: 'farbe', typ: 'farbe', gruppe: 'allgemein', label: J('Farbe', 'Colour'), hinweis: J('Das Icon wird in dieser Farbe gezeigt. Ohne Auswahl bleibt es in der Standardfarbe.', 'The icon is shown in this colour. Without a choice it keeps the default colour.') },
  { key: 'gewicht_kg', typ: 'zahl', gruppe: 'gewicht', min: 0, max: 500, einheit: 'kg', label: J('Gewicht', 'Weight'), hinweis: J('Alles, was zusätzlich mitfährt.', 'Everything that rides along.') },
  { key: 'notiz', typ: 'langtext', gruppe: 'notiz', max: 500, label: J('Notiz', 'Note') }
];

/** Das Gespann hat nur noch/** Das Gespann hat nur noch den Fahrergewicht-Wert; Gepäck ist eine eigene Kachel */
export const GESPANN_FELDER = [
  { key: 'fahrer_gewicht_kg', typ: 'zahl', gruppe: 'fahrt', min: 20, max: 250, einheit: 'kg', label: J('Fahrergewicht', 'Rider weight') }
];

/** Name der Fahrerin oder des Fahrers einer Garage: wird beim Anlegen abgefragt und steht im Gespann statt „Fahrer“ */
export const FAHRER_NAME_FELD = { key: 'fahrer_name', typ: 'text', pflicht: true, max: 40, label: J('Name der Fahrerin oder des Fahrers', 'Name of the rider'), hinweis: J('Ein Vorname oder Spitzname reicht.', 'A first name or nickname is enough.') };

/** E-Mail-Adresse einer Garage (freiwillig; wird bestätigt, bevor sie gilt) */
export const EMAIL_FELD = { key: 'email', typ: 'email', pflicht: true, max: 254, label: J('E-Mail-Adresse', 'Email address') };

/** Die Arten von Einträgen, die ein Nutzer beliebig oft anlegt. tabelle und Spaltennamen kommen nur von hier, nie aus Eingaben. */
export const ARTEN = {
  fahrraeder: { tabelle: 'fahrraeder', max: 20, felder: FAHRRAD, name: J('Fahrrad', 'Bike') },
  anhaenger: { tabelle: 'anhaenger', max: 20, felder: ANHAENGER, name: J('Anhänger', 'Trailer') },
  gepaecke: { tabelle: 'gepaecke', max: 10, felder: GEPAECK, name: J('Gepäck', 'Luggage') }
};

export const ART_NAMEN = Object.keys(ARTEN);

/** Name, wenn keiner angegeben ist: die Bezeichnung der Bauart, der Anhänger-Art oder der Gepäckart (deutsch), sonst die Art selbst */
export function standardName(art, werte) {
  const schluessel = { fahrraeder: 'bauart', anhaenger: 'aufbau', gepaecke: 'typ' }[art];
  const option = ARTEN[art].felder.find((f) => f.key === schluessel)?.optionen?.find((o) => o.wert === werte?.[schluessel]);
  return option ? option.de : ARTEN[art].name.de;
}

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
    } else if (f.typ === 'farbe') {
      if (typeof roh !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(roh.trim())) { fehler[f.key] = 'ungueltig'; continue; }
      werte[f.key] = roh.trim().toLowerCase();
    } else if (f.typ === 'verweis') {
      const n = alsZahl(roh);
      if (!Number.isInteger(n) || n < 1 || n > 4294967295) { fehler[f.key] = 'ungueltig'; continue; }
      werte[f.key] = n;
    }
  }

  return { werte, fehler: Object.keys(fehler).length ? fehler : null };
}
