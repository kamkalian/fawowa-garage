// Plausibilitätsprüfung des Wegenetzes: kürzeste Strecken zwischen bekannten Orten im Vergleich zur Luftlinie und zu bekannten Radstrecken.
// Aufruf: node tools/routing/qualitaet.js <Netzordner>
import { Netz, MODI } from './netz.js';
import { ORTE } from './orte.js';

const netz = new Netz(process.argv[2]);
const haversine = (a, b) => {
  const R = 6371000; const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r; const dLon = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
// [von, nach, ungefähre Strecke mit dem Rad in km laut gängigen Routenplanern]
const PAARE = [
  ['koeln_hbf', 'duesseldorf_hbf', 44], ['essen_hbf', 'dortmund_hbf', 38], ['koeln_hbf', 'bonn_hbf', 30], ['muenster_hbf', 'bielefeld_hbf', 80],
  ['aachen_hbf', 'koeln_hbf', 72], ['koeln_dom', 'koeln_deutz', 1.6], ['duesseldorf_hbf', 'wuppertal_hbf', 33], ['bielefeld_hbf', 'paderborn_hbf', 42],
  ['dortmund_hbf', 'hamm_hbf', 42], ['siegen_hbf', 'winterberg', 60]
];
console.log('Von → Nach'.padEnd(36), 'Luftlinie', ' Netz km', ' Referenz', ' Verhältnis zur Luftlinie', ' Abweichung zur Referenz');
for (const [a, b, ref] of PAARE) {
  const sa = netz.naechster(...ORTE[a]); const sb = netz.naechster(...ORTE[b]);
  const t0 = process.hrtime.bigint();
  const m = netz.kuerzesterWeg(sa.knoten, sb.knoten, 'alle');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const luft = haversine(ORTE[a], ORTE[b]) / 1000;
  const km = m === null ? NaN : m / 1000;
  console.log(`${a} → ${b}`.padEnd(36), luft.toFixed(1).padStart(8), km.toFixed(1).padStart(9), String(ref).padStart(9), (km / luft).toFixed(2).padStart(18), `${(((km - ref) / ref) * 100).toFixed(0)} %`.padStart(22), ` (${ms.toFixed(0)} ms, Abstand Start ${sa.abstand_m.toFixed(0)} m / Ziel ${sb.abstand_m.toFixed(0)} m)`);
}
console.log('\nModi, Köln Hbf → Düsseldorf Hbf:');
for (const modus of Object.keys(MODI)) {
  const sa = netz.naechster(...ORTE.koeln_hbf, MODI[modus]); const sb = netz.naechster(...ORTE.duesseldorf_hbf, MODI[modus]);
  const m = netz.kuerzesterWeg(sa.knoten, sb.knoten, modus);
  console.log(modus.padEnd(8), m === null ? 'keine Verbindung' : `${(m / 1000).toFixed(1)} km`, `(Start ${sa.abstand_m.toFixed(0)} m, Ziel ${sb.abstand_m.toFixed(0)} m vom Weg)`);
}

console.log('\nZusammenhang je Modus (Anteil der Knoten in Netzteilen mit mindestens 2000 Knoten, und Kanten im Modus)');
for (const [name, tab] of Object.entries(MODI)) {
  const gross = netz.grosseKomponenten(tab);
  let knoten = 0; for (let i = 0; i < netz.N; i++) knoten += gross[i];
  let kanten = 0; for (let e = 0; e < netz.E; e++) kanten += tab[netz.kFlags[e]];
  console.log(name.padEnd(8), `${(knoten / netz.N * 100).toFixed(0)} % der Knoten, ${(kanten / netz.E * 100).toFixed(0)} % der Kanten`);
}
