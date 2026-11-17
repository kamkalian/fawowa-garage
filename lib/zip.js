// ZIP-Datei auspacken (für den Worker: das hochgeladene Wegenetz). Die Zip-Bibliothek liest die Datei Eintrag für Eintrag.
import yauzl from 'yauzl';
import { mkdirSync, createWriteStream } from 'fs';
import { dirname, resolve, sep } from 'path';

/**
 * ZIP-Datei in einen Ordner auspacken. Fortschritt in Prozent (nach Anzahl der Dateien).
 * Pfade, die aus dem Ordner herausführen, werden abgelehnt.
 */
export function entpacken(zipDatei, ziel, fortschritt) {
  return new Promise((aufloesen, ablehnen) => {
    yauzl.open(zipDatei, { lazyEntries: true, autoClose: true }, (fehler, zip) => {
      if (fehler) return ablehnen(fehler);
      const gesamt = Math.max(1, zip.entryCount);
      let fertig = 0;
      const wurzel = resolve(ziel) + sep;
      zip.readEntry();
      zip.on('entry', (eintrag) => {
        const pfad = resolve(ziel, eintrag.fileName);
        if (!pfad.startsWith(wurzel)) return ablehnen(new Error('Ungültiger Pfad in der ZIP-Datei'));
        const weiter = () => { fertig++; fortschritt(Math.floor(fertig / gesamt * 100)); zip.readEntry(); };
        if (/\/$/.test(eintrag.fileName)) { mkdirSync(pfad, { recursive: true }); return weiter(); }
        mkdirSync(dirname(pfad), { recursive: true });
        zip.openReadStream(eintrag, (fehler2, strom) => {
          if (fehler2) return ablehnen(fehler2);
          const datei = createWriteStream(pfad);
          strom.on('error', ablehnen);
          datei.on('error', ablehnen);
          datei.on('finish', weiter);
          strom.pipe(datei);
        });
      });
      zip.on('end', () => aufloesen(fertig));
      zip.on('error', ablehnen);
    });
  });
}

