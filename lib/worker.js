// Garage-Worker: eigener Dienst (eigener Container). Er arbeitet die Job-Warteschlange nacheinander ab:
// Download der Kartendaten und Höhendaten, Kartenbau, Netzbau, Reichweiten-Berechnung und Kachel-Erzeugung.
// Das Wegenetz wird nur einmal in diesem Prozess geladen (kein zweites Exemplar), ein Netzbau lädt es neu.
// Zu jedem Download und Bau legt der Worker eine Stand-Datei (stand.json) ab, damit die Verwaltung den Stand zeigen kann.
import { existsSync, mkdirSync, renameSync, readdirSync, rmSync, createWriteStream, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import https from 'https';
import { fileURLToPath } from 'url';
import { erstellePool, warteAufDatenbank } from './db.js';
import { Jobs } from './jobs.js';
import { Netz } from './netz.js';
import { rechneReichweite } from './reichweite.js';
import { kachelKarte, KarteBasis } from './karte-daten.js';
import { KachelJob } from './kachel-job.js';
import { hoehenName, HOEHEN_URL, HOEHEN_LAT, HOEHEN_LON, KARTEN_URL, STAND_DATEI } from './datenquellen.js';

const hier = dirname(fileURLToPath(import.meta.url));
const ROOT = join(hier, '..');
const NETZ_DIR = process.env.NETZ_DIR || join(ROOT, 'data', 'netz');
const ROH_DIR = process.env.ROH_DIR || join(dirname(NETZ_DIR), 'roh');
const HOEHEN_DIR = process.env.HOEHEN_DIR || join(dirname(NETZ_DIR), 'hoehen');
const KACHEL_DIR = process.env.KACHEL_DIR || join(dirname(NETZ_DIR), 'kacheln');
const PBF_DATEI = join(ROH_DIR, 'germany-latest.osm.pbf');

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const pool = erstellePool();
const jobs = new Jobs(pool);

// Das Wegenetz wird bei Bedarf geladen und bleibt im Speicher, bis ein Netzbau es ungültig macht
let netz = null;
let basis = null;
function netzLaden() {
  if (netz) return netz;
  if (!existsSync(join(NETZ_DIR, 'info.json'))) throw new Error('Kein Wegenetz vorhanden. Bitte zuerst den Netzbau starten.');
  netz = new Netz(NETZ_DIR, { minKomponente: 2000 });
  basis = null;
  if (existsSync(join(NETZ_DIR, 'karte'))) {
    try { basis = KarteBasis.laden(NETZ_DIR); } catch (e) { log('Grundkarte nicht ladbar:', e.message); }
  }
  log(`Wegenetz geladen: ${netz.N} Knoten, ${netz.E} Kanten`);
  return netz;
}
const netzVergessen = () => { netz = null; basis = null; };

/** Die Ausdehnung des Netzes (bbox) steht in info.json, damit der Webdienst den Planer einrichten kann; fehlt sie, wird sie nachgetragen */
function bboxNachtragen() {
  const datei = join(NETZ_DIR, 'info.json');
  if (!existsSync(datei)) return;
  let info;
  try { info = JSON.parse(readFileSync(datei, 'utf8')); } catch { return; }
  if (info.bbox) return;
  const n = netzLaden();
  info.bbox = n.bbox;
  writeFileSync(datei + '.tmp', JSON.stringify(info, null, 2));
  renameSync(datei + '.tmp', datei);
  log('Ausdehnung des Wegenetzes in info.json eingetragen');
  netzVergessen();
}

/** Stand-Datei eines Ordners (Download-Datum, Herkunft, Stand der Quelle) */
function schreibeStand(ordner, werte) {
  mkdirSync(ordner, { recursive: true });
  writeFileSync(join(ordner, STAND_DATEI), JSON.stringify(werte, null, 2));
}

/** Ein externer Prozess (Kartenbau, Netzbau); Ausgabe wird protokolliert und die letzte Zeile als Meldung geliefert */
function prozess(skript, argumente, { fortschritt = null } = {}) {
  return new Promise((aufloesen, ablehnen) => {
    const p = spawn(process.execPath, [join(ROOT, skript), ...argumente], { stdio: ['ignore', 'pipe', 'pipe'] });
    let letzte = '';
    const zeile = (buf) => {
      for (const t of buf.toString().split(/\r?\n/)) {
        if (!t.trim()) continue;
        // Fortschrittszeilen (FORTSCHRITT 42) gehen an die Verwaltung, nicht ins Protokoll
        const m = /^FORTSCHRITT (\d+)$/.exec(t.trim());
        if (m) { if (fortschritt) fortschritt(Number(m[1])); continue; }
        letzte = t.trim(); log(t.trim());
      }
    };
    p.stdout.on('data', zeile);
    p.stderr.on('data', zeile);
    p.on('error', ablehnen);
    p.on('exit', (code) => code === 0 ? aufloesen(letzte) : ablehnen(new Error(`${skript} endete mit Code ${code}: ${letzte}`)));
  });
}

/**
 * Datei per HTTPS laden (Weiterleitungen folgen). Liefert { bytes, lastModified }; mit optional: true liefert ein fehlendes
 * Ziel (404) { fehlt: true } statt eines Fehlers. durchschritt(geladen, gesamt) meldet den Fortschritt in Bytes.
 */
function herunterladen(url, ziel, { durchschritt = () => {}, optional = false } = {}) {
  return new Promise((aufloesen, ablehnen) => {
    const holen = (adresse, weiter) => {
      if (weiter > 5) return ablehnen(new Error('Zu viele Weiterleitungen'));
      https.get(adresse, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return holen(new URL(res.headers.location, adresse).href, weiter + 1);
        }
        if (res.statusCode === 404 && optional) { res.resume(); return aufloesen({ fehlt: true }); }
        if (res.statusCode !== 200) { res.resume(); return ablehnen(new Error(`Download fehlgeschlagen (HTTP ${res.statusCode})`)); }
        const gesamt = Number(res.headers['content-length']) || 0;
        const lastModified = res.headers['last-modified'] ?? null;
        let geladen = 0;
        let letzter = 0;
        const datei = createWriteStream(ziel + '.teil');
        res.on('data', (buf) => {
          geladen += buf.length;
          if (Date.now() - letzter > 2000) { letzter = Date.now(); durchschritt(geladen, gesamt); }
        });
        res.pipe(datei);
        datei.on('finish', () => { renameSync(ziel + '.teil', ziel); durchschritt(geladen, gesamt); aufloesen({ bytes: geladen, lastModified }); });
        datei.on('error', ablehnen);
        res.on('error', ablehnen);
      }).on('error', ablehnen);
    };
    holen(url, 0);
  });
}

/** Führt einen Job aus; liefert eine kurze Meldung für das Protokoll */
async function ausfuehren(job) {
  const parameter = job.parameter ? JSON.parse(job.parameter) : {};
  // Fortschritt als Prozent und als Zähler (erledigt von gesamt), z. B. Kacheln oder Megabyte
  const zaehler = (gesamt, erledigt) => jobs.setze(job.id, {
    gesamt, erledigt, fortschritt: gesamt ? Math.max(0, Math.min(100, Math.floor(erledigt / gesamt * 100))) : 0
  }).catch(() => {});

  switch (job.art) {
    case 'download': {
      mkdirSync(ROH_DIR, { recursive: true });
      const e = await herunterladen(KARTEN_URL, PBF_DATEI, { durchschritt: (geladen, gesamt) => zaehler(gesamt, geladen) });
      schreibeStand(ROH_DIR, { geladen_am: new Date().toISOString(), quelle: KARTEN_URL, stand_quelle: e.lastModified, bytes: e.bytes });
      return `${(e.bytes / 1048576).toFixed(0)} MB geladen`;
    }
    case 'hoehen': {
      mkdirSync(HOEHEN_DIR, { recursive: true });
      const namen = [];
      for (let lat = HOEHEN_LAT[0]; lat <= HOEHEN_LAT[1]; lat++) {
        for (let lon = HOEHEN_LON[0]; lon <= HOEHEN_LON[1]; lon++) namen.push(hoehenName(lat, lon));
      }
      let fehlend = 0;
      let bytes = 0;
      let neuste = null;
      await zaehler(namen.length, 0);
      for (let i = 0; i < namen.length; i++) {
        const name = namen[i];
        const e = await herunterladen(`${HOEHEN_URL}/${name.slice(0, 3)}/${name}.hgt.gz`, join(HOEHEN_DIR, `${name}.hgt.gz`), { optional: true });
        if (e.fehlt) fehlend++;
        else {
          bytes += e.bytes;
          if (e.lastModified && (!neuste || new Date(e.lastModified) > new Date(neuste))) neuste = e.lastModified;
        }
        await zaehler(namen.length, i + 1);
      }
      schreibeStand(HOEHEN_DIR, { geladen_am: new Date().toISOString(), quelle: HOEHEN_URL, stand_quelle: neuste, kacheln: namen.length - fehlend, bytes });
      return `${namen.length - fehlend} Kacheln geladen, ${fehlend} ohne Daten (Meer)`;
    }
    case 'karte': {
      if (!existsSync(PBF_DATEI)) throw new Error('Die Kartendaten fehlen. Bitte zuerst den Download starten.');
      await zaehler(100, 0);
      const letzte = await prozess('tools/routing/karte-bauen.js', [PBF_DATEI, NETZ_DIR], { fortschritt: (p) => zaehler(100, p) });
      netzVergessen();
      // Vorhandene Kacheln zeigen die alte Karte: sie werden entfernt und müssen neu erzeugt werden
      for (const eintrag of existsSync(KACHEL_DIR) ? readdirSync(KACHEL_DIR) : []) {
        if (eintrag.startsWith('v')) rmSync(join(KACHEL_DIR, eintrag), { recursive: true, force: true });
      }
      return letzte;
    }
    case 'netz': {
      if (!existsSync(PBF_DATEI)) throw new Error('Die Kartendaten fehlen. Bitte zuerst den Download starten.');
      if (!existsSync(HOEHEN_DIR)) throw new Error('Die Höhendaten fehlen. Bitte zuerst die Höhendaten laden.');
      netzVergessen();
      const letzte = await prozess('tools/routing/bauen.js', [PBF_DATEI, HOEHEN_DIR, NETZ_DIR]);
      bboxNachtragen();
      return letzte;
    }
    case 'reichweite': {
      const n = netzLaden();
      const ergebnis = rechneReichweite(n, parameter);
      // Die Meldung ist der Fehlercode (z. B. akku_leer), die Oberfläche übersetzt ihn
      if (ergebnis.fehler) throw new Error(ergebnis.fehler[0]);
      // Linien und Gitterpunkte werden nicht gespeichert (Datenmenge); die Heatmap ist im Raster enthalten
      const { linien, schritte, ...speicherbar } = ergebnis;
      // Nur das Ergebnis des aktuellen Jobs der Garage übernehmen (eine neuere Berechnung hat die Zeile inzwischen überschrieben)
      await pool.query('UPDATE reichweiten SET ergebnis = ? WHERE garage_id = ? AND job_id = ?', [JSON.stringify(speicherbar), job.garage_id, job.id]);
      return 'Berechnung gespeichert';
    }
    case 'kacheln': {
      const n = netzLaden();
      const routing = {
        bereit: true,
        info: { bbox: n.bbox },
        linien: async (z, x, y) => kachelKarte(n, basis, z, x, y)
      };
      const kachelJob = new KachelJob({ routing, verzeichnis: KACHEL_DIR, log });
      const zooms = Array.isArray(parameter.zooms) ? parameter.zooms : [8, 15];
      kachelJob.start(zooms);
      while (kachelJob.laeuft) {
        const s = kachelJob.status();
        await zaehler(s.gesamt, s.fertig);
        await pause(2000);
      }
      const s = kachelJob.status();
      await zaehler(s.gesamt, s.fertig);
      if (s.fehler && s.fehler === s.gesamt) throw new Error(s.letzterFehler || 'Alle Kacheln fehlgeschlagen');
      return `${s.fertig} von ${s.gesamt} Kacheln, Fehler: ${s.fehler}`;
    }
    default:
      throw new Error(`Unbekannte Jobart: ${job.art}`);
  }
}

async function schleife() {
  for (;;) {
    let job;
    try {
      job = await jobs.naechster();
    } catch (e) {
      log('Warteschlange nicht erreichbar:', e.message);
      await pause(5000);
      continue;
    }
    if (!job) { await pause(3000); continue; }
    log(`Job ${job.id} (${job.art}) startet`);
    await jobs.setze(job.id, { status: 'laeuft', begonnen_am: new Date(), fortschritt: 0 });
    try {
      const meldung = await ausfuehren(job);
      await jobs.setze(job.id, { status: 'fertig', fortschritt: 100, meldung: String(meldung ?? '').slice(0, 500), beendet_am: new Date() });
      log(`Job ${job.id} (${job.art}) fertig`);
    } catch (e) {
      log(`Job ${job.id} (${job.art}) fehlgeschlagen:`, e.message);
      await jobs.setze(job.id, { status: 'fehler', meldung: String(e.message).slice(0, 500), beendet_am: new Date() });
    }
    // Kurzpause, damit der Speicher zwischen großen Jobs zur Ruhe kommt
    await pause(200);
  }
}

async function main() {
  await warteAufDatenbank(pool, { protokoll: log });
  await jobs.unterbrochenMarkieren();
  try { bboxNachtragen(); } catch (e) { log('Ausdehnung nicht ermittelbar:', e.message); }
  log('Garage-Worker bereit');
  await schleife();
}

// Sauber beenden: der laufende Job wird beim nächsten Start als unterbrochen markiert
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { log(`${signal}: Worker beendet`); process.exit(0); });
}

main().catch((e) => { log('Fehler:', e.message); process.exit(1); });
