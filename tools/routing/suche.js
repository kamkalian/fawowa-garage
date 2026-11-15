// Reichweitensuche nach Energie: wie weit kommt das Beispiel-Gespann vom Startpunkt aus, bis der nutzbare Akku leer ist?
//
// Aufruf:
//   node tools/routing/suche.js <Netzordner> <Ort> [--modus alle|strasse|ruhig|radweg] [--set einstellung=wert ...] [--name x] [--wiederholen n]
// <Ort>: Name aus orte.js oder "Breite,Länge". Ergebnis: Kennzahlen auf dem Bildschirm und <Netzordner>/../ergebnisse/<name>.json für die Anzeige.
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { Netz, MODI } from '../../lib/netz.js';
import { ort } from './orte.js';
import { baueModell, pruefeEinstellungen } from '../../lib/rechenmodell.js';

const args = process.argv.slice(2);
const netzOrdner = args.shift();
const ortText = args.shift();
const opt = { modus: 'alle', set: {}, name: null, wiederholen: 1 };
while (args.length) {
  const a = args.shift();
  if (a === '--modus') opt.modus = args.shift();
  else if (a === '--set') { const [k, v] = args.shift().split('='); opt.set[k] = isNaN(Number(v)) ? v : Number(v); }
  else if (a === '--name') opt.name = args.shift();
  else if (a === '--wiederholen') opt.wiederholen = Number(args.shift());
  else throw new Error(`Unbekannte Option ${a}`);
}
if (!netzOrdner || !ortText || !MODI[opt.modus]) {
  console.error('Aufruf: node tools/routing/suche.js <Netzordner> <Ort> [--modus alle|strasse|ruhig|radweg] [--set einstellung=wert ...] [--name x] [--wiederholen n]');
  process.exit(1);
}

// Beispiel-Gespann (wie in scripts/rechenmodell-demo.js)
const fahrrad = { motor_art: 'mittelmotor', motor_nennleistung_w: 250, akku_kapazitaet_wh: 625, schaltung_art: 'kette', radgroesse_zoll: 26, reifenbreite_mm: 50, gewicht_kg: 30 };
const anhaenger = { leergewicht_kg: 60, breite_cm: 80, hoehe_cm: 110, radgroesse_zoll: 20, reifenbreite_mm: 40, solar_wp: 100 };
const gespann = { fahrer_gewicht_kg: 80, gepaeck_kg: 40 };

const einst = pruefeEinstellungen(opt.set);
if (einst.fehler) { console.error('Ungültige Einstellungen:', einst.fehler); process.exit(1); }
const { modell, fehler } = baueModell(fahrrad, anhaenger, gespann, opt.set);
if (fehler.length) { console.error('Modell:', fehler); process.exit(1); }

const t0 = Date.now();
const netz = new Netz(netzOrdner);
const ramGeladen = process.memoryUsage().rss / 1048576;
const ladeMs = Date.now() - t0;

const [lat, lon] = ort(ortText);
const start = netz.naechster(lat, lon, MODI[opt.modus]);
if (!start) { console.error('Kein Weg in der Nähe des Startpunkts.'); process.exit(1); }

let r; const zeiten = [];
for (let i = 0; i < opt.wiederholen; i++) {
  const t1 = process.hrtime.bigint();
  r = netz.reichweite(modell, start.knoten, opt.modus);
  zeiten.push(Number(process.hrtime.bigint() - t1) / 1e6);
}

// Ergebnisse auswerten: erreichte Knoten, Fläche, Entfernung je Himmelsrichtung, Raster für die Anzeige
const R = 6371000; const rad = Math.PI / 180;
const sLat = netz.lat(start.knoten); const sLon = netz.lon(start.knoten);
let erreicht = 0;
const sektoren = new Array(72).fill(0);
const sektorKnoten = new Array(72).fill(-1);
const ZELLE = 0.004;
const raster = new Map();
let maxWh = 0;
for (let i = 0; i < netz.N; i++) {
  const d = r.dist[i];
  if (!Number.isFinite(d)) continue;
  erreicht++;
  const la = netz.lat(i); const lo = netz.lon(i);
  const dy = (la - sLat) * 110574; const dx = (lo - sLon) * 111320 * Math.cos(sLat * rad);
  const dm = Math.hypot(dx, dy);
  let b = Math.atan2(dx, dy) / rad; if (b < 0) b += 360;
  const s = Math.floor(b / 5) % 72;
  if (dm > sektoren[s]) { sektoren[s] = dm; sektorKnoten[s] = i; }
  const key = Math.floor(la / ZELLE) * 100000 + Math.floor(lo / ZELLE);
  const z = raster.get(key);
  if (z === undefined || d < z[2]) raster.set(key, [Math.floor(la / ZELLE) * ZELLE, Math.floor(lo / ZELLE) * ZELLE, d]);
  if (d > maxWh) maxWh = d;
}
// Fläche des sternförmigen Rands (Summe der Dreiecke um den Start)
let flaecheKm2 = 0;
for (let s = 0; s < 72; s++) { const a = sektoren[s] / 1000; const b = sektoren[(s + 1) % 72] / 1000; flaecheKm2 += 0.5 * a * b * Math.sin(5 * rad); }
const rand = sektoren.map((m, s) => (sektorKnoten[s] < 0 ? null : [netz.lat(sektorKnoten[s]), netz.lon(sektorKnoten[s])]));

const sortiert = [...zeiten].sort((a, b) => a - b);
const kennzahlen = {
  modus: opt.modus, einstellungen: einst.werte, start: { ort: ortText, lat: sLat, lon: sLon, abstandZumWeg_m: Math.round(start.abstand_m) },
  budgetWh: +r.grenze.toFixed(1), erreichteKnoten: erreicht, besuchteKnoten: r.besucht, geprueft: r.kanten,
  flaecheKm2: Math.round(flaecheKm2), weitesteKm: +(Math.max(...sektoren) / 1000).toFixed(1), kuerzesteKm: +(Math.min(...sektoren) / 1000).toFixed(1),
  suchzeitMs: { median: +sortiert[Math.floor(sortiert.length / 2)].toFixed(0), min: +sortiert[0].toFixed(0), max: +sortiert[sortiert.length - 1].toFixed(0), wiederholungen: zeiten.length },
  ramGeladenMB: +ramGeladen.toFixed(0), ramNachSucheMB: +(process.memoryUsage().rss / 1048576).toFixed(0), ladezeitMs: ladeMs
};
console.log(JSON.stringify(kennzahlen, null, 2));

const name = opt.name ?? `${ortText.replace(/[^a-z0-9_]/gi, '_')}-${opt.modus}`;
const ausgabe = join(dirname(netzOrdner), 'ergebnisse');
mkdirSync(ausgabe, { recursive: true });
writeFileSync(join(ausgabe, `${name}.json`), JSON.stringify({ ...kennzahlen, zelle: ZELLE, maxWh, rand, zellen: [...raster.values()] }));
console.log(`Gespeichert: ${join(ausgabe, name + '.json')}`);
