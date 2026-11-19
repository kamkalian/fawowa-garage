// Name einer Höhenkachel (z. B. N47E006, wie im SRTM-Datensatz). Die Daten selbst lädt der Server nicht mehr; das macht das Daten-Werkzeug.

/** Name einer Höhenkachel, z. B. N47E006 (wie im SRTM-Datensatz) */
export function hoehenName(lat, lon) {
  const zahl = (n, stellen) => String(Math.abs(n)).padStart(stellen, '0');
  return `${lat >= 0 ? 'N' : 'S'}${zahl(lat, 2)}${lon >= 0 ? 'E' : 'W'}${zahl(lon, 3)}`;
}
