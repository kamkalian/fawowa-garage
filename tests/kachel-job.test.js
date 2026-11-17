import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { KachelJob, kachelDatei, kachelnImRechteck } from '../lib/kachel-job.js';

const BBOX = { minLat: 51.0, maxLat: 51.05, minLon: 7.0, maxLon: 7.05 };

test('Kacheln: Bereich eines Rechtecks je Zoomstufe', () => {
  const b = kachelnImRechteck(10, BBOX);
  assert.ok(b.anzahl >= 1 && b.x0 <= b.x1 && b.y0 <= b.y1);
  assert.equal(b.anzahl, (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1));
});

test('Kachel-Job: erzeugt alle Kacheln auf der Platte, überspringt vorhandene', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kacheln-'));
  try {
    let aufrufe = 0;
    const routing = { bereit: true, info: { bbox: BBOX }, linien: async () => { aufrufe++; return new Uint8Array([1, 2, 3]).buffer; } };
    const job = new KachelJob({ routing, verzeichnis: dir, log: () => {} });
    const erwartet = kachelnImRechteck(10, BBOX).anzahl;
    assert.equal(job.schaetzung([10]).gesamt, erwartet);

    job.start([10]);
    while (job.status().laeuft) await new Promise(r => setTimeout(r, 5));
    const s = job.status();
    assert.equal(s.fertig, erwartet);
    assert.equal(s.fehler, 0);
    assert.equal(aufrufe, erwartet);
    const b = kachelnImRechteck(10, BBOX);
    assert.deepEqual([...readFileSync(kachelDatei(dir, 10, b.x0, b.y0))], [1, 2, 3]);

    // Zweiter Lauf: alles vorhanden, nichts wird erneut erzeugt
    job.start([10]);
    while (job.status().laeuft) await new Promise(r => setTimeout(r, 5));
    assert.equal(aufrufe, erwartet, 'keine doppelten Aufrufe');
    assert.ok(existsSync(join(dir, 'job.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
