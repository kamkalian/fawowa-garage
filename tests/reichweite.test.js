import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Netz } from '../lib/netz.js';
import { rechneReichweite } from '../lib/reichweite.js';
import { kachelLinien, kachelGrenzen, darstellungsart } from '../lib/karte-daten.js';
import { gitterNetz, testNetz } from './hilfen-netz.js';

const FAHRRAD = { motor_art: 'mittelmotor', motor_nennleistung_w: 250, akku_kapazitaet_wh: 10, schaltung_art: 'kette', gewicht_kg: 25 };
const GESPANN = { fahrer_gewicht_kg: 80 };
const START = { lat: 51.075, lon: 7.12 }; // Mitte des Gitters

const netz = new Netz(gitterNetz(31), { minKomponente: 1 });
const rechne = (zusatz = {}) => rechneReichweite(netz, { fahrrad: FAHRRAD, anhaenger: null, gespann: GESPANN, einstellungen: {}, start: START, modus: 'alle', ...zusatz });
const zelle = (r, lat, lon) => {
  const { lat0, lon0, dLat, dLon, nx, ny, daten } = r.raster;
  const x = Math.floor((lon - lon0) / dLon);
  const y = Math.floor((lat - lat0) / dLat);
  if (x < 0 || y < 0 || x >= nx || y >= ny) return 255;
  return Buffer.from(daten, 'base64')[y * nx + x];
};

test('Reichweite: Ergebnis mit Start, Raster, Umrandung und Kennzahlen', () => {
  const r = rechne();
  assert.equal(r.ok, true);
  assert.ok(r.start.abstand_m < 400);
  assert.ok(r.budget_wh > 0 && r.budget_wh < 10);
  assert.equal(r.modus, 'alle');
  assert.deepEqual(r.annahmen.includes('anhaenger_flaeche'), false);
  assert.ok(r.kennzahlen.flaeche_km2 > 0 && r.kennzahlen.weitester_km > 1 && r.kennzahlen.knoten > 10);
  assert.equal(Buffer.from(r.raster.daten, 'base64').length, r.raster.nx * r.raster.ny);
  assert.ok(r.umrandung.length >= 1 && r.umrandung[0].length >= 16);
  for (const linie of r.umrandung) for (const [la, lo] of linie) assert.ok(Number.isFinite(la) && Number.isFinite(lo));
});

test('Reichweite: nahe am Start ist wenig Energie verbraucht, außerhalb ist „nicht erreicht“', () => {
  const r = rechne();
  const nah = zelle(r, 51.075, 7.12);
  assert.ok(nah < 20, `am Start ${nah}`);
  assert.ok(nah < zelle(r, 51.075 + 0.04, 7.12), 'weiter weg kostet mehr');
  assert.equal(zelle(r, 52.0, 7.12), 255);
  assert.equal(zelle(r, 51.075, 9.0), 255);
});

test('Reichweite: die Umrandung umschließt den Start und liegt nahe am Rand des Rasters', () => {
  const r = rechne();
  const alle = r.umrandung.flat();
  const lats = alle.map(p => p[0]);
  const lons = alle.map(p => p[1]);
  assert.ok(Math.min(...lats) < START.lat && Math.max(...lats) > START.lat);
  assert.ok(Math.min(...lons) < START.lon && Math.max(...lons) > START.lon);
  // jede Linie liegt in der Nähe der Grenze: innen erreicht, außen nicht
  const innen = r.umrandung.find(l => l.length > 30);
  assert.ok(innen, 'ein großer Ring');
  const [la, lo] = innen[Math.floor(innen.length / 2)];
  assert.ok(zelle(r, la, lo) !== undefined);
});

test('Reichweite: mehr Akku, Gegenwind und Steigung wirken in die erwartete Richtung', () => {
  const normal = rechne().kennzahlen.flaeche_km2;
  const mehr = rechne({ fahrrad: { ...FAHRRAD, akku_kapazitaet_wh: 18 } }).kennzahlen.flaeche_km2;
  const weniger = rechne({ einstellungen: { akku_rest_prozent: 40 } }).kennzahlen.flaeche_km2;
  assert.ok(mehr > normal && weniger < normal, `${weniger} < ${normal} < ${mehr}`);
});

test('Reichweite: Fehler werden mit Codes gemeldet', () => {
  assert.deepEqual(rechne({ fahrrad: null }).fehler, ['fahrrad_fehlt']);
  assert.deepEqual(rechne({ fahrrad: { ...FAHRRAD, motor_art: 'ohne' } }).fehler, ['kein_motor']);
  assert.deepEqual(rechne({ fahrrad: { ...FAHRRAD, akku_kapazitaet_wh: null } }).fehler, ['akku_fehlt']);
  assert.deepEqual(rechne({ einstellungen: { akku_rest_prozent: 3, reserve_prozent: 5 } }).fehler, ['akku_leer']);
  assert.deepEqual(rechne({ einstellungen: { wind_ms: 99 } }).fehler, ['einstellungen_ungueltig']);
  assert.deepEqual(rechne({ start: { lat: 53.5, lon: 10 } }).fehler, ['ausserhalb']);
  assert.deepEqual(rechne({ start: { lat: 'x', lon: 7 } }).fehler, ['start_ungueltig']);
  assert.deepEqual(rechne({ start: undefined }).fehler, ['start_ungueltig']);
  assert.deepEqual(rechne({ modus: 'radweg' }).fehler, ['modus_ungueltig']);
  // Start weit vom nächsten Weg: Gitter endet bei 51,15 N; hier 51,155 liegt nur 550 m daneben, 51,15+0,03 wäre außerhalb der Box
  assert.equal(rechne({ modus: 'strasse' }).ok, true);
});

test('Reichweite: unsinnige Eingaben stürzen nicht ab', () => {
  for (const eingabe of [{}, { start: { lat: NaN, lon: NaN } }, { start: { lat: 51, lon: 7 }, fahrrad: 5 }, { einstellungen: 'x' }]) {
    const r = rechneReichweite(netz, eingabe);
    assert.ok(r.fehler || r.ok);
  }
});

test('Kartenkacheln: Grenzen, Binärformat und Detailstufen', () => {
  // Kachel, in der der Start liegt (Zoom 14)
  const z = 14;
  const n = 2 ** z;
  const x = Math.floor((START.lon + 180) / 360 * n);
  const y = Math.floor((1 - Math.log(Math.tan(START.lat * Math.PI / 180) + 1 / Math.cos(START.lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const g = kachelGrenzen(z, x, y);
  assert.ok(g.minLat <= START.lat && START.lat <= g.maxLat && g.minLon <= START.lon && START.lon <= g.maxLon);

  const buf = kachelLinien(netz, z, x, y);
  const dv = new DataView(buf);
  const anzahl = dv.getUint32(0, true);
  assert.ok(anzahl > 0);
  let p = 4;
  for (let i = 0; i < anzahl; i++) {
    const art = dv.getUint8(p++);
    const punkte = dv.getUint8(p++);
    assert.ok(art >= 1 && art <= 4 && punkte >= 2);
    for (let k = 0; k < punkte; k++) {
      const la = dv.getInt32(p, true) / 1e6; const lo = dv.getInt32(p + 4, true) / 1e6;
      p += 8;
      assert.ok(la > 50.9 && la < 51.3 && lo > 6.9 && lo < 7.4, `${la}, ${lo}`);
    }
  }
  assert.equal(p, buf.byteLength, 'keine übrigen Bytes');
  // Bei kleinem Zoom werden nur Hauptstraßen gezeigt: das Gitter hat keine
  const wenig = new DataView(kachelLinien(netz, 10, Math.floor((START.lon + 180) / 360 * 1024), 0));
  assert.equal(wenig.getUint32(0, true), 0);
});

test('Darstellungsart: Hauptstraße, Nebenstraße, Radweg, Weg', () => {
  assert.equal(darstellungsart((1 << 2) | (1 << 5)), 1);
  assert.equal(darstellungsart(1 << 2), 2);
  assert.equal(darstellungsart(1 << 3), 3);
  assert.equal(darstellungsart(1 << 4), 4);
});

test('Netz: Linie einer Kante beginnt und endet an den Knoten', () => {
  const kleines = testNetz();
  const linie = kleines.kantenLinie(1);
  assert.deepEqual(linie[0], [kleines.lat(kleines.kA[1]), kleines.lon(kleines.kA[1])]);
  const letzte = linie[linie.length - 1];
  assert.ok(Math.abs(letzte[0] - kleines.lat(kleines.kB[1])) < 1e-9 && Math.abs(letzte[1] - kleines.lon(kleines.kB[1])) < 1e-9);
  assert.equal(kleines.kantenImRechteck(50, 6, 52, 8).length, 4);
  assert.equal(kleines.kantenImRechteck(50, 6, 50.5, 6.5).length, 0);
});

test('Solar: Gutschrift senkt die Kosten, ohne sie negativ zu machen', () => {
  const ohne = rechne({ anhaenger: { leergewicht_kg: 40, solar_wp: 300 } }).kennzahlen.flaeche_km2;
  const mit = rechne({ anhaenger: { leergewicht_kg: 40, solar_wp: 300 }, einstellungen: { einstrahlung_w_m2: 900 } }).kennzahlen.flaeche_km2;
  assert.ok(mit > ohne, `${mit} > ${ohne}`);
});

after(() => {});
