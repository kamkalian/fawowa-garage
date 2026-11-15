// Gesamtgewicht eines Gespanns. Reine Funktion ohne Abhängigkeiten (läuft im Browser und auf dem Server).
// Das Gewicht der Zusatzakkus zählt zusätzlich zum Leergewicht von Fahrrad und Anhänger.

const zahl = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * gespann: { fahrer_gewicht_kg, gepaeck_kg }, fahrrad: { gewicht_kg, zusatzakku_gewicht_kg }, anhaenger: { leergewicht_kg, zusatzakku_gewicht_kg }
 * Ergebnis: { summe (kg, eine Nachkommastelle), fehlt: Liste der Angaben, die für ein vollständiges Gewicht noch fehlen }
 */
export function gesamtgewicht(gespann, fahrrad, anhaenger) {
  const fehlt = [];
  if (!(fahrrad?.gewicht_kg > 0)) fehlt.push('gewicht_kg');
  if (!(anhaenger?.leergewicht_kg > 0)) fehlt.push('leergewicht_kg');
  if (!(gespann?.fahrer_gewicht_kg > 0)) fehlt.push('fahrer_gewicht_kg');

  const summe = zahl(fahrrad?.gewicht_kg) + zahl(fahrrad?.zusatzakku_gewicht_kg)
    + zahl(anhaenger?.leergewicht_kg) + zahl(anhaenger?.zusatzakku_gewicht_kg)
    + zahl(gespann?.fahrer_gewicht_kg) + zahl(gespann?.gepaeck_kg);

  return { summe: Math.round(summe * 10) / 10, fehlt };
}
