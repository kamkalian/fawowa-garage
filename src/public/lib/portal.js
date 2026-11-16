// Verschiebt ein Element in einen Platz außerhalb des Bereichs, in dem es erzeugt wurde (z. B. in die Kopfzeile).
// Die Stelle wird mit id angegeben; fehlt sie, bleibt das Element, wo es ist.
export function portal(node, ziel) {
  const platz = document.getElementById(ziel);
  if (platz) platz.appendChild(node);
  return {
    destroy() { node.remove(); }
  };
}
