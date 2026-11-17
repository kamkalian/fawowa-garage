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
    swap: swapAusMeminfo(lesen),
    cpu: cpuStand()
  };
}

// Letzte Messung der Kerne: aus der Differenz zu einer früheren Messung ergibt sich die Auslastung
let cpuLetzte = null;

/** Anzahl der Kerne und Auslastung je Kern in Prozent seit der letzten Abfrage (beim ersten Mal noch null) */
export function cpuStand() {
  const jetzt = os.cpus().map((c) => ({ ...c.times }));
  const summe = (t) => t.user + t.nice + t.sys + t.idle + t.irq;
  let auslastung = null;
  if (cpuLetzte && cpuLetzte.length === jetzt.length) {
    auslastung = jetzt.map((t, i) => {
      const p = cpuLetzte[i];
      const gesamt = summe(t) - summe(p);
      const frei = t.idle - p.idle;
      return gesamt > 0 ? Math.round((gesamt - frei) / gesamt * 100) : 0;
    });
  }
  cpuLetzte = jetzt;
  return { kerne: jetzt.length, auslastung };
}
