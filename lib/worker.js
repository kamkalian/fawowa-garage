// Garage-Worker: eigener Dienst (eigener Container). Er arbeitet die Job-Warteschlange nacheinander ab:
// Einspielen des Wegenetzes und der Karte aus einer ZIP-Datei, Reichweiten-Berechnung und Kachel-Erzeugung.
// Die ZIP-Datei baut man auf dem eigenen Rechner (Daten-Werkzeug) und lädt sie in der Verwaltung hoch.
// Das Wegenetz wird nur einmal in diesem Prozess geladen (kein zweites Exemplar).
import { existsSync, mkdirSync, renameSync, readdirSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { entpacken } from './zip.js';
import { erstellePool, warteAufDatenbank } from './db.js';
import { Jobs } from './jobs.js';
import { Netz } from './netz.js';
import { rechneReichweiteAsync } from './reichweite.js';
import { PAKET_ORDNER, paketEinspielen, standFehler } from './paket-einspielen.js';
import { aufraeumen } from './platz.js';

const hier = dirname(fileURLToPath(import.meta.url));
const ROOT = join(hier, '..');
const NETZ_DIR = process.env.NETZ_DIR || join(ROOT, 'data', 'netz');
const IMPORT_DIR = process.env.IMPORT_DIR || join(dirname(NETZ_DIR), 'import');
// Kartendatei (germany.pmtiles) aus einem Paket; der Webdienst liest sie ab Phase 4
const KARTE_DIR = process.env.KARTE_DIR || join(dirname(NETZ_DIR), 'karte');
// Zwischenordner im Netz-Speicher: Dateien lassen sich dort ohne Kopieren an ihren Platz verschieben
const NEU_DIR = join(NETZ_DIR, '.neu');
// Kartendaten (Geofabrik) für den Kartenbau; vorerst nur Nordrhein-Westfalen

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const pool = erstellePool();
const jobs = new Jobs(pool);

// Das Wegenetz wird bei Bedarf geladen und bleibt im Speicher, bis ein neues eingespielt wird
let netz = null;
function netzLaden() {
  if (netz) return netz;
  if (!existsSync(join(NETZ_DIR, 'info.json'))) throw new Error('Kein Wegenetz vorhanden. Bitte zuerst die ZIP-Datei hochladen.');
  netz = new Netz(NETZ_DIR, { minKomponente: 2000 });
  log(`Wegenetz geladen: ${netz.N} Knoten, ${netz.E} Kanten`);
  return netz;
}
const netzVergessen = () => { netz = null; };

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
    throw new Error('Die ZIP-Datei hat keine Ausdehnung (bbox). Bitte mit der aktuellen Version des Daten-Werkzeugs neu erzeugen.');
  }

  netzVergessen();
  for (const eintrag of readdirSync(NETZ_DIR)) {
    if (eintrag !== '.neu') rmSync(join(NETZ_DIR, eintrag), { recursive: true, force: true });
  }
  for (const eintrag of readdirSync(NEU_DIR)) renameSync(join(NEU_DIR, eintrag), join(NETZ_DIR, eintrag));
  rmSync(NEU_DIR, { recursive: true, force: true });
  rmSync(quelle, { force: true });
  return 'Wegenetz und Karte eingespielt';
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
    case 'paket_einspielen': {
      const ordner = String(parameter.ordner ?? '');
      if (!PAKET_ORDNER.test(ordner)) throw new Error('Ungültiger Paketname.');
      const paketOrdner = join(IMPORT_DIR, ordner);
      if (!existsSync(paketOrdner)) throw new Error('Das Paket fehlt im Import-Ordner.');
      try {
        const e = await paketEinspielen({ paketOrdner, netzDir: NETZ_DIR, karteDir: KARTE_DIR, importOrdner: IMPORT_DIR, fortschritt: (p) => zaehler(100, p) });
        // Bereinigung: der Speicher des Wegenetzes und die alten Kacheln werden frei, die Rohdaten nur, wenn keine Karte mehr gebaut wird
        netzVergessen();
        const roh = aufraeumen('roh', process.env);
        const rohText = roh > 0 ? `, ${Math.round(roh / 1048576)} MB Rohdaten entfernt` : '';
        return `${e.art} ${e.version} eingespielt (${Math.round(e.bytes / 1048576)} MB)${rohText}`;
      } catch (e) {
        standFehler(IMPORT_DIR, ordner, e.message);
        throw e;
      }
    }
    case 'reichweite': {
      // Das Laden des Wegenetzes dauert einige Sekunden und blockiert; die Meldung wird vorher geschrieben
      await jobs.setze(job.id, { fortschritt: 0, meldung: 'Wegenetz laden' });
      const n = netzLaden();
      // Fortschritt in die Warteschlange schreiben, nur wenn sich Prozent oder Phase ändern
      let letzterStand = '';
      const fortschritt = (text, anteil) => {
        const pct = Math.round(anteil * 100);
        if (`${pct}|${text}` === letzterStand) return;
        letzterStand = `${pct}|${text}`;
        jobs.setze(job.id, { fortschritt: pct, meldung: text }).catch(() => {});
      };
      const ergebnis = await rechneReichweiteAsync(n, parameter, fortschritt);
      // Die Meldung ist der Fehlercode (z. B. akku_leer), die Oberfläche übersetzt ihn
      if (ergebnis.fehler) throw new Error(ergebnis.fehler[0]);
      // Linien und Gitterpunkte kommen getrennt in die Spalte routen (nur auf Abruf geladen); das Ergebnis selbst bleibt klein
      const { linien, schritte, ...speicherbar } = ergebnis;
      // Nur das Ergebnis des aktuellen Jobs der Garage übernehmen (eine neuere Berechnung hat die Zeile inzwischen überschrieben)
      await pool.query('UPDATE reichweiten SET ergebnis = ?, routen = ? WHERE garage_id = ? AND job_id = ?', [JSON.stringify(speicherbar), JSON.stringify({ linien, schritte }), job.garage_id, job.id]);
      return 'Berechnung gespeichert';
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
  log('Garage-Worker bereit');
  await schleife();
}

// Sauber beenden: der laufende Job wird beim nächsten Start als unterbrochen markiert
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => { log(`${signal}: Worker beendet`); process.exit(0); });
}

main().catch((e) => { log('Fehler:', e.message); process.exit(1); });
