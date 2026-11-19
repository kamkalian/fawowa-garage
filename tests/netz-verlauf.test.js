import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Netz } from '../lib/netz.js';

// Kleines Netz mit einer Kante, deren Verlauf knickt: erst 80 m nach Norden, dann 60 m nach Osten.
// Die Luftlinie zwischen den Knoten würde den Knick abschneiden; der Verlauf muss ihm folgen.
function minimalesNetz() {
  const n = Object.create(Netz.prototype);
  n.knLat = Int32Array.from([500000000, 500007200]);  // 50,0000000 und 50,0007200 (≈ 80 m nördlich)
  n.knLon = Int32Array.from([80000000, 80008380]);    // 8,0000000 und 8,0008380 (≈ 60 m östlich vom ersten Knoten)
  n.adjStart = Uint32Array.from([0, 1, 2]);
  n.adj = Uint32Array.from([0, 1]);                   // Kante 0: Knoten 0 zu Knoten 1 (Bit 0 = von B aus)
  n.kA = Uint32Array.from([0]);
  n.kB = Uint32Array.from([1]);
  n.kLegStart = Uint32Array.from([0]);
  n.kLegN = Uint8Array.from([2]);
  n.legLen = Uint16Array.from([800, 600]);            // Zehntelmeter
  n.legKurs = Uint8Array.from([0, 64]);               // 0 = Nord, 64 = Ost (256 Schritte je Umdrehung)
  n.lat = (i) => n.knLat[i] / 1e7;
  n.lon = (i) => n.knLon[i] / 1e7;
  return n;
}

test('Verlauf zwischen zwei Knoten folgt der Kante, nicht der Luftlinie', () => {
  const n = minimalesNetz();
  const punkte = n.verlaufZwischen(0, 1);
  assert.ok(punkte.length >= 3, 'mindestens ein Zwischenpunkt am Knick');
  const [la0, lo0] = punkte[0];
  const [la1, lo1] = punkte[punkte.length - 1];
  // Abstand des Knickpunkts von der Luftlinie zwischen Anfang und Ende
  const mitte = punkte[1];
  const dLa = la1 - la0;
  const dLo = lo1 - lo0;
  const laenge = Math.hypot(dLa, dLo);
  const abstand = Math.abs((mitte[0] - la0) * dLo - (mitte[1] - lo0) * dLa) / laenge; // Abstand von der Luftlinie in Grad (≈ 0,0005 = 50 m)
  assert.ok(abstand > 1e-5, `Zwischenpunkt liegt neben der Luftlinie (Abstand ${abstand})`);
});

test('Verlauf in umgekehrter Richtung beginnt beim anderen Knoten', () => {
  const n = minimalesNetz();
  const hin = n.verlaufZwischen(0, 1);
  const zurueck = n.verlaufZwischen(1, 0);
  assert.deepEqual(zurueck[0], hin[hin.length - 1]);
  assert.deepEqual(zurueck[zurueck.length - 1], hin[0]);
});

test('Mit gespeichertem Verlauf je Kante werden die Weg-Punkte genau übernommen (inkl. Knick)', () => {
  const n = minimalesNetz();
  // Verlauf aus dem Bau: Anfang, Knick, Ende – als Punkte je Kante (1e-7 Grad)
  n.formStart = Uint32Array.from([0]);
  n.formN = Uint32Array.from([3]);
  n.formLat = Int32Array.from([500000000, 500007200, 500007200]);
  n.formLon = Int32Array.from([80000000, 80000000, 80008380]);
  const punkte = n.verlaufZwischen(0, 1);
  assert.deepEqual(punkte, [[50, 8], [50.00072, 8], [50.00072, 8.000838]]);
  assert.deepEqual(n.verlaufZwischen(1, 0)[1], [50.00072, 8]);
});
