// Datei per HTTPS laden (Weiterleitungen folgen), damit der Worker die Kartendaten selbst holen kann.
import { createWriteStream, renameSync } from 'fs';
import https from 'https';

/**
 * Liefert { bytes, lastModified }; mit optional: true liefert ein fehlendes Ziel (404) { fehlt: true } statt eines Fehlers.
 * durchschritt(geladen, gesamt) meldet den Fortschritt in Bytes (höchstens alle 2 Sekunden).
 */
export function herunterladen(url, ziel, { durchschritt = () => {}, optional = false } = {}) {
  return new Promise((aufloesen, ablehnen) => {
    const holen = (adresse, weiter) => {
      if (weiter > 5) return ablehnen(new Error('Zu viele Weiterleitungen'));
      https.get(adresse, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return holen(new URL(res.headers.location, adresse).href, weiter + 1);
        }
        if (res.statusCode === 404 && optional) { res.resume(); return aufloesen({ fehlt: true }); }
        if (res.statusCode !== 200) { res.resume(); return ablehnen(new Error(`Download fehlgeschlagen (HTTP ${res.statusCode})`)); }
        const gesamt = Number(res.headers['content-length']) || 0;
        const lastModified = res.headers['last-modified'] ?? null;
        let geladen = 0;
        let letzter = 0;
        const datei = createWriteStream(ziel + '.teil');
        res.on('data', (buf) => {
          geladen += buf.length;
          if (Date.now() - letzter > 2000) { letzter = Date.now(); durchschritt(geladen, gesamt); }
        });
        res.pipe(datei);
        datei.on('finish', () => {
          renameSync(ziel + '.teil', ziel);
          durchschritt(geladen, gesamt);
          aufloesen({ bytes: geladen, lastModified });
        });
        datei.on('error', ablehnen);
        res.on('error', ablehnen);
      }).on('error', ablehnen);
    };
    holen(url, 0);
  });
}
