// Herkunft der Karten- und Höhendaten und die Stand-Datei, die der Worker nach jedem Download schreibt.
export const KARTEN_URL = 'https://download.geofabrik.de/europe/germany-latest.osm.pbf';
export const HOEHEN_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/skadi';
// Grad-Felder, die Deutschland abdecken (Südwest bis Nordost)
export const HOEHEN_LAT = [47, 55];
export const HOEHEN_LON = [5, 15];
export const STAND_DATEI = 'stand.json';

/** Name einer Höhenkachel, z. B. N47E006 (wie im SRTM-Datensatz) */
export function hoehenName(lat, lon) {
  const zahl = (n, stellen) => String(Math.abs(n)).padStart(stellen, '0');
  return `${lat >= 0 ? 'N' : 'S'}${zahl(lat, 2)}${lon >= 0 ? 'E' : 'W'}${zahl(lon, 3)}`;
}
