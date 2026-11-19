// Die ZIP-Datei vom eigenen Rechner (Daten-Werkzeug) wird auf dem Server wieder ausgepackt (lib/zip.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, createWriteStream } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import archiver from 'archiver';
import { entpacken } from '../lib/zip.js';

test('ZIP: auspacken stellt Ordner und Dateien genau wieder her', async () => {
  const quelle = mkdtempSync(join(tmpdir(), 'garage-zip-quelle-'));
  mkdirSync(join(quelle, 'karte'), { recursive: true });
  writeFileSync(join(quelle, 'info.json'), JSON.stringify({ bbox: { minLat: 47, maxLat: 55, minLon: 5, maxLon: 15 } }));
  writeFileSync(join(quelle, 'karte', 'pts.i32'), Buffer.from([1, 2, 3, 250]));
  const zip = join(mkdtempSync(join(tmpdir(), 'garage-zip-')), 'netz.zip');
  await new Promise((aufloesen, ablehnen) => {
    const archiv = archiver('zip', { zlib: { level: 6 } });
    const ausgabe = createWriteStream(zip);
    ausgabe.on('close', aufloesen);
    archiv.on('error', ablehnen);
    archiv.pipe(ausgabe);
    archiv.directory(quelle, false);
    archiv.finalize();
  });
  const ziel = mkdtempSync(join(tmpdir(), 'garage-zip-ziel-'));
  const fortschritt = [];
  await entpacken(zip, ziel, (p) => fortschritt.push(p));
  assert.deepEqual(readFileSync(join(ziel, 'karte', 'pts.i32')), Buffer.from([1, 2, 3, 250]));
  assert.equal(JSON.parse(readFileSync(join(ziel, 'info.json'), 'utf8')).bbox.maxLat, 55);
  assert.equal(fortschritt.at(-1), 100, 'am Ende 100 Prozent');
});
