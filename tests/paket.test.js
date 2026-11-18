// Paketformat: Manifest des gemeinsamen Beispielpakets (tests/daten/paket, erzeugt vom Go-Werkzeug) lesen und prüfen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, copyFileSync, mkdtempSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pruefeManifest, pruefeZips, pfadErlaubt } from '../lib/paket.js';

const hier = dirname(fileURLToPath(import.meta.url));
const beispiel = join(hier, 'daten', 'paket');
const manifestDatei = readdirSync(beispiel).find((n) => n.endsWith('.manifest.json'));
const manifest = JSON.parse(readFileSync(join(beispiel, manifestDatei), 'utf8'));

test('Beispielpaket: Manifest ist in Ordnung', () => {
  assert.deepEqual(pruefeManifest(manifest), []);
  assert.equal(manifest.format, 'fawowa-paket-1');
  assert.equal(manifest.art, 'netz');
});

test('Beispielpaket: ZIPs stimmen mit Größe und Prüfsumme überein', async () => {
  assert.deepEqual(await pruefeZips(manifest, beispiel), []);
});

test('Verändertes ZIP wird erkannt (gleiche Größe, andere Prüfsumme)', async () => {
  const kopie = mkdtempSync(join(tmpdir(), 'garage-paket-'));
  try {
    for (const n of readdirSync(beispiel)) copyFileSync(join(beispiel, n), join(kopie, n));
    const zip = join(kopie, manifest.zips[0].name);
    const daten = readFileSync(zip);
    daten[daten.length >> 1] ^= 0xff;
    writeFileSync(zip, daten);
    const probleme = await pruefeZips(manifest, kopie);
    assert.ok(probleme.some((p) => p.includes('verändert')), probleme.join(' | '));
  } finally {
    rmSync(kopie, { recursive: true, force: true });
  }
});

test('Fehlendes ZIP wird erkannt', async () => {
  const probleme = await pruefeZips(manifest, join(beispiel, 'nicht-vorhanden'));
  assert.ok(probleme.some((p) => p.includes('fehlt')));
});

test('Pfade: nur a-z0-9._- und /, kein .. und kein absoluter Pfad', () => {
  for (const p of ['../x', '/x', 'a/../b', 'Gross.bin', 'a b', '']) assert.equal(pfadErlaubt(p), false, p);
  for (const p of ['germany.pmtiles', 'karte/pts.i32', 'knoten_lat.i32']) assert.equal(pfadErlaubt(p), true, p);
});

test('Manifest mit kaputten Angaben liefert Probleme', () => {
  const kaputt = JSON.parse(JSON.stringify(manifest));
  kaputt.dateien[0].pfad = '../etc/passwd';
  kaputt.dateien[0].bytes += 1;
  kaputt.format = 'anderes-format';
  const probleme = pruefeManifest(kaputt);
  assert.ok(probleme.length >= 3, probleme.join(' | '));
});
