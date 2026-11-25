// Farbpaare für die Icons von Fahrrad, Anhänger und Gepäck. Jedes Paar hat eine helle und eine dunkle Variante:
// auf hellem Grund wird das Icon in der dunklen, auf dunklem Grund in der hellen Variante gezeigt.
// Gespeichert wird die dunkle Variante (Hex-Wert); daraus ergibt sich das Paar.
// Dieselbe Datei nutzen Browser und Formular.

export const FARBPAARE = Object.freeze([
  { de: 'Rot', en: 'Red', hell: '#fca5a5', dunkel: '#b91c1c' },
  { de: 'Orange', en: 'Orange', hell: '#fdba74', dunkel: '#c2410c' },
  { de: 'Gelb', en: 'Yellow', hell: '#fde047', dunkel: '#b45309' },
  { de: 'Grün', en: 'Green', hell: '#86efac', dunkel: '#15803d' },
  { de: 'Cyan', en: 'Cyan', hell: '#67e8f9', dunkel: '#0e7490' },
  { de: 'Blau', en: 'Blue', hell: '#93c5fd', dunkel: '#1d4ed8' },
  { de: 'Lila', en: 'Purple', hell: '#d8b4fe', dunkel: '#7e22ce' },
  { de: 'Pink', en: 'Pink', hell: '#f9a8d4', dunkel: '#be185d' },
  { de: 'Grau', en: 'Grey', hell: '#e7e5e4', dunkel: '#44403c' }
]);

/** Das Farbpaare zu einem gespeicherten Hex-Wert (hell oder dunkel), sonst null */
export function paarZu(hex) {
  if (!hex) return null;
  const h = hex.toLowerCase();
  return FARBPAARE.find((p) => p.dunkel === h || p.hell === h) ?? null;
}
