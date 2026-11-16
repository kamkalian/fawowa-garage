// Kartendaten für die selbst gezeichnete Karte. Ein Kachelbild (Little-Endian) besteht aus drei Listen: Flächen (Grundkarte),
// Linien (Flüsse, Bäche, Bahn) und Wege (Straßen, Radwege, Pfade). Jede Liste beginnt mit u32 Anzahl; jeder Eintrag: u8 Klasse,
// u16 Punktzahl, dann die Punkte als i32 Breite und i32 Länge (Grad × 1e6).
import { KarteBasis } from './karte-basis.js';

export const ZOOM_MIN = 8;
export const ZOOM_MAX = 15;

const HAUPT = 1 << 5;
const STRASSE = 1 << 2;
const RADWEG = 1 << 3;
const WEG = 1 << 4;

/** Wegart für die Darstellung: 1 Hauptstraße, 2 Nebenstraße, 3 Radweg, 4 Wirtschaftsweg und Pfad */
export function darstellungsart(flags) {
  if (flags & STRASSE) return (flags & HAUPT) ? 1 : 2;
  if (flags & RADWEG) return 3;
  return 4;
}

/** Ausschnitt einer Kachel in Grad */
export function kachelGrenzen(z, x, y) {
  const n = 2 ** z;
  const lon = (xx) => xx / n * 360 - 180;
  const lat = (yy) => Math.atan(Math.sinh(Math.PI * (1 - 2 * yy / n))) * 180 / Math.PI;
  return { minLon: lon(x), maxLon: lon(x + 1), maxLat: lat(y), minLat: lat(y + 1) };
}

/** Welche Wege bei welchem Zoom gezeichnet werden (art: siehe darstellungsart, laenge in Metern) */
function zeigen(z, art, laenge) {
  if (z <= 8) return art === 1 && laenge >= 1500;
  if (z === 9) return art === 1 && laenge >= 600;
  if (z === 10) return art === 1 && laenge >= 200;
  if (z === 11) return art === 1;
  if (z === 12) return art <= 2;
  if (z === 13) return art <= 3;
  return true;
}

/** Listen aus Einträgen { cls, pts (Int32, Breite und Länge in 1e-6 Grad) } binär kodieren */
function kodiere(listen) {
  let size = 0;
  for (const l of listen) {
    size += 4;
    for (const e of l) size += 3 + e.pts.length * 4;
  }
  const buf = new ArrayBuffer(size);
  const dv = new DataView(buf);
  let p = 0;
  for (const l of listen) {
    dv.setUint32(p, l.length, true);
    p += 4;
    for (const e of l) {
      dv.setUint8(p, e.cls);
      dv.setUint16(p + 1, e.pts.length / 2, true);
      p += 3;
      for (let k = 0; k < e.pts.length; k++) { dv.setInt32(p, e.pts[k], true); p += 4; }
    }
  }
  return buf;
}

/**
 * Punkte entfernen, die weniger als eps (in 1e-6 Grad) vom vorherigen entfernt liegen; Anfang und Ende bleiben.
 * So hat ein Polygon bei kleinem Zoom wenige Ecken, und die Zeichnung im Browser bleibt schnell.
 */
function reduziere(pts, eps) {
  const n = pts.length / 2;
  if (n <= 2) return pts;
  const out = [pts[0], pts[1]];
  let la = pts[0]; let lo = pts[1];
  for (let i = 1; i < n - 1; i++) {
    const a = pts[2 * i]; const o = pts[2 * i + 1];
    if (Math.abs(a - la) >= eps || Math.abs(o - lo) >= eps) { out.push(a, o); la = a; lo = o; }
  }
  out.push(pts[2 * (n - 1)], pts[2 * (n - 1) + 1]);
  return Int32Array.from(out);
}

/**
 * Kachel z/x/y als Binärdaten: Grundkarte (basis, optional) und Wege aus dem Wegenetz.
 * Bei kleinem Zoom werden die Wege auf Anfang und Ende vereinfacht.
 */
export function kachelKarte(netz, basis, z, x, y) {
  const g = kachelGrenzen(z, x, y);
  const rl = (g.maxLat - g.minLat) / 20;
  const ro = (g.maxLon - g.minLon) / 20;
  const flaechen = [];
  const linien = [];
  if (basis) {
    const eps = 0.5 * 360 / (256 * 2 ** z) * 1e6; // eine halbe Bildschirmpixel
    for (const i of basis.fuerKachel(z, g.minLat - rl, g.minLon - ro, g.maxLat + rl, g.maxLon + ro)) {
      const meta = basis.meta[i];
      const pts = reduziere(basis.pts.subarray(2 * basis.off[i], 2 * basis.off[i + 1]), eps);
      const flaeche = (meta & 1) === 0;
      if (flaeche && pts.length < 6) continue; // Flächen brauchen mindestens drei Ecken
      (flaeche ? flaechen : linien).push({ cls: meta >> 1, pts });
    }
  }
  const wege = [];
  const einfach = z <= 11;
  const kanten = netz.kantenImRechteck(g.minLat - rl, g.minLon - ro, g.maxLat + rl, g.maxLon + ro,
    (e) => zeigen(z, darstellungsart(netz.kFlags[e]), z <= 10 ? netz.kantenLaenge(e) : 0));
  for (const e of kanten) {
    let p = netz.kantenLinie(e);
    if (einfach) p = [p[0], p[p.length - 1]];
    const pts = new Int32Array(p.length * 2);
    p.forEach(([la, lo], k) => { pts[2 * k] = Math.round(la * 1e6); pts[2 * k + 1] = Math.round(lo * 1e6); });
    wege.push({ cls: darstellungsart(netz.kFlags[e]), pts });
  }
  return kodiere([flaechen, linien, wege]);
}

export { KarteBasis };
