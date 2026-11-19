// Lädt das mit tools/routing/bauen.js erzeugte Wegenetz und sucht darin: nächster Knoten, Reichweite nach Energie (Wh), kürzeste Wege nach Länge
// und Kanten für die Kartenanzeige. Läuft auf dem Server (im Hintergrund-Thread, siehe lib/routing-dienst.js) und in den Werkzeugen.
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { berechneSegment, haltKosten } from './rechenmodell.js';

const lies = (ordner, name, Art) => {
  const b = readFileSync(join(ordner, name));
  return new Art(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

// kante_flags: Bits 0-1 Fahrtrichtungen, Bits 2-4 Klasse (Straße, Radweg, Weg), Bit 5 Hauptstraße, Bit 6 Radweg-Pflicht (bicycle=use_sidepath)
const STRASSE = 1 << 2;
const RADWEG = 1 << 3;
const WEG = 1 << 4;
const HAUPT = 1 << 5;

/**
 * Welche Wege ein Modus zulässt, als Tabelle über alle 256 Werte von kante_flags (die Fahrtrichtung wird getrennt geprüft):
 *   alle     alles, was mit dem Rad befahrbar ist
 *   strasse  nur Straßen (keine eigenen Radwege, Wirtschaftswege und Pfade)
 *   radweg   nur eigene Radwege, Wirtschaftswege und Pfade (keine Straßen)
 *   ruhig    Radwege, Wirtschaftswege und Pfade sowie Wohn- und Nebenstraßen, aber keine Hauptstraßen
 */
const erlaubt = (regel) => Uint8Array.from({ length: 256 }, (_, f) => (regel(f) ? 1 : 0));
export const MODI = Object.freeze({
  alle: erlaubt((f) => f & (STRASSE | RADWEG | WEG)),
  strasse: erlaubt((f) => f & STRASSE),
  radweg: erlaubt((f) => f & (RADWEG | WEG)),
  ruhig: erlaubt((f) => (f & (RADWEG | WEG)) || ((f & STRASSE) && !(f & HAUPT)))
});

/** Die Suche reicht bis 125 % des Budgets, damit die Karte einen grauen Rand zeigen kann */
export const GRENZ_FAKTOR = 1.25;

/** Binärer Min-Heap für (Schlüssel, Knoten) */
class Heap {
  constructor() { this.k = new Float64Array(1 << 20); this.v = new Int32Array(1 << 20); this.n = 0; }
  push(key, val) {
    if (this.n === this.k.length) {
      const k2 = new Float64Array(this.n * 2); k2.set(this.k); this.k = k2;
      const v2 = new Int32Array(this.n * 2); v2.set(this.v); this.v = v2;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = key; this.v[i] = val;
  }
  pop() { // liefert den Knoten; der Schlüssel steht danach in this.letzter
    const wurzelV = this.v[0];
    this.letzter = this.k[0];
    const key = this.k[--this.n];
    const val = this.v[this.n];
    let i = 0;
    while (true) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = key; this.v[i] = val;
    return wurzelV;
  }
}

export class Netz {
  constructor(ordner, { minKomponente = 2000 } = {}) {
    this.knLat = lies(ordner, 'knoten_lat.i32', Int32Array);
    this.knLon = lies(ordner, 'knoten_lon.i32', Int32Array);
    this.adjStart = lies(ordner, 'adj_start.u32', Uint32Array);
    this.adj = lies(ordner, 'adj.u32', Uint32Array);
    this.kA = lies(ordner, 'kante_a.u32', Uint32Array);
    this.kB = lies(ordner, 'kante_b.u32', Uint32Array);
    this.kFlags = lies(ordner, 'kante_flags.u8', Uint8Array);
    this.kBelag = lies(ordner, 'kante_belag.u8', Uint8Array);
    this.kLegStart = lies(ordner, 'kante_leg_start.u32', Uint32Array);
    this.kLegN = lies(ordner, 'kante_leg_n.u8', Uint8Array);
    this.legLen = lies(ordner, 'leg_len.u16', Uint16Array);
    this.legGrad = lies(ordner, 'leg_grad.i8', Int8Array);
    this.legKurs = lies(ordner, 'leg_kurs.u8', Uint8Array);
    // Knotenart je Knoten (Ampel, Haltestelle, Vorfahrt, Überweg, Kreuzung); fehlt die Datei, gibt es keine Halte
    this.knTyp = existsSync(join(ordner, 'knoten_typ.u8')) ? lies(ordner, 'knoten_typ.u8', Uint8Array) : new Uint8Array(this.knLat.length);
    // Verlauf der Kanten (aus dem Bau mit Punkten je Kante); fehlen die Dateien, wird der Verlauf aus den Teilstücken nachgebildet
    const hatForm = existsSync(join(ordner, 'kante_form_start.u32'));
    this.formStart = hatForm ? lies(ordner, 'kante_form_start.u32', Uint32Array) : null;
    this.formN = hatForm ? lies(ordner, 'kante_form_n.u32', Uint32Array) : null;
    this.formLat = hatForm ? lies(ordner, 'form_lat.i32', Int32Array) : null;
    this.formLon = hatForm ? lies(ordner, 'form_lon.i32', Int32Array) : null;
    this.N = this.knLat.length;
    this.E = this.kA.length;
    this.minKomponente = minKomponente; // so viele Knoten muss ein zusammenhängender Netzteil haben, damit der Startpunkt dort einrastet
    this._gitter();
  }

  lat(i) { return this.knLat[i] / 1e7; }
  lon(i) { return this.knLon[i] / 1e7; }

  /** Gitter aus Zellen von 0,01° für die Suche des nächsten Knotens */
  _gitter() {
    let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity;
    for (let i = 0; i < this.N; i++) {
      const a = this.knLat[i]; const o = this.knLon[i];
      if (a < minLat) minLat = a; if (a > maxLat) maxLat = a; if (o < minLon) minLon = o; if (o > maxLon) maxLon = o;
    }
    this.bbox = { minLat: minLat / 1e7, maxLat: maxLat / 1e7, minLon: minLon / 1e7, maxLon: maxLon / 1e7 };
    this.g = { latMin: Math.floor(minLat / 1e5), lonMin: Math.floor(minLon / 1e5), breite: Math.floor(maxLon / 1e5) - Math.floor(minLon / 1e5) + 1,
      hoehe: Math.floor(maxLat / 1e5) - Math.floor(minLat / 1e5) + 1 };
    const zellen = this.g.breite * this.g.hoehe;
    const zaehl = new Uint32Array(zellen + 1);
    const zelleVon = (i) => (Math.floor(this.knLat[i] / 1e5) - this.g.latMin) * this.g.breite + (Math.floor(this.knLon[i] / 1e5) - this.g.lonMin);
    for (let i = 0; i < this.N; i++) zaehl[zelleVon(i) + 1]++;
    for (let z = 0; z < zellen; z++) zaehl[z + 1] += zaehl[z];
    const fuell = zaehl.slice(0, zellen);
    this.gZellen = zaehl;
    this.gKnoten = new Uint32Array(this.N);
    for (let i = 0; i < this.N; i++) this.gKnoten[fuell[zelleVon(i)]++] = i;
  }

  /** Nächster Knoten, an dem im gewählten Modus (Tabelle aus MODI) eine Kante abgeht; Ergebnis { knoten, abstand_m } oder null */
  naechster(lat, lon, modus = MODI.alle) {
    const zl = Math.floor(lat * 100) - this.g.latMin;
    const zo = Math.floor(lon * 100) - this.g.lonMin;
    const cosB = Math.cos(lat * Math.PI / 180);
    const gross = this.grosseKomponenten(modus);
    let beste = -1;
    let besterAbstand = Infinity;
    for (let radius = 0; radius <= 12 && (beste < 0 || radius <= Math.ceil(besterAbstand / 700) + 1); radius++) {
      for (let dl = -radius; dl <= radius; dl++) {
        for (let dO = -radius; dO <= radius; dO++) {
          if (Math.max(Math.abs(dl), Math.abs(dO)) !== radius) continue;
          const l = zl + dl; const o = zo + dO;
          if (l < 0 || o < 0 || l >= this.g.hoehe || o >= this.g.breite) continue;
          const z = l * this.g.breite + o;
          for (let p = this.gZellen[z]; p < this.gZellen[z + 1]; p++) {
            const k = this.gKnoten[p];
            const dy = (this.lat(k) - lat) * 110574;
            const dx = (this.lon(k) - lon) * 111320 * cosB;
            const ab = Math.hypot(dx, dy);
            if (ab >= besterAbstand || !gross[k] || !this.hatKante(k, modus)) continue;
            beste = k; besterAbstand = ab;
          }
        }
      }
    }
    return beste < 0 ? null : { knoten: beste, abstand_m: besterAbstand };
  }

  /**
   * Knoten, die zu einem größeren zusammenhängenden Teil des Netzes gehören (mindestens `minimum` Knoten) — im gewählten Modus, ohne Rücksicht auf
   * Einbahnrichtungen. Der Startpunkt rastet nur dort ein, nicht in winzigen abgeschnittenen Inseln (Bahnhofsvorplätze, Gartenwege ...).
   */
  grosseKomponenten(modus, minimum = this.minKomponente) {
    this._komp = this._komp ?? new Map();
    if (this._komp.has(modus)) return this._komp.get(modus);
    const eltern = new Int32Array(this.N);
    for (let i = 0; i < this.N; i++) eltern[i] = i;
    const wurzel = (x) => { while (eltern[x] !== x) { eltern[x] = eltern[eltern[x]]; x = eltern[x]; } return x; };
    for (let e = 0; e < this.E; e++) {
      if (!modus[this.kFlags[e]]) continue;
      const a = wurzel(this.kA[e]);
      const b = wurzel(this.kB[e]);
      if (a !== b) eltern[a] = b;
    }
    const groesse = new Uint32Array(this.N);
    for (let i = 0; i < this.N; i++) groesse[wurzel(i)]++;
    const gross = new Uint8Array(this.N);
    for (let i = 0; i < this.N; i++) gross[i] = groesse[wurzel(i)] >= minimum ? 1 : 0;
    this._komp.set(modus, gross);
    return gross;
  }

  hatKante(k, modus) {
    for (let p = this.adjStart[k]; p < this.adjStart[k + 1]; p++) {
      const x = this.adj[p];
      const f = this.kFlags[x >> 1];
      if (modus[f] && (f & ((x & 1) ? 2 : 1))) return true;
    }
    return false;
  }

  kantenLaenge(e) {
    let s = 0;
    for (let l = this.kLegStart[e]; l < this.kLegStart[e] + this.kLegN[e]; l++) s += this.legLen[l];
    return s / 10;
  }

  /**
   * Kostentabelle (Wh je Meter) aus dem Rechenmodell, nach Fahrtrichtung (16 Sektoren, ohne Wind nur einer), Steigung (−20 % bis +30 %,
   * Schritte von 0,5 %) und Belag (6 Stufen). Damit kostet das Abfahren einer Kante nur Tabellenzugriffe.
   */
  kostenTabelle(modell) {
    const windig = modell.einstellungen.wind_ms > 0;
    const sektoren = windig ? 16 : 1;
    const STUFEN = [1.0, 1.2, 1.5, 1.9, 2.4, 3.0];
    const GRAD_MIN = -0.2;
    const SCHRITT = 0.005;
    const nGrad = Math.round(0.5 / SCHRITT) + 1;
    const t = new Float32Array(sektoren * nGrad * STUFEN.length);
    const z = new Float32Array(sektoren * nGrad * STUFEN.length); // Fahrzeit in Sekunden je Meter
    for (let s = 0; s < sektoren; s++) {
      for (let g = 0; g < nGrad; g++) {
        for (let b = 0; b < STUFEN.length; b++) {
          const r = berechneSegment(modell, { laenge_m: 100, steigung: GRAD_MIN + g * SCHRITT, richtung_grad: s * 22.5, oberflaeche: STUFEN[b] });
          // Solarertrag mindert den Verbrauch, aber höchstens bis null (so bleiben die Kosten nicht negativ, was die Suche braucht)
          t[(s * nGrad + g) * STUFEN.length + b] = Math.max(0, r.motor_wh - r.solar_wh) / 100;
          z[(s * nGrad + g) * STUFEN.length + b] = r.zeit_s / 100;
        }
      }
    }
    // belag (Faktor × 20) -> nächste Stufe
    const belagStufe = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      let best = 0;
      for (let b = 1; b < STUFEN.length; b++) if (Math.abs(STUFEN[b] - i / 20) < Math.abs(STUFEN[best] - i / 20)) best = b;
      belagStufe[i] = best;
    }
    // Halte je Knotenart (Index 1..5, 0 = kein Halt): Energie (t, Wh) und Wartezeit (z, s)
    const h = haltKosten(modell);
    const halt = { t: new Float32Array(h.length + 1), z: new Float32Array(h.length + 1) };
    h.forEach((x, i) => { halt.t[i + 1] = x.wh; halt.z[i + 1] = x.s; });
    return { t, z, sektoren, nGrad, nStufen: STUFEN.length, GRAD_MIN, SCHRITT, belagStufe, halt };
  }

  /** Verlauf der Kante zwischen den Knoten k und u als Punkte [[Breite, Länge], ...] von k nach u (null, wenn es keine Kante gibt) */
  verlaufZwischen(k, u) {
    for (let p = this.adjStart[k]; p < this.adjStart[k + 1]; p++) {
      const x = this.adj[p];
      const e = x >> 1;
      const v = (x & 1) ? this.kA[e] : this.kB[e];
      if (v !== u) continue;
      const punkte = this.kantenLinie(e); // von kA nach kB
      return this.kA[e] === k ? punkte : punkte.reverse();
    }
    return null;
  }

  /** Verlauf einer Kante als Linie [[Breite, Länge], ...] von a nach b, aus den Teilstücken nachgebildet (Länge und Richtung); das Ende wird auf b gezogen */
  kantenLinie(e) {
    if (this.formStart) {
      const s = this.formStart[e];
      const punkte = [];
      for (let k = s; k < s + this.formN[e]; k++) punkte.push([this.formLat[k] / 1e7, this.formLon[k] / 1e7]);
      return punkte;
    }
    const n = this.kLegN[e];
    const s0 = this.kLegStart[e];
    let lat = this.lat(this.kA[e]);
    let lon = this.lon(this.kA[e]);
    const punkte = [[lat, lon]];
    const abstand = [0];
    let summe = 0;
    for (let k = 0; k < n; k++) {
      const m = this.legLen[s0 + k] / 10;
      const kurs = this.legKurs[s0 + k] * 2 * Math.PI / 256;
      lat += m * Math.cos(kurs) / 110574;
      lon += m * Math.sin(kurs) / (111320 * Math.cos(lat * Math.PI / 180));
      summe += m;
      punkte.push([lat, lon]);
      abstand.push(summe);
    }
    const fLat = this.lat(this.kB[e]) - lat;
    const fLon = this.lon(this.kB[e]) - lon;
    if (summe > 0) for (let i = 1; i < punkte.length; i++) { const w = abstand[i] / summe; punkte[i][0] += fLat * w; punkte[i][1] += fLon * w; }
    else punkte.push([this.lat(this.kB[e]), this.lon(this.kB[e])]);
    return punkte;
  }

  /** Alle Kanten, von denen mindestens ein Endpunkt im Rechteck liegt (Grad); filter(e) wählt aus */
  kantenImRechteck(minLat, minLon, maxLat, maxLon, filter = () => true) {
    const z0 = Math.max(0, Math.floor(minLat * 100) - this.g.latMin);
    const z1 = Math.min(this.g.hoehe - 1, Math.floor(maxLat * 100) - this.g.latMin);
    const o0 = Math.max(0, Math.floor(minLon * 100) - this.g.lonMin);
    const o1 = Math.min(this.g.breite - 1, Math.floor(maxLon * 100) - this.g.lonMin);
    const gesehen = new Set();
    const ergebnis = [];
    for (let zl = z0; zl <= z1; zl++) {
      for (let zo = o0; zo <= o1; zo++) {
        const z = zl * this.g.breite + zo;
        for (let p = this.gZellen[z]; p < this.gZellen[z + 1]; p++) {
          const k = this.gKnoten[p];
          const la = this.lat(k); const lo = this.lon(k);
          if (la < minLat || la > maxLat || lo < minLon || lo > maxLon) continue;
          for (let q = this.adjStart[k]; q < this.adjStart[k + 1]; q++) {
            const e = this.adj[q] >> 1;
            if (gesehen.has(e)) continue;
            gesehen.add(e);
            if (filter(e)) ergebnis.push(e);
          }
        }
      }
    }
    return ergebnis;
  }

  /** Energie (Wh) für das Abfahren einer Kante in Richtung side (0: a→b, 1: b→a) */
  kantenEnergie(tab, e, side) { return this.kantenKosten(tab, e, side, 't'); }

  /** Kosten einer Kante in Richtung side; feld 't' = Wh, 'z' = Sekunden */
  /** Steigung in Prozent auf dem Weg von Knoten u nach Knoten k (nach Länge gewichtet); null, wenn beide nicht verbunden sind */
  steigungZwischen(u, k) {
    for (let p = this.adjStart[k]; p < this.adjStart[k + 1]; p++) {
      const x = this.adj[p];
      const e = x >> 1;
      const v = (x & 1) ? this.kA[e] : this.kB[e];
      if (v !== u) continue;
      const side = this.kA[e] === u ? 0 : 1; // 0: Fahrt von A nach B, sonst umgekehrt
      const n = this.kLegN[e];
      const s0 = this.kLegStart[e];
      let s = 0;
      let l = 0;
      for (let q = 0; q < n; q++) {
        const leg = side === 0 ? s0 + q : s0 + n - 1 - q;
        const len = this.legLen[leg];
        let g = this.legGrad[leg] / 200;
        if (side === 1) g = -g;
        s += g * len;
        l += len;
      }
      return l > 0 ? Math.round(1000 * s / l) / 10 : 0;
    }
    return null;
  }

  kantenKosten(tab, e, side, feld) {
    const tabelle = tab[feld];
    const n = this.kLegN[e];
    const s0 = this.kLegStart[e];
    const bs = tab.belagStufe[this.kBelag[e]];
    let wh = 0;
    for (let k = 0; k < n; k++) {
      const leg = side === 0 ? s0 + k : s0 + n - 1 - k;
      let g = this.legGrad[leg] / 200;
      if (side === 1) g = -g;
      let gi = Math.round((g - tab.GRAD_MIN) / tab.SCHRITT);
      if (gi < 0) gi = 0; else if (gi >= tab.nGrad) gi = tab.nGrad - 1;
      let si = 0;
      if (tab.sektoren > 1) {
        let kurs = this.legKurs[leg] * 360 / 256;
        if (side === 1) kurs += 180;
        si = Math.round((kurs % 360) / 22.5) % 16;
      }
      wh += this.legLen[leg] / 10 * tabelle[(si * tab.nGrad + gi) * tab.nStufen + bs];
    }
    // Halt an der Ankunft (Ampel, Vorfahrt, Überweg, Kreuzung)
    const ende = side === 0 ? this.kB[e] : this.kA[e];
    const art = this.knTyp[ende];
    if (art && tab.halt) wh += tab.halt[feld][art];
    return wh;
  }

  /**
   * Dijkstra von einem Knoten aus. kosten(e, side) liefert die Kosten einer Kante in Richtung side. Abbruch bei Kosten über `grenze`
   * (oder, wenn `ziel` angegeben ist, beim Erreichen des Ziels). Ergebnis: { dist, vorgaenger (nur mit ziel), besucht, kanten }.
   */
  suche(start, modus, kosten, grenze, ziel = -1) {
    const g = this.sucheSchritte(start, modus, kosten, grenze, ziel);
    for (;;) {
      const s = g.next();
      if (s.done) return s.value;
    }
  }

  /**
   * Die Suche als Generator: meldet alle paar tausend Schritte den erreichten Anteil der Grenze (0..1, steigt mit jeder Stufe)
   * und liefert am Ende das Ergebnis. So bleibt der Fortschritt im Worker sichtbar.
   */
  *sucheSchritte(start, modus, kosten, grenze, ziel = -1) {
    const dist = new Float64Array(this.N).fill(Infinity); // nicht Float32: die Rundung würde veraltete Heap-Einträge von gültigen nicht unterscheiden lassen
    const vor = new Int32Array(this.N).fill(-1); // Vorgänger je Knoten (für die Routen)
    const heap = new Heap();
    dist[start] = 0;
    heap.push(0, start);
    let besucht = 0;
    let kanten = 0;
    while (heap.n > 0) {
      const u = heap.pop();
      const du = heap.letzter;
      if (du > dist[u]) continue;
      besucht++;
      if (besucht % 4000 === 0 && Number.isFinite(grenze)) yield Math.min(du / grenze, 1);
      if (u === ziel) break;
      for (let p = this.adjStart[u]; p < this.adjStart[u + 1]; p++) {
        const x = this.adj[p];
        const e = x >> 1;
        const side = x & 1;
        const f = this.kFlags[e];
        if (!modus[f] || !(f & (side ? 2 : 1))) continue;
        kanten++;
        const v = side ? this.kA[e] : this.kB[e];
        const nd = du + kosten(e, side);
        if (nd < dist[v] && nd <= grenze) {
          dist[v] = nd;
          vor[v] = u;
          heap.push(nd, v);
        }
      }
    }
    return { dist, vorgaenger: vor, besucht, kanten };
  }

  /** Reichweite nach Energie: dist enthält je Knoten die Wh, die vom Start bis dorthin gebraucht werden (Infinity: nicht erreichbar) */
  reichweite(modell, startKnoten, modusName = 'alle') {
    const g = this.reichweiteSchritte(modell, startKnoten, modusName);
    for (;;) {
      const s = g.next();
      if (s.done) return s.value;
    }
  }

  /** Reichweite als Generator (siehe sucheSchritte): liefert Zwischenstände, am Ende das Ergebnis */
  *reichweiteSchritte(modell, startKnoten, modusName = 'alle') {
    const tab = this.kostenTabelle(modell);
    const zeit = modell.einstellungen.budget_art === 'zeit';
    const feld = zeit ? 'z' : 't';
    const grenze = zeit ? modell.budget.s : modell.akku.nutzbar_wh;
    const suchGrenze = grenze * GRENZ_FAKTOR;
    const r = yield* this.sucheSchritte(startKnoten, MODI[modusName], (e, side) => this.kantenKosten(tab, e, side, feld), suchGrenze);
    return { ...r, grenze, feld, tab };
  }

  /** Kürzeste Strecke nach Länge in Metern zwischen zwei Knoten (oder null) */
  kuerzesterWeg(start, ziel, modusName = 'alle') {
    const r = this.suche(start, MODI[modusName], (e) => this.kantenLaenge(e), Infinity, ziel);
    return Number.isFinite(r.dist[ziel]) ? r.dist[ziel] : null;
  }
}
