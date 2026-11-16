// Bewertung von OpenStreetMap-Wegen für Fahrräder mit Anhänger: darf man hier radeln, in welche Richtung, auf welcher Art Weg, mit welchem Belag.

export const KLASSE = Object.freeze({ STRASSE: 1, RADWEG: 2, WEG: 4 });

/** Tag-Schlüssel, die der Einleser aus den Wegen holt */
export const SCHLUESSEL = new Set([
  'highway', 'oneway', 'oneway:bicycle', 'junction', 'access', 'bicycle', 'vehicle', 'motorroad', 'service', 'surface', 'tracktype', 'smoothness',
  'bridge', 'tunnel', 'cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both'
]);

const STRASSEN = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road']);
const WEGE = new Set(['track', 'path', 'footway', 'pedestrian', 'bridleway']);
const KEIN_ZUGANG = new Set(['no', 'private']);
const UNBRAUCHBARE_ZUFAHRTEN = new Set(['parking_aisle', 'drive-through', 'emergency_access']); // Zufahrten (driveway) gehören zum Straßennetz: sie verbinden die Straßen untereinander

// Rollwiderstand relativ zu glattem Asphalt
const BELAG = {
  asphalt: 1, concrete: 1.05, 'concrete:lanes': 1.1, 'concrete:plates': 1.15, paved: 1.1, paving_stones: 1.3, 'paving_stones:lanes': 1.3,
  sett: 1.9, cobblestone: 1.8, unhewn_cobblestone: 2.3, bricks: 1.5, compacted: 1.5, fine_gravel: 1.6, gravel: 2, pebblestone: 2.2, unpaved: 1.9,
  ground: 2.2, dirt: 2.2, earth: 2.2, mud: 3, grass: 2.6, sand: 3, wood: 1.3, metal: 1.2, rubber: 1.1, tartan: 1.1, grass_paver: 1.8
};
const BELAG_STANDARD_STRASSE = { primary: 1, secondary: 1, tertiary: 1, unclassified: 1.1, residential: 1.05, living_street: 1.3, service: 1.2, road: 1.2 };
const BELAG_TRACKTYPE = { grade1: 1.2, grade2: 1.5, grade3: 1.9, grade4: 2.2, grade5: 2.6 };

/** Darf man hier mit dem Fahrrad fahren? */
export function radErlaubt(t) {
  const hw = t.highway;
  const rad = t.bicycle;
  if (!hw) return false;
  if (rad === 'no' || rad === 'dismount') return false; // use_sidepath: erlaubt, wird aber markiert (siehe radwegPflicht)
  const ja = rad === 'yes' || rad === 'designated' || rad === 'permissive';
  if (!ja && (KEIN_ZUGANG.has(t.access) || KEIN_ZUGANG.has(t.vehicle))) return false;

  if (hw === 'cycleway') return true;
  if (hw === 'footway' || hw === 'pedestrian' || hw === 'bridleway') return ja;
  if (hw === 'path' || hw === 'track') return true;
  if (hw === 'trunk' || hw === 'trunk_link') return ja;
  if (STRASSEN.has(hw)) {
    if (t.motorroad === 'yes' && !ja) return false;
    if (hw === 'service' && UNBRAUCHBARE_ZUFAHRTEN.has(t.service)) return false;
    return true;
  }
  return false;
}

/** Art des Wegs: STRASSE (Straße für alle), RADWEG (eigener Radweg) oder WEG (Wirtschaftsweg, Pfad, Fuß- und Reitweg mit Freigabe) */
export function klasse(t) {
  if (t.highway === 'cycleway') return KLASSE.RADWEG;
  if (WEGE.has(t.highway)) return t.bicycle === 'designated' ? KLASSE.RADWEG : KLASSE.WEG;
  return KLASSE.STRASSE;
}

const HAUPTSTRASSEN = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);

/** Hauptstraße (Bundes-, Land-, Kreisstraße) im Gegensatz zu Wohn- und Nebenstraßen */
export function hauptstrasse(t) { return HAUPTSTRASSEN.has(t.highway); }

/** An der Straße soll ein getrennter Radweg benutzt werden (bicycle=use_sidepath); auf der Straße selbst wäre das Radeln dort nicht vorgesehen */
export function radwegPflicht(t) { return t.bicycle === 'use_sidepath'; }

/** Fahrtrichtungen für Fahrräder: 1 = in Richtung der Wegpunkte, 2 = dagegen, 3 = beide */
export function fahrtrichtung(t) {
  const gegenrichtungFrei = ['cycleway', 'cycleway:left', 'cycleway:right', 'cycleway:both'].some(k => typeof t[k] === 'string' && t[k].startsWith('opposite'));
  if (t['oneway:bicycle'] === 'no' || gegenrichtungFrei) return 3;
  const ow = t['oneway:bicycle'] ?? t.oneway;
  if (ow === 'yes' || ow === 'true' || ow === '1') return 1;
  if (ow === '-1' || ow === 'reverse') return 2;
  if (t.junction === 'roundabout' && ow === undefined) return 1;
  return 3;
}

/** Rollwiderstand relativ zu Asphalt (Zahl zwischen 0,8 und 4) */
export function belagsfaktor(t) {
  let f = BELAG[t.surface];
  if (f === undefined) {
    if (t.highway === 'track') f = BELAG_TRACKTYPE[t.tracktype] ?? 1.8;
    else if (t.highway === 'path') f = 1.8;
    else if (t.highway === 'footway' || t.highway === 'pedestrian' || t.highway === 'bridleway') f = 1.3;
    else if (t.highway === 'cycleway') f = 1.05;
    else f = BELAG_STANDARD_STRASSE[t.highway] ?? 1.1;
  }
  const s = t.smoothness;
  if (s === 'bad') f *= 1.2;
  else if (s === 'very_bad' || s === 'horrible' || s === 'very_horrible' || s === 'impassable') f *= 1.5;
  return Math.min(4, Math.max(0.8, f));
}

/** Brücke oder Tunnel: das Höhenmodell zeigt dort das Gelände, nicht den Weg */
export function bruecke(t) {
  const b = t.bridge;
  const tu = t.tunnel;
  return (b !== undefined && b !== 'no') || (tu !== undefined && tu !== 'no' && tu !== 'building_passage');
}

/** Ergebnis: null (nicht befahrbar) oder { klasse, fahrt, belag (Faktor × 20, ganze Zahl), bruecke, haupt, sidepath } */
export function bewerteWeg(t) {
  if (!radErlaubt(t)) return null;
  return {
    klasse: klasse(t), fahrt: fahrtrichtung(t), belag: Math.round(belagsfaktor(t) * 20), bruecke: bruecke(t),
    haupt: klasse(t) === KLASSE.STRASSE && hauptstrasse(t), sidepath: radwegPflicht(t)
  };
}
