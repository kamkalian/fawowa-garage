// Grundkarte aus dem Netzordner (Unterordner karte/, erzeugt von tools/routing/karte-bauen.js): Flächen (Wasser, Wald, Grün,
// Wohngebiete) und Linien (Flüsse, Bäche, Bahn). Die Abfrage prüft jedes Merkmal gegen die Kachel; bei 500 000 Merkmalen ist das schnell genug.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export class KarteBasis {
  /** Lädt die Grundkarte aus dem Netzordner oder liefert null, wenn es keine gibt */
  static laden(netzOrdner) {
    const dir = join(netzOrdner, 'karte');
    if (!existsSync(join(dir, 'info.json'))) return null;
    return new KarteBasis(dir);
  }

  constructor(dir) {
    const lade = (name) => {
      const b = readFileSync(join(dir, name));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    };
    this.pts = new Int32Array(lade('pts.i32'));   // Breite, Länge je Punkt (1e-6 Grad)
    this.off = new Uint32Array(lade('off.u32'));  // Punktnummer des Anfangs je Merkmal, letzter Eintrag = Ende
    this.meta = new Uint8Array(lade('meta.u8'));  // bit 0: 1 = Linie, 0 = Fläche; bits 1..3: Klasse
    this.bbox = new Float32Array(lade('bbox.f32')); // je Merkmal: minLat, minLon, maxLat, maxLon
    this.n = this.meta.length;
  }

  /** Nummern der Merkmale, die eine Kachel berühren und im Zoom z groß genug sind, um sichtbar zu sein */
  fuerKachel(z, minLat, minLon, maxLat, maxLon) {
    const kleinst = 3 * 360 / (256 * 2 ** z);
    const b = this.bbox;
    const ergebnis = [];
    for (let i = 0; i < this.n; i++) {
      const k = i * 4;
      if (b[k + 2] < minLat || b[k] > maxLat || b[k + 3] < minLon || b[k + 1] > maxLon) continue;
      if (Math.max(b[k + 2] - b[k], b[k + 3] - b[k + 1]) < kleinst) continue;
      ergebnis.push(i);
    }
    return ergebnis;
  }
}
