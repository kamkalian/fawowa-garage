// Minimaler Einleser für OpenStreetMap-PBF-Dateien (ohne Abhängigkeiten): liest Datei-Blöcke nacheinander und zerlegt sie in Knoten und Wege.
// Relationen werden übersprungen. Format: https://wiki.openstreetmap.org/wiki/PBF_Format
import { openSync, readSync, closeSync, fstatSync } from 'fs';
import { inflateSync } from 'zlib';

/** Protobuf-Leser über einem Buffer. Ganzzahlen kommen als Number (bis 2^53 genau, für OSM-IDs ausreichend). */
class Leser {
  constructor(buf, pos = 0, ende = buf.length) { this.b = buf; this.p = pos; this.ende = ende; }
  varint() {
    const b = this.b;
    let r = 0;
    let m = 1;
    let x;
    do { x = b[this.p++]; r += (x & 0x7f) * m; m *= 128; } while (x & 0x80);
    return r;
  }
  zigzag() { const r = this.varint(); return r % 2 === 0 ? r / 2 : -(r + 1) / 2; }
  /** Nächstes Feld: setzt this.feld und this.typ; false am Ende */
  weiter() {
    if (this.p >= this.ende) return false;
    const k = this.varint();
    this.feld = Math.floor(k / 8);
    this.typ = k % 8;
    return true;
  }
  /** Länge eines Feldes mit Länge (Typ 2); Ergebnis: [start, ende] und springt dahinter */
  bereich() {
    const n = this.varint();
    const start = this.p;
    this.p += n;
    return [start, start + n];
  }
  ueberspringen() {
    if (this.typ === 0) this.varint();
    else if (this.typ === 1) this.p += 8;
    else if (this.typ === 2) { const n = this.varint(); this.p += n; } // nicht `this.p += this.varint()`: die linke Seite wird zuerst ausgewertet
    else if (this.typ === 5) this.p += 4;
    else throw new Error(`Unbekannter Feldtyp ${this.typ}`);
  }
}

/** Liest packed Zahlen (varint) in ein Array; zigzag: Vorzeichen-Kodierung */
function packed(buf, start, ende, zigzag, ausgabe) {
  const l = new Leser(buf, start, ende);
  let n = 0;
  while (l.p < ende) ausgabe[n++] = zigzag ? l.zigzag() : l.varint();
  return n;
}

/**
 * Geht die Blöcke einer PBF-Datei durch. Für jeden Datenblock wird `block` aufgerufen: { knoten, wege }-Rückrufe werden
 * über `optionen` gesteuert:
 *   knoten(ids, lat, lon, n)           Dichte Knoten eines Blocks (Arrays der Länge n, lat/lon in Grad); nur, wenn angegeben
 *   knotenTags(id, lat, lon, tags)     Knoten mit Tags aus knotenSchluessel (z. B. Orte); tags als Objekt
 *   knotenSchluessel: Set der Tag-Schlüssel, die für Knoten gelesen werden
 *   wege(id, tags, refs, nRefs)        ein Weg: tags als Objekt nur mit den Schlüsseln aus `schluessel`, refs als Knoten-IDs
 *   relationen(id, tags, mitglieder)   eine Relation; mitglieder: [{ typ: 0|1|2, id, rolle }]
 *   schluessel: Set der Tag-Schlüssel, die für Wege und Relationen gelesen werden
 */
export function leseDatei(pfad, { knoten = null, knotenTags = null, knotenSchluessel = new Set(), wege = null, relationen = null, schluessel = new Set(), fortschritt = null } = {}) {
  const fd = openSync(pfad, 'r');
  const groesse = fstatSync(fd).size;
  let pos = 0;
  let nBloecke = 0;
  const kopf = Buffer.alloc(4);
  let ids = new Float64Array(16384);
  let lat = new Float64Array(16384);
  let lon = new Float64Array(16384);
  let refs = new Float64Array(2048);

  try {
    while (pos < groesse) {
      readSync(fd, kopf, 0, 4, pos);
      const kopfLaenge = kopf.readUInt32BE(0);
      const kopfBuf = Buffer.alloc(kopfLaenge);
      readSync(fd, kopfBuf, 0, kopfLaenge, pos + 4);
      const kl = new Leser(kopfBuf);
      let typ = '';
      let datenLaenge = 0;
      while (kl.weiter()) {
        if (kl.feld === 1 && kl.typ === 2) { const [a, e] = kl.bereich(); typ = kopfBuf.toString('utf8', a, e); }
        else if (kl.feld === 3 && kl.typ === 0) datenLaenge = kl.varint();
        else kl.ueberspringen();
      }
      const blob = Buffer.alloc(datenLaenge);
      readSync(fd, blob, 0, datenLaenge, pos + 4 + kopfLaenge);
      pos += 4 + kopfLaenge + datenLaenge;
      if (typ !== 'OSMData') continue;

      // Blob: roh (1) oder zlib (3)
      const bl = new Leser(blob);
      let daten = null;
      while (bl.weiter()) {
        if (bl.feld === 1 && bl.typ === 2) { const [a, e] = bl.bereich(); daten = blob.subarray(a, e); }
        else if (bl.feld === 3 && bl.typ === 2) { const [a, e] = bl.bereich(); daten = inflateSync(blob.subarray(a, e)); }
        else bl.ueberspringen();
      }
      if (!daten) throw new Error('Block ohne Daten (andere Kompression?)');

      // PrimitiveBlock
      const pl = new Leser(daten);
      let strBereich = null;
      let granularitaet = 100;
      let latOffset = 0;
      let lonOffset = 0;
      const gruppen = [];
      while (pl.weiter()) {
        if (pl.feld === 1 && pl.typ === 2) strBereich = pl.bereich();
        else if (pl.feld === 2 && pl.typ === 2) gruppen.push(pl.bereich());
        else if (pl.feld === 17 && pl.typ === 0) granularitaet = pl.varint();
        else if (pl.feld === 19 && pl.typ === 0) latOffset = pl.zigzag();
        else if (pl.feld === 20 && pl.typ === 0) lonOffset = pl.zigzag();
        else pl.ueberspringen();
      }

      // Stringtabelle nur für Wege decodieren (Knotenblöcke brauchen sie nicht)
      let strings = null;
      const stringsLaden = () => {
        if (strings) return strings;
        strings = [];
        const sl = new Leser(daten, strBereich[0], strBereich[1]);
        while (sl.weiter()) {
          if (sl.feld === 1 && sl.typ === 2) { const [a, e] = sl.bereich(); strings.push(daten.toString('utf8', a, e)); }
          else sl.ueberspringen();
        }
        return strings;
      };

      for (const [gs, ge] of gruppen) {
        const gl = new Leser(daten, gs, ge);
        while (gl.weiter()) {
          if (gl.feld === 2 && gl.typ === 2 && (knoten || knotenTags)) {
            // DenseNodes
            const [ds, de] = gl.bereich();
            const dl = new Leser(daten, ds, de);
            let idB = null; let latB = null; let lonB = null; let kvB = null;
            while (dl.weiter()) {
              if (dl.feld === 1 && dl.typ === 2) idB = dl.bereich();
              else if (dl.feld === 10 && dl.typ === 2) kvB = dl.bereich();
              else if (dl.feld === 8 && dl.typ === 2) latB = dl.bereich();
              else if (dl.feld === 9 && dl.typ === 2) lonB = dl.bereich();
              else dl.ueberspringen();
            }
            if (!idB) continue;
            const maxN = idB[1] - idB[0]; // mehr Knoten als Bytes gibt es nicht
            if (ids.length < maxN) { ids = new Float64Array(maxN); lat = new Float64Array(maxN); lon = new Float64Array(maxN); }
            const n = packed(daten, idB[0], idB[1], true, ids);
            packed(daten, latB[0], latB[1], true, lat);
            packed(daten, lonB[0], lonB[1], true, lon);
            let i0 = 0; let a0 = 0; let o0 = 0;
            for (let i = 0; i < n; i++) {
              i0 += ids[i]; a0 += lat[i]; o0 += lon[i];
              ids[i] = i0;
              lat[i] = 1e-9 * (latOffset + granularitaet * a0);
              lon[i] = 1e-9 * (lonOffset + granularitaet * o0);
            }
            if (knoten) knoten(ids, lat, lon, n);
            if (knotenTags && kvB) {
              // keys_vals: je Knoten Paare (Schlüssel, Wert) als Stringnummern, abgeschlossen mit 0
              const st = stringsLaden();
              const kv = new Leser(daten, kvB[0], kvB[1]);
              for (let i = 0; i < n && kv.p < kvB[1]; i++) {
                let tags = null;
                while (kv.p < kvB[1]) {
                  const k = kv.varint();
                  if (k === 0) break;
                  const v = kv.varint();
                  if (knotenSchluessel.has(st[k])) (tags ??= {})[st[k]] = st[v];
                }
                if (tags) knotenTags(ids[i], lat[i], lon[i], tags);
              }
            }
          } else if (gl.feld === 3 && gl.typ === 2 && wege) {
            // Way
            const [ws, we] = gl.bereich();
            const wl = new Leser(daten, ws, we);
            let id = 0; let keyB = null; let valB = null; let refB = null;
            while (wl.weiter()) {
              if (wl.feld === 1 && wl.typ === 0) id = wl.varint();
              else if (wl.feld === 2 && wl.typ === 2) keyB = wl.bereich();
              else if (wl.feld === 3 && wl.typ === 2) valB = wl.bereich();
              else if (wl.feld === 8 && wl.typ === 2) refB = wl.bereich();
              else wl.ueberspringen();
            }
            if (!keyB || !refB) continue;
            const s = stringsLaden();
            const tags = {};
            const kl2 = new Leser(daten, keyB[0], keyB[1]);
            const vl2 = new Leser(daten, valB[0], valB[1]);
            while (kl2.p < keyB[1]) {
              const k = s[kl2.varint()];
              const v = s[vl2.varint()];
              if (schluessel.has(k)) tags[k] = v;
            }
            const maxR = refB[1] - refB[0];
            if (refs.length < maxR) refs = new Float64Array(maxR);
            const nr = packed(daten, refB[0], refB[1], true, refs);
            let r0 = 0;
            for (let i = 0; i < nr; i++) { r0 += refs[i]; refs[i] = r0; }
            wege(id, tags, refs, nr);
          } else if (gl.feld === 4 && gl.typ === 2 && relationen) {
            // Relation: Tags (nur schluessel) und Mitglieder (Typ 0 Knoten, 1 Weg, 2 Relation) mit Rolle
            const [rs, re] = gl.bereich();
            const rl = new Leser(daten, rs, re);
            let id = 0; let keyB = null; let valB = null; let rollenB = null; let memB = null; let typB = null;
            while (rl.weiter()) {
              if (rl.feld === 1 && rl.typ === 0) id = rl.varint();
              else if (rl.feld === 2 && rl.typ === 2) keyB = rl.bereich();
              else if (rl.feld === 3 && rl.typ === 2) valB = rl.bereich();
              else if (rl.feld === 8 && rl.typ === 2) rollenB = rl.bereich();
              else if (rl.feld === 9 && rl.typ === 2) memB = rl.bereich();
              else if (rl.feld === 10 && rl.typ === 2) typB = rl.bereich();
              else rl.ueberspringen();
            }
            if (!keyB || !valB || !memB || !typB || !rollenB) continue;
            const s = stringsLaden();
            const tags = {};
            const kl2 = new Leser(daten, keyB[0], keyB[1]);
            const vl2 = new Leser(daten, valB[0], valB[1]);
            while (kl2.p < keyB[1]) {
              const k = s[kl2.varint()];
              const v = s[vl2.varint()];
              if (schluessel.has(k)) tags[k] = v;
            }
            const rollen = [];
            const rl2 = new Leser(daten, rollenB[0], rollenB[1]);
            while (rl2.p < rollenB[1]) rollen.push(s[rl2.varint()]);
            const ml = new Leser(daten, memB[0], memB[1]);
            const mids = [];
            let m0 = 0;
            while (ml.p < memB[1]) { m0 += ml.zigzag(); mids.push(m0); }
            const tl = new Leser(daten, typB[0], typB[1]);
            const typen = [];
            while (tl.p < typB[1]) typen.push(tl.varint());
            relationen(id, tags, mids.map((mid, i) => ({ typ: typen[i], id: mid, rolle: rollen[i] })));
          } else {
            gl.ueberspringen();
          }
        }
      }
      nBloecke++;
      if (fortschritt && nBloecke % 50 === 0) fortschritt(pos / groesse, nBloecke);
    }
  } finally {
    closeSync(fd);
  }
  return nBloecke;
}
