// Angaben des Reichweiten-Planers für die Web-Anwendung: Ausdehnung des Wegenetzes und Ortsnamen für die Karte.
// Das Wegenetz selbst (Hunderte MB) liegt nur im Worker; der Webdienst liest nur die kleinen Dateien daneben.
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** Liefert { bbox, orte } oder null, wenn kein Wegenetz eingerichtet oder noch ohne Ausdehnung ist */
export function ladePlaner(netzOrdner) {
  if (!netzOrdner) return null;
  const infoDatei = join(netzOrdner, 'info.json');
  if (!existsSync(infoDatei)) return null;
  let info;
  try { info = JSON.parse(readFileSync(infoDatei, 'utf8')); } catch { return null; }
  if (!info.bbox) return null;
  const orteDatei = join(netzOrdner, 'orte.json');
  let orte = [];
  try { orte = existsSync(orteDatei) ? JSON.parse(readFileSync(orteDatei, 'utf8')) : []; } catch { orte = []; }
  return { bbox: info.bbox, orte };
}
