// Sperrgebiete für die Reichweiten-Karte: große Flächen ohne Fahrwege für die Allgemeinheit (Tagebaue, Flughäfen).
// Die Umrisse kommen aus OSM-Multipolygonen (äußerer Ring) und geschlossenen Wegen mit gleichem Tag.
//
// Aufruf:  node tools/routing/gebiete.js <osm.pbf> <Ausgabedatei sperr.json>
//
// Löcher in den Flächen werden nicht berücksichtigt (die ganze Fläche gilt als gesperrt).

import { writeFileSync } from 'fs';
import { leseDatei } from './pbf.js';

const [, , pbfDatei, ausgabe] = process.argv;
if (!pbfDatei || !ausgabe) {
  console.error('Aufruf: node tools/routing/gebiete.js <osm.pbf> <Ausgabedatei sperr.json>');
  process.exit(1);
}

const art = (tags) => (tags.landuse === 'quarry' ? 'Tagebau' : tags.aeroway === 'aerodrome' ? 'Flughafen' : null);
const SCHLUESSEL = new Set(['type', 'landuse', 'aeroway', 'name']);

// 1. Relationen: Multipolygone mit Tagebau oder Flughafen
const relationen = [];
leseDatei(pbfDatei, {
  schluessel: SCHLUESSEL,
  relationen: (id, tags, mitglieder) => {
    if (tags.type === 'multipolygon' && art(tags)) relationen.push({ id, tags, mitglieder });
  },
});
const wegIds = new Set();
for (const r of relationen) for (const m of r.mitglieder) if (m.typ === 1) wegIds.add(m.id); // alle Mitgliedswege, für die Hülle auch die übrigen
console.log(`Relationen: ${relationen.length}, äußere Wege: ${wegIds.size}`);

// 2. Wege: Mitglieder und geschlossene Flächenwege (landuse=quarry, aeroway=aerodrome) mit Knoten-IDs
const wege = new Map();
leseDatei(pbfDatei, {
  schluessel: SCHLUESSEL,
  wege: (id, tags, refs, n) => {
    if (!wegIds.has(id) && !(art(tags) && refs[0] === refs[n - 1] && n > 3)) return;
    wege.set(id, { tags, refs: Array.from(refs.subarray(0, n)) });
  },
});
const knotenIds = new Set();
for (const w of wege.values()) for (const k of w.refs) knotenIds.add(k);
console.log(`Wege gespeichert: ${wege.size}, Knoten nötig: ${knotenIds.size}`);

// 3. Koordinaten der nötigen Knoten
const koord = new Map();
leseDatei(pbfDatei, {
  knoten: (ids, lat, lon, n) => {
    for (let i = 0; i < n; i++) if (knotenIds.has(ids[i])) koord.set(ids[i], [lat[i], lon[i]]);
  },
});

/** Verkettet Wegstücke zu geschlossenen Ringen (Knotenfolge) */
function ringe(stuecke) {
  const frei = stuecke.map((s) => s.slice());
  const out = [];
  while (frei.length) {
    let ring = frei.pop();
    let geaendert = true;
    while (geaendert && ring[0] !== ring[ring.length - 1]) {
      geaendert = false;
      for (let i = 0; i < frei.length; i++) {
        const s = frei[i];
        const ende = ring[ring.length - 1];
        if (s[0] === ende) { ring = ring.concat(s.slice(1)); }
        else if (s[s.length - 1] === ende) { ring = ring.concat(s.slice(0, -1).reverse()); }
        else continue;
        frei.splice(i, 1);
        geaendert = true;
        break;
      }
    }
    if (ring[0] === ring[ring.length - 1] && ring.length > 3) out.push(ring);
  }
  return out;
}

/** Konvexe Hülle (Kette von Punkten [lat, lon]) */
function huelle(punkte) {
  const p = punkte.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const kreuz = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const unten = []; const oben = [];
  for (const q of p) { while (unten.length >= 2 && kreuz(unten[unten.length - 2], unten[unten.length - 1], q) <= 0) unten.pop(); unten.push(q); }
  for (const q of p.slice().reverse()) { while (oben.length >= 2 && kreuz(oben[oben.length - 2], oben[oben.length - 1], q) <= 0) oben.pop(); oben.push(q); }
  const h = unten.slice(0, -1).concat(oben.slice(0, -1));
  return h.concat([h[0]]);
}
const k2 = (la, lo) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5];

const gebiete = [];
for (const r of relationen) {
  const stuecke = r.mitglieder
    .filter((m) => m.typ === 1 && (m.rolle === 'outer' || m.rolle === '') && wege.has(m.id))
    .map((m) => wege.get(m.id).refs);
  let rs = ringe(stuecke);
  if (!rs.length && stuecke.length) {
    // Die Wegstücke schließen sich nicht (z. B. Lücken im Extrakt): grob die Hülle aller äußeren Knoten nehmen
    const alle = r.mitglieder.filter((m) => m.typ === 1 && wege.has(m.id)).flatMap((m) => wege.get(m.id).refs).map((k) => koord.get(k)).filter(Boolean);
    if (alle.length > 3) { rs = [huelle(alle).map(([la, lo]) => k2(la, lo))]; console.log('Hülle statt Ring:', r.tags.name ?? art(r.tags)); }
  }
  for (const ring of rs) {
    const punkte = (ring.map ? ring.map((k) => (Array.isArray(k) ? k : koord.get(k))) : ring).filter(Boolean).map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
    if (punkte.length > 3) gebiete.push({ art: art(r.tags), name: r.tags.name ?? '', ring: punkte });
  }
}
// Geschlossene Flächenwege ohne Relation
for (const [, w] of wege) {
  const a = art(w.tags);
  if (!a) continue;
  const punkte = w.refs.map((k) => koord.get(k)).filter(Boolean).map(([la, lo]) => [Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5]);
  if (punkte.length > 3) gebiete.push({ art: a, name: w.tags.name ?? '', ring: punkte });
}

writeFileSync(ausgabe, JSON.stringify({ erzeugt: new Date().toISOString(), gebiete }));
console.log(`Gebiete: ${gebiete.length}`, gebiete.filter((g) => /Hambach|Inden|Garzweiler|Köln\/Bonn/i.test(g.name)).map((g) => `${g.name} (${g.ring.length})`).join(', '));
