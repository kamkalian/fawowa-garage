// Reichweiten-Planer: Vom Start aus wird ein Raster aus 1-km-Punkten geprüft. Jeder Punkt, der innerhalb des Budgets (Akku oder
// Fahrtzeit) erreicht wird, bekommt seine Route. Die Routen teilen sich Abschnitte und führen auch über Kreuz, weil die Suche im
// Netz (Dijkstra-Baum) jeden Weg mit dem geringsten Verbrauch bzw. der kürzesten Zeit findet. Aus den Linien entsteht die Heatmap.
// Läuft im Hintergrund-Thread (lib/routing-dienst.js).

import { baueModell, pruefeEinstellungen } from './rechenmodell.js';
import { MODI, GRENZ_FAKTOR } from './netz.js';

export const MODUS_NAMEN = Object.freeze(['alle', 'strasse', 'ruhig']);
export { pruefeEinstellungen };

const SCHRITT_M = 1000;        // Abstand der Gitterpunkte (größer, wenn die Reichweite sehr groß ist)
const MAX_PUNKTE_SEITE = 600;  // höchstens so viele Gitterpunkte je Seite
const MAX_ABSTAND_M = 1500;    // ein Gitterpunkt, der weiter als das von einem Knoten entfernt ist, zählt nicht
const MAX_RADIUS_M = 300000;   // höchstens so weit vom Start
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
  const einst = modell.einstellungen;
  const zeit = einst.budget_art === 'zeit';
  if (!zeit && modell.akku.nutzbar_wh <= 0) return { fehler: ['akku_leer'] };

  const modus = MODI[modusName];
  const snap = netz.naechster(lat, lon, modus);
  if (!snap || snap.abstand_m > MAX_ABSTAND_STARTWEG_M) return { fehler: ['kein_weg_in_naehe'] };

  // Eine Suche vom Start aus liefert Verbrauch bzw. Zeit und den Baum (Vorgänger) zu jedem Knoten
  const r = netz.reichweite(modell, snap.knoten, modusName);
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
  let schritt = SCHRITT_M;
  if (2 * radius / schritt + 1 > MAX_PUNKTE_SEITE) schritt = 2 * radius / (MAX_PUNKTE_SEITE - 1);
  const n = Math.floor(radius / schritt);

  // Gitterpunkte: je Punkt der nächste Knoten; im Budget (1) oder nicht (0, nur bis zur Grenze der Suche)
  const schritte = [];
  const ziele = new Map(); // Knoten -> true, wenn von dort eine Route ausgeht
  let weitester = 0;
  let anzahlMachbar = 0;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const dN = i * schritt; const dE = j * schritt;
      const dist = Math.hypot(dN, dE);
      if (dist > radius) continue;
      const la = sLat + dN / mLat;
      const lo = sLon + dE / mLon;
      const k = netz.naechster(la, lo, modus);
      if (!k || k.abstand_m > MAX_ABSTAND_M) continue;
      const bk = besterKnoten(netz, r, k.knoten);
      const machbar = r.dist[bk] <= budget;
      if (!machbar && !(r.dist[bk] <= grenzeSuche)) continue; // weit außerhalb: nicht anzeigen
      schritte.push([Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5, machbar ? 1 : 0]);
      if (machbar) {
        ziele.set(bk, true);
        anzahlMachbar++;
        if (dist > weitester) weitester = dist;
      }
    }
  }

  // Linien: der Baum-Pfad zu jedem erreichbaren Ziel, jeder Abschnitt nur einmal
  const linien = baumLinien(netz, r, ziele, budget);
  if (!linien.length) return { fehler: ['kein_weg_in_naehe'] };
  const raster = heatmapAusLinien(linien);

  let knoten = 0;
  for (let i = 0; i < netz.N; i++) if (Number.isFinite(r.dist[i])) knoten++;

  return {
    ok: true,
    start: { lat: sLat, lon: sLon, abstand_m: Math.round(snap.abstand_m) },
    budget: zeit ? { art: 'zeit', wert: Math.round(budget / 360) / 10, einheit: 'h' } : { art: 'akku', wert: Math.round(budget), einheit: 'Wh' },
    schritte,
    linien,
    raster,
    kennzahlen: {
      weitester_km: Math.round(weitester / 100) / 10,
      punkte_machbar: anzahlMachbar,
      punkte_gesamt: schritte.length,
      schrittweite_m: Math.round(schritt),
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
function baumLinien(netz, r, ziele, budget) {
  const besucht = new Uint8Array(netz.N);
  const linien = [];
  for (const z of ziele.keys()) {
    let k = z;
    while (k >= 0 && !besucht[k]) {
      besucht[k] = 1;
      const u = r.vorgaenger[k];
      if (u < 0) break;
      const anteil = Math.min(r.dist[k] / budget, CAP);
      linien.push([
        Math.round(netz.lat(k) * 1e5) / 1e5, Math.round(netz.lon(k) * 1e5) / 1e5,
        Math.round(netz.lat(u) * 1e5) / 1e5, Math.round(netz.lon(u) * 1e5) / 1e5,
        Math.round(anteil * 1000) / 1000
      ]);
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
  // Zeile 0 liegt im Süden
  const daten = new Uint8Array(nx * ny).fill(254);
  for (let i = 0; i < wert.length; i++) if (wert[i] !== Infinity) daten[i] = Math.round(Math.min(wert[i], CAP) / CAP * 254);
  return { lat0: minLa, lon0: minLo, dLat, dLon, nx, ny, max: CAP, daten: Buffer.from(daten).toString('base64') };
}
