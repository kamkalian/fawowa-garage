// Einstellungen des Reichweiten-Planers im Profil der Garage. Der Server nimmt nur bekannte Felder an und prüft sie;
// was fehlt oder ungültig ist, bekommt den Standardwert.
import { pruefeEinstellungen } from './rechenmodell.js';
import { MODUS_NAMEN } from './reichweite.js';

const FELDER = [
  'akku_rest_prozent', 'zusatz_rest_prozent', 'fahrtzeit_h', 'reserve_prozent', 'eigenleistung_max_w', 'geschwindigkeit_kmh',
  'unterstuetzung', 'wind_ms', 'wind_richtung_grad', 'einstrahlung_w_m2', 'temperatur_c', 'hoehe_m', 'oberflaeche'
];

/** Macht aus den Angaben des Planers eine bereinigte Fassung zum Speichern */
export function bereinigePlaner(roh) {
  const q = roh && typeof roh === 'object' && !Array.isArray(roh) ? roh : {};
  const { werte } = pruefeEinstellungen(q.e);
  const e = {};
  for (const k of FELDER) e[k] = werte[k];
  return {
    stil: q.stil === 'sportlich' ? 'sportlich' : 'gemuetlich',
    modus: MODUS_NAMEN.includes(q.modus) ? q.modus : 'alle',
    wahlAkku: q.wahlAkku !== false,
    schrittIdx: [0, 1, 2].includes(q.schrittIdx) ? q.schrittIdx : 2,
    weitere: q.weitere === true,
    e
  };
}
