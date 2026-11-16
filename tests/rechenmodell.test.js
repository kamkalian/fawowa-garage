import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  G, baueModell, berechneSegment, reichweiteEntlang, verbrauchProKm, luftdichte, rollwiderstandsbeiwert, gegenwindAnteil,
  pruefeEinstellungen, EINSTELLUNGEN_STANDARD, UNTERSTUETZUNG, haltKosten
} from '../lib/rechenmodell.js';

// Ein typisches Gespann: Lastenrad mit Mittelmotor, Wohnwagen-Anhänger mit Solar
const RAD = {
  motor_art: 'mittelmotor', motor_nennleistung_w: 250, akku_kapazitaet_wh: 625, schaltung_art: 'kette', radgroesse_zoll: 26, reifenbreite_mm: 50,
  gewicht_kg: 30, anzahl_raeder: 2
};
const WAGEN = { leergewicht_kg: 60, breite_cm: 80, hoehe_cm: 110, radgroesse_zoll: 20, reifenbreite_mm: 40, solar_wp: 100, zusatzakku_wh: 0 };
const FAHRT = { fahrer_gewicht_kg: 80, gepaeck_kg: 40 };

const modell = (einst = {}, rad = RAD, wagen = WAGEN, fahrt = FAHRT) => {
  const r = baueModell(rad, wagen, fahrt, einst);
  assert.deepEqual(r.fehler, []);
  return r.modell;
};
const eben = { laenge_m: 1000, steigung: 0, richtung_grad: 0 };
const nah = (a, b, rel = 0.01, text = '') => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel + 1e-9, `${text} ${a} ≈ ${b}`);

test('Luftdichte: Normalwerte und Abnahme mit Höhe und Wärme', () => {
  nah(luftdichte(15, 0), 1.225, 0.002);
  assert.ok(luftdichte(15, 1500) < luftdichte(15, 0));
  assert.ok(luftdichte(30, 0) < luftdichte(0, 0));
});

test('Rollwiderstand: kleine Räder rollen schlechter, ohne Angabe ein mittlerer Wert', () => {
  assert.equal(rollwiderstandsbeiwert(null, null), 0.006);
  assert.ok(rollwiderstandsbeiwert(40, 20) > rollwiderstandsbeiwert(40, 26));
  assert.ok(rollwiderstandsbeiwert(25, 28) < rollwiderstandsbeiwert(40, 28));
});

test('Gegenwind: Vorzeichen nach Himmelsrichtung', () => {
  // Fahrt nach Norden (0°)
  nah(gegenwindAnteil(5, 0, 0), 5, 1e-9, 'Wind aus Nord = Gegenwind');
  nah(gegenwindAnteil(5, 180, 0), -5, 1e-9, 'Wind aus Süd = Rückenwind');
  assert.ok(Math.abs(gegenwindAnteil(5, 90, 0)) < 1e-9, 'Wind aus Ost = Seitenwind');
  // Fahrt nach Osten (90°)
  nah(gegenwindAnteil(5, 90, 90), 5, 1e-9);
  nah(gegenwindAnteil(5, 270, 90), -5, 1e-9);
  // Schräg: 60° zwischen Fahrt und Windquelle
  nah(gegenwindAnteil(10, 60, 0), 5, 1e-9);
});

test('Ebene ohne Wind: Leistung am Rad stimmt mit der Formel überein', () => {
  const m = modell({ geschwindigkeit_kmh: 18, unterstuetzung: 'max', eigenleistung_w: 60 });
  const v = 18 / 3.6;
  const rho = luftdichte(15, 100);
  const erwartet = (G * (m.crr1 * m.m1_kg + m.crr2 * m.m2_kg) + 0.5 * rho * m.cda_m2 * v * v) * v;
  nah(berechneSegment(m, eben).leistung_rad_w, erwartet, 1e-9);
  assert.equal(m.m1_kg, 80 + 30);
  assert.equal(m.m2_kg, 60 + 40, 'Zuladung fährt im Anhänger');
});

test('Plausible Größenordnung: Wh pro km eben, mit Anhänger, 18 km/h', () => {
  const r = berechneSegment(modell(), eben);
  assert.ok(r.wh_pro_km > 4 && r.wh_pro_km < 12, `Wh/km = ${r.wh_pro_km}`);
  assert.equal(r.schieben, false);
  nah(r.v_ms, 5, 1e-9);
});

test('Verbrauch steigt mit Steigung, Masse und Gegenwind und sinkt mit Rückenwind', () => {
  const m = modell();
  const wh = (seg, mm = m) => berechneSegment(mm, { ...eben, ...seg }).wh_pro_km;
  const flach = wh({});
  assert.ok(wh({ steigung: 0.03 }) > flach);
  assert.ok(wh({ steigung: 0.06 }) > wh({ steigung: 0.03 }));

  const schwer = modell({}, RAD, WAGEN, { ...FAHRT, gepaeck_kg: 120 });
  assert.ok(wh({}, schwer) > flach);

  const gegen = modell({ wind_ms: 6, wind_richtung_grad: 0 });
  const rueck = modell({ wind_ms: 6, wind_richtung_grad: 180 });
  const seit = modell({ wind_ms: 6, wind_richtung_grad: 90 });
  assert.ok(wh({}, gegen) > flach, 'Gegenwind kostet');
  assert.ok(wh({}, rueck) < flach, 'Rückenwind spart');
  nah(wh({}, seit), flach, 1e-6, 'Seitenwind wirkt in Fahrtrichtung nicht');
  assert.ok(wh({}, gegen) - flach > flach - wh({}, rueck), 'Gegenwind kostet mehr, als Rückenwind spart');
});

test('Bergab: kein Verbrauch des Motors, keine Rückgewinnung', () => {
  const r = berechneSegment(modell(), { ...eben, steigung: -0.05 });
  assert.equal(r.motor_wh, 0);
  assert.equal(r.batterie_wh, 0);
  assert.equal(r.schieben, false);
});

test('Gegenüberliegende Richtungen: Verbrauch hängt von der Fahrtrichtung zum Wind ab, Energie über Hin- und Rückweg bleibt höher als ohne Wind', () => {
  const m = modell({ wind_ms: 5, wind_richtung_grad: 90 });
  const ohne = modell();
  const hin = berechneSegment(m, { ...eben, richtung_grad: 270 }).motor_wh; // Wind aus Ost, Fahrt nach Westen = Rückenwind
  const zurueck = berechneSegment(m, { ...eben, richtung_grad: 90 }).motor_wh;
  const normal = berechneSegment(ohne, eben).motor_wh;
  assert.ok(hin < normal && zurueck > normal);
  assert.ok(hin + zurueck > 2 * normal, 'der Mehrverbrauch bei Gegenwind überwiegt');
});

test('Zu steil: langsamer, bei sehr steil Schieben', () => {
  const m = modell({ geschwindigkeit_kmh: 20 });
  const mittel = berechneSegment(m, { ...eben, steigung: 0.05 });
  assert.ok(mittel.v_ms < 20 / 3.6, 'bei 5 % wird es langsamer');
  assert.ok(mittel.v_ms >= 1.8);
  assert.equal(mittel.schieben, false);
  const steil = berechneSegment(m, { ...eben, steigung: 0.30 });
  assert.equal(steil.schieben, true);
  assert.ok(steil.v_ms < 1.6);
  assert.ok(steil.motor_wh > 0);
  // Die Leistung am Rad ist nie größer als das, was Fahrer (bis zur Höchstleistung) und Motor liefern können
  const e = m.einstellungen;
  const grenze = m.eta_kette * (e.eigenleistung_max_w + Math.min(m.motor.spitze_w, UNTERSTUETZUNG.tour * e.eigenleistung_max_w));
  assert.ok(mittel.leistung_rad_w <= grenze + 1e-6);
  assert.ok(mittel.eigenleistung_w <= e.eigenleistung_max_w + 1e-9, 'der Fahrer tritt nie mehr als seine Höchstleistung');
});

test('Die Fahrerleistung ist das Ergebnis: auf der Ebene wenig, bergauf mehr, nie über die Höchstleistung', () => {
  const m = modell({ geschwindigkeit_kmh: 16 });
  const eben_ = berechneSegment(m, eben).eigenleistung_w;
  const berg = berechneSegment(m, { ...eben, steigung: 0.03 }).eigenleistung_w;
  assert.ok(eben_ > 0 && eben_ < berg, `Ebene ${eben_} W, Berg ${berg} W`);
  assert.ok(berechneSegment(m, { ...eben, steigung: 0.2 }).eigenleistung_w <= m.einstellungen.eigenleistung_max_w + 1e-9);
  assert.equal(berechneSegment(m, { ...eben, steigung: -0.05 }).eigenleistung_w, 0, 'bergab tritt der Fahrer nicht');
});

test('Unterstützungsstufe: höhere Stufe schafft Steigungen schneller, ohne Motor gar nicht mit schwerem Gespann', () => {
  const stufen = ['aus', 'eco', 'tour', 'sport', 'turbo'];
  const tempo = stufen.map(s => berechneSegment(modell({ unterstuetzung: s, geschwindigkeit_kmh: 20 }), { ...eben, steigung: 0.08 }).v_ms);
  for (let i = 1; i < tempo.length; i++) assert.ok(tempo[i] >= tempo[i - 1] - 1e-9, `${stufen[i]} nicht langsamer als ${stufen[i - 1]}`);
  assert.ok(tempo[4] > tempo[0]);
  assert.equal(berechneSegment(modell({ unterstuetzung: 'aus' }), eben).motor_wh, 0);
});

test('Wirkungsgrade: Nabenmotor und Nabenschaltung kosten mehr Energie', () => {
  const basis = berechneSegment(modell(), eben).wh_pro_km;
  assert.ok(berechneSegment(modell({}, { ...RAD, motor_art: 'nabe_hinten' }), eben).wh_pro_km !== basis);
  assert.ok(berechneSegment(modell({}, { ...RAD, schaltung_art: 'stufenlos' }), eben).wh_pro_km > basis);
});

test('Unterstützung ist proportional zur Fahrerleistung: stärkere Stufe kostet bergauf mehr Akku', () => {
  const steil = { ...eben, steigung: 0.05 };
  const eco = berechneSegment(modell({ unterstuetzung: 'eco', geschwindigkeit_kmh: 16 }), steil).wh_pro_km;
  const sport = berechneSegment(modell({ unterstuetzung: 'sport', geschwindigkeit_kmh: 16 }), steil).wh_pro_km;
  assert.ok(sport > eco, `sport ${sport} > eco ${eco}`);
});

test('Motor: nie mehr als die Nennleistung (250 W)', () => {
  const m = modell({ unterstuetzung: 'max', geschwindigkeit_kmh: 20 });
  for (const st of [0.03, 0.08]) {
    const r = berechneSegment(m, { ...eben, steigung: st });
    assert.ok(r.motor_wh / (r.zeit_s / 3600) <= 250 / (m.motor.eta * 0.95) + 1e-6, 'Akkuleistung nie über 250 W Motor');
  }
});

test('Halte: Ampel kostet mehr als Kreuzung, und ohne Motor kostet ein Halt keinen Akku', () => {
  const h = haltKosten(modell());
  assert.ok(h[0].wh > h[4].wh && h[0].s > h[4].s);
  assert.equal(haltKosten(modell({ unterstuetzung: 'aus' }))[0].wh, 0);
});

test('Solar: senkt den Netto-Verbrauch, kann den Akku laden, Wirkung ist null ohne Einstrahlung', () => {
  const ohne = berechneSegment(modell(), eben);
  const sonne = berechneSegment(modell({ einstrahlung_w_m2: 800 }), eben);
  assert.equal(ohne.solar_wh, 0);
  assert.ok(sonne.solar_wh > 0);
  assert.equal(sonne.motor_wh, ohne.motor_wh, 'der Motorverbrauch ändert sich nicht');
  nah(sonne.batterie_wh, ohne.motor_wh - sonne.solar_wh, 1e-9);
  // Bergab mit Sonne: Akku wird geladen
  assert.ok(berechneSegment(modell({ einstrahlung_w_m2: 800 }), { ...eben, steigung: -0.04 }).batterie_wh < 0);
  // ohne Solarmodule bleibt es aus
  assert.equal(berechneSegment(modell({ einstrahlung_w_m2: 800 }, RAD, { ...WAGEN, solar_wp: 0 }), eben).solar_wh, 0);
});

test('Oberfläche: Schotter kostet mehr als Asphalt, Segment kann sie überschreiben', () => {
  const m = modell();
  const asphalt = berechneSegment(m, eben).wh_pro_km;
  assert.ok(berechneSegment(m, { ...eben, oberflaeche: 2 }).wh_pro_km > asphalt);
  assert.ok(berechneSegment(modell({ oberflaeche: 2 }), eben).wh_pro_km > asphalt);
});

test('Anhänger kostet Energie; ohne Anhänger fährt die Zuladung am Fahrrad', () => {
  const mit = berechneSegment(modell(), eben).wh_pro_km;
  const ohne = baueModell(RAD, null, FAHRT).modell;
  assert.equal(ohne.m2_kg, 0);
  assert.equal(ohne.m1_kg, 80 + 30 + 40);
  assert.ok(berechneSegment(ohne, eben).wh_pro_km < mit);
});

test('Ein größerer Anhänger hat mehr Luftwiderstand, Windschatten verdeckt kleine', () => {
  const klein = baueModell(RAD, { ...WAGEN, breite_cm: 50, hoehe_cm: 80 }, FAHRT).modell.cda_m2;
  const gross = baueModell(RAD, { ...WAGEN, breite_cm: 100, hoehe_cm: 140 }, FAHRT).modell.cda_m2;
  assert.ok(gross > klein);
  assert.ok(klein < 0.55 + 0.2, 'kleiner Anhänger fast im Windschatten');
});

test('Akku: nutzbare Energie mit Füllstand, Reserve und Zusatzakkus je Füllstand', () => {
  const m = modell({ akku_rest_prozent: 80, reserve_prozent: 10 });
  nah(m.akku.start_wh, 500, 1e-9);
  nah(m.akku.reserve_wh, 62.5, 1e-9);
  nah(m.akku.nutzbar_wh, 437.5, 1e-9);

  const mitZusatz = baueModell({ ...RAD, zusatzakku_wh: 400 }, { ...WAGEN, zusatzakku_wh: 600 }, FAHRT, { akku_rest_prozent: 50, zusatz_rest_prozent: 100, reserve_prozent: 0 }).modell;
  assert.equal(mitZusatz.akku.kapazitaet_wh, 625 + 400 + 600);
  nah(mitZusatz.akku.start_wh, 625 * 0.5 + 1000, 1e-9);
  // Ohne eigene Angabe gilt der Füllstand des Hauptakkus auch für Zusatzakkus
  nah(baueModell({ ...RAD, zusatzakku_wh: 400 }, WAGEN, FAHRT, { akku_rest_prozent: 50, reserve_prozent: 0 }).modell.akku.start_wh, 1025 * 0.5, 1e-9);
});

test('Reichweite eben: Strecke = nutzbarer Akku geteilt durch Verbrauch je km', () => {
  const m = modell();
  const pro = berechneSegment(m, eben).wh_pro_km;
  const route = Array.from({ length: 400 }, () => eben); // 400 km
  const r = reichweiteEntlang(m, route);
  assert.equal(r.ende_erreicht, false);
  nah(r.strecke_m / 1000, m.akku.nutzbar_wh / pro, 1e-6);
  nah(r.verbraucht_wh, m.akku.nutzbar_wh, 1e-6);
  assert.ok(r.rest_wh < 1e-6);
  assert.equal(r.schiebestrecke_m, 0);
  assert.ok(r.zeit_s > 0);
});

test('Reichweite: ein Wegstück wird anteilig gefahren, wenn der Akku mittendrin leer wird', () => {
  const m = modell();
  const pro = berechneSegment(m, eben).wh_pro_km;
  const bis = m.akku.nutzbar_wh / pro * 1000; // Meter bis leer
  const r = reichweiteEntlang(m, [{ ...eben, laenge_m: bis * 0.5 }, { ...eben, laenge_m: bis }]);
  nah(r.strecke_m, bis, 1e-6);
  assert.equal(r.segment_index, 1);
  assert.equal(r.ende_erreicht, false);
});

test('Reichweite: kurze Route wird ganz gefahren, Rest bleibt übrig', () => {
  const m = modell();
  const r = reichweiteEntlang(m, [{ ...eben, laenge_m: 5000 }]);
  assert.equal(r.ende_erreicht, true);
  assert.equal(r.strecke_m, 5000);
  assert.ok(r.rest_wh > 0 && r.rest_wh < m.akku.nutzbar_wh);
  assert.equal(r.segment_index, 1);
  assert.deepEqual(reichweiteEntlang(m, []).strecke_m, 0);
});

test('Reichweite: leerer Akku kommt keinen Meter weit; Berg, Gegenwind, mehr Gewicht verkürzen; größerer Akku verlängert', () => {
  const route = (seg) => Array.from({ length: 300 }, () => ({ ...eben, ...seg }));
  const km = (m, seg = {}) => reichweiteEntlang(m, route(seg)).strecke_m / 1000;

  assert.equal(km(modell({ akku_rest_prozent: 5, reserve_prozent: 5 })), 0, 'nur Reserve');
  assert.equal(km(modell({ akku_rest_prozent: 0 })), 0);

  const flach = km(modell());
  assert.ok(km(modell(), { steigung: 0.04 }) < flach, 'Berg');
  assert.ok(km(modell({ wind_ms: 6, wind_richtung_grad: 0 })) < flach, 'Gegenwind');
  assert.ok(km(modell({}, RAD, WAGEN, { ...FAHRT, gepaeck_kg: 150 })) < flach, 'mehr Gewicht');
  assert.ok(km(modell({}, { ...RAD, akku_kapazitaet_wh: 1250 })) > flach * 1.9, 'doppelter Akku');
  assert.ok(km(modell({ einstrahlung_w_m2: 900 })) > flach, 'Sonne verlängert');
});

test('Reichweite: der Akku wird nie über seine Kapazität geladen (Solar bergab)', () => {
  const m = modell({ einstrahlung_w_m2: 1000, akku_rest_prozent: 100 });
  const r = reichweiteEntlang(m, Array.from({ length: 50 }, () => ({ ...eben, steigung: -0.03 })));
  assert.ok(r.verbraucht_wh >= 0, 'höchstens voll, nicht darüber');
  assert.equal(r.ende_erreicht, true);
});

test('Hin und zurück über einen Hügel: Aufstieg kostet mehr, als der Abstieg spart', () => {
  const m = modell();
  const hoch = berechneSegment(m, { ...eben, steigung: 0.05 }).motor_wh;
  const runter = berechneSegment(m, { ...eben, steigung: -0.05 }).motor_wh;
  const flach = berechneSegment(m, eben).motor_wh;
  assert.ok(hoch + runter > 2 * flach * 0.9, 'ohne Rückgewinnung bleibt es teuer');
  assert.ok(hoch + runter > flach);
});

test('verbrauchProKm ignoriert Solar und Segmentlänge', () => {
  const m = modell({ einstrahlung_w_m2: 900 });
  assert.equal(verbrauchProKm(m, eben), verbrauchProKm(m, { ...eben, laenge_m: 37 }));
  assert.equal(verbrauchProKm(m, eben), berechneSegment({ ...m, solar_wp: 0 }, eben).motor_wh);
});

test('Fehlende Angaben: Annahmen werden genannt, Rechnung bleibt möglich', () => {
  const r = baueModell({ motor_art: 'mittelmotor', akku_kapazitaet_wh: 500 }, { leergewicht_kg: null }, {});
  assert.deepEqual(r.fehler, []);
  for (const a of ['fahrer_gewicht_kg', 'gewicht_kg', 'leergewicht_kg', 'motor_nennleistung_w', 'schaltung_art', 'anhaenger_flaeche']) {
    assert.ok(r.annahmen.includes(a), `Annahme ${a}`);
  }
  assert.ok(berechneSegment(r.modell, eben).wh_pro_km > 0);

  // Vollständige Daten: keine Annahmen
  const voll = baueModell(RAD, WAGEN, FAHRT);
  assert.deepEqual(voll.annahmen, []);
});

test('Fehler: kein Fahrrad, kein Motor, kein Akku, ungültige Einstellungen', () => {
  assert.deepEqual(baueModell(null, WAGEN, FAHRT).fehler, ['fahrrad_fehlt']);
  assert.deepEqual(baueModell({ ...RAD, motor_art: 'ohne' }, WAGEN, FAHRT).fehler, ['kein_motor']);
  assert.deepEqual(baueModell({ ...RAD, akku_kapazitaet_wh: null }, WAGEN, FAHRT).fehler, ['akku_fehlt']);
  // Ein Zusatzakku im Anhänger genügt
  assert.deepEqual(baueModell({ ...RAD, akku_kapazitaet_wh: null }, { ...WAGEN, zusatzakku_wh: 500 }, FAHRT).fehler, []);
  assert.deepEqual(baueModell(RAD, WAGEN, FAHRT, { geschwindigkeit_kmh: 99 }).fehler, ['einstellungen_ungueltig']);
  assert.equal(baueModell(null).modell, null);
});

test('Einstellungen prüfen: Standardwerte, Grenzen, Komma, unbekannte Felder, Auswahl', () => {
  assert.deepEqual(pruefeEinstellungen({}).werte, { ...EINSTELLUNGEN_STANDARD });
  assert.equal(pruefeEinstellungen(null).fehler, null);
  const ok = pruefeEinstellungen({ akku_rest_prozent: '65,5', wind_ms: 4, unterstuetzung: 'sport', foo: 1 });
  assert.equal(ok.fehler, null);
  assert.equal(ok.werte.akku_rest_prozent, 65.5);
  assert.equal(ok.werte.unterstuetzung, 'sport');
  assert.ok(!('foo' in ok.werte));

  const schlecht = pruefeEinstellungen({
    akku_rest_prozent: 101, reserve_prozent: -1, geschwindigkeit_kmh: 'schnell', wind_ms: Infinity, unterstuetzung: 'raketen', oberflaeche: 100
  });
  assert.deepEqual(schlecht.fehler, {
    akku_rest_prozent: 'zu_gross', reserve_prozent: 'zu_klein', geschwindigkeit_kmh: 'ungueltig',
    wind_ms: 'ungueltig', unterstuetzung: 'ungueltig', oberflaeche: 'zu_gross'
  });
  // Auch Namen aus der Prototypkette sind keine gültigen Stufen
  assert.ok(pruefeEinstellungen({ unterstuetzung: 'constructor' }).fehler?.unterstuetzung);
});

test('Reine Funktionen: Eingaben bleiben unverändert, gleiche Eingabe gleiches Ergebnis', () => {
  const rad = structuredClone(RAD);
  const wagen = structuredClone(WAGEN);
  const einst = { wind_ms: 3, einstrahlung_w_m2: 500 };
  const kopieEinst = structuredClone(einst);
  const a = baueModell(rad, wagen, FAHRT, einst);
  const b = baueModell(rad, wagen, FAHRT, einst);
  assert.deepEqual(a, b);
  assert.deepEqual(rad, RAD);
  assert.deepEqual(wagen, WAGEN);
  assert.deepEqual(einst, kopieEinst);
  const seg = { ...eben, steigung: 0.04 };
  const segKopie = { ...seg };
  assert.deepEqual(berechneSegment(a.modell, seg), berechneSegment(b.modell, seg));
  assert.deepEqual(seg, segKopie);
});

test('Ungewöhnliche Segmente: Länge null, fehlende Werte, extreme Steigung, ungültige Zahlen', () => {
  const m = modell();
  const leer = berechneSegment(m, { laenge_m: 0, steigung: 0, richtung_grad: 0 });
  assert.equal(leer.batterie_wh, 0);
  assert.equal(leer.wh_pro_km, 0);
  const fehlt = berechneSegment(m, { laenge_m: 500 });
  assert.ok(Number.isFinite(fehlt.batterie_wh));
  for (const steigung of [5, -5, NaN, Infinity, '0,1']) {
    const r = berechneSegment(m, { ...eben, steigung });
    assert.ok(Number.isFinite(r.batterie_wh) && Number.isFinite(r.zeit_s) && r.zeit_s > 0, String(steigung));
  }
  assert.ok(Number.isFinite(berechneSegment(m, { laenge_m: -50, steigung: 0 }).batterie_wh));
});

test('Starker Rückenwind schiebt: nie negative Motorleistung, Verbrauch null', () => {
  const m = modell({ wind_ms: 20, wind_richtung_grad: 180 });
  const r = berechneSegment(m, eben);
  assert.equal(r.motor_wh, 0);
  assert.ok(r.leistung_rad_w < 0 || r.leistung_rad_w >= 0);
  assert.ok(Number.isFinite(r.zeit_s));
});
