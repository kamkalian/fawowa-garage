// Das Gespann aus allen Zugfahrzeugen und Anhängern im Gespann. Für die Rechnung werden die Werte zusammengefasst:
// Gewichte, Akkus und Motorleistungen werden addiert. Je Zugfahrzeug gilt der erste Akku als Hauptakku, die weiteren als Zusatzakkus.
// Motoren von Anhängern zählen zur Motorleistung. Schaltung und Reifen kommen vom ersten Zugfahrzeug (mit Motor, sonst vom ersten).
// Die Rechnung kennt die Gewichte der Zusatzakkus nicht mehr; die Felder bleiben leer.
import { hatMotor } from './rechenmodell.js';

const summe = (werte) => werte.reduce((s, x) => s + (Number(x) || 0), 0);
const motoren = (e) => e?.motoren ?? [];
const akkus = (e) => e?.akkus ?? [];

/** fahrraeder und anhaenger: die Einträge der Garage mit Listen motoren und akkus; mitglieder: { fahrraeder: [id, ...], anhaenger: [id, ...] } */
export function gespannFuerRechnung(fahrraeder, anhaenger, mitglieder, gepaecke = []) {
  const zugfahrzeuge = (mitglieder?.fahrraeder ?? []).map(id => fahrraeder.find(f => f.id === id)).filter(Boolean);
  const anhaengerListe = (mitglieder?.anhaenger ?? []).map(id => anhaenger.find(a => a.id === id)).filter(Boolean);
  // Gepäck im Gespann: die Summe der Gewichte aller zugeordneten Gepäck-Kacheln (Zuladung)
  const gepaeckListe = (mitglieder?.gepaecke ?? []).map(id => gepaecke.find(g => g.id === id)).filter(Boolean);

  const alleMotoren = [...zugfahrzeuge, ...anhaengerListe].flatMap(motoren);
  const basis = zugfahrzeuge.find(z => motoren(z).length) ?? zugfahrzeuge[0];

  let fahrrad = null;
  if (zugfahrzeuge.length) {
    const hauptakkus = zugfahrzeuge.map(z => akkus(z)[0]?.kapazitaet_wh).filter(x => x != null);
    const zusatzakkus = zugfahrzeuge.flatMap(z => akkus(z).slice(1)).map(a => a.kapazitaet_wh);
    fahrrad = {
      ...basis,
      gewicht_kg: summe(zugfahrzeuge.map(z => z.gewicht_kg)) || basis.gewicht_kg,
      motor_art: alleMotoren[0]?.motor_art ?? 'ohne',
      motor_nennleistung_w: summe(alleMotoren.map(m => m.leistung_w)),
      akku_kapazitaet_wh: summe(hauptakkus) || null,
      zusatzakku_wh: summe(zusatzakkus) || null,
      zusatzakku_gewicht_kg: null
    };
  }

  let anhaengerGesamt = null;
  if (anhaengerListe.length) {
    const basisAnhaenger = anhaengerListe[0];
    anhaengerGesamt = {
      ...basisAnhaenger,
      leergewicht_kg: summe(anhaengerListe.map(a => a.leergewicht_kg)) || basisAnhaenger.leergewicht_kg,
      solar_wp: summe(anhaengerListe.map(a => a.solar_wp)) || null,
      zusatzakku_wh: summe(anhaengerListe.flatMap(akkus).map(a => a.kapazitaet_wh)) || null,
      zusatzakku_gewicht_kg: null
    };
  }
  return {
    fahrrad, anhaenger: anhaengerGesamt, zugfahrzeuge: zugfahrzeuge.length, anhaengerAnzahl: anhaengerListe.length,
    gepaeck_kg: summe(gepaeckListe.map(g => g.gewicht_kg)) || null
  };
}
