// Prüft die Höhen im Netz: Verteilung der Steigungen und Energie hin und zurück zwischen Orten verschiedener Höhe.
// Aufruf: node tools/routing/steigungen.js <Netzordner>
import { Netz, MODI } from '../../lib/netz.js';
import { ORTE } from './orte.js';
import { baueModell } from '../../lib/rechenmodell.js';

const netz = new Netz(process.argv[2]);
// Verteilung der Steigungen nach Wegstrecke
const grenzen = [0.02, 0.04, 0.06, 0.08, 0.12, 0.20];
const km = new Array(grenzen.length + 1).fill(0);
let gesamt = 0;
for (let l = 0; l < netz.legLen.length; l++) {
  const m = netz.legLen[l] / 10;
  const g = Math.abs(netz.legGrad[l] / 200);
  let i = 0; while (i < grenzen.length && g >= grenzen[i]) i++;
  km[i] += m; gesamt += m;
}
console.log('Anteil der Wegstrecke nach Steigung (Betrag):');
['unter 2 %', '2–4 %', '4–6 %', '6–8 %', '8–12 %', '12–20 %', 'über 20 %'].forEach((n, i) => console.log(' ', n.padEnd(10), `${(km[i] / gesamt * 100).toFixed(1)} %`));

const modell = baueModell({ motor_art: 'mittelmotor', motor_nennleistung_w: 250, akku_kapazitaet_wh: 625, schaltung_art: 'kette', radgroesse_zoll: 26, reifenbreite_mm: 50, gewicht_kg: 30 },
  { leergewicht_kg: 60, breite_cm: 80, hoehe_cm: 110, radgroesse_zoll: 20, reifenbreite_mm: 40, solar_wp: 100 }, { fahrer_gewicht_kg: 80, gepaeck_kg: 40 }).modell;
const tab = netz.kostenTabelle(modell);
const energie = (a, b) => {
  const sa = netz.naechster(...ORTE[a]); const sb = netz.naechster(...ORTE[b]);
  const r = netz.suche(sa.knoten, MODI.alle, (e, side) => netz.kantenEnergie(tab, e, side), Infinity, sb.knoten);
  return r.dist[sb.knoten];
};
console.log('\nEnergie (Wh) hin und zurück, Beispiel-Gespann, kürzester Weg nach Energie:');
for (const [a, b] of [['wuppertal_hbf', 'duesseldorf_hbf'], ['siegen_hbf', 'winterberg'], ['koeln_hbf', 'bonn_hbf'], ['muenster_hbf', 'bielefeld_hbf'], ['aachen_hbf', 'koeln_hbf']]) {
  const hin = energie(a, b); const zurueck = energie(b, a);
  console.log(`${a} → ${b}`.padEnd(36), `${hin.toFixed(0).padStart(5)} Wh`, ' | zurück', `${zurueck.toFixed(0).padStart(5)} Wh`, ' | Unterschied', `${((hin - zurueck) / Math.min(hin, zurueck) * 100).toFixed(0)} %`);
}
