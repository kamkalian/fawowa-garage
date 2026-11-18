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
export async function datenstand({ env = process.env, letzte = {}, stand = {} } = {}) {
  const netz = env.NETZ_DIR;
  const kacheln = env.KACHEL_DIR || (netz ? join(dirname(netz), 'kacheln') : null);

  const netzVorhanden = !!(netz && existsSync(join(netz, 'info.json')) && existsSync(join(netz, 'karte', 'pts.i32')));
  // Zeitpunkt des Wegenetzes: der letzte Auftrag „entpacken“, sonst das Änderungsdatum der Netz-Datei
  // Eingespielte Pakete zählen vor den Aufträgen; sonst das Änderungsdatum der Netz-Datei
  const netzZeit = stand.netz?.eingespielt_am ?? letzte.entpacken ?? (netzVorhanden ? dateiZeit(join(netz, 'info.json')) : null);
  const karteDatei = env.KARTE_DIR ? join(env.KARTE_DIR, 'germany.pmtiles') : (netz ? join(dirname(netz), 'karte', 'germany.pmtiles') : null);
  const karteVorhanden = !!(karteDatei && existsSync(karteDatei));
  const karteZeit = stand.karte?.eingespielt_am ?? (karteVorhanden ? dateiZeit(karteDatei) : null);
  const kachelVorhanden = !!(kacheln && existsSync(kacheln) && readdirSync(kacheln).some(v => v.startsWith('v')));
  const kachelZeit = letzte.kacheln ?? null;

  return {
    objekte: [
      {
        schluessel: 'netz', name: 'Wegenetz', quelle: 'Paket vom Daten-Werkzeug',
        vorhanden: netzVorhanden, geladen_am: iso(netzZeit),
        neu: null,
        version: stand.netz?.version ?? null,
        auftrag: null, knopf: null
      },
      {
        schluessel: 'karte', name: 'Karte (PMTiles)', quelle: 'Paket vom eigenen Rechner',
        vorhanden: karteVorhanden, geladen_am: iso(karteZeit),
        neu: null,
        version: stand.karte?.version ?? null,
        auftrag: null, knopf: null
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
