// Plattenplatz für die Verwaltung: freier und belegter Platz des Datenträgers und die Größe der Datenordner.
// Die Größe eines Ordners wird höchstens alle 60 Sekunden neu durchgezählt (bei vielen Kacheln dauert das).
import { statfsSync, readdirSync, statSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const CACHE_MS = 60 * 1000;
const cache = new Map();

/** Summe der Dateigrößen unterhalb eines Ordners (Bytes); fehlt der Ordner, 0 */
export function ordnerGroesse(ordner) {
  let summe = 0;
  const stapel = [ordner];
  while (stapel.length) {
    const d = stapel.pop();
    let eintraege;
    try { eintraege = readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of eintraege) {
      const p = join(d, e.name);
      if (e.isDirectory()) stapel.push(p);
      else { try { summe += statSync(p).size; } catch { /* verschwunden */ } }
    }
  }
  return summe;
}

function gemessen(schluessel, ordner) {
  const zwischen = cache.get(schluessel);
  if (zwischen && Date.now() - zwischen.zeit < CACHE_MS) return zwischen.wert;
  const wert = ordnerGroesse(ordner);
  cache.set(schluessel, { zeit: Date.now(), wert });
  return wert;
}

/** Die Datenordner des Servers, die man aufräumen kann */
export function datenOrdner(env = process.env) {
  const netz = env.NETZ_DIR;
  if (!netz) return null;
  const daten = dirname(netz);
  return {
    netz,
    roh: env.ROH_DIR || join(daten, 'roh'),
    hoehen: env.HOEHEN_DIR || join(daten, 'hoehen'),
    kacheln: env.KACHEL_DIR || join(daten, 'kacheln'),
    import: env.IMPORT_DIR || join(daten, 'import')
  };
}

/** Freier und belegter Platz des Datenträgers sowie die Größe der Ordner */
export function platzStand(env = process.env) {
  const ordner = datenOrdner(env);
  const ziel = ordner?.netz ?? '/';
  let frei = null;
  let gesamt = null;
  try {
    const s = statfsSync(existsSync(ziel) ? ziel : '/');
    frei = Number(s.bavail) * Number(s.bsize);
    gesamt = Number(s.blocks) * Number(s.bsize);
  } catch { /* Platz nicht ermittelbar */ }
  const teile = [];
  if (ordner) {
    // Der Kachelordner hat sehr viele Dateien: sein Durchzählen würde den Server blockieren, deshalb nicht hier
    for (const [name, pfad] of Object.entries(ordner)) {
      if (name === 'kacheln') continue;
      teile.push({ name, bytes: gemessen(name, pfad) });
    }
  }
  return { frei, gesamt, ordner: teile };
}

// Aufräumziele: nur die Daten, die der Server nicht mehr braucht; jeder Löschvorgang muss bestätigt werden
const LOESCHBAR = {
  'roh': (o) => o.roh,
  'hoehen': (o) => o.hoehen,
  'import': (o) => o.import
};

/** Löscht den Inhalt eines Aufräumziels (roh, hoehen, import); liefert die Anzahl der gelöschten Bytes */
export function aufraeumen(ziel, env = process.env) {
  const ordner = datenOrdner(env);
  const wahl = LOESCHBAR[ziel];
  if (!ordner || !wahl) return null;
  const pfad = wahl(ordner);
  const vorher = ordnerGroesse(pfad);
  if (existsSync(pfad)) {
    for (const e of readdirSync(pfad)) rmSync(join(pfad, e), { recursive: true, force: true });
  }
  cache.delete(ziel);
  return vorher;
}
