// Baut die Karten- und Wegedaten für den Reichweiten-Planer auf deinem Rechner und packt sie in eine ZIP-Datei.
// Die ZIP-Datei lädst du danach in der Verwaltung hoch (Reiter „Kartendaten“).
//
// Start (im Projektordner):   npm run daten
// Optionen:                   node scripts/daten-bauen.mjs --ordner ./daten --neu
//   --ordner  Arbeitsordner (Standard: ./daten). Downloads und Zwischenergebnisse liegen dort.
//   --neu     Karte und Wegenetz neu bauen, auch wenn schon vorhanden. Downloads werden nur bei neuen Daten erneuert.
//
// Ablauf: 1. Kartendaten Deutschland (OpenStreetMap)  2. Höhendaten (SRTM)  3. Wegenetz  4. Karte  5. ZIP-Datei.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, createWriteStream, createReadStream, readdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import https from 'https';
import { createRequire } from 'module';
import { KARTEN_URL, HOEHEN_URL, HOEHEN_LAT, HOEHEN_LON, hoehenName } from '../lib/datenquellen.js';

const require = createRequire(import.meta.url);
const archiver = require('archiver');

const hier = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(hier, '..');

const argumente = process.argv.slice(2);
const neu = argumente.includes('--neu');
const ordnerArg = argumente.indexOf('--ordner');
const ARBEIT = resolve(ordnerArg >= 0 ? argumente[ordnerArg + 1] : join(ROOT, 'daten'));
const ROH = join(ARBEIT, 'roh');
const HOEHEN = join(ARBEIT, 'hoehen');
const NETZ = join(ARBEIT, 'netz');
const PBF = join(ROH, 'germany-latest.osm.pbf');
const START = Date.now();

const zeit = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`;
};
const mb = (b) => `${(b / 1048576).toFixed(0)} MB`;
const schritt = (nr, text) => console.log(`\n[${nr}/5] ${text}`);
const balken = (anteil, breite = 30) => {
  const n = Math.max(0, Math.min(breite, Math.round(anteil * breite)));
  return `[${'█'.repeat(n)}${'░'.repeat(breite - n)}] ${String(Math.round(anteil * 100)).padStart(3)} %`;
};
/** Zeile auf dem Bildschirm überschreiben (für Fortschrittsanzeigen) */
const zeile = (text) => process.stdout.write(`\r${text}`.padEnd(100) + (process.stdout.isTTY ? '' : '\n'));

/** Adresse abrufen (Weiterleitungen folgen); liefert Antwort-Objekt mit Kopfzeilen */
function anfrage(url, methode = 'GET', weiter = 0) {
  return new Promise((aufloesen, ablehnen) => {
    if (weiter > 5) return ablehnen(new Error('Zu viele Weiterleitungen'));
    https.request(url, { method: methode }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return anfrage(new URL(res.headers.location, url).href, methode, weiter + 1).then(aufloesen, ablehnen);
      }
      aufloesen(res);
    }).on('error', ablehnen).end();
  });
}

/**
 * Datei laden, wenn sie fehlt oder der Anbieter eine neuere Fassung hat. Gibt { geladen: true|false, fehlt } zurück.
 * optional: 404 gilt als „es gibt hier keine Daten“ (z. B. Meer bei den Höhendaten).
 */
async function laden(url, ziel, { optional = false, zeigeName = '' } = {}) {
  const stand = `${ziel}.stand.json`;
  const altStand = existsSync(stand) ? JSON.parse(readFileSync(stand, 'utf8')) : null;
  if (existsSync(ziel) && !neu && altStand) {
    // Kopfzeile prüfen: nur neu laden, wenn der Anbieter einen jüngeren Stand hat
    const kopf = await anfrage(url, 'HEAD');
    kopf.resume();
    const neuer = kopf.headers['last-modified'] && altStand.last_modified && new Date(kopf.headers['last-modified']) > new Date(altStand.last_modified);
    if (kopf.statusCode === 200 && !neuer) return { geladen: false };
    if (kopf.statusCode !== 200 && kopf.statusCode !== 404) return { geladen: false };
  }

  const res = await anfrage(url);
  if (res.statusCode === 404 && optional) { res.resume(); return { fehlt: true }; }
  if (res.statusCode !== 200) { res.resume(); throw new Error(`Download fehlgeschlagen (HTTP ${res.statusCode}): ${url}`); }

  const gesamt = Number(res.headers['content-length']) || 0;
  let geladen = 0;
  let letzte = 0;
  mkdirSync(dirname(ziel), { recursive: true });
  const datei = createWriteStream(ziel + '.teil');
  res.on('data', (buf) => {
    geladen += buf.length;
    if (Date.now() - letzte > 500 && gesamt) { letzte = Date.now(); zeile(`  ${zeigeName} ${balken(geladen / gesamt)} ${mb(geladen)} von ${mb(gesamt)}`); }
  });
  await new Promise((aufloesen, ablehnen) => { res.pipe(datei); datei.on('finish', aufloesen); datei.on('error', ablehnen); res.on('error', ablehnen); });
  renameSync(ziel + '.teil', ziel);
  writeFileSync(stand, JSON.stringify({ quelle: url, last_modified: res.headers['last-modified'] ?? null, geladen_am: new Date().toISOString() }, null, 2));
  if (gesamt) zeile(`  ${zeigeName} ${balken(1)} ${mb(geladen)}`);
  console.log('');
  return { geladen: true };
}

/** Ein Bau-Programm starten; die Zeilen „FORTSCHRITT n“ werden als Fortschrittsanzeige gezeigt, sonst Text */
function bauen(skript, argumente, { fortschritt = false } = {}) {
  return new Promise((aufloesen, ablehnen) => {
    const p = spawn(process.execPath, [join(ROOT, skript), ...argumente], { stdio: ['ignore', 'pipe', 'pipe'] });
    let letzte = '';
    const verarbeiten = (buf) => {
      for (const t of buf.toString().split(/\r?\n/)) {
        const s = t.trim();
        if (!s) continue;
        const m = /^FORTSCHRITT (\d+)$/.exec(s);
        if (m && fortschritt) { zeile(`  ${balken(Number(m[1]) / 100)} ${zeit(Date.now() - START)}`); continue; }
        letzte = s;
        console.log(`\n  ${s}`);
      }
    };
    p.stdout.on('data', verarbeiten);
    p.stderr.on('data', verarbeiten);
    // Solange das Programm rechnet, zeigt die Zeile die verstrichene Zeit
    const uhr = setInterval(() => { if (!fortschritt) zeile(`  läuft ... ${zeit(Date.now() - START)}`); }, 1000);
    p.on('error', (e) => { clearInterval(uhr); ablehnen(e); });
    p.on('exit', (code) => {
      clearInterval(uhr);
      console.log('');
      if (code === 0) aufloesen(letzte);
      else ablehnen(new Error(`${skript} endete mit Code ${code}: ${letzte}`));
    });
  });
}

/** Alle Dateien des Netzordners in eine ZIP-Datei; Fortschritt nach Bytes */
function zippen(ordner, ziel) {
  return new Promise((aufloesen, ablehnen) => {
    mkdirSync(dirname(ziel), { recursive: true });
    const ausgabe = createWriteStream(ziel + '.teil');
    const archiv = archiver('zip', { zlib: { level: 6 }, zip64: true });
    archiv.on('progress', (p) => zeile(`  packen ${balken(p.fs.processedBytes / Math.max(1, p.fs.totalBytes || p.fs.processedBytes))} ${mb(p.fs.processedBytes)}`));
    archiv.on('error', ablehnen);
    ausgabe.on('close', () => { renameSync(ziel + '.teil', ziel); console.log(''); aufloesen(); });
    archiv.pipe(ausgabe);
    archiv.directory(ordner, false);
    archiv.finalize();
  });
}

async function main() {
  console.log(`FaWoWa-Garage: Karten- und Wegedaten bauen`);
  console.log(`Arbeitsordner: ${ARBEIT}${neu ? ' (neu bauen)' : ''}`);

  // 1. Kartendaten
  schritt(1, 'Kartendaten Deutschland laden (OpenStreetMap, ca. 5 GB)');
  const pbf = await laden(KARTEN_URL, PBF, { zeigeName: 'Kartendaten' });
  console.log(pbf.geladen ? '  fertig.' : '  schon vorhanden und aktuell.');

  // 2. Höhendaten
  schritt(2, 'Höhendaten laden (SRTM, Deutschland)');
  const namen = [];
  for (let lat = HOEHEN_LAT[0]; lat <= HOEHEN_LAT[1]; lat++) for (let lon = HOEHEN_LON[0]; lon <= HOEHEN_LON[1]; lon++) namen.push(hoehenName(lat, lon));
  let neuGeladen = 0;
  for (let i = 0; i < namen.length; i++) {
    const name = namen[i];
    const e = await laden(`${HOEHEN_URL}/${name.slice(0, 3)}/${name}.hgt.gz`, join(HOEHEN), { optional: true, zeigeName: '' }).catch(() => ({}));
    if (e.geladen) neuGeladen++;
    zeile(`  Kachel ${i + 1} von ${namen.length} ${balken((i + 1) / namen.length)}`);
  }
  console.log(`\n  ${neuGeladen} Kacheln neu geladen.`);

  // 3. Wegenetz (das Programm zum Netzbau schreibt zugleich die Ausdehnung in info.json)
  schritt(3, 'Wegenetz bauen (dauert länger, braucht viel Arbeitsspeicher)');
  mkdirSync(NETZ, { recursive: true });
  await bauen('tools/routing/bauen.js', [PBF, HOEHEN, NETZ]);

  // 4. Karte
  schritt(4, 'Karte bauen');
  await bauen('tools/routing/karte-bauen.js', [PBF, NETZ], { fortschritt: true });

  // 5. ZIP-Datei
  schritt(5, 'ZIP-Datei packen');
  const datum = new Date().toISOString().slice(0, 10);
  const zip = join(ARBEIT, `garage-netz-${datum}.zip`);
  await zippen(NETZ, zip);
  const groesse = statSync(zip).size;
  console.log(`\nFertig nach ${zeit(Date.now() - START)}.`);
  console.log(`Datei: ${zip} (${mb(groesse)})`);
  console.log('Hochladen: Verwaltung → Reiter „Kartendaten“ → „ZIP hochladen“.');
}

main().catch((e) => {
  console.error(`\nFehler: ${e.message}`);
  process.exit(1);
});
