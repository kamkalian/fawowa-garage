// Das Gespann aus allen Zugfahrzeugen und Anhängern im Gespann. Für die Rechnung werden die Werte zusammengefasst:
// Gewichte, Akkus, Zusatzakkus und Motorleistungen werden addiert; die übrigen Angaben (Reifen, Schaltung, Motorart) kommen vom
// ersten Fahrzeug, das einen Motor hat (sonst vom ersten).
import { hatMotor } from './rechenmodell.js';

const summe = (liste, feld) => liste.reduce((s, x) => s + (Number(x[feld]) || 0), 0);

/** fahrraeder und anhaenger: die Einträge der Garage in gemeinsamer Reihenfolge; mitglieder: { fahrraeder: [id, ...], anhaenger: [id, ...] } */
export function gespannFuerRechnung(fahrraeder, anhaenger, mitglieder) {
  const zugfahrzeuge = (mitglieder?.fahrraeder ?? []).map(id => fahrraeder.find(f => f.id === id)).filter(Boolean);
  const anhaengerListe = (mitglieder?.anhaenger ?? []).map(id => anhaenger.find(a => a.id === id)).filter(Boolean);

  let fahrrad = null;
  if (zugfahrzeuge.length) {
    const basis = zugfahrzeuge.find(hatMotor) ?? zugfahrzeuge[0];
    fahrrad = {
      ...basis,
      gewicht_kg: summe(zugfahrzeuge, 'gewicht_kg') || basis.gewicht_kg,
      akku_kapazitaet_wh: summe(zugfahrzeuge, 'akku_kapazitaet_wh') || basis.akku_kapazitaet_wh,
      zusatzakku_wh: summe(zugfahrzeuge, 'zusatzakku_wh') || null,
      motor_nennleistung_w: summe(zugfahrzeuge.filter(hatMotor), 'motor_nennleistung_w') || basis.motor_nennleistung_w
    };
  }

  let anhaengerGesamt = null;
  if (anhaengerListe.length) {
    const basis = anhaengerListe[0];
    anhaengerGesamt = {
      ...basis,
      leergewicht_kg: summe(anhaengerListe, 'leergewicht_kg') || basis.leergewicht_kg,
      solar_wp: summe(anhaengerListe, 'solar_wp') || null,
      zusatzakku_wh: summe(anhaengerListe, 'zusatzakku_wh') || null
    };
  }
  return { fahrrad, anhaenger: anhaengerGesamt, zugfahrzeuge: zugfahrzeuge.length, anhaengerAnzahl: anhaengerListe.length };
}
