// Prüft den Einleser an der echten Datei: zählt Knoten und Wege und misst die Zeit.
import { leseDatei } from './pbf.js';
const datei = process.argv[2];
let knoten = 0, wege = 0, hw = 0, refsSumme = 0, letzte = 0, sortiert = true, minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
const t0 = Date.now();
leseDatei(datei, {
  knoten: (ids, lat, lon, n) => {
    for (let i = 0; i < n; i++) {
      if (ids[i] <= letzte) sortiert = false;
      letzte = ids[i];
      if (lat[i] < minLat) minLat = lat[i]; if (lat[i] > maxLat) maxLat = lat[i];
      if (lon[i] < minLon) minLon = lon[i]; if (lon[i] > maxLon) maxLon = lon[i];
    }
    knoten += n;
  },
  wege: (id, tags, refs, n) => { wege++; if (tags.highway) { hw++; refsSumme += n; } },
  schluessel: new Set(['highway']),
  fortschritt: (p, b) => { if (b % 500 === 0) console.log(`${(p * 100).toFixed(0)} %  ${((Date.now() - t0) / 1000).toFixed(0)} s  Knoten ${knoten}`); }
});
console.log({ knoten, wege, highwayWege: hw, highwayKnotenRefs: refsSumme, sortiert, bbox: [minLat, minLon, maxLat, maxLon], sekunden: (Date.now() - t0) / 1000 });
