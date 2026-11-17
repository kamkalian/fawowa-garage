// Angaben des Reichweiten-Planers für die Web-Anwendung: Ausdehnung des Wegenetzes und Ortsnamen für die Karte.
// Das Wegenetz selbst (Hunderte MB) liegt nur im Worker; der Webdienst liest nur die kleinen Dateien daneben.
// Ändern sie sich (neuer Netzbau), werden sie beim nächsten Abruf neu gelesen, ohne Neustart des Webdienstes.
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** Liest { bbox, orte } oder null, wenn kein Wegenetz eingerichtet oder noch ohne Ausdehnung ist */
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

/**
 * Liefert eine Funktion, die den jeweils aktuellen Planer liefert. Gelesen wird nur neu, wenn sich info.json oder orte.json geändert hat.
 */
export function planerLader(netzOrdner) {
  let stand = null;
  let zuletzt = null;
  return () => {
    if (!netzOrdner) return null;
    const dateien = [join(netzOrdner, 'info.json'), join(netzOrdner, 'orte.json')];
    const kennung = dateien.map(d => { try { return statSync(d).mtimeMs; } catch { return 0; } }).join('|');
    if (kennung !== zuletzt) {
      zuletzt = kennung;
      stand = ladePlaner(netzOrdner);
    }
    return stand;
  };
}
