// Angaben über den Server für die Verwaltung: Arbeitsspeicher, Auslagerungsspeicher (Swap) und Stand der Kartendaten.
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import os from 'os';

const MB = 1048576;

/** Werte aus /proc/meminfo in MB (nur auf Linux, im Container); sonst null */
export function swapAusMeminfo(lesen = () => readFileSync('/proc/meminfo', 'utf8')) {
  try {
    const werte = {};
    for (const zeile of lesen().split('\n')) {
      const m = zeile.match(/^(\w+):\s+(\d+)\s+kB/);
      if (m) werte[m[1]] = Number(m[2]) * 1024 / MB;
    }
    if (werte.SwapTotal === undefined) return null;
    const gesamt = Math.round(werte.SwapTotal);
    const frei = Math.round(werte.SwapFree ?? 0);
    return { gesamtMB: gesamt, genutztMB: gesamt - frei };
  } catch {
    return null;
  }
}

/** Arbeitsspeicher und Swap des Servers (der Container sieht den Speicher des Hosts) */
export function systemStand(lesen) {
  const gesamt = os.totalmem() / MB;
  const frei = os.freemem() / MB;
  return {
    ramGesamtMB: Math.round(gesamt),
    ramGenutztMB: Math.round(gesamt - frei),
    swap: swapAusMeminfo(lesen)
  };
}

/** Welche Kartendaten vorhanden sind (für die Anzeige im Verwaltungsbereich) */
export function netzStand(env = process.env) {
  if (!env.NETZ_DIR) return null;
  const netz = env.NETZ_DIR;
  const roh = env.ROH_DIR || join(dirname(netz), 'roh');
  const hoehen = env.HOEHEN_DIR || join(dirname(netz), 'hoehen');
  const kacheln = env.KACHEL_DIR || join(dirname(netz), 'kacheln');
  let anzahlKacheln = 0;
  try {
    for (const v of readdirSync(kacheln)) if (v.startsWith('v')) anzahlKacheln++;
  } catch { /* kein Ordner */ }
  return {
    pbf: existsSync(join(roh, 'germany-latest.osm.pbf')),
    hoehen: existsSync(hoehen) && readdirSync(hoehen).some(d => d.endsWith('.hgt') || d.endsWith('.hgt.gz')),
    netz: existsSync(join(netz, 'info.json')),
    karte: existsSync(join(netz, 'karte')),
    kachelVersionen: anzahlKacheln
  };
}
