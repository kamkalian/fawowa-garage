// Orte in NRW für Tests (Bahnhöfe und bekannte Punkte): [Breite, Länge]
export const ORTE = {
  koeln_hbf: [50.9430, 6.9589], koeln_dom: [50.9413, 6.9583], koeln_deutz: [50.9411, 6.9745],
  duesseldorf_hbf: [51.2200, 6.7942], dortmund_hbf: [51.5178, 7.4590], essen_hbf: [51.4513, 7.0143],
  muenster_hbf: [51.9566, 7.6357], bielefeld_hbf: [52.0291, 8.5327], aachen_hbf: [50.7678, 6.0911],
  bonn_hbf: [50.7320, 7.0969], wuppertal_hbf: [51.2548, 7.1501], paderborn_hbf: [51.7132, 8.7406],
  siegen_hbf: [50.8756, 8.0200], winterberg: [51.1925, 8.5300], bocholt: [51.8383, 6.6156], hamm_hbf: [51.6783, 7.8081]
};
export function ort(text) {
  if (ORTE[text]) return ORTE[text];
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(text ?? '');
  if (m) return [Number(m[1]), Number(m[2])];
  throw new Error(`Unbekannter Ort "${text}". Bekannt: ${Object.keys(ORTE).join(', ')} oder "breite,länge"`);
}
