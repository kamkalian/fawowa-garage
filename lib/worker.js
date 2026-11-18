// Garage-Worker: eigener Dienst (eigener Container). Er arbeitet die Job-Warteschlange nacheinander ab:
// Einspielen des Wegenetzes und der Karte aus einer ZIP-Datei, Reichweiten-Berechnung und Kachel-Erzeugung.
// Die ZIP-Datei baut man auf dem eigenen Rechner (scripts/daten-bauen.mjs) und lädt sie in der Verwaltung hoch.
// Das Wegenetz wird nur einmal in diesem Prozess geladen (kein zweites Exemplar).
import { existsSync, mkdirSync, renameSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { entpacken } from './zip.js';
import { herunterladen } from './download.js';
import { spawn } from 'child_process';
import { erstellePool, warteAufDatenbank } from './db.js';
import { Jobs } from './jobs.js';
import { Netz } from './netz.js';
import { rechneReichweite } from './reichweite.js';
import { kachelKarte, KarteBasis } from './karte-daten.js';
import { KachelJob } from './kachel-job.js';
import { PAKET_ORDNER, paketEinspielen, standFehler } from './paket-einspielen.js';
import { paketWaechterStarten } from './paket-waechter.js';

const hier = dirname(fileURLToPath(import.meta.url));
const ROOT = join(hier, '..');
const NETZ_DIR = process.env.NETZ_DIR || join(ROOT, 'data', 'netz');
const KACHEL_DIR = process.env.KACHEL_DIR || join(dirname(NETZ_DIR), 'kacheln');
const IMPORT_DIR = process.env.IMPORT_DIR || join(dirname(NETZ_DIR), 'import');
// Kartendatei (germany.pmtiles) aus einem Paket; der Webdienst liest sie ab Phase 4
const KARTE_DIR = process.env.KARTE_DIR || join(dirname(NETZ_DIR), 'karte');
// Zwischenordner im Netz-Speicher: Dateien lassen sich dort ohne Kopieren an ihren Platz verschieben
const NEU_DIR = join(NETZ_DIR, '.neu');
// Kartendaten (Geofabrik) für den Kartenbau; vorerst nur Nordrhein-Westfalen
const ROH_DIR = process.env.ROH_DIR || join(dirname(NETZ_DIR), 'roh');
const NRW_URL = 'https://download.geofabrik.de/europe/germany/nordrhein-westfalen-latest.osm.pbf';
const NRW_PBF = join(ROH_DIR, 'nordrhein-westfalen-latest.osm.pbf');
// Programm zum Bau der Karte (im Container, siehe Dockerfile)
const KARTEN_BIN = process.env.KARTEN_BIN || '/app/bin/daten-bauen';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const pool = erstellePool();
const jobs = new Jobs(pool);

// Das Wegenetz wird bei Bedarf geladen und bleibt im Speicher, bis ein neues eingespielt wird
let netz = null;
let basis = null;
function netzLaden() {
  if (netz) return netz;
  if (!existsSync(join(NETZ_DIR, 'info.json'))) throw new Error('Kein Wegenetz vorhanden. Bitte zuerst die ZIP-Datei hochladen.');
  netz = new Netz(NETZ_DIR, { minKomponente: 2000 });
  basis = null;
  if (existsSync(join(NETZ_DIR, 'karte'))) {
    try { basis = KarteBasis.laden(NETZ_DIR); } catch (e) { log('Grundkarte nicht ladbar:', e.message); }
  }
  log(`Wegenetz geladen: ${netz.N} Knoten, ${netz.E} Kanten`);
  return netz;
}
const netzVergessen = () => { netz = null; basis = null; };

/** Auftrag „entpacken“: ZIP prüfen, auspacken, das alte Wegenetz und die Karte ersetzen */
async function einspielen(parameter, fortschritt) {
  const quelle = join(IMPORT_DIR, String(parameter.datei ?? ''));
  if (!parameter.datei || !existsSync(quelle)) throw new Error('Die hochgeladene Datei fehlt.');
  rmSync(NEU_DIR, { recursive: true, force: true });
  mkdirSync(NEU_DIR, { recursive: true });
  await entpacken(quelle, NEU_DIR, fortschritt);

  // Prüfen, bevor etwas ersetzt wird: ohne Wegenetz, Karte und Ausdehnung wird nichts verändert
  const info = join(NEU_DIR, 'info.json');
  if (!existsSync(info) || !existsSync(join(NEU_DIR, 'karte', 'pts.i32'))) {
    rmSync(NEU_DIR, { recursive: true, force: true });
    throw new Error('Die ZIP-Datei enthält kein Wegenetz mit Karte.');
  }
  if (!JSON.parse(readFileSync(info, 'utf8')).bbox) {
    rmSync(NEU_DIR, { recursive: true, force: true });
    throw new Error('Die ZIP-Datei hat keine Ausdehnung (bbox). Bitte mit der aktuellen Version von scripts/daten-bauen.mjs neu erzeugen.');
  }

  netzVergessen();
  for (const eintrag of readdirSync(NETZ_DIR)) {
    if (eintrag !== '.neu') rmSync(join(NETZ_DIR, eintrag), { recursive: true, force: true });
  }
  for (const eintrag of readdirSync(NEU_DIR)) renameSync(join(NEU_DIR, eintrag), join(NETZ_DIR, eintrag));
  rmSync(NEU_DIR, { recursive: true, force: true });
  rmSync(quelle, { force: true });
  // Vorhandene Kacheln zeigen die alte Karte: sie werden entfernt und müssen neu erzeugt werden
  for (const eintrag of existsSync(KACHEL_DIR) ? readdirSync(KACHEL_DIR) : []) {
    if (eintrag.startsWith('v')) rmSync(join(KACHEL_DIR, eintrag), { recursive: true, force: true });
  }
  return 'Wegenetz und Karte eingespielt';
}

/**
 * Karte mit dem Go-Programm bauen (Unterbefehl karte): schreibt nach netz/karte. Die Zeilen „FORTSCHRITT n“ gehen an fortschritt.
 * Liefert die letzte Textzeile als Meldung; bei Fehler (auch Abbruch durch zu wenig Speicher) eine Exception.
 */
function karteBauenProzess(pbf, netzOrdner, fortschritt) {
  return new Promise((aufloesen, ablehnen) => {
    const p = spawn(KARTEN_BIN, ['karte', pbf, netzOrdner], { stdio: ['ignore', 'pipe', 'pipe'] });
    let letzte = '';
    const zeile = (buf) => {
      for (const t of buf.toString().split(/\r?\n/)) {
        const s = t.trim();
        if (!s) continue;
        const m = /^FORTSCHRITT (\d+)$/.exec(s);
        if (m) { fortschritt(Number(m[1])); continue; }
        letzte = s;
        log(s);
      }
    };
    p.stdout.on('data', zeile);
    p.stderr.on('data', zeile);
    p.on('error', ablehnen);
    p.on('exit', (code, signal) => {
      if (code === 0) return aufloesen(letzte);
      const grund = signal ? `Signal ${signal} (vermutlich zu wenig Speicher)` : `Code ${code}`;
      ablehnen(new Error(`Kartenbau abgebrochen: ${grund}. ${letzte}`));
    });
  });
}

/** Vorhandene Kacheln zeigen die alte Karte: sie werden entfernt und müssen neu erzeugt werden */
function kachelnLoeschen() {
  for (const eintrag of existsSync(KACHEL_DIR) ? readdirSync(KACHEL_DIR) : []) {
    if (eintrag.startsWith('v')) rmSync(join(KACHEL_DIR, eintrag), { recursive: true, force: true });
  }
}

/** Führt einen Job aus; liefert eine kurze Meldung für das Protokoll */
async function ausfuehren(job) {
  const parameter = job.parameter ? JSON.parse(job.parameter) : {};
  // Fortschritt als Prozent und als Zähler (erledigt von gesamt), z. B. Kacheln
  const zaehler = (gesamt, erledigt) => jobs.setze(job.id, {
    gesamt, erledigt, fortschritt: gesamt ? Math.max(0, Math.min(100, Math.floor(erledigt / gesamt * 100))) : 0
  }).catch(() => {});

  switch (job.art) {
    case 'entpacken':
      return einspielen(parameter, (p) => zaehler(100, p));
    case 'download': {
      mkdirSync(ROH_DIR, { recursive: true });
      const e = await herunterladen(NRW_URL, NRW_PBF, { durchschritt: (geladen, gesamt) => zaehler(gesamt, geladen) });
      return `${Math.round(e.bytes / 1048576)} MB geladen`;
    }
    case 'karte': {
      // gebiet: 'deutschland' (bereits auf dem Server) oder NRW (Standard)
      const pbf = parameter.gebiet === 'deutschland' ? join(ROH_DIR, 'germany-latest.osm.pbf') : NRW_PBF;
      if (!existsSync(pbf)) throw new Error('Die Kartendaten fehlen. Bitte zuerst die Kartendaten laden.');
      netzVergessen();
      await zaehler(100, 0);
      mkdirSync(NETZ_DIR, { recursive: true });
      const letzte = await karteBauenProzess(pbf, NETZ_DIR, (p) => zaehler(100, p));
      // Vorhandene Kacheln zeigen die alte Karte: sie werden entfernt und müssen neu erzeugt werden
      for (const eintrag of existsSync(KACHEL_DIR) ? readdirSync(KACHEL_DIR) : []) {
        if (eintrag.startsWith('v')) rmSync(join(KACHEL_DIR, eintrag), { recursive: true, force: true });
      }
      return letzte || 'Karte gebaut';
    }
    case 'paket_einspielen': {
      const ordner = String(parameter.ordner ?? '');
      if (!PAKET_ORDNER.test(ordner)) throw new Error('Ungültiger Paketname.');
      const paketOrdner = join(IMPORT_DIR, ordner);
      if (!existsSync(paketOrdner)) throw new Error('Das Paket fehlt im Import-Ordner.');
      try {
        const e = await paketEinspielen({ paketOrdner, netzDir: NETZ_DIR, karteDir: KARTE_DIR, importOrdner: IMPORT_DIR, fortschritt: (p) => zaehler(100, p) });
        if (e.art === 'netz') {
          netzVergessen();
          kachelnLoeschen();
        }
        return `${e.art} ${e.version} eingespielt (${Math.round(e.bytes / 1048576)} MB)`;
      } catch (e) {
        standFehler(IMPORT_DIR, ordner, e.message);
        throw e;
      }
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
  paketWaechterStarten({ importOrdner: IMPORT_DIR, jobs, log });
  log('Garage-Worker bereit');
  await schleife();
}

// Sauber beenden: der laufende Job wird beim nächsten Start als unterbrochen markiert
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { log(`${signal}: Worker beendet`); process.exit(0); });
}

main().catch((e) => { log('Fehler:', e.message); process.exit(1); });
