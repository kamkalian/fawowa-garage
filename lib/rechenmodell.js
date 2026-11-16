// Rechenmodell des Reichweiten-Planers: Energieverbrauch eines Pedelec-Gespanns (Fahrrad, Anhänger, Fahrer) auf einem Wegstück
// und Reichweite entlang einer Route. Reine Funktionen ohne Abhängigkeiten (läuft auf dem Server und im Browser).
// Die Annahmen und Formeln stehen in docs/RECHENMODELL.md.
//
// Ablauf:  baueModell(fahrrad, anhaenger, gespann, einstellungen)  ->  { modell, annahmen, fehler }
//          berechneSegment(modell, segment)                         ->  Verbrauch, Zeit, Geschwindigkeit eines Wegstücks
//          reichweiteEntlang(modell, segmente)                      ->  wie weit der Akku auf einer Strecke reicht
//
// Einheiten: Meter, Sekunden, Watt, Wattstunden, Grad. Steigung als Verhältnis (0,05 = 5 %), negativ bergab.

export const G = 9.80665;   // Fallbeschleunigung, m/s²
const RAD = Math.PI / 180;

// ---------- Annahmen, wenn eine Angabe fehlt (das Ergebnis nennt sie in `annahmen`) ----------
export const ANNAHMEN = Object.freeze({
  fahrer_gewicht_kg: 75,
  fahrrad_gewicht_kg: 25,
  anhaenger_leergewicht_kg: 35,
  anhaenger_flaeche_m2: 0.7,   // Stirnfläche des Anhängers
  motor_nennleistung_w: 250,   // gesetzlich übliche Nennleistung eines Pedelecs
  schaltung_wirkungsgrad: 0.93
});

// Luftwiderstand: Fahrer aufrecht, dazu der Teil der Anhänger-Stirnfläche, der nicht im Windschatten von Fahrer und Fahrrad liegt
const CDA_FAHRER_M2 = 0.55;
const WINDSCHATTEN_M2 = 0.45;
const CD_ANHAENGER = 0.9;
const CDA_ANHAENGER_GRUND_M2 = 0.08; // Räder, Deichsel, Aufbauten

const ETA_AKKU = 0.95;             // Entladung des Akkus (Zellen, Elektronik)
const MOTOR_SPITZE_FAKTOR = 1;     // Pedelec: der Motor unterstützt dauerhaft höchstens mit der Nennleistung (250 W)
const SOLAR_WIRKUNG = 0.8;         // vom Nennwert der Module bleibt nach Ausrichtung, Verschattung und Laderegler dieser Anteil
const ABSCHALTGESCHWINDIGKEIT_KMH = 25; // Pedelec: oberhalb unterstützt der Motor nicht mehr
const SCHIEBEN_MS = 5 / 3.6;       // wenn es nicht mehr fahrbar ist: Schieben mit Schiebehilfe
const MIN_FAHRGESCHWINDIGKEIT_MS = 1.8; // darunter gilt ein Wegstück als nicht mehr fahrbar

// Wirkungsgrad der Schaltung (Kette bis Hinterrad) und Bauart des Motors
const SCHALTUNG = { kette: 0.95, nabe: 0.91, getriebe: 0.9, stufenlos: 0.85, ohne: 0.96 };
const MOTOR_ETA = { mittelmotor: 0.8, nabe_hinten: 0.75, nabe_vorn: 0.75 };

/** Unterstützungsstufen: wie viel mechanische Motorleistung höchstens im Verhältnis zur Eigenleistung des Fahrers (Bosch: Eco 60 %, Tour 140 %, eMTB/Sport 240 %, Turbo 340 %) */
export const UNTERSTUETZUNG = Object.freeze({ aus: 0, eco: 0.6, tour: 1.4, sport: 2.4, turbo: 3.4, max: Infinity });

export const EINSTELLUNGEN_STANDARD = Object.freeze({
  akku_rest_prozent: 100,    // Füllstand des Hauptakkus
  zusatz_rest_prozent: null, // Füllstand der Zusatzakkus; null = wie der Hauptakku
  reserve_prozent: 5,        // dieser Anteil der Gesamtkapazität bleibt unangetastet
  geschwindigkeit_kmh: 18,   // gewünschte Reisegeschwindigkeit (bei zu viel Steigung langsamer)
  eigenleistung_w: 60,       // durchschnittliche Tretleistung des Fahrers auf der Ebene
  eigenleistung_max_w: 150,  // so viel tritt er höchstens, wenn es bergauf mehr braucht (er tritt nur so viel mehr, wie nötig ist)
  unterstuetzung: 'tour',
  wind_ms: 0,                // Windgeschwindigkeit
  wind_richtung_grad: 0,     // Richtung, AUS der der Wind weht (Wetterdienst-Konvention: 0 = Nord, 90 = Ost)
  temperatur_c: 15,
  hoehe_m: 100,
  einstrahlung_w_m2: 0,      // Sonneneinstrahlung auf die Solarmodule
  oberflaeche: 1,            // Rollwiderstand relativ zu Asphalt (1 = glatter Asphalt, 1,6 = Pflaster, 2 = fester Schotter)
  budget_art: 'akku',        // 'akku' (Energie aus dem Akku) oder 'zeit' (feste Fahrtzeit, ohne Akkugrenze)
  fahrtzeit_h: 3,            // Fahrtzeit in Stunden, wenn budget_art 'zeit' ist
});

/** Grenzen der Einstellungen (für die Prüfung von Eingaben) */
export const EINSTELLUNGEN_GRENZEN = Object.freeze({
  akku_rest_prozent: [0, 100], zusatz_rest_prozent: [0, 100], reserve_prozent: [0, 50], geschwindigkeit_kmh: [5, ABSCHALTGESCHWINDIGKEIT_KMH],
  eigenleistung_w: [20, 300], eigenleistung_max_w: [20, 400], wind_ms: [0, 25], wind_richtung_grad: [0, 360], temperatur_c: [-30, 45], hoehe_m: [-100, 4000],
  einstrahlung_w_m2: [0, 1200], oberflaeche: [0.8, 4], fahrtzeit_h: [0.5, 12]
});

const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const begrenze = (x, [min, max]) => Math.min(max, Math.max(min, x));

/**
 * Prüft Einstellungen: unbekannte Felder werden ignoriert, fehlende bekommen den Standardwert.
 * Ergebnis: { werte, fehler } — fehler ist null oder { feld: 'ungueltig' | 'zu_klein' | 'zu_gross' }.
 */
export function pruefeEinstellungen(roh) {
  const quelle = roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {};
  const werte = { ...EINSTELLUNGEN_STANDARD };
  const fehler = {};

  for (const [key, grenzen] of Object.entries(EINSTELLUNGEN_GRENZEN)) {
    const v = quelle[key];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(',', '.')) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) { fehler[key] = 'ungueltig'; continue; }
    if (n < grenzen[0]) { fehler[key] = 'zu_klein'; continue; }
    if (n > grenzen[1]) { fehler[key] = 'zu_gross'; continue; }
    werte[key] = n;
  }
  if (quelle.budget_art !== undefined && quelle.budget_art !== null && quelle.budget_art !== '') {
    if (quelle.budget_art === 'akku' || quelle.budget_art === 'zeit') werte.budget_art = quelle.budget_art;
    else fehler.budget_art = 'ungueltig';
  }
  if (quelle.unterstuetzung !== undefined && quelle.unterstuetzung !== null && quelle.unterstuetzung !== '') {
    if (Object.hasOwn(UNTERSTUETZUNG, quelle.unterstuetzung)) werte.unterstuetzung = quelle.unterstuetzung;
    else fehler.unterstuetzung = 'ungueltig';
  }
  return { werte, fehler: Object.keys(fehler).length ? fehler : null };
}

/** Luftdichte in kg/m³ aus Temperatur und Höhe über dem Meer (barometrische Höhenformel) */
export function luftdichte(temperatur_c = 15, hoehe_m = 0) {
  const druck = 101325 * Math.pow(1 - 2.25577e-5 * hoehe_m, 5.25588);
  return druck / (287.058 * (temperatur_c + 273.15));
}

/** Rollwiderstandsbeiwert aus Reifenbreite und Radgröße (Faustwerte für Asphalt); ohne Angabe ein mittlerer Wert */
export function rollwiderstandsbeiwert(breite_mm, radgroesse_zoll) {
  let crr = 0.006;
  const b = zahl(breite_mm);
  if (b !== null) crr = b < 30 ? 0.005 : b <= 50 ? 0.006 : 0.0065;
  const z = zahl(radgroesse_zoll);
  if (z !== null && z <= 20) crr += 0.002; // kleine Räder rollen schlechter
  return crr;
}

/**
 * Windanteil in Fahrtrichtung in m/s: positiv = Gegenwind, negativ = Rückenwind.
 * richtung_grad: Fahrtrichtung (0 = Nord, 90 = Ost); windAus_grad: Richtung, aus der der Wind weht.
 */
export function gegenwindAnteil(wind_ms, windAus_grad, richtung_grad) {
  return wind_ms * Math.cos((richtung_grad - windAus_grad) * RAD);
}

// ---------- Modell aus den Einträgen der Garage ----------

/**
 * Baut das Rechenmodell. fahrrad (Pflicht), anhaenger (optional), gespann (Fahrer- und Zuladungsgewicht) sind Einträge der Garage
 * (Feldnamen wie in lib/felder.js). einstellungen: siehe EINSTELLUNGEN_STANDARD (ungültige Werte führen zu einem Fehler im Ergebnis).
 * Ergebnis:
 *   modell    – alles, was berechneSegment braucht, oder null bei Fehlern
 *   annahmen  – Angaben, die gefehlt haben und durch Standardwerte ersetzt wurden (Feldnamen)
 *   fehler    – Gründe, warum nicht gerechnet werden kann: 'fahrrad_fehlt', 'kein_motor', 'akku_fehlt', 'einstellungen_ungueltig'
 */
export const MOTOR_ARTEN = Object.freeze(['mittelmotor', 'nabe_hinten', 'nabe_vorn']);

/** Hat das Fahrrad einen Motor? Bauart aus der Liste, oder ohne Bauart eine Nennleistung. Ohne Angaben gilt: kein Motor. */
export function hatMotor(fahrrad) {
  if (!fahrrad) return false;
  if (MOTOR_ARTEN.includes(fahrrad.motor_art)) return true;
  return (fahrrad.motor_art === null || fahrrad.motor_art === undefined) && (zahl(fahrrad.motor_nennleistung_w) ?? 0) > 0;
}

export function baueModell(fahrrad, anhaenger = null, gespann = null, einstellungen = {}) {
  const annahmen = [];
  const { werte: eingestellt, fehler: einstFehler } = pruefeEinstellungen(einstellungen);
  const fehler = [];
  if (einstFehler) fehler.push('einstellungen_ungueltig');
  if (!fahrrad) fehler.push('fahrrad_fehlt');
  if (fehler.length) return { modell: null, annahmen, fehler };

  const motor = hatMotor(fahrrad);
  const zeitModus = eingestellt.budget_art === 'zeit';
  // Ohne Motor fährt das Gespann allein mit der Eigenleistung
  const einst = { ...eingestellt, unterstuetzung: motor ? eingestellt.unterstuetzung : 'aus' };
  const motorArt = fahrrad.motor_art ?? null;
  const haupt = zahl(fahrrad.akku_kapazitaet_wh) ?? 0;
  const zusatzFahrrad = zahl(fahrrad.zusatzakku_wh) ?? 0;
  const zusatzAnhaenger = anhaenger ? (zahl(anhaenger.zusatzakku_wh) ?? 0) : 0;
  const kapazitaet = haupt + zusatzFahrrad + zusatzAnhaenger;

  if (!zeitModus) {
    if (!motor) fehler.push('kein_motor');
    else if (kapazitaet <= 0) fehler.push('akku_fehlt');
    if (fehler.length) return { modell: null, annahmen, fehler };
  }

  const mitAnnahme = (wert, standard, name) => {
    const w = zahl(wert);
    if (w !== null && w > 0) return w;
    annahmen.push(name);
    return standard;
  };

  const zusatzRest = einst.zusatz_rest_prozent ?? einst.akku_rest_prozent;
  const startWh = haupt * einst.akku_rest_prozent / 100 + (zusatzFahrrad + zusatzAnhaenger) * zusatzRest / 100;
  const reserveWh = kapazitaet * einst.reserve_prozent / 100;

  if (motor && !MOTOR_ETA[motorArt]) annahmen.push('motor_art');
  const motorUeberKette = motorArt !== 'nabe_hinten' && motorArt !== 'nabe_vorn';
  const nenn = motor ? mitAnnahme(fahrrad.motor_nennleistung_w, ANNAHMEN.motor_nennleistung_w, 'motor_nennleistung_w') : 0;
  const etaKette = SCHALTUNG[fahrrad.schaltung_art] ?? (annahmen.push('schaltung_art'), ANNAHMEN.schaltung_wirkungsgrad);

  // Massen: m1 = Fahrrad mit Fahrer, m2 = Anhänger mit Zuladung. Ohne Anhänger fährt die Zuladung am Fahrrad mit.
  const fahrer = mitAnnahme(gespann?.fahrer_gewicht_kg, ANNAHMEN.fahrer_gewicht_kg, 'fahrer_gewicht_kg');
  const zuladung = zahl(gespann?.gepaeck_kg) ?? 0;
  const radLeer = mitAnnahme(fahrrad.gewicht_kg, ANNAHMEN.fahrrad_gewicht_kg, 'gewicht_kg');
  const m1 = fahrer + radLeer + (zahl(fahrrad.zusatzakku_gewicht_kg) ?? 0) + (anhaenger ? 0 : zuladung);
  const m2 = anhaenger
    ? mitAnnahme(anhaenger.leergewicht_kg, ANNAHMEN.anhaenger_leergewicht_kg, 'leergewicht_kg') + (zahl(anhaenger.zusatzakku_gewicht_kg) ?? 0) + zuladung
    : 0;

  const crr1 = rollwiderstandsbeiwert(fahrrad.reifenbreite_mm, fahrrad.radgroesse_zoll);
  const crr2 = anhaenger ? rollwiderstandsbeiwert(anhaenger.reifenbreite_mm, anhaenger.radgroesse_zoll) : 0;
  let cda = CDA_FAHRER_M2;
  if (anhaenger) {
    const breite = zahl(anhaenger.breite_cm);
    const hoehe = zahl(anhaenger.hoehe_cm);
    let flaeche = ANNAHMEN.anhaenger_flaeche_m2;
    if (breite !== null && hoehe !== null) flaeche = breite / 100 * hoehe / 100;
    else annahmen.push('anhaenger_flaeche');
    cda += CDA_ANHAENGER_GRUND_M2 + CD_ANHAENGER * Math.max(0, flaeche - WINDSCHATTEN_M2);
  }

  const nutzbar = Math.max(0, startWh - reserveWh);
  const modell = {
    einstellungen: einst,
    m1_kg: m1, m2_kg: m2, masse_kg: m1 + m2,
    crr1, crr2, cda_m2: cda,
    eta_kette: etaKette,
    motor: {
      art: motorArt, ueber_kette: motorUeberKette, eta: MOTOR_ETA[motorArt] ?? 0.77,
      nennleistung_w: nenn, spitze_w: nenn * MOTOR_SPITZE_FAKTOR
    },
    akku: { kapazitaet_wh: kapazitaet, start_wh: startWh, reserve_wh: reserveWh, nutzbar_wh: nutzbar },
    budget: { art: einst.budget_art, wh: nutzbar, s: einst.fahrtzeit_h * 3600 },
    solar_wp: anhaenger ? (zahl(anhaenger.solar_wp) ?? 0) : 0
  };
  return { modell, annahmen: [...new Set(annahmen)], fehler: [] };
}

// ---------- Ein Wegstück ----------

/**
 * Rechnet ein Wegstück durch.
 * segment: { laenge_m, steigung, richtung_grad, oberflaeche? } — oberflaeche überschreibt den Wert aus den Einstellungen.
 * Ergebnis: {
 *   v_ms, zeit_s,        Geschwindigkeit und Fahrzeit
 *   schieben,            true, wenn das Stück mit der gewählten Unterstützung nicht mehr fahrbar ist (Schieben mit Schiebehilfe)
 *   motor_wh,            Entnahme aus dem Akku durch den Motor
 *   solar_wh,            Ladung durch die Solarmodule im selben Zeitraum
 *   batterie_wh,         motor_wh − solar_wh (negativ: der Akku wird geladen)
 *   wh_pro_km,           batterie_wh je Kilometer (für die Farbe der Karte)
 *   leistung_rad_w,      mechanische Leistung am Hinterrad
 *   eigenleistung_w      Tretleistung des Fahrers auf diesem Stück
 * }
 */
export function berechneSegment(modell, segment) {
  const e = modell.einstellungen;
  const laenge = Math.max(0, zahl(segment.laenge_m) ?? 0);
  const steigung = begrenze(zahl(segment.steigung) ?? 0, [-0.4, 0.4]);
  const richtung = zahl(segment.richtung_grad) ?? 0;
  const oberflaeche = zahl(segment.oberflaeche) ?? e.oberflaeche;

  const winkel = Math.atan(steigung);
  const rollen = G * Math.cos(winkel) * (modell.crr1 * modell.m1_kg + modell.crr2 * modell.m2_kg) * oberflaeche;
  const hang = modell.masse_kg * G * Math.sin(winkel);
  const rho = luftdichte(e.temperatur_c, e.hoehe_m);
  const gegenwind = gegenwindAnteil(e.wind_ms, e.wind_richtung_grad, richtung);

  // Kraft in Fahrtrichtung bei Fahrgeschwindigkeit v; Gegenwind erhöht die Luftgeschwindigkeit, Rückenwind verringert sie (und kann schieben)
  const kraft = (v) => {
    const vl = v + gegenwind;
    return rollen + hang + 0.5 * rho * modell.cda_m2 * vl * Math.abs(vl);
  };
  const leistungRad = (v) => kraft(v) * v;

  // Was Fahrer und Motor am Hinterrad liefern, wenn der Fahrer mit Leistung r tritt. Der Motor unterstützt höchstens mit
  // faktor × r (Unterstützungsstufe) und höchstens mit seiner Spitzenleistung.
  const faktor = UNTERSTUETZUNG[e.unterstuetzung];
  const grundLeistung = e.eigenleistung_w;
  const maxLeistung = Math.max(grundLeistung, e.eigenleistung_max_w);
  const motorMaxBei = (r) => Math.min(modell.motor.spitze_w, faktor * r); // mechanisch am Motor
  const fahrerRad = (r) => modell.eta_kette * r;
  const motorRad = (m) => (modell.motor.ueber_kette ? modell.eta_kette * m : m);
  const verfuegbarBei = (r) => fahrerRad(r) + motorRad(motorMaxBei(r));

  // Der Fahrer tritt auf der Ebene mit der Grundleistung und bergauf so viel mehr, wie nötig ist (bis zur Höchstleistung).
  // Reicht auch das nicht, wird langsamer gefahren, bis die Leistung genügt.
  const vWunsch = Math.min(e.geschwindigkeit_kmh, ABSCHALTGESCHWINDIGKEIT_KMH) / 3.6;
  let v = vWunsch;
  let schieben = false;
  let r = grundLeistung;
  if (leistungRad(vWunsch) > verfuegbarBei(grundLeistung)) {
    if (leistungRad(vWunsch) <= verfuegbarBei(maxLeistung)) {
      let unten = grundLeistung;
      let oben = maxLeistung;
      for (let i = 0; i < 60; i++) {
        const mitte = (unten + oben) / 2;
        if (verfuegbarBei(mitte) < leistungRad(vWunsch)) unten = mitte; else oben = mitte;
      }
      r = oben;
    } else {
      r = maxLeistung;
      const verfuegbar = verfuegbarBei(r);
      if (leistungRad(MIN_FAHRGESCHWINDIGKEIT_MS) >= verfuegbar) {
        schieben = true;
        v = SCHIEBEN_MS;
      } else {
        let unten = MIN_FAHRGESCHWINDIGKEIT_MS;
        let oben = vWunsch;
        for (let i = 0; i < 60; i++) {
          const mitte = (unten + oben) / 2;
          if (leistungRad(mitte) > verfuegbar) oben = mitte; else unten = mitte;
        }
        v = unten;
      }
    }
  }

  const leistung = schieben ? verfuegbarBei(r) : leistungRad(v);
  // Motorleistung (mechanisch): was nach der Tretleistung noch fehlt, höchstens die Obergrenze
  let motorMech = 0;
  if (leistung > fahrerRad(r)) {
    motorMech = (leistung - fahrerRad(r)) / (modell.motor.ueber_kette ? modell.eta_kette : 1);
    motorMech = Math.min(motorMech, motorMaxBei(r));
  }
  const batterieW = motorMech / (modell.motor.eta * ETA_AKKU);

  const zeit = laenge / v;
  const motorWh = batterieW * zeit / 3600;
  const solarW = modell.solar_wp * (e.einstrahlung_w_m2 / 1000) * SOLAR_WIRKUNG;
  const solarWh = solarW * zeit / 3600;
  const batterieWh = motorWh - solarWh;

  return {
    v_ms: v, zeit_s: zeit, schieben,
    motor_wh: motorWh, solar_wh: solarWh, batterie_wh: batterieWh,
    wh_pro_km: laenge > 0 ? batterieWh / (laenge / 1000) : 0,
    leistung_rad_w: leistung,
    eigenleistung_w: r
  };
}

/** Verbrauch aus dem Akku in Wh je km für ein Wegstück gleicher Art (ohne Solar, für Vergleiche) */
export function verbrauchProKm(modell, segment) {
  const r = berechneSegment({ ...modell, solar_wp: 0 }, { ...segment, laenge_m: 1000 });
  return r.motor_wh;
}

// ---------- Reichweite entlang einer Route ----------

/**
 * Fährt die Segmente der Reihe nach ab, bis der nutzbare Akku leer ist.
 * segmente: Liste von { laenge_m, steigung, richtung_grad, oberflaeche? } in Fahrtreihenfolge.
 * Ergebnis: {
 *   strecke_m,       so weit kommt man
 *   zeit_s,
 *   verbraucht_wh,   aus dem Akku entnommen (Solar abgezogen)
 *   rest_wh,         nutzbarer Rest am Ende (ohne die Reserve)
 *   ende_erreicht,   true, wenn die Route zu Ende war, bevor der Akku leer wurde
 *   segment_index,   Nummer des Segments, in dem der Akku leer wurde (bzw. Anzahl der Segmente)
 *   schiebestrecke_m
 * }
 */
export function reichweiteEntlang(modell, segmente) {
  const grenze = modell.akku.reserve_wh;
  const maximum = modell.akku.kapazitaet_wh;
  let akku = modell.akku.start_wh;
  let strecke = 0;
  let zeit = 0;
  let schieben = 0;
  let index = 0;

  for (; index < segmente.length; index++) {
    const s = segmente[index];
    const r = berechneSegment(modell, s);
    const laenge = Math.max(0, zahl(s.laenge_m) ?? 0);
    if (r.batterie_wh > 0 && akku - r.batterie_wh <= grenze) {
      const anteil = Math.max(0, (akku - grenze) / r.batterie_wh);
      strecke += laenge * anteil;
      zeit += r.zeit_s * anteil;
      if (r.schieben) schieben += laenge * anteil;
      akku = Math.min(akku, grenze);
      return ergebnis(false);
    }
    akku = Math.min(maximum, akku - r.batterie_wh);
    strecke += laenge;
    zeit += r.zeit_s;
    if (r.schieben) schieben += laenge;
  }
  return ergebnis(true);

  function ergebnis(ende) {
    return {
      strecke_m: strecke, zeit_s: zeit, verbraucht_wh: modell.akku.start_wh - akku, rest_wh: Math.max(0, akku - grenze),
      ende_erreicht: ende, segment_index: index, schiebestrecke_m: schieben
    };
  }
}
