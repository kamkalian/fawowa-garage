// Reichweiten-Planer: vom Start aus werden in 36 Richtungen (alle 10°) Routen gerechnet. Die Route geht in 1-km-Schritten weiter, bis
// der Akku leer ist oder die Fahrtzeit abgelaufen ist. Aus den Routen entsteht eine Heatmap über die Linien.
// Läuft im Hintergrund-Thread (lib/routing-dienst.js).

import { baueModell, pruefeEinstellungen } from './rechenmodell.js';
import { MODI } from './netz.js';

export const MODUS_NAMEN = Object.freeze(['alle', 'strasse', 'ruhig']);
export { pruefeEinstellungen };

const RICHTUNGEN = 36;        // alle 10°
const SCHRITT_M = 1000;       // Schritte entlang der Richtung
const MAX_KM = 300;           // höchstens so weit
const MAX_ABSTAND_M = 1500;   // ein Punkt, der weiter als das von einem Knoten entfernt ist, zählt nicht als erreicht
const D_LAT = 0.0015;         // Rasterzelle für die Heatmap in Grad (etwa 165 m); wird bei großen Routen größer
const D_LON = 0.0024;
const CAP = 1.5;              // höchster Wert im Raster
const PAD = 0.01;             // Rand um die Routen (Grad)
const MAX_ZELLEN = 1200;      // höchstens so viele Zellen je Seite
const DUENN_M = 120;          // Punkte entlang der Route, die näher als das aneinander liegen, werden weggelassen
const MAX_ABSTAND_STARTWEG_M = 2000;
const RAD = Math.PI / 180;

/**
 * eingabe: { fahrrad, anhaenger, gespann, einstellungen, start: { lat, lon }, modus }
 * Ergebnis bei Erfolg: { ok: true, start, budget, routen, raster, kennzahlen, modell, annahmen, einstellungen, modus }
 *   routen: [{ winkel, km, verbrauch, pfad: [[lat, lon, anteil], ...] }]; anteil = Verbrauch bis dorthin / Budget (1 = leer)
 *   raster: Heatmap aus den Linien (base64, ein Byte je Zelle, Wert = byte / 254 × max; leer = 254)
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

  // Eine einzige Suche vom Start aus liefert für alle Richtungen den Verbrauch bzw. die Zeit bis zu jedem Knoten
  const r = netz.reichweite(modell, snap.knoten, modusName);
  const budget = r.grenze;
  const sLat = netz.lat(snap.knoten);
  const sLon = netz.lon(snap.knoten);
  const cosS = Math.cos(sLat * RAD);

  const routen = [];
  let weitester = 0;
  let summeKm = 0;
  for (let i = 0; i < RICHTUNGEN; i++) {
    const kurs = i * 360 / RICHTUNGEN * RAD;
    // Jeder Kilometerschritt wird geprüft (auch über Flüsse und Gebiete ohne Weg hinweg). Ist ein Schritt nicht machbar, endet die
    // Route nicht dort, sondern an der Grenze des Budgets auf dem Weg dorthin. Die Route mit dem weitesten Endpunkt bleibt.
    let best = -1;
    let bestM = 0;
    const schritte = [];
    for (let k = 1; k <= MAX_KM; k++) {
      const la = sLat + (k * SCHRITT_M * Math.cos(kurs)) / 110574;
      const lo = sLon + (k * SCHRITT_M * Math.sin(kurs)) / (111320 * cosS);
      const n = netz.naechster(la, lo, modus);
      if (!n || n.abstand_m > MAX_ABSTAND_M) continue;
      const machbar = r.dist[n.knoten] <= budget;
      schritte.push([Math.round(netz.lat(n.knoten) * 1e5) / 1e5, Math.round(netz.lon(n.knoten) * 1e5) / 1e5, machbar ? 1 : 0]);
      const ende = machbar ? n.knoten : grenzPunkt(r, n.knoten, budget);
      if (ende < 0) continue;
      const m = Math.hypot((netz.lat(ende) - sLat) * 110574, (netz.lon(ende) - sLon) * 111320 * cosS);
      if (m > bestM) { bestM = m; best = ende; }
    }
    const pfad = best >= 0 ? wegZurueck(netz, r, best, snap.knoten, budget) : [];
    const km = Math.round(bestM / 100) / 10;
    routen.push({ winkel: i * 360 / RICHTUNGEN, km, verbrauch: best >= 0 ? Math.round(r.dist[best]) : 0, pfad, schritte });
    if (km > weitester) weitester = km;
    summeKm += km;
  }
  if (summeKm === 0) return { fehler: ['kein_weg_in_naehe'] };

  const raster = heatmapAusLinien(routen);
  let knoten = 0;
  for (let i = 0; i < netz.N; i++) if (Number.isFinite(r.dist[i])) knoten++;

  return {
    ok: true,
    start: { lat: sLat, lon: sLon, abstand_m: Math.round(snap.abstand_m) },
    budget: zeit ? { art: 'zeit', wert: Math.round(budget / 360) / 10, einheit: 'h' } : { art: 'akku', wert: Math.round(budget), einheit: 'Wh' },
    routen,
    raster,
    kennzahlen: { weitester_km: weitester, mittel_km: Math.round(summeKm / RICHTUNGEN * 10) / 10, richtungen: RICHTUNGEN, knoten, ms: Date.now() - t0 },
    modell: { masse_kg: modell.masse_kg, kapazitaet_wh: modell.akku.kapazitaet_wh, nutzbar_wh: modell.akku.nutzbar_wh, fahrtzeit_h: einst.fahrtzeit_h },
    annahmen, einstellungen: einst, modus: modusName
  };
}

/**
 * Auf dem Weg vom Start zu knoten: der letzte Knoten, der noch im Budget liegt (die Grenze des Budgets). -1, wenn es keinen gibt.
 */
function grenzPunkt(r, knoten, budget) {
  let k = knoten;
  while (k >= 0 && !(r.dist[k] <= budget)) k = r.vorgaenger[k];
  return k;
}

/** Weg vom Start zum Ziel über den Suchbaum; Punkte [lat, lon, Anteil des Budgets], zu dünne Punkte weggelassen */
function wegZurueck(netz, r, ziel, start, budget) {
  const knoten = [];
  for (let k = ziel; k !== start && k >= 0; k = r.vorgaenger[k]) knoten.push(k);
  knoten.push(start);
  knoten.reverse();
  const pfad = [];
  let letzt = null;
  for (let i = 0; i < knoten.length; i++) {
    const k = knoten[i];
    const la = netz.lat(k); const lo = netz.lon(k);
    const ende = i === knoten.length - 1;
    if (letzt && !ende && Math.hypot((la - letzt[0]) * 111000, (lo - letzt[1]) * 111000 * 0.63) < DUENN_M) continue;
    pfad.push([Math.round(la * 1e5) / 1e5, Math.round(lo * 1e5) / 1e5, Math.round(Math.min(r.dist[k] / budget, CAP) * 1000) / 1000]);
    letzt = [la, lo];
  }
  return pfad;
}

/**
 * Heatmap aus den Routenlinien: die Zellen entlang einer Route bekommen den Anteil des Budgets an dieser Stelle (der kleinste,
 * wenn sich Routen kreuzen). Ohne Linie bleibt die Zelle leer (254).
 */
function heatmapAusLinien(routen) {
  const punkte = routen.flatMap((rt) => rt.pfad);
  if (!punkte.length) return null;
  let minLa = Infinity; let maxLa = -Infinity; let minLo = Infinity; let maxLo = -Infinity;
  for (const [la, lo] of punkte) { if (la < minLa) minLa = la; if (la > maxLa) maxLa = la; if (lo < minLo) minLo = lo; if (lo > maxLo) maxLo = lo; }
  minLa -= PAD; maxLa += PAD; minLo -= PAD; maxLo += PAD;
  // Zellgröße: so fein wie möglich, aber nie mehr als MAX_ZELLEN je Seite
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
  for (const rt of routen) {
    const p = rt.pfad;
    if (p.length === 1) setze(p[0][0], p[0][1], p[0][2]);
    for (let i = 1; i < p.length; i++) {
      const [la0, lo0, f0] = p[i - 1]; const [la1, lo1, f1] = p[i];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(la1 - la0) / (dLat / 2), Math.abs(lo1 - lo0) / (dLon / 2))));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        setze(la0 + (la1 - la0) * t, lo0 + (lo1 - lo0) * t, f0 + (f1 - f0) * t);
      }
    }
  }
  // Zeile 0 liegt im Süden
  const daten = new Uint8Array(nx * ny).fill(254);
  for (let i = 0; i < wert.length; i++) if (wert[i] !== Infinity) daten[i] = Math.round(Math.min(wert[i], CAP) / CAP * 254);
  return { lat0: minLa, lon0: minLo, dLat, dLon, nx, ny, max: CAP, daten: Buffer.from(daten).toString('base64') };
}
