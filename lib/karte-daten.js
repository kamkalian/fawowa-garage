// Daten für die selbst gezeichnete Karte: Wegelinien je Kartenkachel (Binärformat) aus dem Wegenetz.
// Kachelschema wie bei OpenStreetMap (z/x/y, Web-Mercator). Je kleiner der Zoom, desto weniger Wege (nur Hauptstraßen).

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

/**
 * Wegelinien einer Kachel als ArrayBuffer: Anzahl (u32), dann je Weg: Art (u8), Punktzahl (u8), Punkte als Breite und Länge (i32, Grad × 1e6).
 * Bei kleinem Zoom werden die Wege auf Anfangs- und Endpunkt vereinfacht.
 */
export function kachelLinien(netz, z, x, y) {
  const g = kachelGrenzen(z, x, y);
  // Rand von einem Zwanzigstel, damit Linien über die Kachelgrenze hinweg ohne Lücke zeichnen
  const rl = (g.maxLat - g.minLat) / 20;
  const ro = (g.maxLon - g.minLon) / 20;
  const kanten = netz.kantenImRechteck(g.minLat - rl, g.minLon - ro, g.maxLat + rl, g.maxLon + ro, (e) => zeigen(z, darstellungsart(netz.kFlags[e]), z <= 10 ? netz.kantenLaenge(e) : 0));
  const einfach = z <= 11;
  const linien = kanten.map((e) => {
    const punkte = netz.kantenLinie(e);
    return { art: darstellungsart(netz.kFlags[e]), punkte: einfach ? [punkte[0], punkte[punkte.length - 1]] : punkte };
  });
  let bytes = 4;
  for (const l of linien) bytes += 2 + l.punkte.length * 8;
  const buf = new ArrayBuffer(bytes);
  const dv = new DataView(buf);
  dv.setUint32(0, linien.length, true);
  let p = 4;
  for (const l of linien) {
    dv.setUint8(p++, l.art);
    dv.setUint8(p++, Math.min(255, l.punkte.length));
    for (const [la, lo] of l.punkte.slice(0, 255)) { dv.setInt32(p, Math.round(la * 1e6), true); dv.setInt32(p + 4, Math.round(lo * 1e6), true); p += 8; }
  }
  return buf.slice(0, p);
}
