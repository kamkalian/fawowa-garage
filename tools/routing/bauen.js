// Baut aus einer OSM-PBF-Datei und SRTM-Höhenkacheln das Wegenetz für die Reichweitensuche und schreibt es als Binärdateien.
//
// Aufruf:  node tools/routing/bauen.js <osm.pbf> <hgt-Ordner> <Ausgabeordner>
//
// Das Netz besteht nur aus Kreuzungen und Wegenden (Knoten); die Wege dazwischen sind Kanten. Jede Kante trägt Teilstücke („Legs“, höchstens
// etwa 120 m lang) mit Länge, Steigung und Richtung, weil sich der Energieverbrauch daraus berechnet. Die Höhen kommen aus SRTM, werden entlang
// des Wegs geglättet (Rauschen des Modells), und Brücken und Tunnel werden zwischen ihren Enden geradlinig interpoliert.
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { leseDatei } from './pbf.js';
import { SCHLUESSEL, bewerteWeg } from './tags.js';
import { Hoehen } from './hoehen.js';

const [, , pbfDatei, hgtOrdner, ausgabe] = process.argv;
if (!pbfDatei || !hgtOrdner || !ausgabe) {
  console.error('Aufruf: node tools/routing/bauen.js <osm.pbf> <hgt-Ordner> <Ausgabeordner>');
  process.exit(1);
}
mkdirSync(ausgabe, { recursive: true });

const LEG_MAX_M = 120;        // Teilstücke werden nach dieser Länge abgeschlossen
const GLAETTUNG_M = 400;      // Breite des gleitenden Mittels für die Höhen (SRTM-Fehler sind über Dutzende Meter korreliert)
const GRADIENT_MAX = 0.4;
const zeit0 = Date.now();
const sek = () => ((Date.now() - zeit0) / 1000).toFixed(0).padStart(4) + ' s';
const mb = () => (process.memoryUsage().rss / 1048576).toFixed(0) + ' MB';
const log = (...a) => console.log(sek(), `[${mb()}]`, ...a);

/** Wachsendes Array fester Art */
class Liste {
  constructor(Art, start = 1 << 20) { this.Art = Art; this.a = new Art(start); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const neu = new this.Art(this.a.length * 2); neu.set(this.a); this.a = neu; }
    this.a[this.n++] = v;
  }
  fertig() { return this.a.subarray(0, this.n); }
}

// ---------- 1. Knoten und Wege einlesen ----------
let knotenIds = new Float64Array(1 << 26);
let knotenLat = new Int32Array(1 << 26);
let knotenLon = new Int32Array(1 << 26);
let nKnoten = 0;
let wegeBegonnen = false;

const wegStart = new Liste(Uint32Array, 1 << 22);    // Beginn der Knotenliste je Weg
const wegKnoten = new Liste(Int32Array, 1 << 24);    // Knotennummern (Index in die Knoten-Arrays)
const wegArt = new Liste(Uint8Array, 1 << 22);       // klasse (Bits 0-2) | fahrt<<3 | bruecke<<5 | haupt<<6 | sidepath<<7
const wegBelag = new Liste(Uint8Array, 1 << 22);
const zaehler = { wegeGesamt: 0, wegeBrauchbar: 0, knotenRefsFehlend: 0 };

function sucheKnoten(id) {
  let lo = 0;
  let hi = nKnoten - 1;
  while (lo <= hi) {
    const mitte = (lo + hi) >>> 1;
    const w = knotenIds[mitte];
    if (w < id) lo = mitte + 1; else if (w > id) hi = mitte - 1; else return mitte;
  }
  return -1;
}

log('Lese', pbfDatei);
let letzteId = 0;
// Orte für die Beschriftung der Karte und die Suche nach dem Startpunkt
const ORTS_ARTEN = new Set(['city', 'town', 'village', 'suburb']);
// Knoten mit Halt-Regel (OSM highway=*): Bits 1 Ampel, 2 Haltestelle, 4 Vorfahrt achten, 8 Überweg
const HALT_ARTEN = { traffic_signals: 1, stop: 2, give_way: 4, crossing: 8 };
const haltOsm = new Map(); // OSM-Knoten-ID -> Bits
const orte = [];

leseDatei(pbfDatei, {
  knotenSchluessel: new Set(['place', 'name', 'highway']),
  knotenTags: (id, lat, lon, tags) => {
    if (tags.name && ORTS_ARTEN.has(tags.place)) orte.push([tags.name, tags.place, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
    const art = HALT_ARTEN[tags.highway];
    if (art) haltOsm.set(id, art);
  },
  knoten: (ids, lat, lon, n) => {
    if (wegeBegonnen) throw new Error('Knoten nach den Wegen: die Datei ist nicht nach Typ sortiert');
    if (nKnoten + n > knotenIds.length) {
      const neu = knotenIds.length * 2;
      const i2 = new Float64Array(neu); i2.set(knotenIds); knotenIds = i2;
      const a2 = new Int32Array(neu); a2.set(knotenLat); knotenLat = a2;
      const o2 = new Int32Array(neu); o2.set(knotenLon); knotenLon = o2;
    }
    for (let i = 0; i < n; i++) {
      if (ids[i] <= letzteId) throw new Error('Knoten sind nicht nach ID sortiert');
      letzteId = ids[i];
      knotenIds[nKnoten] = ids[i];
      knotenLat[nKnoten] = Math.round(lat[i] * 1e7);
      knotenLon[nKnoten] = Math.round(lon[i] * 1e7);
      nKnoten++;
    }
  },
  wege: (id, tags, refs, n) => {
    wegeBegonnen = true;
    zaehler.wegeGesamt++;
    if (!tags.highway) return;
    const b = bewerteWeg(tags);
    if (!b) return;
    wegStart.push(wegKnoten.n);
    let dazu = 0;
    for (let i = 0; i < n; i++) {
      const idx = sucheKnoten(refs[i]);
      if (idx < 0) { zaehler.knotenRefsFehlend++; continue; }
      wegKnoten.push(idx);
      dazu++;
    }
    if (dazu < 2) { wegKnoten.n -= dazu; wegStart.n--; return; }
    wegArt.push(b.klasse | (b.fahrt << 3) | ((b.bruecke ? 1 : 0) << 5) | ((b.haupt ? 1 : 0) << 6) | ((b.sidepath ? 1 : 0) << 7));
    wegBelag.push(b.belag);
    zaehler.wegeBrauchbar++;
  },
  schluessel: SCHLUESSEL,
  fortschritt: (p) => { if (Math.random() < 0.05) log(`Einlesen ${(p * 100).toFixed(0)} %`); }
});
wegStart.push(wegKnoten.n); // Ende des letzten Wegs
const nWege = zaehler.wegeBrauchbar;
const WS = wegStart.fertig();
const WK = wegKnoten.fertig();
const WA = wegArt.fertig();
const WB = wegBelag.fertig();
log(`Knoten ${nKnoten}, Wege gesamt ${zaehler.wegeGesamt}, befahrbar ${nWege}, Knotenverweise ${WK.length}, fehlend ${zaehler.knotenRefsFehlend}`);

// ---------- 2. Kreuzungen finden ----------
const nutzung = new Uint8Array(nKnoten);
for (let w = 0; w < nWege; w++) {
  for (let i = WS[w]; i < WS[w + 1]; i++) { const k = WK[i]; if (nutzung[k] < 255) nutzung[k]++; }
  const a = WK[WS[w]];
  const e = WK[WS[w + 1] - 1];
  nutzung[a] = Math.min(255, nutzung[a] + 2);
  nutzung[e] = Math.min(255, nutzung[e] + 2);
}
log('Kreuzungen gezählt');

// ---------- 3. Höhen, Kanten und Teilstücke ----------
const hoehen = new Hoehen(hgtOrdner);
const neuNr = new Int32Array(nKnoten).fill(-1);
const nLat = new Liste(Int32Array, 1 << 22);
const nLon = new Liste(Int32Array, 1 << 22);
const eA = new Liste(Uint32Array, 1 << 22);
const eB = new Liste(Uint32Array, 1 << 22);
const eFlags = new Liste(Uint8Array, 1 << 22);
const eBelag = new Liste(Uint8Array, 1 << 22);
const eLegStart = new Liste(Uint32Array, 1 << 22);
const eLegN = new Liste(Uint8Array, 1 << 22);
const legLen = new Liste(Uint16Array, 1 << 23);   // Dezimeter
const legGrad = new Liste(Int8Array, 1 << 23);    // halbe Prozent
const legKurs = new Liste(Uint8Array, 1 << 23);   // 360° / 256
const stat = { kmKlasse: { 1: 0, 2: 0, 4: 0 }, kantenLang: 0, schleifen: 0, ohneHoehe: 0, legsGekappt: 0, gradKlemmung: 0, wegeMitSprung: 0 };

const knotenNr = (idx) => {
  let n = neuNr[idx];
  if (n < 0) { n = nLat.n; neuNr[idx] = n; nLat.push(knotenLat[idx]); nLon.push(knotenLon[idx]); }
  return n;
};

const grad2rad = Math.PI / 180;
function kurs(lat1, lon1, lat2, lon2) {
  const dy = lat2 - lat1;
  const dx = (lon2 - lon1) * Math.cos((lat1 + lat2) / 2 * grad2rad);
  let b = Math.atan2(dx, dy) / grad2rad;
  if (b < 0) b += 360;
  return b;
}

let verarbeitet = 0;
for (let w = 0; w < nWege; w++) {
  const s = WS[w];
  const n = WS[w + 1] - s;
  const art = WA[w];
  const klasseBits = art & 7;
  const fahrt = (art >> 3) & 3;
  const istBruecke = ((art >> 5) & 1) === 1;
  const haupt = (art >> 6) & 1;
  const sidepath = (art >> 7) & 1;

  // Lage, Weglänge und Höhe der Punkte
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const d = new Float64Array(n);
  let hoehe = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = WK[s + i];
    lat[i] = knotenLat[k] / 1e7;
    lon[i] = knotenLon[k] / 1e7;
    if (i > 0) {
      const dy = (lat[i] - lat[i - 1]) * 110574;
      const dx = (lon[i] - lon[i - 1]) * 111320 * Math.cos((lat[i] + lat[i - 1]) / 2 * grad2rad);
      d[i] = d[i - 1] + Math.hypot(dx, dy);
    }
    hoehe[i] = hoehen.hoehe(lat[i], lon[i]);
  }
  // Lücken im Höhenmodell auffüllen (letzter gültiger Wert); ganz ohne Daten: Weg bleibt eben
  let gueltig = NaN;
  for (let i = 0; i < n; i++) { if (Number.isNaN(hoehe[i])) hoehe[i] = gueltig; else gueltig = hoehe[i]; }
  gueltig = NaN;
  for (let i = n - 1; i >= 0; i--) { if (Number.isNaN(hoehe[i])) hoehe[i] = gueltig; else gueltig = hoehe[i]; }
  if (Number.isNaN(hoehe[0])) { stat.ohneHoehe++; hoehe.fill(0); }
  // Brücken und Tunnel: zwischen den Enden geradlinig
  if (istBruecke && d[n - 1] > 0) {
    const h0 = hoehe[0];
    const h1 = hoehe[n - 1];
    for (let i = 1; i < n - 1; i++) hoehe[i] = h0 + (h1 - h0) * d[i] / d[n - 1];
  }
  // Gleitendes Mittel entlang des Wegs (dreieckige Gewichte)
  if (n > 2 && GLAETTUNG_M > 0) {
    const glatt = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let summe = 0;
      let gew = 0;
      for (let j = i; j >= 0 && d[i] - d[j] < GLAETTUNG_M; j--) { const g = 1 - (d[i] - d[j]) / GLAETTUNG_M; summe += g * hoehe[j]; gew += g; }
      for (let j = i + 1; j < n && d[j] - d[i] < GLAETTUNG_M; j++) { const g = 1 - (d[j] - d[i]) / GLAETTUNG_M; summe += g * hoehe[j]; gew += g; }
      glatt[i] = summe / gew;
    }
    // Die Enden behalten ihre Höhe, damit zusammenstoßende Wege an Kreuzungen zusammenpassen
    glatt[0] = (glatt[0] + hoehe[0]) / 2;
    glatt[n - 1] = (glatt[n - 1] + hoehe[n - 1]) / 2;
    hoehe = glatt;
  }

  // Kanten zwischen Kreuzungen, Teilstücke je ~120 m
  let kantenStart = 0;
  for (let i = 1; i < n; i++) {
    const knoten = WK[s + i];
    const istKreuzung = nutzung[knoten] >= 2 || i === n - 1 || haltOsm.has(knotenIds[knoten]);
    if (!istKreuzung) continue;

    const a = knotenNr(WK[s + kantenStart]);
    const b = knotenNr(knoten);
    if (a === b) { stat.schleifen++; kantenStart = i; continue; }

    const legsAnfang = legLen.n;
    let legStart = kantenStart;
    let kantenLaenge = 0;
    for (let j = kantenStart + 1; j <= i; j++) {
      const l = d[j] - d[legStart];
      if (l >= LEG_MAX_M || j === i) {
        let laenge = Math.max(0.1, l);
        const steigung = Math.max(-GRADIENT_MAX, Math.min(GRADIENT_MAX, (hoehe[j] - hoehe[legStart]) / laenge));
        if (Math.abs((hoehe[j] - hoehe[legStart]) / laenge) > GRADIENT_MAX) stat.gradKlemmung++;
        const richtung = kurs(lat[legStart], lon[legStart], lat[j], lon[j]);
        // Sehr lange Teilstücke (Länge über 6,5 km) würden nicht in 16 Bit passen: aufteilen
        while (laenge > 6000) {
          legLen.push(60000); legGrad.push(Math.round(steigung * 200)); legKurs.push(Math.round(richtung / 360 * 256) & 255);
          laenge -= 6000; stat.legsGekappt++;
        }
        legLen.push(Math.round(laenge * 10));
        legGrad.push(Math.round(steigung * 200));
        legKurs.push(Math.round(richtung / 360 * 256) & 255);
        kantenLaenge += l;
        legStart = j;
      }
    }
    const nLegs = legLen.n - legsAnfang;
    if (nLegs > 255) { stat.kantenLang++; legLen.n = legsAnfang; legGrad.n = legsAnfang; legKurs.n = legsAnfang; kantenStart = i; continue; }
    eA.push(a); eB.push(b);
    // Bits 0-1 Fahrtrichtung, 2-4 Klasse (Straße, Radweg, Weg), 5 Hauptstraße, 6 Radweg-Pflicht
    eFlags.push(fahrt | (klasseBits << 2) | (haupt << 5) | (sidepath << 6));
    eBelag.push(WB[w]);
    eLegStart.push(legsAnfang);
    eLegN.push(nLegs);
    stat.kmKlasse[klasseBits] += kantenLaenge / 1000;
    kantenStart = i;
  }
  verarbeitet++;
  if (verarbeitet % 400000 === 0) log(`Wege verarbeitet ${verarbeitet} / ${nWege}  Knoten ${nLat.n}  Kanten ${eA.n}`);
}
const N = nLat.n;
const E = eA.n;
log(`Netz: ${N} Knoten, ${E} Kanten, ${legLen.n} Teilstücke`);

// ---------- 4. Nachbarschaftsliste (CSR) ----------
const A = eA.fertig();
const B = eB.fertig();
const grad = new Uint32Array(N + 1);
for (let e = 0; e < E; e++) { grad[A[e] + 1]++; grad[B[e] + 1]++; }
for (let i = 0; i < N; i++) grad[i + 1] += grad[i];
const adj = new Uint32Array(E * 2);
const fuell = grad.slice(0, N);
for (let e = 0; e < E; e++) {
  adj[fuell[A[e]]++] = e * 2;       // verlässt a in Richtung b
  adj[fuell[B[e]]++] = e * 2 + 1;   // verlässt b in Richtung a
}

// Knotenart je Knoten im Netz: 0 keine, 1 Ampel, 2 Haltestelle, 3 Vorfahrt achten, 4 Überweg, 5 Kreuzung ohne Regel
const knotenTyp = new Uint8Array(N);
for (let idx = 0; idx < nKnoten; idx++) {
  const n = neuNr[idx];
  if (n < 0) continue;
  const f = haltOsm.get(knotenIds[idx]) ?? 0;
  const grad3 = grad[n + 1] - grad[n] >= 3;
  knotenTyp[n] = (f & 1) ? 1 : (f & 2) ? 2 : (f & 4) ? 3 : (f & 8) ? 4 : grad3 ? 5 : 0;
}
log(`Knotenarten: Ampel ${knotenTyp.filter((t) => t === 1).length}, Haltestelle ${knotenTyp.filter((t) => t === 2).length}, Vorfahrt ${knotenTyp.filter((t) => t === 3).length}, Überweg ${knotenTyp.filter((t) => t === 4).length}, Kreuzung ${knotenTyp.filter((t) => t === 5).length}`);

// ---------- 5. Schreiben ----------
writeFileSync(join(ausgabe, 'orte.json'), JSON.stringify(orte));
log(`Orte: ${orte.length}`);
const dateien = {
  'knoten_lat.i32': nLat.fertig(), 'knoten_lon.i32': nLon.fertig(), 'adj_start.u32': grad, 'adj.u32': adj,
  'kante_a.u32': A, 'kante_b.u32': B, 'kante_flags.u8': eFlags.fertig(), 'kante_belag.u8': eBelag.fertig(),
  'kante_leg_start.u32': eLegStart.fertig(), 'kante_leg_n.u8': eLegN.fertig(),
  'leg_len.u16': legLen.fertig(), 'leg_grad.i8': legGrad.fertig(), 'leg_kurs.u8': legKurs.fertig(), 'knoten_typ.u8': knotenTyp
};
const groessen = {};
for (const [name, arr] of Object.entries(dateien)) {
  writeFileSync(join(ausgabe, name), Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
  groessen[name] = arr.byteLength;
}
const gesamtBytes = Object.values(groessen).reduce((a, b) => a + b, 0);
// Ausdehnung des Netzes (Grad): der Webdienst prüft damit, ob ein Startpunkt im Gebiet liegt
const bbox = (() => {
  const la = nLat.fertig(); const lo = nLon.fertig();
  let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity;
  for (let i = 0; i < la.length; i++) {
    const a = la[i] / 1e7; const o = lo[i] / 1e7;
    if (a < minLat) minLat = a; if (a > maxLat) maxLat = a;
    if (o < minLon) minLon = o; if (o > maxLon) maxLon = o;
  }
  return { minLat, maxLat, minLon, maxLon };
})();
const info = {
  erzeugt: new Date().toISOString(), quelle: pbfDatei, knoten: N, kanten: E, teilstuecke: legLen.n, bbox,
  kmStrasse: Math.round(stat.kmKlasse[1]), kmRadweg: Math.round(stat.kmKlasse[2]), kmWeg: Math.round(stat.kmKlasse[4]),
  groessenBytes: groessen, gesamtMB: +(gesamtBytes / 1048576).toFixed(1), statistik: stat, osm: { ...zaehler, knoten: nKnoten },
  bauzeitSekunden: +((Date.now() - zeit0) / 1000).toFixed(0), spitzenRamMB: +(process.memoryUsage().rss / 1048576).toFixed(0)
};
writeFileSync(join(ausgabe, 'info.json'), JSON.stringify(info, null, 2));
log('Fertig.', JSON.stringify({ ...info, groessenBytes: undefined }));
