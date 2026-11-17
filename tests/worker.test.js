// Garage-Worker und seine Hilfen: Reichweite im Wegenetz, Angaben für den Planer, Stand des Servers.
// Die Warteschlange selbst (lib/jobs.js) braucht MySQL und wird in tests/speicher.integration.test.js geprüft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Netz } from '../lib/netz.js';
import { rechneReichweite } from '../lib/reichweite.js';
import { ladePlaner } from '../lib/planer.js';
import { swapAusMeminfo, netzStand } from '../lib/system.js';
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

test('Kartendaten: Anzeige, was vorhanden ist', () => {
  const leer = mkdtempSync(join(tmpdir(), 'garage-stand-'));
  const s = netzStand({ NETZ_DIR: join(leer, 'netz') });
  assert.equal(s.netz, false);
  assert.equal(s.pbf, false);
  assert.equal(s.kachelVersionen, 0);
  mkdirSync(join(leer, 'kacheln', 'v1'), { recursive: true });
  assert.equal(netzStand({ NETZ_DIR: join(leer, 'netz') }).kachelVersionen, 1);
  assert.equal(netzStand({}), null);
});
