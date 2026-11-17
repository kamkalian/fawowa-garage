// Stand der Karten- und Höhendaten für die Verwaltung: wann etwas zuletzt geladen oder gebaut wurde und ob der Anbieter neuere Daten hat.
// Die Prüfung beim Anbieter (HEAD-Anfragen) wird 30 Minuten zwischengespeichert, damit die Verwaltung nicht ständig abfragt.
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { KARTEN_URL, HOEHEN_URL, HOEHEN_LAT, HOEHEN_LON, STAND_DATEI, hoehenName } from './datenquellen.js';

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();

/** Last-Modified einer Adresse (ISO-Zeit) oder null; nach 8 Sekunden gibt die Prüfung auf */
async function entfernt(url) {
  const zwischen = cache.get(url);
  if (zwischen && Date.now() - zwischen.zeit < CACHE_MS) return zwischen.wert;
  let wert = null;
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000), redirect: 'follow' });
    if (res.ok) wert = res.headers.get('last-modified');
  } catch { wert = undefined; }
  cache.set(url, { zeit: Date.now(), wert });
  return wert;
}

/** Neuester Stand aller Höhenkacheln beim Anbieter (Last-Modified); dafür werden alle Kacheln geprüft */
async function entfernteHoehen() {
  const zwischen = cache.get('hoehen');
  if (zwischen && Date.now() - zwischen.zeit < CACHE_MS) return zwischen.wert;
  const namen = [];
  for (let lat = HOEHEN_LAT[0]; lat <= HOEHEN_LAT[1]; lat++) {
    for (let lon = HOEHEN_LON[0]; lon <= HOEHEN_LON[1]; lon++) namen.push(hoehenName(lat, lon));
  }
  let neuste = null;
  let fehler = false;
  const warteschlange = [...namen];
  const arbeiter = Array.from({ length: 8 }, async () => {
    while (warteschlange.length) {
      const name = warteschlange.shift();
      const wert = await entfernt(`${HOEHEN_URL}/${name.slice(0, 3)}/${name}.hgt.gz`);
      if (wert === undefined) fehler = true;
      else if (wert && (!neuste || new Date(wert) > new Date(neuste))) neuste = wert;
    }
  });
  await Promise.all(arbeiter);
  const wert = fehler && !neuste ? undefined : neuste;
  cache.set('hoehen', { zeit: Date.now(), wert });
  return wert;
}

function lesen(datei) {
  try { return JSON.parse(readFileSync(datei, 'utf8')); } catch { return null; }
}

const iso = (d) => (d ? new Date(d).toISOString() : null);
// Ist a neuer als b? Unbekannt (null), wenn a fehlt; neu (true), wenn b noch fehlt
const neuer = (a, b) => (!a ? null : !b ? true : new Date(a) > new Date(b));

/**
 * Stand aller Datenobjekte. letzte: { art: Date } der letzten erfolgreichen Aufträge; entfernt: Prüfung beim Anbieter (für Tests austauschbar).
 * Liefert je Objekt: vorhanden, geladen_am (ISO), neu (true/false, null = nicht prüfbar) und den Auftrag, der es aktualisiert.
 */
export async function datenstand({ env = process.env, letzte = {}, pruefeKarte = entfernt, pruefeHoehen = entfernteHoehen } = {}) {
  const netz = env.NETZ_DIR;
  const roh = env.ROH_DIR || (netz ? join(dirname(netz), 'roh') : null);
  const hoehen = env.HOEHEN_DIR || (netz ? join(dirname(netz), 'hoehen') : null);
  const kacheln = env.KACHEL_DIR || (netz ? join(dirname(netz), 'kacheln') : null);

  const pbfStand = roh ? lesen(join(roh, STAND_DATEI)) : null;
  const hoehenStand = hoehen ? lesen(join(hoehen, STAND_DATEI)) : null;
  const pbfQuelle = await pruefeKarte(KARTEN_URL);
  const hoehenQuelle = await pruefeHoehen();

  // Zeitpunkte: wann die Kartendaten und Höhendaten auf dem Server liegen, wann Karte, Netz und Kacheln zuletzt entstanden
  const kartenDaten = pbfStand?.geladen_am ?? null;
  const hoehenDaten = hoehenStand?.geladen_am ?? null;
  const karteZeit = letzte.karte ?? null;
  const netzZeit = letzte.netz ?? null;
  const kachelZeit = letzte.kacheln ?? null;
  const netzDaten = [kartenDaten, hoehenDaten].filter(Boolean).sort().pop() ?? null;

  const kartenVorhanden = !!(netz && existsSync(join(netz, 'karte', 'pts.i32')));
  const kachelVorhanden = !!(kacheln && existsSync(kacheln) && readdirSync(kacheln).some(v => v.startsWith('v')));

  return {
    objekte: [
      {
        schluessel: 'download', name: 'Kartendaten Deutschland', quelle: 'OpenStreetMap (Geofabrik)',
        vorhanden: !!pbfStand, geladen_am: iso(kartenDaten),
        // Neu, wenn der Anbieter einen jüngeren Stand hat als der, den wir geladen haben
        neu: neuer(pbfQuelle, pbfStand?.stand_quelle),
        auftrag: 'download', knopf: 'Neu laden'
      },
      {
        schluessel: 'hoehen', name: 'Höhendaten Deutschland', quelle: 'SRTM (Anbieter der Höhenkacheln)',
        vorhanden: !!hoehenStand, geladen_am: iso(hoehenDaten),
        neu: neuer(hoehenQuelle, hoehenStand?.stand_quelle),
        auftrag: 'hoehen', knopf: 'Neu laden'
      },
      {
        schluessel: 'karte', name: 'Karte', quelle: 'aus den Kartendaten',
        vorhanden: kartenVorhanden, geladen_am: iso(karteZeit),
        // Neu, wenn die Kartendaten nach dem letzten Kartenbau geladen wurden
        neu: neuer(kartenDaten, karteZeit),
        auftrag: 'karte', knopf: 'Neu bauen'
      },
      {
        schluessel: 'netz', name: 'Wegenetz', quelle: 'aus Kartendaten und Höhendaten',
        vorhanden: !!(netz && existsSync(join(netz, 'info.json'))), geladen_am: iso(netzZeit),
        neu: neuer(netzDaten, netzZeit),
        auftrag: 'netz', knopf: 'Neu bauen'
      },
      {
        schluessel: 'kacheln', name: 'Kacheln der Karte', quelle: 'aus der Karte',
        vorhanden: kachelVorhanden, geladen_am: iso(kachelZeit),
        // Neu, wenn die Karte nach den Kacheln neu gebaut wurde
        neu: neuer(karteZeit, kachelZeit),
        auftrag: 'kacheln', knopf: 'Neu erzeugen'
      }
    ]
  };
}
