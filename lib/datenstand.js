// Stand der Karten- und Wegedaten für die Verwaltung. Das Wegenetz und die Karte kommen als ZIP-Datei vom eigenen Rechner;
// der Server packt sie aus (Auftrag „entpacken“). Die Kacheln entstehen aus der Karte (Auftrag „kacheln“).
import { existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

const iso = (d) => (d ? new Date(d).toISOString() : null);
// Ist a neuer als b? Unbekannt (null), wenn a fehlt; neu (true), wenn b noch fehlt
const neuer = (a, b) => (!a ? null : !b ? true : new Date(a) > new Date(b));

/** Änderungsdatum einer Datei als ISO-Zeit oder null */
function dateiZeit(datei) {
  try { return statSync(datei).mtime.toISOString(); } catch { return null; }
}

/**
 * Stand der Datenobjekte. letzte: { auftragsart: Date } der letzten erfolgreichen Aufträge.
 * Je Objekt: vorhanden, geladen_am (ISO), neu (true/false, null = unbekannt), auftrag (Art des Auftrags), knopf (Beschriftung).
 */
export async function datenstand({ env = process.env, letzte = {} } = {}) {
  const netz = env.NETZ_DIR;
  const kacheln = env.KACHEL_DIR || (netz ? join(dirname(netz), 'kacheln') : null);

  const netzVorhanden = !!(netz && existsSync(join(netz, 'info.json')) && existsSync(join(netz, 'karte', 'pts.i32')));
  // Zeitpunkt des Wegenetzes: der letzte Auftrag „entpacken“, sonst das Änderungsdatum der Netz-Datei
  const netzZeit = letzte.entpacken ?? (netzVorhanden ? dateiZeit(join(netz, 'info.json')) : null);
  const kachelVorhanden = !!(kacheln && existsSync(kacheln) && readdirSync(kacheln).some(v => v.startsWith('v')));
  const kachelZeit = letzte.kacheln ?? null;

  return {
    objekte: [
      {
        schluessel: 'netz', name: 'Wegenetz und Karte', quelle: 'ZIP-Datei vom eigenen Rechner (scripts/daten-bauen.mjs)',
        vorhanden: netzVorhanden, geladen_am: iso(netzZeit),
        neu: null,
        auftrag: 'entpacken', knopf: 'ZIP hochladen'
      },
      {
        schluessel: 'kacheln', name: 'Kacheln der Karte', quelle: 'aus der Karte',
        vorhanden: kachelVorhanden, geladen_am: iso(kachelZeit),
        // Neu, wenn das Wegenetz nach den Kacheln neu eingespielt wurde
        neu: neuer(netzZeit, kachelZeit),
        auftrag: 'kacheln', knopf: 'Neu erzeugen'
      }
    ]
  };
}
