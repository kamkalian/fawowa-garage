// Hintergrund-Thread des Routing-Dienstes: hält das Wegenetz im Speicher und führt die Aufträge nacheinander aus,
// damit eine Reichweitensuche (bis zu einigen Sekunden) die Anwendung nicht blockiert.
import { parentPort, workerData } from 'worker_threads';
import { Netz } from './netz.js';
import { rechneReichweite } from './reichweite.js';
import { kachelKarte, KarteBasis } from './karte-daten.js';

const netz = new Netz(workerData.ordner, { minKomponente: workerData.minKomponente });
const basis = workerData.mitKarte ? KarteBasis.laden(workerData.ordner) : null;
parentPort.postMessage({
  art: 'bereit',
  info: { knoten: netz.N, kanten: netz.E, bbox: netz.bbox, ramMB: Math.round(process.memoryUsage().rss / 1048576), grundkarte: !!basis }
});

parentPort.on('message', (auftrag) => {
  try {
    if (auftrag.art === 'reichweite') {
      parentPort.postMessage({ id: auftrag.id, ergebnis: rechneReichweite(netz, auftrag.eingabe) });
    } else if (auftrag.art === 'linien') {
      const buf = kachelKarte(netz, basis, auftrag.z, auftrag.x, auftrag.y);
      parentPort.postMessage({ id: auftrag.id, ergebnis: buf }, [buf]);
    } else {
      parentPort.postMessage({ id: auftrag.id, fehler: 'Unbekannter Auftrag' });
    }
  } catch (e) {
    parentPort.postMessage({ id: auftrag.id, fehler: e.message });
  }
});
