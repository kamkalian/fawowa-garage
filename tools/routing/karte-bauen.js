// Grundkarte für NRW aus OpenStreetMap: Flächen (Wasser, Wald, Grünflächen, Wohngebiete) und Linien (Flüsse, Bäche, Bahn).
// Geschrieben wird nach <Netzordner>/karte. Mehrfachflächen (Relationen vom Typ multipolygon, z. B. Flussufer und Seen) werden
// aus ihren Außenrändern zusammengesetzt; Flüsse aus Relationen vom Typ waterway als Linien. Innenringe (Inseln) werden nicht
// ausgeschnitten. Die Geometrie wird vereinfacht (etwa 4 m).
// Aufruf: node tools/routing/karte-bauen.js <osm.pbf> <Netzordner>
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { leseDatei } from './pbf.js';

const [, , pbfDatei, netzOrdner] = process.argv;
if (!pbfDatei || !netzOrdner) {
  console.error('Aufruf: node tools/routing/karte-bauen.js <osm.pbf> <Netzordner>');
  process.exit(1);
}
const ausgabe = join(netzOrdner, 'karte');
mkdirSync(ausgabe, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0).padStart(4) + ' s', ...a);

const SCHLUESSEL = new Set(['natural', 'landuse', 'leisure', 'waterway', 'railway', 'water', 'highway', 'type', 'motorroad']);

// Knoten (in der Datei nach ID sortiert) mit Koordinaten in 1e-7 Grad
let kIds = new Float64Array(1 << 26);
let kLat = new Int32Array(1 << 26);
let kLon = new Int32Array(1 << 26);
let nK = 0;
function knotenDazu(ids, la, lo, n) {
  if (nK + n > kIds.length) {
    const m = Math.max(kIds.length * 2, nK + n);
    const a = new Float64Array(m); a.set(kIds); kIds = a;
    const b = new Int32Array(m); b.set(kLat); kLat = b;
    const c = new Int32Array(m); c.set(kLon); kLon = c;
  }
  for (let i = 0; i < n; i++) {
    kIds[nK] = ids[i];
    kLat[nK] = Math.round(la[i] * 1e7);
    kLon[nK] = Math.round(lo[i] * 1e7);
    nK++;
  }
}
function suche(id) {
  let lo = 0; let hi = nK - 1;
  while (lo <= hi) {
    const m = (lo + hi) >>> 1;
    const w = kIds[m];
    if (w < id) lo = m + 1; else if (w > id) hi = m - 1; else return m;
  }
  return -1;
}

const GRUEN_LANDUSE = new Set(['grass', 'meadow', 'recreation_ground', 'village_green', 'cemetery', 'orchard', 'vineyard', 'allotments']);
const GRUEN_LEISURE = new Set(['park', 'garden', 'playground', 'recreation_ground', 'pitch']);

/** Klasse eines Weges: 1 Wasser, 2 Wald, 3 Grün, 4 Wohngebiet (Flächen); 5 Fluss, 6 Bach, 7 Bahn, 8 Autobahn (Linien) */
function klassifiziere(t) {
  if (t.natural === 'water' || t.water || t.landuse === 'reservoir' || t.waterway === 'riverbank') return { flaeche: true, cls: 1 };
  if (t.landuse === 'forest' || t.natural === 'wood') return { flaeche: true, cls: 2 };
  if (GRUEN_LANDUSE.has(t.landuse) || GRUEN_LEISURE.has(t.leisure)) return { flaeche: true, cls: 3 };
  if (t.landuse === 'residential') return { flaeche: true, cls: 4 };
  if (t.waterway === 'river' || t.waterway === 'canal') return { flaeche: false, cls: 5 };
  if (t.waterway === 'stream') return { flaeche: false, cls: 6 };
  if (t.railway === 'rail') return { flaeche: false, cls: 7 };
  // Autobahnen, Schnellstraßen (trunk) und Kraftfahrstraßen (motorroad=yes) gehören zur Klasse 8
  if (['motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(t.highway) || t.motorroad === 'yes') return { flaeche: false, cls: 8 };
  return null;
}

/** Douglas-Peucker; Abstand in Grad, Längen mit cos(Breite) gestaucht. Ergebnis: Maske der behaltenen Punkte */
function vereinfache(a, o, eps) {
  const n = a.length;
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const c = Math.cos(51.3 * Math.PI / 180);
  const stapel = [[0, n - 1]];
  while (stapel.length) {
    const [s, e] = stapel.pop();
    const x1 = o[s] * c; const y1 = a[s]; const x2 = o[e] * c; const y2 = a[e];
    const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy);
    let max = 0; let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const x = o[i] * c; const y = a[i];
      const d = len === 0 ? Math.hypot(x - x1, y - y1) : Math.abs(dy * (x - x1) - dx * (y - y1)) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (idx >= 0 && max > eps) { keep[idx] = 1; stapel.push([s, idx], [idx, e]); }
  }
  return keep;
}

const pts = [];
const off = [0];
const meta = [];
const bbox = [];

/** Ein Merkmal in die Karte aufnehmen: a = Breiten, o = Längen (Grad) */
function aufnehmen(a0, o0, k) {
  if (a0.length < (k.flaeche ? 3 : 2)) return;
  const a = a0.slice(); const o = o0.slice();
  if (k.flaeche && a.length > 3 && a[0] === a[a.length - 1] && o[0] === o[o.length - 1]) { a.pop(); o.pop(); }
  let minA = Infinity; let maxA = -Infinity; let minO = Infinity; let maxO = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < minA) minA = a[i]; if (a[i] > maxA) maxA = a[i];
    if (o[i] < minO) minO = o[i]; if (o[i] > maxO) maxO = o[i];
  }
  // Sehr kleine Flächen (unter etwa 20 m) sieht man ohnehin nicht
  if (Math.max(maxA - minA, maxO - minO) < (k.flaeche ? 0.0002 : 0.0001)) return;
  const keep = vereinfache(a, o, 0.00004);
  let anz = 0;
  for (let i = 0; i < a.length; i++) if (keep[i]) { pts.push(Math.round(a[i] * 1e6), Math.round(o[i] * 1e6)); anz++; }
  off.push(off[off.length - 1] + anz);
  meta.push((k.flaeche ? 0 : 1) | (k.cls << 1));
  bbox.push(minA, minO, maxA, maxO);
}

/** Knotenketten (Wege, als Knoten-IDs) zu geschlossenen Ringen zusammensetzen; offene Reste werden verworfen */
function ringe(wege) {
  const offen = wege.map(w => w.slice()).filter(w => w.length > 1);
  const ergebnis = [];
  while (offen.length) {
    let ring = offen.pop();
    let weiter = true;
    while (weiter && ring[0] !== ring[ring.length - 1]) {
      weiter = false;
      for (let i = 0; i < offen.length; i++) {
        const w = offen[i];
        const ende = ring[ring.length - 1];
        if (w[0] === ende) ring = ring.concat(w.slice(1));
        else if (w[w.length - 1] === ende) ring = ring.concat(w.slice(0, -1).reverse());
        else if (w[w.length - 1] === ring[0]) ring = w.concat(ring.slice(1));
        else if (w[0] === ring[0]) ring = w.slice().reverse().concat(ring.slice(1));
        else continue;
        offen.splice(i, 1);
        weiter = true;
        break;
      }
    }
    if (ring.length > 3 && ring[0] === ring[ring.length - 1]) ergebnis.push(ring);
  }
  return ergebnis;
}

// Schritt 1: Relationen finden. Gespeichert werden nur Mehrfachflächen und Flüsse; die Wege ihrer Mitglieder werden gemerkt.
const relationen = [];
const benoetigteWege = new Set();
leseDatei(pbfDatei, {
  schluessel: SCHLUESSEL,
  relationen: (id, tags, mitglieder) => {
    if (tags.type !== 'multipolygon' && tags.type !== 'waterway') return;
    const k = klassifiziere(tags);
    if (!k) return;
    const wegIds = mitglieder
      .filter(m => m.typ === 1 && (tags.type === 'waterway' || m.rolle === 'outer' || m.rolle === ''))
      .map(m => m.id);
    if (!wegIds.length) return;
    relationen.push({ id, k, wegIds });
    for (const w of wegIds) benoetigteWege.add(w);
  }
});
log(`Relationen: ${relationen.length}, benötigte Wege: ${benoetigteWege.size}`);

// Schritt 2: Knoten und Wege lesen; die Knotenketten der benötigten Wege werden gemerkt
const wegRefs = new Map();
leseDatei(pbfDatei, {
  schluessel: SCHLUESSEL,
  knoten: (ids, la, lo, n) => knotenDazu(ids, la, lo, n),
  wege: (id, tags, refs, n) => {
    if (benoetigteWege.has(id)) wegRefs.set(id, Float64Array.from(refs.subarray(0, n)));
    const k = klassifiziere(tags);
    if (!k || n < 2) return;
    const geschlossen = refs[0] === refs[n - 1];
    if (k.flaeche && (!geschlossen || n < 4)) return;
    const a = []; const o = [];
    for (let i = 0; i < n; i++) {
      const idx = suche(refs[i]);
      if (idx >= 0) { a.push(kLat[idx] / 1e7); o.push(kLon[idx] / 1e7); }
    }
    aufnehmen(a, o, k);
  }
});
log(`Knoten: ${nK}, gemerkte Wege: ${wegRefs.size}`);

// Schritt 3: Relationen zusammensetzen: Mehrfachflächen aus geschlossenen Ringen, Flüsse als Linien
let relFlaechen = 0; let relLinien = 0;
for (const r of relationen) {
  const ketten = r.wegIds.map(id => wegRefs.get(id)).filter(Boolean)
    .map(refs => Array.from(refs).filter(nd => suche(nd) >= 0));
  if (r.k.flaeche) {
    for (const ring of ringe(ketten)) {
      const idx = ring.map(nd => suche(nd));
      aufnehmen(idx.map(i => kLat[i] / 1e7), idx.map(i => kLon[i] / 1e7), r.k);
      relFlaechen++;
    }
  } else {
    for (const kette of ketten) {
      if (kette.length < 2) continue;
      const idx = kette.map(nd => suche(nd));
      aufnehmen(idx.map(i => kLat[i] / 1e7), idx.map(i => kLon[i] / 1e7), r.k);
      relLinien++;
    }
  }
}
log(`Aus Relationen: Flächen ${relFlaechen}, Linien ${relLinien}`);

log(`Merkmale: ${meta.length}, Punkte: ${pts.length / 2}`);

const P = Int32Array.from(pts);
const O = Uint32Array.from(off);
const M = Uint8Array.from(meta);
const B = Float32Array.from(bbox);
writeFileSync(join(ausgabe, 'pts.i32'), Buffer.from(P.buffer, P.byteOffset, P.byteLength));
writeFileSync(join(ausgabe, 'off.u32'), Buffer.from(O.buffer, O.byteOffset, O.byteLength));
writeFileSync(join(ausgabe, 'meta.u8'), Buffer.from(M.buffer, M.byteOffset, M.byteLength));
writeFileSync(join(ausgabe, 'bbox.f32'), Buffer.from(B.buffer, B.byteOffset, B.byteLength));
const flaechen = meta.filter((m) => (m & 1) === 0).length;
writeFileSync(join(ausgabe, 'info.json'), JSON.stringify({
  erzeugt: new Date().toISOString(), quelle: pbfDatei, merkmale: meta.length, flaechen, linien: meta.length - flaechen,
  punkte: P.length / 2, bytes: P.byteLength + O.byteLength + M.byteLength + B.byteLength
}, null, 2));
log('Fertig.');
