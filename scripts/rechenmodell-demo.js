// Zeigt das Rechenmodell an einem Beispiel-Gespann: Verbrauch je Kilometer nach Steigung und Wind, und Reichweiten.
// Aufruf: node scripts/rechenmodell-demo.js
import { baueModell, berechneSegment, reichweiteEntlang } from '../lib/rechenmodell.js';

const fahrrad = { motor_art: 'mittelmotor', motor_nennleistung_w: 250, akku_kapazitaet_wh: 625, schaltung_art: 'kette', radgroesse_zoll: 26, reifenbreite_mm: 50, gewicht_kg: 30 };
const anhaenger = { leergewicht_kg: 60, breite_cm: 80, hoehe_cm: 110, radgroesse_zoll: 20, reifenbreite_mm: 40, solar_wp: 100 };
const gespann = { fahrer_gewicht_kg: 80, gepaeck_kg: 40 };

const modell = (einstellungen) => baueModell(fahrrad, anhaenger, gespann, einstellungen).modell;
const zeile = (...zellen) => zellen.map((z, i) => String(z).padStart(i === 0 ? 14 : 12)).join('');

const basis = modell({});
console.log(`Gespann: ${basis.masse_kg} kg gesamt, Akku ${basis.akku.kapazitaet_wh} Wh (nutzbar ${basis.akku.nutzbar_wh.toFixed(0)} Wh), Standard-Einstellungen\n`);

console.log('Steigung (nach Norden, ohne Wind)');
console.log(zeile('Steigung', 'km/h', 'Wh/km', 'Rad-W', 'schieben'));
for (const s of [-0.05, 0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.15]) {
  const r = berechneSegment(basis, { laenge_m: 1000, steigung: s, richtung_grad: 0 });
  console.log(zeile(`${(s * 100).toFixed(0)} %`, (r.v_ms * 3.6).toFixed(1), r.wh_pro_km.toFixed(1), r.leistung_rad_w.toFixed(0), r.schieben ? 'ja' : ''));
}

console.log('\nWind 5 m/s aus Nord, Fahrt in verschiedene Richtungen, eben');
console.log(zeile('Fahrt nach', 'km/h', 'Wh/km'));
for (const [name, grad] of [['Nord (Gegenw.)', 0], ['Ost (Seite)', 90], ['Süd (Rücken)', 180], ['West (Seite)', 270]]) {
  const r = berechneSegment(modell({ wind_ms: 5, wind_richtung_grad: 0 }), { laenge_m: 1000, steigung: 0, richtung_grad: grad });
  console.log(zeile(name, (r.v_ms * 3.6).toFixed(1), r.wh_pro_km.toFixed(1)));
}

console.log('\nReichweite auf ebener Strecke bei 100 % Akku');
const eben = Array.from({ length: 300 }, () => ({ laenge_m: 1000, steigung: 0, richtung_grad: 0 }));
for (const [name, einst] of [
  ['Standard', {}], ['Eco', { unterstuetzung: 'eco' }], ['Turbo', { unterstuetzung: 'turbo' }], ['Gegenwind 5 m/s', { wind_ms: 5 }],
  ['Sonne 800 W/m²', { einstrahlung_w_m2: 800 }], ['Akku 50 %', { akku_rest_prozent: 50 }]
]) {
  const r = reichweiteEntlang(modell(einst), eben);
  console.log(zeile(name, `${(r.strecke_m / 1000).toFixed(0)} km`, `${(r.zeit_s / 3600).toFixed(1)} h`));
}
