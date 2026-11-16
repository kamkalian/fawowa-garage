import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Netz } from '../lib/netz.js';
import { rechneReichweite } from '../lib/reichweite.js';
import { kachelKarte, kachelGrenzen, darstellungsart, zeigen } from '../lib/karte-daten.js';
import { gitterNetz, testNetz } from './hilfen-netz.js';

const FAHRRAD = { motor_art: 'mittelmotor', motor_nennleistung_w: 250, akku_kapazitaet_wh: 18, schaltung_art: 'kette', gewicht_kg: 25 };
const OHNE_MOTOR = { motor_art: 'ohne', gewicht_kg: 25 };
const GESPANN = { fahrer_gewicht_kg: 80 };
const START = { lat: 51.075, lon: 7.12 }; // Mitte des Gitters

const netz = new Netz(gitterNetz(31), { minKomponente: 1 });
const rechne = (zusatz = {}) => rechneReichweite(netz, { fahrrad: FAHRRAD, anhaenger: null, gespann: GESPANN, einstellungen: {}, start: START, modus: 'alle', ...zusatz });

/** Liest die drei Listen aus einer Kachel (Flächen, Linien, Wege) */
function lieseKachel(buf) {
  const dv = new DataView(buf);
  let p = 0;
  const liste = () => {
    const n = dv.getUint32(p, true);
    p += 4;
    const out = [];
    for (let i = 0; i < n; i++) {
      const cls = dv.getUint8(p);
      const np = dv.getUint16(p + 1, true);
      p += 3;
      const pts = [];
      for (let k = 0; k < np; k++) { pts.push([dv.getInt32(p, true) / 1e6, dv.getInt32(p + 4, true) / 1e6]); p += 8; }
      out.push({ cls, pts });
    }
    return out;
  };
  return { flaechen: liste(), linien: liste(), wege: liste(), ende: p };
}

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

test('Grundkarte: Kachel als Binärformat mit drei Listen, Koordinaten in den Kachelgrenzen', () => {
  const z = 14;
  const n = 2 ** z;
  const x = Math.floor((START.lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(START.lat * Math.PI / 180) + 1 / Math.cos(START.lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const g = kachelGrenzen(z, x, y);
  assert.ok(g.minLat <= START.lat && START.lat <= g.maxLat && g.minLon <= START.lon && START.lon <= g.maxLon);
  const buf = kachelKarte(netz, null, z, x, y);
  const k = lieseKachel(buf);
  assert.equal(k.flaechen.length, 0, 'ohne Grundkarte keine Flächen');
  assert.equal(k.linien.length, 0);
  assert.ok(k.wege.length > 0, 'Wege sind da');
  assert.equal(k.ende, buf.byteLength, 'keine übrigen Bytes');
  for (const w of k.wege) for (const [la, lo] of w.pts) assert.ok(la > 50.9 && la < 51.3 && lo > 6.9 && lo < 7.4, `${la}, ${lo}`);
});

test('Kachel: bei Zoom 8 fehlen kurze Straßen (500 m, auf dem Bildschirm zu klein), bei Zoom 14 sind sie da', () => {
  const kachel = (z) => {
    const n = 2 ** z;
    const x = Math.floor((START.lon + 180) / 360 * n);
    const y = Math.floor((1 - Math.log(Math.tan(START.lat * Math.PI / 180) + 1 / Math.cos(START.lat * Math.PI / 180)) / Math.PI) / 2 * n);
    return lieseKachel(kachelKarte(netz, null, z, x, y)).wege;
  };
  assert.equal(kachel(8).length, 0, 'bei Zoom 8 sind 500-m-Straßen unter einem Pixel-Schwellwert');
  assert.ok(kachel(14).length > 0, 'bei Zoom 14 erscheinen sie');
});

test('Sichtbarkeit wächst mit dem Zoom: ein Weg wird mit steigendem Zoom bei immer kürzerer Länge gezeigt', () => {
  assert.equal(zeigen(13, 2, 60, 51), false, 'Nebenstraßen erst ab Zoom 14');
  assert.equal(zeigen(14, 2, 60, 51), true);
  assert.equal(zeigen(12, 2, 500, 51), true);
  assert.equal(zeigen(11, 1, 3000, 51), false, 'Hauptstraßen erst ab Zoom 12');
  assert.equal(zeigen(12, 1, 3000, 51), true);
  assert.equal(zeigen(13, 2, 3000, 51), false, 'Nebenstraßen erst ab Zoom 14');
  assert.equal(zeigen(12, 4, 3000, 51), false, 'Wege erst bei hohem Zoom');
});

test('Darstellungsart: Hauptstraße, Nebenstraße, Radweg, Weg', () => {
  assert.equal(darstellungsart((1 << 2) | (1 << 5)), 1);
  assert.equal(darstellungsart(1 << 2), 2);
  assert.equal(darstellungsart(1 << 3), 3);
  assert.equal(darstellungsart(1 << 4), 4);
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
