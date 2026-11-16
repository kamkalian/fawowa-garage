import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Netz } from '../lib/netz.js';
import { rechneReichweite } from '../lib/reichweite.js';
import { kachelKarte, kachelGrenzen, darstellungsart } from '../lib/karte-daten.js';
import { gitterNetz, testNetz } from './hilfen-netz.js';

const FAHRRAD = { motor_art: 'mittelmotor', motor_nennleistung_w: 250, akku_kapazitaet_wh: 18, schaltung_art: 'kette', gewicht_kg: 25 };
const OHNE_MOTOR = { motor_art: 'ohne', gewicht_kg: 25 };
const GESPANN = { fahrer_gewicht_kg: 80 };
const START = { lat: 51.075, lon: 7.12 }; // Mitte des Gitters

const netz = new Netz(gitterNetz(31), { minKomponente: 1 });
const rechne = (zusatz = {}) => rechneReichweite(netz, { fahrrad: FAHRRAD, anhaenger: null, gespann: GESPANN, einstellungen: {}, start: START, modus: 'alle', ...zusatz });
/** Wert des Rasters (0..max) an einem Punkt, 'max' außerhalb */
const wert = (r, lat, lon) => {
  const { lat0, lon0, dLat, dLon, nx, ny, max, daten } = r.raster;
  const x = Math.floor((lon - lon0) / dLon);
  const y = Math.floor((lat - lat0) / dLat);
  if (x < 0 || y < 0 || x >= nx || y >= ny) return max;
  return Buffer.from(daten, 'base64')[y * nx + x] / 254 * max;
};

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

test('Reichweite: Ergebnis mit Start, Raster und Kennzahlen (ohne Umrandung)', () => {
  const r = rechne();
  assert.equal(r.ok, true);
  assert.ok(r.start.abstand_m < 400);
  assert.equal(r.budget.art, 'akku');
  assert.equal(r.budget.einheit, 'Wh');
  assert.ok(r.budget.wert > 0 && r.budget.wert < 20);
  assert.equal(r.umrandung, undefined, 'die Begrenzungslinie gibt es nicht mehr');
  assert.equal(Buffer.from(r.raster.daten, 'base64').length, r.raster.nx * r.raster.ny);
  assert.equal(r.raster.max, 1.5);
  assert.ok(r.kennzahlen.flaeche_km2 > 0 && r.kennzahlen.weitester_km > 1);
});

test('Reichweite: nahe am Start wenig, weiter weg mehr, außerhalb des Rasters der Höchstwert', () => {
  const r = rechne();
  const nah = wert(r, 51.075, 7.12);
  assert.ok(nah < 0.3, `am Start ${nah}`);
  assert.ok(nah < wert(r, 51.075 + 0.04, 7.12), 'weiter weg kostet mehr');
  assert.equal(wert(r, 52.0, 7.12), 1.5);
});

test('Reichweite: es gibt einen grauen Rand über der Grenze und die Werte sind geglättet', () => {
  const r = rechne();
  const { nx, ny, daten } = r.raster;
  const bytes = Buffer.from(daten, 'base64');
  let grau = 0; let rot = 0;
  for (let i = 0; i < nx * ny; i++) {
    const f = bytes[i] / 254 * 1.5;
    if (f > 1 && f < 1.5) grau++;
    if (f <= 1) rot++;
  }
  assert.ok(rot > 0, 'innerhalb der Grenze gibt es Fläche');
  assert.ok(grau > 0, 'es gibt einen Übergangsbereich über der Grenze');
  let sprung = 0;
  for (let y = 0; y < ny; y++) for (let x = 1; x < nx; x++) sprung = Math.max(sprung, Math.abs(bytes[y * nx + x] - bytes[y * nx + x - 1]));
  assert.ok(sprung < 60, `größter Sprung zwischen Nachbarn: ${sprung}`);
});

test('Reichweite: mehr Akku und weniger Füllstand wirken in die erwartete Richtung', () => {
  const normal = rechne().kennzahlen.flaeche_km2;
  const mehr = rechne({ fahrrad: { ...FAHRRAD, akku_kapazitaet_wh: 60 } }).kennzahlen.flaeche_km2;
  const weniger = rechne({ einstellungen: { akku_rest_prozent: 40 } }).kennzahlen.flaeche_km2;
  assert.ok(mehr > normal && weniger < normal, `${weniger} < ${normal} < ${mehr}`);
});

test('Reichweite nach Fahrtzeit: auch ohne Motor, Einheit Stunden', () => {
  const r = rechne({ fahrrad: OHNE_MOTOR, einstellungen: { budget_art: 'zeit', fahrtzeit_h: 0.5 } });
  assert.equal(r.ok, true);
  assert.equal(r.budget.art, 'zeit');
  assert.equal(r.budget.einheit, 'h');
  assert.equal(r.budget.wert, 0.5);
  assert.ok(r.kennzahlen.flaeche_km2 > 0);
  const laenger = rechne({ fahrrad: OHNE_MOTOR, einstellungen: { budget_art: 'zeit', fahrtzeit_h: 1 } });
  assert.ok(laenger.kennzahlen.flaeche_km2 > r.kennzahlen.flaeche_km2, 'mehr Zeit, mehr Fläche');
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

test('Kachel bei kleinem Zoom: das Gitter (nur 500-m-Straßen) zeigt bei Zoom 8 nichts', () => {
  const z = 8;
  const n = 2 ** z;
  const x = Math.floor((START.lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(START.lat * Math.PI / 180) + 1 / Math.cos(START.lat * Math.PI / 180)) / Math.PI) / 2 * n);
  assert.equal(lieseKachel(kachelKarte(netz, null, z, x, y)).wege.length, 0);
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
  const ohne = rechneReichweite(netz, { fahrrad: FAHRRAD, anhaenger, gespann: GESPANN, einstellungen: {}, start: START, modus: 'alle' }).kennzahlen.flaeche_km2;
  const mit = rechneReichweite(netz, { fahrrad: FAHRRAD, anhaenger, gespann: GESPANN, einstellungen: { einstrahlung_w_m2: 900 }, start: START, modus: 'alle' }).kennzahlen.flaeche_km2;
  assert.ok(mit > ohne, `${mit} > ${ohne}`);
});
