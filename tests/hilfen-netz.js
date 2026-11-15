// Kleines Wegenetz im Binärformat von tools/routing/bauen.js für Tests.
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Netz } from '../lib/netz.js';

export const STRASSE = 1 << 2;
export const RADWEG = 1 << 3;

//   0 ─(Straße, eben)─ 1 ─(Radweg, 4 % bergauf von 1 nach 2)─ 2 ─(Einbahn 2→3, Straße)─ 3,   dazu eine abgetrennte Insel 4 ─ 5
export function schreibeNetz(kanten, knoten) {
  const dir = mkdtempSync(join(tmpdir(), 'garage-netz-'));
  const N = knoten.length;
  const E = kanten.length;
  const grad = new Uint32Array(N + 1);
  for (const k of kanten) { grad[k.a + 1]++; grad[k.b + 1]++; }
  for (let i = 0; i < N; i++) grad[i + 1] += grad[i];
  const adj = new Uint32Array(E * 2);
  const fuell = grad.slice(0, N);
  kanten.forEach((k, e) => { adj[fuell[k.a]++] = e * 2; adj[fuell[k.b]++] = e * 2 + 1; });
  const datei = (name, arr) => writeFileSync(join(dir, name), Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
  datei('knoten_lat.i32', Int32Array.from(knoten.map(k => Math.round(k[0] * 1e7))));
  datei('knoten_lon.i32', Int32Array.from(knoten.map(k => Math.round(k[1] * 1e7))));
  datei('adj_start.u32', grad);
  datei('adj.u32', adj);
  datei('kante_a.u32', Uint32Array.from(kanten.map(k => k.a)));
  datei('kante_b.u32', Uint32Array.from(kanten.map(k => k.b)));
  datei('kante_flags.u8', Uint8Array.from(kanten.map(k => k.flags)));
  datei('kante_belag.u8', Uint8Array.from(kanten.map(() => 20)));
  datei('kante_leg_start.u32', Uint32Array.from(kanten.map((_, i) => i)));
  datei('kante_leg_n.u8', Uint8Array.from(kanten.map(() => 1)));
  datei('leg_len.u16', Uint16Array.from(kanten.map(k => k.laenge * 10)));
  datei('leg_grad.i8', Int8Array.from(kanten.map(k => Math.round((k.steigung ?? 0) * 200))));
  datei('leg_kurs.u8', Uint8Array.from(kanten.map(k => k.kurs ?? 64)));
  return dir;
}
export function testNetz() {
  const dir = schreibeNetz([
    { a: 0, b: 1, flags: 3 | STRASSE, laenge: 1000 },
    { a: 1, b: 2, flags: 3 | RADWEG, laenge: 1000, steigung: 0.04 },
    { a: 2, b: 3, flags: 1 | STRASSE, laenge: 1000 },
    { a: 4, b: 5, flags: 3 | STRASSE, laenge: 500 }
  ], [[51.0, 7.0], [51.0, 7.01], [51.0, 7.02], [51.0, 7.03], [51.1, 7.0], [51.1, 7.01]]);
  const netz = new Netz(dir);
  netz.minKomponente = 1;
  netz.ordner = dir;
  return netz;
}

/** Quadratisches Straßengitter aus n × n Knoten (Abstand 0,005° Breite, 0,008° Länge, Kanten 500 m, eben) um 51,0 N 7,0 O; Ergebnis: Ordner */
export function gitterNetz(n = 31) {
  const knoten = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) knoten.push([51.0 + i * 0.005, 7.0 + j * 0.008]);
  const kanten = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (j + 1 < n) kanten.push({ a: i * n + j, b: i * n + j + 1, flags: 3 | STRASSE, laenge: 500, kurs: 64 });      // nach Osten
      if (i + 1 < n) kanten.push({ a: i * n + j, b: (i + 1) * n + j, flags: 3 | STRASSE, laenge: 500, kurs: 0 });       // nach Norden
    }
  }
  return schreibeNetz(kanten, knoten);
}
