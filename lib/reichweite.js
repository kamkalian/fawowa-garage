// Reichweiten-Rechnung für die Karte: Gespann und Einstellungen -> Rechenmodell -> Suche im Wegenetz -> Raster (Wärmekarte) und Umrandung.
// Läuft im Hintergrund-Thread des Routing-Dienstes (lib/routing-dienst.js); reine Funktion von (Netz, Eingabe).

import { baueModell, pruefeEinstellungen } from './rechenmodell.js';
import { MODI } from './netz.js';

export const MODUS_NAMEN = Object.freeze(['alle', 'strasse', 'ruhig']);

// Zellgröße des Rasters in Grad: etwa 330 m in beide Richtungen auf der Breite von NRW
const D_LAT = 0.003;
const D_LON = 0.0048;
const UNERREICHT = 255;     // Wert im Raster für „nicht erreicht“
const AUSSEN = 1.4;         // Feldwert außerhalb der Reichweite für die Umrandung (über dem Grenzwert 1)
const MAX_ABSTAND_STARTWEG_M = 2000; // weiter vom Start darf der nächste Weg nicht entfernt sein

const MIN_PUNKTE_RING = 16;   // Ringe mit weniger Punkten (Inseln und Löcher unter etwa 20 Zellen) werden nicht ausgegeben
const MIN_PUNKTE_OFFEN = 8;
const RAD = Math.PI / 180;

/**
 * eingabe: { fahrrad, anhaenger, gespann, einstellungen, start: { lat, lon }, modus }
 * Ergebnis: { fehler: [Code, ...] } oder { ok: true, ... } mit
 *   start        { lat, lon, abstand_m }  der Punkt im Wegenetz, von dem aus gerechnet wurde
 *   budget_wh    nutzbare Energie
 *   raster       { lat0, lon0, dLat, dLon, nx, ny, daten }  daten: base64 von nx·ny Byte (0..254 = Anteil des Budgets · 254, 255 = nicht erreicht), Zeile 0 liegt im Süden
 *   umrandung    Liste von Linienzügen [[Breite, Länge], ...] (die Grenze der erreichbaren Fläche)
 *   kennzahlen   { flaeche_km2, weitester_km, knoten, ms }
 *   modell       { masse_kg, kapazitaet_wh, nutzbar_wh }, annahmen, einstellungen
 * Fehlercodes: fahrrad_fehlt, kein_motor, akku_fehlt, einstellungen_ungueltig, modus_ungueltig, start_ungueltig, ausserhalb, kein_weg_in_naehe, akku_leer
 */
export function rechneReichweite(netz, eingabe) {
  const t0 = Date.now();
  const modusName = eingabe.modus ?? 'alle';
  if (!MODUS_NAMEN.includes(modusName)) return { fehler: ['modus_ungueltig'] };
  const { lat, lon } = eingabe.start ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { fehler: ['start_ungueltig'] };
  const b = netz.bbox;
  if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return { fehler: ['ausserhalb'] };

  const { modell, annahmen, fehler } = baueModell(eingabe.fahrrad, eingabe.anhaenger ?? null, eingabe.gespann ?? null, eingabe.einstellungen ?? {});
  if (fehler.length) return { fehler };
  if (modell.akku.nutzbar_wh <= 0) return { fehler: ['akku_leer'] };

  const modus = MODI[modusName];
  const snap = netz.naechster(lat, lon, modus);
  if (!snap || snap.abstand_m > MAX_ABSTAND_STARTWEG_M) return { fehler: ['kein_weg_in_naehe'] };

  const r = netz.reichweite(modell, snap.knoten, modusName);
  const sLat = netz.lat(snap.knoten);
  const sLon = netz.lon(snap.knoten);

  // Kennzahlen aus den erreichten Knoten
  let knoten = 0;
  let weitesterM = 0;
  let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity;
  const cosS = Math.cos(sLat * RAD);
  for (let i = 0; i < netz.N; i++) {
    if (!Number.isFinite(r.dist[i])) continue;
    knoten++;
    const la = netz.lat(i); const lo = netz.lon(i);
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la; if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
    const dm = Math.hypot((la - sLat) * 110574, (lo - sLon) * 111320 * cosS);
    if (dm > weitesterM) weitesterM = dm;
  }

  // Raster: je Zelle der kleinste Energieanteil. Außer den Knoten zählen Punkte entlang der Wege, auch das Stück einer Kante, das der Akku
  // noch schafft (so reicht die Fläche bis zur leeren Batterie und nicht nur bis zum letzten Knoten, und Felder ohne Kreuzung bleiben nicht leer).
  // Der Rand um die erreichten Knoten fängt Kanten ab, die über sie hinausragen.
  const RAND_LAT = 0.03;
  const RAND_LON = 0.05;
  const lat0 = Math.floor((minLat - RAND_LAT) / D_LAT) * D_LAT;
  const lon0 = Math.floor((minLon - RAND_LON) / D_LON) * D_LON;
  const ny = Math.floor((maxLat + RAND_LAT - lat0) / D_LAT) + 1;
  const nx = Math.floor((maxLon + RAND_LON - lon0) / D_LON) + 1;
  const gross = new Float32Array(nx * ny).fill(Infinity);
  const setze = (la, lo, f) => {
    const zy = Math.floor((la - lat0) / D_LAT);
    const zx = Math.floor((lo - lon0) / D_LON);
    if (zx < 0 || zy < 0 || zx >= nx || zy >= ny) return;
    if (f < gross[zy * nx + zx]) gross[zy * nx + zx] = f;
  };
  const budget = r.grenze;
  for (let i = 0; i < netz.N; i++) if (Number.isFinite(r.dist[i])) setze(netz.lat(i), netz.lon(i), r.dist[i] / budget);
  for (let e = 0; e < netz.E; e++) {
    const flags = netz.kFlags[e];
    if (!modus[flags]) continue;
    const a = netz.kA[e]; const bk = netz.kB[e];
    const da = r.dist[a]; const db = r.dist[bk];
    const aErreicht = Number.isFinite(da); const bErreicht = Number.isFinite(db);
    if (!aErreicht && !bErreicht) continue;
    const aLat = netz.lat(a); const aLon = netz.lon(a); const bLat = netz.lat(bk); const bLon = netz.lon(bk);
    const laengeM = Math.hypot((bLat - aLat) * 110574, (bLon - aLon) * 111320 * cosS);
    if (laengeM < 200 && aErreicht && bErreicht) continue; // kurze Kante zwischen erreichten Knoten: die Knoten genügen
    const eAb = (flags & 1) ? netz.kantenEnergie(r.tab, e, 0) : Infinity; // Energie a -> b
    const eBa = (flags & 2) ? netz.kantenEnergie(r.tab, e, 1) : Infinity; // Energie b -> a
    const schritte = Math.max(1, Math.ceil(laengeM / 150));
    for (let k = 1; k < schritte; k++) {
      const t = k / schritte;
      let kosten = Infinity;
      if (aErreicht && eAb !== Infinity) kosten = da + t * eAb;
      if (bErreicht && eBa !== Infinity) kosten = Math.min(kosten, db + (1 - t) * eBa);
      if (kosten <= budget) setze(aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t, kosten / budget);
    }
  }

  // Auf die belegten Zellen zuschneiden
  let zx0 = nx; let zx1 = -1; let zy0 = ny; let zy1 = -1;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (gross[y * nx + x] !== Infinity) { if (x < zx0) zx0 = x; if (x > zx1) zx1 = x; if (y < zy0) zy0 = y; if (y > zy1) zy1 = y; }
  const cnx = zx1 - zx0 + 1;
  const cny = zy1 - zy0 + 1;
  const feld = new Float32Array(cnx * cny).fill(Infinity);
  for (let y = 0; y < cny; y++) for (let x = 0; x < cnx; x++) feld[y * cnx + x] = gross[(y + zy0) * nx + x + zx0];
  const rLat0 = lat0 + zy0 * D_LAT;
  const rLon0 = lon0 + zx0 * D_LON;
  schliesseLuecken(feld, cnx, cny);

  let zellen = 0;
  const daten = new Uint8Array(cnx * cny);
  for (let i = 0; i < feld.length; i++) {
    if (feld[i] <= 1) { daten[i] = Math.min(254, Math.round(feld[i] * 254)); zellen++; } else daten[i] = UNERREICHT;
  }
  const zellFlaecheKm2 = (D_LAT * 110574) * (D_LON * 111320 * cosS) / 1e6;

  return {
    ok: true,
    start: { lat: sLat, lon: sLon, abstand_m: Math.round(snap.abstand_m) },
    budget_wh: r.grenze,
    raster: { lat0: rLat0, lon0: rLon0, dLat: D_LAT, dLon: D_LON, nx: cnx, ny: cny, daten: Buffer.from(daten).toString('base64') },
    umrandung: umrandung(feld, cnx, cny, rLat0, rLon0),
    kennzahlen: { flaeche_km2: Math.round(zellen * zellFlaecheKm2), weitester_km: Math.round(weitesterM / 100) / 10, knoten, ms: Date.now() - t0 },
    modell: { masse_kg: modell.masse_kg, kapazitaet_wh: modell.akku.kapazitaet_wh, nutzbar_wh: modell.akku.nutzbar_wh },
    annahmen, einstellungen: modell.einstellungen, modus: modusName
  };
}

/** Prüft Einstellungen für die Schnittstelle: { werte, fehler } wie pruefeEinstellungen */
export { pruefeEinstellungen };

/**
 * Zellen ohne Knoten mitten im erreichten Gebiet (Wald, Felder) bekommen den Mittelwert ihrer erreichten Nachbarn, wenn mindestens
 * fünf der acht Nachbarn erreicht sind. Zwei Durchgänge schließen kleine Lücken, ohne den Rand wachsen zu lassen.
 */
function schliesseLuecken(feld, nx, ny) {
  for (let durchgang = 0; durchgang < 2; durchgang++) {
    const neu = [];
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (feld[y * nx + x] !== Infinity) continue;
        let summe = 0; let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx; const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
            const v = feld[yy * nx + xx];
            if (v !== Infinity) { summe += v; n++; }
          }
        }
        if (n >= 5) neu.push([y * nx + x, summe / n]);
      }
    }
    for (const [i, v] of neu) feld[i] = v;
  }
}

/** Grenze des Gebiets (Feldwert 1) als Linienzüge [[Breite, Länge], ...] — Marching Squares über die Zellmitten, Linien verkettet */
function umrandung(feld, nx, ny, lat0, lon0) {
  // Feld mit Rand aus „außen“ auffüllen
  const w = nx + 2;
  const h = ny + 2;
  const v = new Float32Array(w * h).fill(AUSSEN);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { const f = feld[y * nx + x]; v[(y + 1) * w + x + 1] = f <= 1 ? f : AUSSEN; }

  const punkte = new Map();   // Schlüssel der Kante -> [x, y] in Rasterkoordinaten
  const nachbarn = new Map(); // Schlüssel -> Schlüssel der Verbundenen
  const kante = (art, i, j, a, b) => { // a, b: Feldwerte an den Enden; Ergebnis: Schlüssel
    const key = `${art}${i},${j}`;
    if (!punkte.has(key)) {
      const t = (1 - a) / (b - a);
      punkte.set(key, art === 'h' ? [i + t, j] : [i, j + t]);
    }
    return key;
  };
  const verbinde = (k1, k2) => {
    if (!nachbarn.has(k1)) nachbarn.set(k1, []);
    if (!nachbarn.has(k2)) nachbarn.set(k2, []);
    nachbarn.get(k1).push(k2);
    nachbarn.get(k2).push(k1);
  };

  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = v[j * w + i];             // oben links
      const b = v[j * w + i + 1];         // oben rechts
      const c = v[(j + 1) * w + i + 1];   // unten rechts
      const d = v[(j + 1) * w + i];       // unten links
      const fall = (a < 1 ? 8 : 0) | (b < 1 ? 4 : 0) | (c < 1 ? 2 : 0) | (d < 1 ? 1 : 0);
      if (fall === 0 || fall === 15) continue;
      const oben = () => kante('h', i, j, a, b);
      const unten = () => kante('h', i, j + 1, d, c);
      const links = () => kante('v', i, j, a, d);
      const rechts = () => kante('v', i + 1, j, b, c);
      switch (fall) {
        case 1: case 14: verbinde(links(), unten()); break;
        case 2: case 13: verbinde(unten(), rechts()); break;
        case 3: case 12: verbinde(links(), rechts()); break;
        case 4: case 11: verbinde(oben(), rechts()); break;
        case 6: case 9: verbinde(oben(), unten()); break;
        case 7: case 8: verbinde(oben(), links()); break;
        case 5: verbinde(oben(), links()); verbinde(unten(), rechts()); break;
        case 10: verbinde(oben(), rechts()); verbinde(links(), unten()); break;
        default: break;
      }
    }
  }

  // Zu Linienzügen verketten
  const besucht = new Set();
  const linien = [];
  const zuKoord = (key) => {
    const [x, y] = punkte.get(key);
    return [Math.round((lat0 + (y - 1 + 0.5) * D_LAT) * 1e5) / 1e5, Math.round((lon0 + (x - 1 + 0.5) * D_LON) * 1e5) / 1e5];
  };
  const gehe = (start) => {
    const linie = [];
    let aktuell = start;
    while (aktuell !== undefined && !besucht.has(aktuell)) {
      besucht.add(aktuell);
      linie.push(zuKoord(aktuell));
      aktuell = nachbarn.get(aktuell).find((k) => !besucht.has(k));
    }
    return linie;
  };
  // Offene Enden zuerst (Grad 1), danach geschlossene Ringe
  // Kleine Inseln und Löcher (wenige Zellen) lassen die Umrandung unruhig wirken und kosten Übertragung: weglassen
  for (const [key, n] of nachbarn) if (n.length === 1 && !besucht.has(key)) { const l = gehe(key); if (l.length >= MIN_PUNKTE_OFFEN) linien.push(l); }
  for (const key of nachbarn.keys()) if (!besucht.has(key)) { const l = gehe(key); if (l.length >= MIN_PUNKTE_RING) { l.push(l[0]); linien.push(l); } }
  return linien;
}
