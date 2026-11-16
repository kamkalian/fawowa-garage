import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KarteBasis } from '../lib/karte-basis.js';

// Zwei Merkmale in Kachelnähe: eine kurze Straßenlinie (Klasse 5) und ein kurzes Autobahnstück (Klasse 8)
function fake() {
  return Object.assign(Object.create(KarteBasis.prototype), {
    n: 2,
    meta: new Uint8Array([(5 << 1) | 1, (8 << 1) | 1]),
    bbox: new Float32Array([51.0, 7.0, 51.00001, 7.00001, 51.0, 7.0, 51.00001, 7.00001])
  });
}

test('Grundkarte: kurze Merkmale fallen bei kleinem Zoom weg, Autobahnen bleiben', () => {
  const ids = fake().fuerKachel(8, 50.9, 6.9, 51.1, 7.1);
  assert.deepEqual(ids, [1], 'nur die Autobahn bleibt');
});
