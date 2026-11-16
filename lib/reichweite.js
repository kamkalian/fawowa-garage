// Reichweiten-Rechnung für die Karte: Gespann und Einstellungen -> Rechenmodell -> Suche im Wegenetz -> Wärmekarte (Raster).
// Die Werte im Raster sind der Anteil des Budgets (Akku in Wh oder Fahrtzeit in s), 1 = Grenze. Über 1 folgt ein grauer Rand, der auslaufen
// soll; die Werte sind geglättet, damit der Verlauf ohne Zacken aussieht. Läuft im Hintergrund-Thread (lib/routing-dienst.js).

import { baueModell, pruefeEinstellungen } from './rechenmodell.js';
import { MODI, GRENZ_FAKTOR } from './netz.js';

export const MODUS_NAMEN = Object.freeze(['alle', 'strasse', 'ruhig']);
export { pruefeEinstellungen };

const D_LAT = 0.0015;     // Zellgröße des Rasters in Grad (etwa 165 m)
const D_LON = 0.0024;
const CAP = 1.5;            // höchster Wert im Raster (darüber ist nichts mehr zu sehen)
const RADIUS = 2;           // Glättung: zweimal ein Mittel über 5 Zellen
const PAD = 4;              // Rand um die erreichten Zellen, damit die Glättung nicht abgeschnitten wird
const RAND_LAT = 0.03;      // Rand um die erreichten Knoten im Raster
const RAND_LON = 0.05;
const MAX_ABSTAND_STARTWEG_M = 2000;
const RAD = Math.PI / 180;

/**
 * eingabe: { fahrrad, anhaenger, gespann, einstellungen, start: { lat, lon }, modus }
 * Ergebnis bei Erfolg: { ok: true, start, budget: { art, wert, einheit }, raster: { lat0, lon0, dLat, dLon, nx, ny, max, daten }, kennzahlen, modell, annahmen, einstellungen, modus }
 * raster.daten: base64, ein Byte je Zelle (Zeile 0 = Süden); Wert = byte / 254 × max.
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

  const r = netz.reichweite(modell, snap.knoten, modusName);
  const budget = r.grenze;
  const feld = r.feld;
  const sLat = netz.lat(snap.knoten);
  const sLon = netz.lon(snap.knoten);
  const cosS = Math.cos(sLat * RAD);

  let knoten = 0;
  let weitesterM = 0;
  let minLat = Infinity; let maxLat = -Infinity; let minLon = Infinity; let maxLon = -Infinity;
  for (let i = 0; i < netz.N; i++) {
    if (!Number.isFinite(r.dist[i])) continue;
    knoten++;
    const la = netz.lat(i); const lo = netz.lon(i);
    if (la < minLat) minLat = la; if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo; if (lo > maxLon) maxLon = lo;
    const dm = Math.hypot((la - sLat) * 110574, (lo - sLon) * 111320 * cosS);
    if (dm > weitesterM) weitesterM = dm;
  }

  // Raster: je Zelle der kleinste Anteil aus Knoten und Punkten entlang der Kanten, die der Akku oder die Zeit noch schafft
  const lat0 = Math.floor((minLat - RAND_LAT) / D_LAT) * D_LAT;
  const lon0 = Math.floor((minLon - RAND_LON) / D_LON) * D_LON;
  const ny = Math.floor((maxLat + RAND_LAT - lat0) / D_LAT) + 1;
  const nx = Math.floor((maxLon + RAND_LON - lon0) / D_LON) + 1;
  const v = new Float32Array(nx * ny).fill(Infinity);
  const setze = (la, lo, f) => {
    const zy = Math.floor((la - lat0) / D_LAT);
    const zx = Math.floor((lo - lon0) / D_LON);
    if (zx < 0 || zy < 0 || zx >= nx || zy >= ny) return;
    const i = zy * nx + zx;
    if (f < v[i]) v[i] = f;
  };
  for (let i = 0; i < netz.N; i++) if (Number.isFinite(r.dist[i])) setze(netz.lat(i), netz.lon(i), r.dist[i] / budget);
  for (let e = 0; e < netz.E; e++) {
    const flags = netz.kFlags[e];
    if (!modus[flags]) continue;
    const a = netz.kA[e]; const bk = netz.kB[e];
    const da = r.dist[a]; const db = r.dist[bk];
    const aE = Number.isFinite(da); const bE = Number.isFinite(db);
    if (!aE && !bE) continue;
    const aLat = netz.lat(a); const aLon = netz.lon(a); const bLat = netz.lat(bk); const bLon = netz.lon(bk);
    const laengeM = Math.hypot((bLat - aLat) * 110574, (bLon - aLon) * 111320 * cosS);
    if (laengeM < 200 && aE && bE) continue;
    const eAb = (flags & 1) ? netz.kantenKosten(r.tab, e, 0, feld) : Infinity;
    const eBa = (flags & 2) ? netz.kantenKosten(r.tab, e, 1, feld) : Infinity;
    const schritte = Math.max(1, Math.ceil(laengeM / 150));
    for (let k = 1; k < schritte; k++) {
      const t = k / schritte;
      let kosten = Infinity;
      if (aE && eAb !== Infinity) kosten = da + t * eAb;
      if (bE && eBa !== Infinity) kosten = Math.min(kosten, db + (1 - t) * eBa);
      if (kosten <= budget * GRENZ_FAKTOR) setze(aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t, kosten / budget);
    }
  }

  // Keine Erweiterung um eine Zelle: nur Zellen mit erreichbarer Straße werden gefärbt (sonst färbt sich der Rhein mit)
  for (let i = 0; i < v.length; i++) v[i] = v[i] === Infinity ? CAP : Math.min(v[i], CAP);

  // Auf die erreichten Zellen zuschneiden, mit Rand
  let x0 = nx; let x1 = -1; let y0 = ny; let y1 = -1;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (v[y * nx + x] < CAP) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { fehler: ['kein_weg_in_naehe'] };
  const cx0 = Math.max(0, x0 - PAD); const cx1 = Math.min(nx - 1, x1 + PAD);
  const cy0 = Math.max(0, y0 - PAD); const cy1 = Math.min(ny - 1, y1 + PAD);
  const cnx = cx1 - cx0 + 1; const cny = cy1 - cy0 + 1;
  const roh = new Float32Array(cnx * cny);
  for (let y = 0; y < cny; y++) for (let x = 0; x < cnx; x++) roh[y * cnx + x] = v[(y + cy0) * nx + x + cx0];

  let zellen = 0;
  for (let i = 0; i < roh.length; i++) if (roh[i] <= 1) zellen++;
  const zellFlaecheKm2 = (D_LAT * 110574) * (D_LON * 111320 * cosS) / 1e6;

  const glatt = weichzeichnen(roh, cnx, cny, RADIUS, CAP);
  const daten = new Uint8Array(cnx * cny);
  for (let i = 0; i < glatt.length; i++) daten[i] = Math.round(Math.min(Math.max(glatt[i], 0), CAP) / CAP * 254);

  return {
    ok: true,
    start: { lat: sLat, lon: sLon, abstand_m: Math.round(snap.abstand_m) },
    budget: zeit ? { art: 'zeit', wert: Math.round(budget / 360) / 10, einheit: 'h' } : { art: 'akku', wert: Math.round(budget), einheit: 'Wh' },
    raster: {
      lat0: lat0 + cy0 * D_LAT, lon0: lon0 + cx0 * D_LON, dLat: D_LAT, dLon: D_LON, nx: cnx, ny: cny, max: CAP,
      daten: Buffer.from(daten).toString('base64')
    },
    kennzahlen: { flaeche_km2: Math.round(zellen * zellFlaecheKm2), weitester_km: Math.round(weitesterM / 100) / 10, knoten, ms: Date.now() - t0 },
    modell: { masse_kg: modell.masse_kg, kapazitaet_wh: modell.akku.kapazitaet_wh, nutzbar_wh: modell.akku.nutzbar_wh, fahrtzeit_h: einst.fahrtzeit_h },
    annahmen, einstellungen: einst, modus: modusName
  };
}

/**
 * Weichzeichnen nur über erreichte Zellen (normiertes Mittel): die Glättung zieht keine Farbe in Zellen ohne Information.
 * Zellen ohne Erreichbarkeit bleiben leer; die Kante der Fläche ist hart und verschwimmt nicht.
 */
function weichzeichnen(f, w, h, r, leer) {
  const m = new Float32Array(w * h);
  const fm = new Float32Array(w * h);
  for (let i = 0; i < f.length; i++) if (f[i] < leer) { m[i] = 1; fm[i] = f[i]; }
  const summe = glaette(fm, w, h, r);
  const anteil = glaette(m, w, h, r);
  const out = new Float32Array(w * h);
  // Harte Kante: nur erreichte Zellen werden gefärbt, die Glättung wirkt nicht darüber hinaus (Gebiete ohne Straße bleiben leer)
  for (let i = 0; i < out.length; i++) out[i] = f[i] < leer && anteil[i] > 0 ? summe[i] / anteil[i] : leer;
  return out;
}

/** Gleitendes Mittel über (2r+1) Zellen, zweimal in x und y; am Rand wird der Randwert wiederholt */
function glaette(f, w, h, r) {
  let a = f;
  for (let durchgang = 0; durchgang < 2; durchgang++) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[y * w + Math.min(w - 1, Math.max(0, x + k))];
        tmp[y * w + x] = s / (2 * r + 1);
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
        out[y * w + x] = s / (2 * r + 1);
      }
    }
    a = out;
  }
  return a;
}
