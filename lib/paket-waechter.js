// Paket-Wächter (im Worker): sucht alle 30 Sekunden im Import-Ordner nach fertigen Paketen und legt dafür je einen Auftrag
// „paket_einspielen“ an. Ein fertiger Paketordner hat sein Manifest; der Upload-Ordner endet auf „.hochladen“ und wird ignoriert,
// weil der Umbenennen-Schritt des Werkzeugs erst nach dem Manifest erfolgt.
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { PAKET_ORDNER } from './paket-einspielen.js';

export const WAECHTER_INTERVALL_MS = 30_000;

/**
 * Einmal prüfen: legt für jedes neue Paket einen Auftrag an. Liefert die Namen der neu angelegten Pakete.
 */
export async function paketeSuchen(importOrdner, jobs) {
  if (!existsSync(importOrdner)) return [];
  const angelegt = [];
  for (const n of readdirSync(importOrdner)) {
    if (!PAKET_ORDNER.test(n) || n.endsWith('.hochladen')) continue;
    if (!existsSync(join(importOrdner, n, n + '.manifest.json'))) continue;
    const id = await jobs.paketAnlegen(n, { auto: true });
    if (id) angelegt.push(n);
  }
  return angelegt;
}

/** Wächter starten: prüft sofort und danach alle 30 Sekunden. Liefert eine Funktion zum Anhalten. */
export function paketWaechterStarten({ importOrdner, jobs, log = () => {}, intervallMs = WAECHTER_INTERVALL_MS }) {
  let laeuft = false;
  const lauf = async () => {
    if (laeuft) return;
    laeuft = true;
    try {
      const neu = await paketeSuchen(importOrdner, jobs);
      if (neu.length) log(`Paket(e) gefunden, Einspielen angelegt: ${neu.join(', ')}`);
    } catch (e) {
      log('Paket-Wächter:', e.message);
    } finally {
      laeuft = false;
    }
  };
  lauf();
  const timer = setInterval(lauf, intervallMs);
  return () => clearInterval(timer);
}
