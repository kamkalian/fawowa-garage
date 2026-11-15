// Höhenmodell aus SRTM-Kacheln (*.hgt.gz, 1 Bogensekunde = 3601 × 3601 Werte je Grad-Kachel). Bilineare Abfrage in Metern.
import { readFileSync, existsSync } from 'fs';
import { gunzipSync } from 'zlib';
import { join } from 'path';

const N = 3601;
const LEER = -32768;

export class Hoehen {
  constructor(verzeichnis) {
    this.verzeichnis = verzeichnis;
    this.kacheln = new Map(); // "lat,lon" -> Int16Array | null
  }

  _kachel(lat, lon) {
    const schluessel = `${lat},${lon}`;
    if (this.kacheln.has(schluessel)) return this.kacheln.get(schluessel);
    const name = `${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}`;
    const datei = join(this.verzeichnis, `${name}.hgt.gz`);
    let daten = null;
    if (existsSync(datei)) {
      const roh = gunzipSync(readFileSync(datei));
      if (roh.length !== N * N * 2) throw new Error(`${name}: unerwartete Größe ${roh.length}`);
      roh.swap16(); // die Dateien sind big-endian, dieser Rechner little-endian
      daten = new Int16Array(roh.buffer.slice(roh.byteOffset, roh.byteOffset + roh.length));
    }
    this.kacheln.set(schluessel, daten);
    return daten;
  }

  /** Höhe in Metern an einer Stelle (Grad) oder NaN, wenn es dort keine Daten gibt */
  hoehe(lat, lon) {
    const kl = Math.floor(lat);
    const ko = Math.floor(lon);
    const k = this._kachel(kl, ko);
    if (!k) return NaN;
    const zeile = (kl + 1 - lat) * (N - 1); // Zeile 0 liegt im Norden
    const spalte = (lon - ko) * (N - 1);
    const z0 = Math.min(N - 2, Math.floor(zeile));
    const s0 = Math.min(N - 2, Math.floor(spalte));
    const fz = zeile - z0;
    const fs = spalte - s0;
    const a = k[z0 * N + s0];
    const b = k[z0 * N + s0 + 1];
    const c = k[(z0 + 1) * N + s0];
    const d = k[(z0 + 1) * N + s0 + 1];
    if (a === LEER || b === LEER || c === LEER || d === LEER) {
      // Lücke im Datensatz: Mittel der gültigen Nachbarwerte
      let summe = 0;
      let n = 0;
      for (const w of [a, b, c, d]) if (w !== LEER) { summe += w; n++; }
      return n ? summe / n : NaN;
    }
    return (a * (1 - fs) + b * fs) * (1 - fz) + (c * (1 - fs) + d * fs) * fz;
  }
}
