// Einspielen eines Pakets (Auftrag „paket_einspielen“): die Stücke aus den ZIP-Dateien zusammensetzen und gegen die Prüfsummen
// prüfen, den Inhalt prüfen, dann die alte Version ersetzen. Das Format steht in docs/PAKETFORMAT.md, die Prüfung der
// Struktur in lib/paket.js.
import yauzl from 'yauzl';
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, writeFileSync, closeSync } from 'fs';
import { basename, dirname, join } from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { pruefeManifest, pruefeZips } from './paket.js';

export const PAKET_ORDNER = /^(netz|karte)-[0-9A-Za-z._T-]+$/;
const PMTILES_MAGIC = 'PMTiles';

/** Öffnet eine ZIP-Datei und liefert ihre Einträge nach Namen. Die Dateien selbst werden erst beim Lesen gelesen. */
function zipOeffnen(pfad) {
  return new Promise((aufloesen, ablehnen) => {
    yauzl.open(pfad, { lazyEntries: true, autoClose: false }, (fehler, zip) => {
      if (fehler) return ablehnen(fehler);
      const eintraege = new Map();
      zip.on('entry', (e) => { eintraege.set(e.fileName, e); zip.readEntry(); });
      zip.on('end', () => aufloesen({ zip, eintraege }));
      zip.on('error', ablehnen);
      zip.readEntry();
    });
  });
}

function eintragStrom(zip, eintrag) {
  return new Promise((aufloesen, ablehnen) => {
    zip.openReadStream(eintrag, (fehler, strom) => (fehler ? ablehnen(fehler) : aufloesen(strom)));
  });
}

/**
 * Setzt die Dateien eines Pakets in <ziel>/.neu zusammen. Jedes Stück wird gegen seine Größe und Prüfsumme geprüft, jede Datei
 * gegen Größe und Prüfsumme. Liefert die Zahl der geschriebenen Bytes. Bei einem Fehler wird .neu wieder entfernt.
 */
export async function paketZusammensetzen(m, paketOrdner, ziel, fortschritt = () => {}) {
  const neu = join(ziel, '.neu');
  rmSync(neu, { recursive: true, force: true });
  mkdirSync(neu, { recursive: true });
  const gesamt = m.dateien.reduce((a, d) => a + d.bytes, 0) || 1;
  const offen = new Map();
  let geschrieben = 0;
  try {
    for (const d of m.dateien) {
      const pfad = join(neu, d.pfad);
      mkdirSync(dirname(pfad), { recursive: true });
      const gesamtHash = createHash('sha256');
      const start = geschrieben;
      const stuecke = [...d.stuecke].sort((a, b) => a.offset - b.offset);
      for (let i = 0; i < stuecke.length; i++) {
        const s = stuecke[i];
        if (!offen.has(s.zip)) offen.set(s.zip, await zipOeffnen(join(paketOrdner, s.zip)));
        const { zip, eintraege } = offen.get(s.zip);
        const eintrag = eintraege.get(s.eintrag);
        if (!eintrag) throw new Error(`Stück ${s.eintrag} fehlt in ${s.zip}`);
        if (eintrag.uncompressedSize !== s.bytes) throw new Error(`Stück ${s.eintrag}: falsche Größe`);
        const stueckHash = createHash('sha256');
        let stueckBytes = 0;
        const zaehlen = new Transform({
          transform(chunk, _enc, cb) {
            gesamtHash.update(chunk);
            stueckHash.update(chunk);
            stueckBytes += chunk.length;
            geschrieben += chunk.length;
            fortschritt(Math.min(99, Math.floor(geschrieben / gesamt * 100)));
            cb(null, chunk);
          }
        });
        // Das erste Stück legt die Datei neu an, die weiteren hängen sich an
        await pipeline(await eintragStrom(zip, eintrag), zaehlen, createWriteStream(pfad, { flags: i === 0 ? 'w' : 'a' }));
        if (stueckBytes !== s.bytes) throw new Error(`Stück ${s.eintrag}: falsche Größe beim Lesen`);
        if (stueckHash.digest('hex') !== s.sha256) throw new Error(`Stück ${s.eintrag}: Prüfsumme stimmt nicht`);
      }
      if (geschrieben - start !== d.bytes) throw new Error(`${d.pfad}: falsche Größe`);
      if (gesamtHash.digest('hex') !== d.sha256) throw new Error(`${d.pfad}: Prüfsumme stimmt nicht`);
    }
    return geschrieben;
  } catch (e) {
    rmSync(neu, { recursive: true, force: true });
    throw e;
  } finally {
    for (const { zip } of offen.values()) zip.close();
  }
}

/** Prüft den Inhalt von <neu>, bevor etwas ersetzt wird. Wirft bei Fehler. */
export function paketInhaltPruefen(art, neu) {
  if (art === 'netz') {
    const info = join(neu, 'info.json');
    if (!existsSync(info) || !existsSync(join(neu, 'karte', 'pts.i32'))) throw new Error('Das Wegenetz hat kein info.json oder keine Karte (karte/pts.i32).');
    if (!JSON.parse(readFileSync(info, 'utf8')).bbox) throw new Error('Das Wegenetz hat keine Ausdehnung (bbox).');
  } else if (art === 'karte') {
    const datei = join(neu, 'germany.pmtiles');
    if (!existsSync(datei)) throw new Error('Die Karte enthält keine germany.pmtiles.');
    const kopf = Buffer.alloc(8);
    const f = openSync(datei, 'r');
    try { readSync(f, kopf, 0, 8, 0); } finally { closeSync(f); }
    if (kopf.subarray(0, 7).toString('latin1') !== PMTILES_MAGIC || kopf[7] !== 3) {
      throw new Error('germany.pmtiles hat keinen gültigen PMTiles-Kopf (Version 3).');
    }
  }
}

/**
 * Ersetzt den Inhalt von ziel durch die Dateien in <ziel>/.neu. Die alten Dateien wandern nach .alt. Schlägt das Umbenennen
 * fehl, kommen die alten Dateien zurück. alleAlten: alle Einträge von ziel ersetzen (Wegenetz), sonst nur die gleichnamigen (Karte).
 */
export function paketTauschen(ziel, { alleAlten }) {
  const neu = join(ziel, '.neu');
  const alt = join(ziel, '.alt');
  rmSync(alt, { recursive: true, force: true });
  mkdirSync(alt, { recursive: true });
  const neue = readdirSync(neu);
  const verschoben = [];
  try {
    const alte = alleAlten
      ? readdirSync(ziel).filter((n) => n !== '.neu' && n !== '.alt')
      : neue.filter((n) => existsSync(join(ziel, n)));
    for (const n of alte) { renameSync(join(ziel, n), join(alt, n)); verschoben.push(n); }
    for (const n of neue) renameSync(join(neu, n), join(ziel, n));
  } catch (e) {
    for (const n of neue) rmSync(join(ziel, n), { recursive: true, force: true });
    for (const n of verschoben) renameSync(join(alt, n), join(ziel, n));
    throw e;
  }
  rmSync(alt, { recursive: true, force: true });
  rmSync(neu, { recursive: true, force: true });
}

/** Manifest eines Paketordners lesen und vollständig prüfen (Struktur, Name, ZIP-Dateien). Wirft bei Fehler. */
export async function paketPruefen(paketOrdner) {
  const name = basename(paketOrdner);
  if (!PAKET_ORDNER.test(name)) throw new Error('Ungültiger Name des Paketordners.');
  const manifestPfad = join(paketOrdner, name + '.manifest.json');
  if (!existsSync(manifestPfad)) throw new Error('Das Manifest fehlt.');
  const m = JSON.parse(readFileSync(manifestPfad, 'utf8'));
  const probleme = pruefeManifest(m);
  if (name !== `${m.art}-${m.version}`) probleme.push('Ordnername passt nicht zu Art und Version');
  if (probleme.length) throw new Error('Paket ungültig: ' + probleme.slice(0, 3).join('; '));
  const zipProbleme = await pruefeZips(m, paketOrdner);
  if (zipProbleme.length) throw new Error('Paket unvollständig: ' + zipProbleme.slice(0, 3).join('; '));
  return m;
}

/**
 * Ein Paket einspielen. netz → netzDir (ganzer Inhalt wird ersetzt), karte → karteDir (germany.pmtiles).
 * Liefert { art, version, bytes }. Der Paketordner wird danach gelöscht; der Stand steht in status.json im Import-Ordner.
 */
export async function paketEinspielen({ paketOrdner, netzDir, karteDir, importOrdner, fortschritt = () => {} }) {
  const m = await paketPruefen(paketOrdner);
  const ziel = m.art === 'netz' ? netzDir : karteDir;
  mkdirSync(ziel, { recursive: true });
  const bytes = await paketZusammensetzen(m, paketOrdner, ziel, fortschritt);
  try {
    paketInhaltPruefen(m.art, join(ziel, '.neu'));
  } catch (e) {
    rmSync(join(ziel, '.neu'), { recursive: true, force: true });
    throw e;
  }
  paketTauschen(ziel, { alleAlten: m.art === 'netz' });
  standSchreiben(importOrdner, m.art, { version: m.version, bytes, eingespielt_am: new Date().toISOString() });
  rmSync(paketOrdner, { recursive: true, force: true });
  return { art: m.art, version: m.version, bytes };
}

/** Stand-Datei (status.json im Import-Ordner) lesen; fehlt sie oder ist sie kaputt, leer */
export function standLesen(importOrdner) {
  try { return JSON.parse(readFileSync(join(importOrdner, 'status.json'), 'utf8')); } catch { return { stand: {}, letzter: null }; }
}

function standSchreibenDatei(importOrdner, inhalt) {
  mkdirSync(importOrdner, { recursive: true });
  const tmp = join(importOrdner, 'status.json.tmp');
  writeFileSync(tmp, JSON.stringify(inhalt, null, 2));
  renameSync(tmp, join(importOrdner, 'status.json'));
}

/** Eingespielte Version einer Art eintragen und den Auftrag als Letzten merken */
export function standSchreiben(importOrdner, art, eintrag) {
  const alt = standLesen(importOrdner);
  standSchreibenDatei(importOrdner, {
    stand: { ...(alt.stand ?? {}), [art]: eintrag },
    letzter: { art, version: eintrag.version, ok: true, meldung: 'eingespielt', zeit: eintrag.eingespielt_am }
  });
}

/** Fehlgeschlagenen Auftrag als Letzten merken; der Stand bleibt unverändert */
export function standFehler(importOrdner, ordner, meldung) {
  const alt = standLesen(importOrdner);
  standSchreibenDatei(importOrdner, { stand: alt.stand ?? {}, letzter: { ordner, ok: false, meldung, zeit: new Date().toISOString() } });
}

/** Pakete im Import-Ordner (fertige Ordner mit Manifest) für die Verwaltung */
export function paketeListe(importOrdner) {
  if (!existsSync(importOrdner)) return [];
  const liste = [];
  for (const n of readdirSync(importOrdner)) {
    if (!PAKET_ORDNER.test(n)) continue;
    const pfad = join(importOrdner, n);
    const manifestPfad = join(pfad, n + '.manifest.json');
    if (!existsSync(manifestPfad)) continue;
    try {
      const m = JSON.parse(readFileSync(manifestPfad, 'utf8'));
      const zips = m.zips ?? [];
      liste.push({ ordner: n, art: m.art, version: m.version, zips: zips.length, bytes: zips.reduce((a, z) => a + z.bytes, 0) });
    } catch {
      liste.push({ ordner: n, art: null, version: null, zips: 0, bytes: 0, fehler: 'Manifest nicht lesbar' });
    }
  }
  return liste.sort((a, b) => a.ordner.localeCompare(b.ordner));
}
