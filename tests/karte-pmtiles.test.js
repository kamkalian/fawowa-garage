// Karte im Browser: Auslieferung der PMTiles-Datei (mit HTTP-Range), Sicherheitsrichtlinie für MapLibre und Stil-Prüfung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { starteTestServer } from './hilfen.js';
import { CSP } from '../lib/sicherheit.js';

const hier = dirname(fileURLToPath(import.meta.url));
const stil = JSON.parse(readFileSync(join(hier, '..', 'src', 'public', 'karte', 'stil.json'), 'utf8'));

/** Eine kleine Test-Datei: Anfang wie eine PMTiles-Datei (Magic und Version 3), dann Füllung */
function karteOrdner(groesse = 1000) {
  const d = mkdtempSync(join(tmpdir(), 'karte-test-'));
  const b = Buffer.alloc(groesse, 9);
  b.write('PMTiles', 0, 'latin1');
  b[7] = 3;
  writeFileSync(join(d, 'germany.pmtiles'), b);
  return d;
}

test('PMTiles-Datei fehlt: 404', async () => {
  const leer = mkdtempSync(join(tmpdir(), 'karte-leer-'));
  const t = await starteTestServer({ app: { env: { KARTE_DIR: leer } } });
  try {
    const r = await t.anfrage('GET', '/karte/germany.pmtiles');
    assert.equal(r.status, 404);
  } finally {
    await t.schliessen();
    rmSync(leer, { recursive: true, force: true });
  }
});

test('PMTiles-Datei wird mit HTTP-Range in Teilen geliefert (206)', async () => {
  const d = karteOrdner(1000);
  const t = await starteTestServer({ app: { env: { KARTE_DIR: d } } });
  try {
    const ganz = await fetch(t.url + '/karte/germany.pmtiles');
    assert.equal(ganz.status, 200);
    assert.equal(ganz.headers.get('accept-ranges'), 'bytes');
    assert.ok(ganz.headers.get('etag'), 'ETag fehlt');
    assert.match(ganz.headers.get('cache-control') ?? '', /max-age=/);
    assert.equal((await ganz.arrayBuffer()).byteLength, 1000);

    const teil = await fetch(t.url + '/karte/germany.pmtiles', { headers: { Range: 'bytes=0-99' } });
    assert.equal(teil.status, 206);
    assert.equal(teil.headers.get('content-range'), 'bytes 0-99/1000');
    assert.equal((await teil.arrayBuffer()).byteLength, 100);

    const ende = await fetch(t.url + '/karte/germany.pmtiles', { headers: { Range: 'bytes=900-' } });
    assert.equal(ende.status, 206);
    assert.equal((await ende.arrayBuffer()).byteLength, 100);
  } finally {
    await t.schliessen();
    rmSync(d, { recursive: true, force: true });
  }
});

test('Sicherheitsrichtlinie erlaubt MapLibre-Arbeitsprozesse aus blob: und sonst nichts Fremdes', () => {
  assert.match(CSP, /worker-src 'self' blob:/);
  assert.match(CSP, /connect-src 'self' data: blob:/); // Wärmekarte: MapLibre lädt das data:-Bild per fetch
  assert.doesNotMatch(CSP, /unsafe-eval|unsafe-inline/);
});

test('Stil: Version 8, jede Ebene nutzt eine vorhandene Quelle, Ebenen-Ids eindeutig', () => {
  assert.equal(stil.version, 8);
  const quellen = Object.keys(stil.sources);
  assert.deepEqual(quellen, ['osm']);
  assert.equal(stil.sources.osm.type, 'vector');
  const ids = new Set();
  for (const l of stil.layers) {
    assert.ok(!ids.has(l.id), `Ebenen-Id doppelt: ${l.id}`);
    ids.add(l.id);
    if (l.type === 'background') continue;
    assert.ok(quellen.includes(l.source), `Ebene ${l.id} nutzt unbekannte Quelle ${l.source}`);
    assert.ok(l.paint && Object.keys(l.paint).length > 0, `Ebene ${l.id} ohne Farbe/Linie`);
  }
});

test('Stil: Ortsnamen nutzen nur Schriften, die als Glyphen auf dem Server liegen', () => {
  const beschriftet = stil.layers.filter((l) => l.type === 'symbol');
  assert.ok(beschriftet.some((l) => l.id === 'ort-stadt'), 'Städte fehlen');
  for (const l of beschriftet) {
    for (const schrift of l.layout['text-font']) {
      const ordner = join(hier, '..', 'public', 'karte', 'glyphs', schrift);
      assert.ok(existsSync(join(ordner, '0-255.pbf')), `Glyphen für ${schrift} fehlen`);
    }
  }
  assert.ok(stil.layers.some((l) => l.id === 'weg-autobahn'), 'Autobahn-Ebene fehlt');
  assert.ok(stil.layers.some((l) => l.id === 'radweg'), 'Radweg-Ebene fehlt');
});

test('Stil: Auf- und Abfahrten liegen unter den Hauptstraßen, Radwege durchgehend grün (ohne Strichelung)', () => {
  const reihe = stil.layers.map((l) => l.id);
  const rampe = reihe.indexOf('weg-rampe');
  for (const id of ['weg-nebenstrasse', 'weg-hauptstrasse', 'weg-bundesstrasse', 'weg-autobahn']) {
    assert.ok(rampe < reihe.indexOf(id), `Rampen müssen vor ${id} gezeichnet werden`);
    const ebene = stil.layers.find((l) => l.id === id);
    assert.match(JSON.stringify(ebene.filter), /"ramp"/, `${id} schließt Rampen nicht aus`);
  }
  const rad = stil.layers.find((l) => l.id === 'radweg');
  assert.equal(rad.paint['line-dasharray'], undefined, 'Radweg darf nicht gestrichelt sein');
  assert.ok(rad.minzoom <= 8, 'Radweg muss ab Zoom 8 sichtbar sein');
});
