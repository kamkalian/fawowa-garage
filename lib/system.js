// Angaben über den Server für die Verwaltung: Arbeitsspeicher und Auslagerungsspeicher (Swap).
import { readFileSync } from 'fs';
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
