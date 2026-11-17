// Garage-Worker und seine Hilfen: Reichweite im Wegenetz, Angaben für den Planer, Stand des Servers.
// Die Warteschlange selbst (lib/jobs.js) braucht MySQL und wird in tests/speicher.integration.test.js geprüft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Netz } from '../lib/netz.js';
import { rechneReichweite } from '../lib/reichweite.js';
import { ladePlaner, planerLader } from '../lib/planer.js';
import { swapAusMeminfo } from '../lib/system.js';
import { datenstand } from '../lib/datenstand.js';
import { hoehenName } from '../lib/datenquellen.js';
import { gitterNetz } from './hilfen-netz.js';

const RAD = { name: 'Rad', motor_art: 'mittelmotor', akku_kapazitaet_wh: 10, gewicht_kg: 25 };
const START = { lat: 51.075, lon: 7.12 };

test('Worker: Reichweite im Wegenetz (dieselbe Rechnung, die der Job speichert)', () => {
  const netz = new Netz(gitterNetz(31), { minKomponente: 1 });
  const r = rechneReichweite(netz, { fahrrad: RAD, gespann: { fahrer_gewicht_kg: 80 }, einstellungen: {}, start: START, modus: 'alle' });
  assert.equal(r.ok, true);
  assert.ok(r.kennzahlen.punkte_gesamt >= 0);
});

test('Worker: Startpunkt außerhalb des Netzes liefert einen Fehlercode statt einer Rechnung', () => {
  const netz = new Netz(gitterNetz(31), { minKomponente: 1 });
  const r = rechneReichweite(netz, { fahrrad: RAD, gespann: { fahrer_gewicht_kg: 80 }, einstellungen: {}, start: { lat: 53.5, lon: 10 }, modus: 'alle' });
  assert.deepEqual(r.fehler, ['ausserhalb']);
});

test('Planer: ohne Wegenetz oder ohne Ausdehnung gibt es keine Angaben', () => {
  assert.equal(ladePlaner(undefined), null);
  assert.equal(ladePlaner(mkdtempSync(join(tmpdir(), 'garage-leer-'))), null);
  const ohneBox = mkdtempSync(join(tmpdir(), 'garage-ohnebox-'));
  writeFileSync(join(ohneBox, 'info.json'), JSON.stringify({ knoten: 5 }));
  assert.equal(ladePlaner(ohneBox), null, 'ohne bbox ist der Planer nicht eingerichtet');
});

test('Planer: wird nach einem neuen Netzbau ohne Neustart erkannt', () => {
  const ordner = mkdtempSync(join(tmpdir(), 'garage-lader-'));
  const holen = planerLader(ordner);
  assert.equal(holen(), null, 'noch kein Netz');
  writeFileSync(join(ordner, 'info.json'), JSON.stringify({ bbox: { minLat: 50, maxLat: 52, minLon: 6, maxLon: 9 } }));
  assert.equal(holen().bbox.maxLat, 52, 'neues Netz wird gelesen');
});

test('Planer: Ausdehnung und Orte aus dem Wegenetz', () => {
  const ordner = mkdtempSync(join(tmpdir(), 'garage-planer-'));
  writeFileSync(join(ordner, 'info.json'), JSON.stringify({ bbox: { minLat: 50, maxLat: 52, minLon: 6, maxLon: 9 } }));
  writeFileSync(join(ordner, 'orte.json'), JSON.stringify([{ n: 'Köln', lat: 50.9, lon: 6.9 }]));
  const p = ladePlaner(ordner);
  assert.equal(p.bbox.minLat, 50);
  assert.equal(p.orte.length, 1);
});

test('Stand des Servers: Swap aus /proc/meminfo', () => {
  const text = 'MemTotal:        4000000 kB\nMemFree:          100000 kB\nSwapTotal:       2097152 kB\nSwapFree:        1048576 kB\n';
  const s = swapAusMeminfo(() => text);
  assert.equal(s.gesamtMB, 2048);
  assert.equal(s.genutztMB, 1024);
});

test('Stand des Servers: ohne Swap-Angabe (kein Linux) gibt es null', () => {
  assert.equal(swapAusMeminfo(() => 'MemTotal: 1 kB\n'), null);
  assert.equal(swapAusMeminfo(() => { throw new Error('kein /proc'); }), null);
});

test('Höhenkacheln: Name wie im SRTM-Datensatz', () => {
  assert.equal(hoehenName(47, 6), 'N47E006');
  assert.equal(hoehenName(55, 15), 'N55E015');
  assert.equal(hoehenName(-3, -70), 'S03W070');
});

test('Datenstand: ohne ZIP gibt es kein Wegenetz; nach dem Entpacken gilt sein Datum; Kacheln sind älter als das Netz', async () => {
  const netz = mkdtempSync(join(tmpdir(), 'garage-netz-'));
  const env = { NETZ_DIR: netz, KACHEL_DIR: join(netz, '..', 'kacheln-' + Date.now()) };
  const leer = await datenstand({ env, letzte: {} });
  const k0 = Object.fromEntries(leer.objekte.map(o => [o.schluessel, o]));
  assert.equal(k0.netz.vorhanden, false);
  assert.equal(k0.netz.auftrag, 'entpacken');
  mkdirSync(join(netz, 'karte'), { recursive: true });
  writeFileSync(join(netz, 'karte', 'pts.i32'), 'x');
  writeFileSync(join(netz, 'info.json'), '{}');
  const mitNetz = await datenstand({ env, letzte: { entpacken: new Date('2026-11-10T10:00:00Z'), kacheln: new Date('2026-11-09T10:00:00Z') } });
  const k = Object.fromEntries(mitNetz.objekte.map(o => [o.schluessel, o]));
  assert.equal(k.netz.vorhanden, true);
  assert.equal(k.netz.geladen_am, '2026-11-10T10:00:00.000Z');
  assert.equal(k.kacheln.neu, true, 'Netz nach den Kacheln neu eingespielt');
});
