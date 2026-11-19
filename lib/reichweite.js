// Reichweiten-Planer: Vom Start aus wird ein Raster aus 1-km-Punkten geprüft. Jeder Punkt, der innerhalb des Budgets (Akku oder
// Fahrtzeit) erreicht wird, bekommt seine Route. Die Routen teilen sich Abschnitte und führen auch über Kreuz, weil die Suche im
// Netz (Dijkstra-Baum) jeden Weg mit dem geringsten Verbrauch bzw. der kürzesten Zeit findet. Aus den Linien entsteht die Heatmap.
// Läuft im Hintergrund-Thread (lib/routing-dienst.js).

import { baueModell, pruefeEinstellungen } from './rechenmodell.js';
import { MODI, GRENZ_FAKTOR } from './netz.js';

export const MODUS_NAMEN = Object.freeze(['alle', 'strasse', 'ruhig']);
export { pruefeEinstellungen };


const MAX_ABSTAND_M = 1500;    // ein Punkt, der weiter als das von einem Knoten entfernt ist, zählt nicht
const MAX_ABSTAND_GITTER_M = 1500; // Gitterpunkte, die weiter als das von einer befahrbaren Straße oder einem Weg entfernt sind, werden nicht gesetzt
const MAX_RADIUS_M = 200000;   // höchstens so weit vom Start
const D_LAT = 0.0015;          // Rasterzelle der Heatmap in Grad (etwa 165 m); wird bei großen Routen größer
const D_LON = 0.0024;
const CAP = 1.5;               // höchster Wert im Raster
const PAD = 0.01;              // Rand um die Linien (Grad)
const MAX_ZELLEN = 1200;       // höchstens so viele Zellen je Seite
const MAX_ABSTAND_STARTWEG_M = 2000;
const RAD = Math.PI / 180;

/**
 * eingabe: { fahrrad, anhaenger, gespann, einstellungen, start: { lat, lon }, modus }
 * Ergebnis bei Erfolg: { ok: true, start, budget, schritte, linien, raster, kennzahlen, modell, annahmen, einstellungen, modus }
 *   schritte: [[lat, lon, machbar (1/0)], ...] – Gitterpunkte, die im Budget liegen (1) oder nicht (0, nur in der Nähe der Grenze)
 *   linien:   [[lat1, lon1, lat2, lon2, anteil], ...] – Abschnitte der Routen; anteil = Verbrauch bis zum Abschnitt / Budget (1 = leer)
 *   raster:   Heatmap aus den Linien (base64, ein Byte je Zelle, Wert = byte / 254 × max; leer = 254)
 * Fehlercodes: fahrrad_fehlt, kein_motor, akku_fehlt, einstellungen_ungueltig, modus_ungueltig, start_ungueltig, ausserhalb, kein_weg_in_naehe, akku_leer
 */
function* rechneReichweiteSchritte(netz, eingabe) {
  // Abstand der Gitterpunkte um den Start: 0,5, 1 oder 2 km
  const SCHRITT_M = eingabe.schrittM ?? 2000;
  const t0 = Date.now();
  const modusName = eingabe.modus ?? 'alle';
  if (!MODUS_NAMEN.includes(modusName)) return { fehler: ['modus_ungueltig'] };
  const { lat, lon } = eingabe.start ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { fehler: ['start_ungueltig'] };
  const b = netz.bbox;
  if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return { fehler: ['ausserhalb'] };

  const { modell, annahmen, fehler } = baueModell(eingabe.fahrrad, eingabe.anhaenger ?? null, eingabe.gespann ?? null, eingabe.einstellungen ?? {});
  if (fehler.length) return { fehler };
  const einst = modell.einstellungen;
  const zeit = einst.budget_art === 'zeit';
  if (!zeit && modell.akku.nutzbar_wh <= 0) return { fehler: ['akku_leer'] };

  const modus = MODI[modusName];
  const snap = netz.naechster(lat, lon, modus);
  if (!snap || snap.abstand_m > MAX_ABSTAND_STARTWEG_M) return { fehler: ['kein_weg_in_naehe'] };

  // Eine Suche vom Start aus liefert Verbrauch bzw. Zeit und den Baum (Vorgänger) zu jedem Knoten
  // Die Suche meldet ihren Stand (0..1 der Suchgrenze); sie reicht 2 % bis 35 % des Fortschritts
  yield ['Suche vom Start aus', 0.02];
  const suche = netz.reichweiteSchritte(modell, snap.knoten, modusName);
  let s;
  while (!(s = suche.next()).done) yield ['Suche vom Start aus', 0.02 + 0.33 * s.value];
  const r = s.value;
  const budget = r.grenze;
  const grenzeSuche = budget * GRENZ_FAKTOR;
  const sLat = netz.lat(snap.knoten);
  const sLon = netz.lon(snap.knoten);
  const cosS = Math.cos(sLat * RAD);
  const mLat = 110574;
  const mLon = 111320 * cosS;

  // Größter Abstand eines erreichten Knotens bestimmt die Ausdehnung des Gitters
  let radius = 0;
  for (let i = 0; i < netz.N; i++) {
    if (!(r.dist[i] <= budget)) continue;
    const d = Math.hypot((netz.lat(i) - sLat) * mLat, (netz.lon(i) - sLon) * mLon);
    if (d > radius) radius = d;
  }
  radius = Math.min(radius + SCHRITT_M, MAX_RADIUS_M);
  const ringe = Math.floor(radius / SCHRITT_M);

  // Gitterpunkte auf Ringen um den Start: Ring k liegt k km entfernt, mit etwa 2πk Punkten (Abstand etwa 1 km). Je Punkt der nächste
  // Knoten; im Budget (1) oder nicht (0, nur bis zur Grenze der Suche). Der Start selbst ist Ring 0.
  const schritte = [];
  const ziele = new Map(); // Knoten -> true, wenn von dort eine Route ausgeht
  let weitester = 0;
  let anzahlMachbar = 0;
  const punkte = [[sLat, sLon, 0]];
  for (let k = 1; k <= ringe; k++) {
    const n = Math.max(6, Math.round(2 * Math.PI * k));
    for (let j = 0; j < n; j++) {
      const winkel = 2 * Math.PI * j / n;
      const dist = k * SCHRITT_M;
      punkte.push([sLat + dist * Math.cos(winkel) / mLat, sLon + dist * Math.sin(winkel) / mLon, dist]);
    }
  }
  const gesehen = new Set(); // Knoten, auf die schon ein Punkt gesetzt wurde
  let gezaehlt = 0;
  for (const [la, lo, dist] of punkte) {
    if (++gezaehlt % 10 === 0) yield [`Punkte im Raster festlegen: ${gezaehlt} von ${punkte.length}`, 0.35 + 0.3 * gezaehlt / punkte.length];
    {
      const k = netz.naechster(la, lo, modus);
      if (!k || k.abstand_m > MAX_ABSTAND_GITTER_M) continue; // Punkt wird auf die nächste Straße gesetzt
      // Der Punkt sitzt auf dem Knoten, den Bewertung und Routen nehmen (bk), damit Punkt und Routenende zusammenfallen
      const bk = besterKnoten(netz, r, k.knoten);
      if (gesehen.has(bk)) continue; // je Knoten einmal
      const machbar = r.dist[bk] <= budget;
      if (!machbar && !(r.dist[bk] <= grenzeSuche)) continue; // weit außerhalb: nicht anzeigen
      gesehen.add(bk);
      schritte.push([Math.round(netz.lat(bk) * 1e5) / 1e5, Math.round(netz.lon(bk) * 1e5) / 1e5, machbar ? 1 : 0]);
      if (machbar) {
        ziele.set(bk, true);
        anzahlMachbar++;
        if (dist > weitester) weitester = dist;
      }
    }
  }

  // Linien: der Baum-Pfad zu jedem erreichbaren Ziel, jeder Abschnitt nur einmal
  const linien = yield* baumLinienSchritte(netz, r, ziele, budget);
  // Ohne gültigen Punkt gibt es keine Linien; das Ergebnis bleibt gültig, die Heatmap ist dann leer
  yield ['Heatmap berechnen', 0.97];
  const raster = linien.length ? heatmapAusLinien(linien) : null;

  let knoten = 0;
  for (let i = 0; i < netz.N; i++) if (Number.isFinite(r.dist[i])) knoten++;

  return {
    ok: true,
    schritt_m: SCHRITT_M,
    start: { lat: sLat, lon: sLon, abstand_m: Math.round(snap.abstand_m) },
    budget: zeit ? { art: 'zeit', wert: Math.round(budget / 360) / 10, einheit: 'h' } : { art: 'akku', wert: Math.round(budget), einheit: 'Wh' },
    schritte,
    linien,
    raster,
    kennzahlen: {
      weitester_km: Math.round(weitester / 100) / 10,
      punkte_machbar: anzahlMachbar,
      punkte_gesamt: schritte.length,
      ringe,
      knoten,
      ms: Date.now() - t0
    },
    modell: { masse_kg: modell.masse_kg, kapazitaet_wh: modell.akku.kapazitaet_wh, nutzbar_wh: modell.akku.nutzbar_wh, fahrtzeit_h: einst.fahrtzeit_h },
    annahmen, einstellungen: einst, modus: modusName
  };
}

/** Der Knoten mit der kleinsten Zeit bzw. dem kleinsten Verbrauch unter dem Knoten und seinen direkten Nachbarn */
function besterKnoten(netz, r, k) {
  let best = k;
  for (let p = netz.adjStart[k]; p < netz.adjStart[k + 1]; p++) {
    const x = netz.adj[p];
    const e = x >> 1;
    const v = (x & 1) ? netz.kA[e] : netz.kB[e];
    if (r.dist[v] < r.dist[best]) best = v;
  }
  return best;
}

/**
 * Linien der Routen: vom Ziel rückwärts über den Baum bis zum Start; jeder Knoten wird nur einmal aufgenommen, so teilen sich die
 * Routen ihre Abschnitte. Ein Abschnitt geht vom Knoten zu seinem Vorgänger; anteil = Verbrauch am Knoten / Budget.
 */
function* baumLinienSchritte(netz, r, ziele, budget) {
  const besucht = new Uint8Array(netz.N);
  const linien = [];
  let n = 0;
  yield ['Routen berechnen: 0 von ' + ziele.size, 0.65];
  for (const z of ziele.keys()) {
    if (++n % 200 === 0) yield [`Routen berechnen: ${n} von ${ziele.size}`, 0.65 + 0.3 * n / ziele.size];
    let k = z;
    while (k >= 0 && !besucht[k]) {
      besucht[k] = 1;
      const u = r.vorgaenger[k];
      if (u < 0) break;
      const anteil = Math.min(r.dist[k] / budget, CAP);
      // Steigung in Fahrtrichtung vom Vorgänger (u) zum Knoten (k), in Prozent
      const steigung = netz.steigungZwischen(u, k) ?? 0;
      // Der Abschnitt folgt dem Verlauf der Straße (Kurven der Kante), nicht der Luftlinie zwischen den Knoten
      const verlauf = netz.verlaufZwischen(k, u) ?? [[netz.lat(k), netz.lon(k)], [netz.lat(u), netz.lon(u)]];
      const anteilGerundet = Math.round(anteil * 1000) / 1000;
      for (let i = 0; i + 1 < verlauf.length; i++) {
        linien.push([
          Math.round(verlauf[i][0] * 1e5) / 1e5, Math.round(verlauf[i][1] * 1e5) / 1e5,
          Math.round(verlauf[i + 1][0] * 1e5) / 1e5, Math.round(verlauf[i + 1][1] * 1e5) / 1e5,
          anteilGerundet, steigung
        ]);
      }
      k = u;
    }
  }
  return linien;
}

/**
 * Heatmap aus den Linien: die Zellen entlang eines Abschnitts bekommen den Anteil des Budgets an dieser Stelle (der kleinste, wenn
 * sich Abschnitte kreuzen). Ohne Linie bleibt die Zelle leer (254).
 */
function heatmapAusLinien(linien) {
  let minLa = Infinity; let maxLa = -Infinity; let minLo = Infinity; let maxLo = -Infinity;
  for (const [la1, lo1, la2, lo2] of linien) {
    minLa = Math.min(minLa, la1, la2); maxLa = Math.max(maxLa, la1, la2);
    minLo = Math.min(minLo, lo1, lo2); maxLo = Math.max(maxLo, lo1, lo2);
  }
  minLa -= PAD; maxLa += PAD; minLo -= PAD; maxLo += PAD;
  const dLat = Math.max(D_LAT, (maxLa - minLa) / MAX_ZELLEN);
  const dLon = Math.max(D_LON, (maxLo - minLo) / MAX_ZELLEN);
  const ny = Math.ceil((maxLa - minLa) / dLat) + 1;
  const nx = Math.ceil((maxLo - minLo) / dLon) + 1;
  const wert = new Float32Array(nx * ny).fill(Infinity);
  const setze = (la, lo, f) => {
    const zy = Math.floor((la - minLa) / dLat);
    const zx = Math.floor((lo - minLo) / dLon);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const y = zy + dy; const x = zx + dx;
      if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
      const i = y * nx + x;
      if (f < wert[i]) wert[i] = f;
    }
  };
  for (const [la1, lo1, la2, lo2, f] of linien) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(la2 - la1) / (dLat / 2), Math.abs(lo2 - lo1) / (dLon / 2))));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      setze(la1 + (la2 - la1) * t, lo1 + (lo2 - lo1) * t, f);
    }
  }
  // Leere Felder bekommen den Mittelwert ihrer benachbarten (gefüllten) Felder; die Werte stammen alle aus dem ursprünglichen Raster
  // Die Transparenz geht mit ein: leere Nachbarn zählen für die Deckkraft als 0, sodass gefüllte Felder am Rand durchscheinend werden.
  const gefuellt = new Float32Array(wert);
  const deckkraft = new Float32Array(nx * ny);
  for (let i = 0; i < wert.length; i++) if (wert[i] !== Infinity) deckkraft[i] = 1;
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      if (wert[i] !== Infinity) continue;
      let summe = 0; let anzahl = 0; let alpha = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const w = wert[yy * nx + xx];
        if (w !== Infinity) { summe += w; anzahl++; alpha += 1; }
      }
      if (anzahl) { gefuellt[i] = summe / anzahl; deckkraft[i] = alpha / 8; }
    }
  }
  // Zeile 0 liegt im Süden
  const daten = new Uint8Array(nx * ny).fill(254);
  const alpha = new Uint8Array(nx * ny);
  for (let i = 0; i < gefuellt.length; i++) {
    if (gefuellt[i] !== Infinity) daten[i] = Math.round(Math.min(gefuellt[i], CAP) / CAP * 254);
    alpha[i] = Math.round(deckkraft[i] * 255);
  }
  return {
    lat0: minLa, lon0: minLo, dLat, dLon, nx, ny, max: CAP,
    daten: Buffer.from(daten).toString('base64'),
    deckkraft: Buffer.from(alpha).toString('base64') // je Feld 0 (leer) bis 255 (voll deckend)
  };
}

/** Berechnung ohne Unterbrechung (Tests, Aufrufe ohne Oberfläche) */
export function rechneReichweite(netz, eingabe) {
  const lauf = rechneReichweiteSchritte(netz, eingabe);
  for (;;) {
    const s = lauf.next();
    if (s.done) return s.value;
  }
}

/**
 * Berechnung für den Worker: meldet Phase und Anteil (melde(text, anteil)) und gibt der übrigen Arbeit zwischendurch Zeit,
 * damit der Fortschritt in die Datenbank geschrieben werden kann.
 */
export async function rechneReichweiteAsync(netz, eingabe, melde) {
  const lauf = rechneReichweiteSchritte(netz, eingabe);
  for (;;) {
    const s = lauf.next();
    if (s.done) return s.value;
    melde(s.value[0], s.value[1]);
    await new Promise((weiter) => setImmediate(weiter));
  }
}
