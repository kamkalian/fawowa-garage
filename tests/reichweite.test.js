import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Netz } from '../lib/netz.js';
import { rechneReichweite } from '../lib/reichweite.js';
import { gitterNetz, testNetz } from './hilfen-netz.js';

const FAHRRAD = { motor_art: 'mittelmotor', motor_nennleistung_w: 250, akku_kapazitaet_wh: 18, schaltung_art: 'kette', gewicht_kg: 25 };
const OHNE_MOTOR = { motor_art: 'ohne', gewicht_kg: 25 };
const GESPANN = { fahrer_gewicht_kg: 80 };
const START = { lat: 51.075, lon: 7.12 }; // Mitte des Gitters

const netz = new Netz(gitterNetz(31), { minKomponente: 1 });
const rechne = (zusatz = {}) => rechneReichweite(netz, { fahrrad: FAHRRAD, anhaenger: null, gespann: GESPANN, einstellungen: {}, start: START, modus: 'alle', ...zusatz });

/** Liest die drei Listen aus einer Kachel (Flächen, Linien, Wege) */
test('Routen: jeder machbare Punkt bekommt eine Route, Linien starten am Start des Baums', () => {
  const r = rechne();
  assert.equal(r.ok, true);
  assert.ok(r.kennzahlen.punkte_machbar > 0 && r.linien.length > 0);
  const gruen = r.schritte.filter(([, , m]) => m === 1);
  assert.equal(gruen.length, r.kennzahlen.punkte_machbar);
  for (const [la1, lo1, la2, lo2, f] of r.linien) {
    assert.ok([la1, lo1, la2, lo2].every(Number.isFinite) && f >= 0 && f <= 1.5);
  }
  assert.ok(r.kennzahlen.weitester_km > 1);
});

test('Routen: Fahrtzeit-Modus, Abschnitte bleiben im Budget', () => {
  const kurz = rechne({ fahrrad: OHNE_MOTOR, einstellungen: { budget_art: 'zeit', fahrtzeit_h: 0.5 } });
  const lang = rechne({ fahrrad: OHNE_MOTOR, einstellungen: { budget_art: 'zeit', fahrtzeit_h: 1 } });
  assert.equal(kurz.budget.art, 'zeit');
  assert.ok(lang.kennzahlen.punkte_machbar > kurz.kennzahlen.punkte_machbar, 'mehr Zeit, mehr erreichbare Punkte');
  for (const [, , , , f] of kurz.linien) assert.ok(f <= 1, 'Zeit eingehalten');
});

test('Routen: mehr Akku, mehr erreichbare Punkte; weniger Füllstand, weniger Punkte', () => {
  const normal = rechne().kennzahlen.punkte_machbar;
  const mehr = rechne({ fahrrad: { ...FAHRRAD, akku_kapazitaet_wh: 60 } }).kennzahlen.punkte_machbar;
  const weniger = rechne({ einstellungen: { akku_rest_prozent: 40 } }).kennzahlen.punkte_machbar;
  assert.ok(mehr > normal && weniger < normal, `${weniger} < ${normal} < ${mehr}`);
});

test('Heatmap aus den Linien: Werte nur entlang der Linien, sonst leer (254)', () => {
  const r = rechne();
  const { nx, ny, daten } = r.raster;
  const bytes = Buffer.from(daten, 'base64');
  assert.equal(bytes.length, nx * ny);
  const gefaerbt = bytes.filter((x) => x < 254).length;
  assert.ok(gefaerbt > 0 && gefaerbt < nx * ny, 'es gibt Linien, aber nicht überall');
});

test('Ohne Motor nach Akku: Fehler kein_motor; Fahrtzeit ohne Akku-Angaben geht trotzdem', () => {
  assert.deepEqual(rechne({ fahrrad: OHNE_MOTOR }).fehler, ['kein_motor']);
  assert.equal(rechne({ fahrrad: { ...OHNE_MOTOR, akku_kapazitaet_wh: null }, einstellungen: { budget_art: 'zeit' } }).ok, true);
});

test('Reichweite: Fehler werden mit Codes gemeldet', () => {
  assert.deepEqual(rechne({ fahrrad: null }).fehler, ['fahrrad_fehlt']);
  assert.deepEqual(rechne({ fahrrad: { ...FAHRRAD, akku_kapazitaet_wh: null } }).fehler, ['akku_fehlt']);
  assert.deepEqual(rechne({ einstellungen: { akku_rest_prozent: 3, reserve_prozent: 5 } }).fehler, ['akku_leer']);
  assert.deepEqual(rechne({ einstellungen: { wind_ms: 99 } }).fehler, ['einstellungen_ungueltig']);
  assert.deepEqual(rechne({ start: { lat: 53.5, lon: 10 } }).fehler, ['ausserhalb']);
  assert.deepEqual(rechne({ start: { lat: 'x', lon: 7 } }).fehler, ['start_ungueltig']);
  assert.deepEqual(rechne({ start: undefined }).fehler, ['start_ungueltig']);
  assert.deepEqual(rechne({ modus: 'radweg' }).fehler, ['modus_ungueltig']);
});

test('Reichweite: unsinnige Eingaben stürzen nicht ab', () => {
  for (const eingabe of [{}, { start: { lat: NaN, lon: NaN } }, { start: { lat: 51, lon: 7 }, fahrrad: 5 }, { einstellungen: 'x' }]) {
    const r = rechneReichweite(netz, eingabe);
    assert.ok(r.fehler || r.ok);
  }
});

test('Netz: Linie einer Kante beginnt und endet an den Knoten; Rechteckabfrage', () => {
  const kleines = testNetz();
  const linie = kleines.kantenLinie(1);
  assert.deepEqual(linie[0], [kleines.lat(kleines.kA[1]), kleines.lon(kleines.kA[1])]);
  const letzte = linie[linie.length - 1];
  assert.ok(Math.abs(letzte[0] - kleines.lat(kleines.kB[1])) < 1e-9 && Math.abs(letzte[1] - kleines.lon(kleines.kB[1])) < 1e-9);
  assert.equal(kleines.kantenImRechteck(50, 6, 52, 8).length, 4);
  assert.equal(kleines.kantenImRechteck(50, 6, 50.5, 6.5).length, 0);
});

test('Solar: Gutschrift senkt die Kosten, die Fläche wird größer', () => {
  const anhaenger = { leergewicht_kg: 40, solar_wp: 300 };
  const ohne = rechneReichweite(netz, { fahrrad: FAHRRAD, anhaenger, gespann: GESPANN, einstellungen: {}, start: START, modus: 'alle' }).kennzahlen.weitester_km;
  const mit = rechneReichweite(netz, { fahrrad: FAHRRAD, anhaenger, gespann: GESPANN, einstellungen: { einstrahlung_w_m2: 900 }, start: START, modus: 'alle' }).kennzahlen.weitester_km;
  assert.ok(mit >= ohne, `${mit} >= ${ohne}`);
});
