// Symbole für Bauart (Fahrrad, Trike, Quad, Lastenrad) und Art des Anhängers.
// Raster 48 × 48, Strichzeichnung in currentColor. Fahrräder und Lastenräder in Seitenansicht (2D);
// Trikes, Quads und Anhänger in räumlicher Ansicht (Projektion aus einfachen 3D-Modellen, siehe unten).

// --- 2D-Symbole ---
const ZWEI_D = {
  fahrrad: '<circle cx="11" cy="32" r="8.5"/><circle cx="37" cy="32" r="8.5"/><path d="M11 32 L22 32 L19 18 H31 L37 32 M22 32 L31 18 M19 18 L11 32 M31 18 L33 12 M29 12 H37 M14 15 H23"/>',
  fahrrad_dach: '<circle cx="11" cy="32" r="8.5"/><circle cx="37" cy="32" r="8.5"/><path d="M11 32 L22 32 L19 18 H31 L37 32 M22 32 L31 18 M19 18 L11 32 M31 18 L33 12 M29 12 H37 M14 15 H23"/><path d="M12 15 Q13 5 24 5 Q35 5 36 15"/>',
  fahrrad_kabine: '<circle cx="11" cy="32" r="8.5"/><circle cx="37" cy="32" r="8.5"/><path d="M11 32 L22 32 L19 18 H31 L37 32 M22 32 L31 18 M19 18 L11 32 M31 18 L33 12 M29 12 H37 M14 15 H23"/><rect x="11" y="3" width="26" height="12" rx="3"/>',
  lastenrad: '<circle cx="12" cy="34" r="6"/><circle cx="36" cy="34" r="6"/><rect x="4" y="12" width="16" height="16" rx="2"/><path d="M12 34 L24 24 H30 L36 34 M24 24 L27 14 H32"/>',
  lastenrad_kabine: '<circle cx="12" cy="34" r="6"/><circle cx="36" cy="34" r="6"/><rect x="4" y="6" width="20" height="22" rx="3"/><path d="M8 12 H20 V20 H8 Z"/><path d="M12 34 L24 26 H30 L36 34 M24 26 L27 16 H32"/>',
  gepaeck: '<rect x="8" y="14" width="32" height="24" rx="3"/><path d="M8 22 H40 M19 14 V10 H29 V14"/>'
};

// --- 3D-Modelle: Linienzüge aus Punkten [x, y, z]. x nach vorn, y nach oben, z nach rechts. ---
const kreis = (c, r, n = 28) => Array.from({ length: n + 1 }, (_, i) => {
  const t = (2 * Math.PI * i) / n; return [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t), c[2]];
});
const kiste = (x0, x1, y0, y1, z0, z1) => {
  const a = [x0, y0, z0], b = [x1, y0, z0], c = [x1, y0, z1], d = [x0, y0, z1];
  const e = [x0, y1, z0], f = [x1, y1, z0], g = [x1, y1, z1], h = [x0, y1, z1];
  return [[e, f, g, h, e], [a, e], [b, f], [c, g], [d, h]];
};
const linie = (...punkte) => punkte;
const DACH_TRIKE = [linie([-0.75, 1.75, -0.55], [-0.75, 1.75, 0.55], [0.25, 1.75, 0.55], [0.25, 1.75, -0.55], [-0.75, 1.75, -0.55]),
  linie([-0.75, 1.75, -0.55], [-0.75, 1.2, -0.55]), linie([0.25, 1.75, -0.55], [0.25, 1.2, -0.55])];
const DACH_QUAD = [linie([-0.45, 1.6, -0.5], [-0.45, 1.6, 0.5], [0.45, 1.6, 0.5], [0.45, 1.6, -0.5], [-0.45, 1.6, -0.5]),
  linie([-0.45, 1.6, -0.5], [-0.45, 0.8, -0.5]), linie([0.45, 1.6, -0.5], [0.45, 0.8, -0.5])];

const TRIKE = [
  kreis([-0.9, 0.5, -0.7], 0.5), kreis([-0.9, 0.5, 0.7], 0.5), kreis([0.95, 0.5, 0], 0.5),
  linie([-0.9, 0.5, -0.7], [-0.9, 0.5, 0.7]),
  linie([-0.5, 1.2, 0], [-0.9, 0.5, 0]),
  linie([-0.5, 1.2, 0], [0.45, 1.2, 0], [0.95, 0.5, 0]),
  linie([-0.75, 1.2, -0.2], [-0.3, 1.2, 0.2]),
  linie([0.45, 1.2, 0], [0.5, 1.6, 0]), linie([0.5, 1.6, -0.4], [0.5, 1.6, 0.4])
];
const QUAD = [
  kreis([-0.8, 0.42, -0.75], 0.42), kreis([-0.8, 0.42, 0.75], 0.42), kreis([0.8, 0.42, -0.75], 0.42), kreis([0.8, 0.42, 0.75], 0.42),
  linie([-0.6, 0.8, -0.5], [0.6, 0.8, -0.5], [0.6, 0.8, 0.5], [-0.6, 0.8, 0.5], [-0.6, 0.8, -0.5]),
  linie([-0.4, 0.8, -0.2], [-0.4, 1.1, -0.2], [0.1, 1.1, -0.2], [0.1, 1.1, 0.2], [-0.4, 1.1, 0.2], [-0.4, 0.8, 0.2]),
  linie([0.6, 0.8, 0], [0.7, 1.3, 0]), linie([0.7, 1.3, -0.45], [0.7, 1.3, 0.45])
];
const DEICHSEL = (x) => linie([x, 0.8, 0], [x - 0.55, 0.75, 0]);
const ANHAENGER = {
  einachser: [...kiste(-0.9, 0.9, 0.55, 1.35, -0.6, 0.6), kreis([0, 0.4, -0.6], 0.4), kreis([0, 0.4, 0.6], 0.4), DEICHSEL(-0.9)],
  doppelachser: [...kiste(-0.9, 0.9, 0.55, 1.35, -0.6, 0.6), kreis([-0.3, 0.4, -0.6], 0.4), kreis([-0.3, 0.4, 0.6], 0.4), kreis([0.3, 0.4, -0.6], 0.4), kreis([0.3, 0.4, 0.6], 0.4), DEICHSEL(-0.9)],
  drehschemel: [...kiste(-0.5, 0.9, 0.55, 1.35, -0.6, 0.6), ...kiste(-0.95, -0.5, 0.6, 0.95, -0.35, 0.35), kreis([0.3, 0.4, -0.6], 0.4), kreis([0.3, 0.4, 0.6], 0.4), linie([-0.95, 0.75, 0], [-1.5, 0.7, 0])],
  lastenanhaenger: [...kiste(-0.9, 0.9, 0.55, 1.6, -0.6, 0.6), linie([-0.9, 1.1, -0.6], [0.9, 1.1, -0.6]), kreis([0, 0.4, -0.6], 0.4), kreis([0, 0.4, 0.6], 0.4), DEICHSEL(-0.9)],
  wohnkabine: [...kiste(-0.9, 0.9, 0.55, 1.2, -0.6, 0.6), linie([-0.9, 1.2, -0.6], [-0.9, 1.2, 0.6], [0.9, 1.2, 0.6], [0.9, 1.2, -0.6], [-0.9, 1.2, -0.6]), linie([-0.9, 1.2, 0], [-0.4, 1.6, 0], [0.4, 1.6, 0], [0.9, 1.2, 0]), kreis([-0.5, 0.4, -0.6], 0.4), kreis([-0.5, 0.4, 0.6], 0.4), kreis([0.4, 0.4, -0.6], 0.4), kreis([0.4, 0.4, 0.6], 0.4), DEICHSEL(-0.9)],
  sonstiges: [...kiste(-0.9, 0.9, 0.55, 1.2, -0.6, 0.6), kreis([0, 0.4, -0.6], 0.4), kreis([0, 0.4, 0.6], 0.4), DEICHSEL(-0.9)]
};
const MODELLE = {
  trike: TRIKE, trike_dach: [...TRIKE, ...DACH_TRIKE],
  quad: QUAD, quad_dach: [...QUAD, ...DACH_QUAD],
  ...ANHAENGER
};

// Schräge Ansicht (isometrisch): Blick von vorn-rechts oben
const C30 = Math.cos(Math.PI / 6);
const projiziere = ([x, y, z]) => [(z - x) * C30, (x + z) * 0.5 - y];

// Alle 3D-Modelle gemeinsam auf den Raster-Maßstab bringen, damit die Symbole gleich groß wirken
const alleProjiziert = Object.values(MODELLE).flat().flatMap(linie_ => linie_.map(projiziere));
const x0 = Math.min(...alleProjiziert.map(p => p[0])), x1 = Math.max(...alleProjiziert.map(p => p[0]));
const y0 = Math.min(...alleProjiziert.map(p => p[1])), y1 = Math.max(...alleProjiziert.map(p => p[1]));
const massstab = 40 / Math.max(x1 - x0, y1 - y0);
const aufRaster = ([x, y, z]) => {
  const [px, py] = projiziere([x, y, z]);
  return [4 + (px - x0) * massstab + (40 - (x1 - x0) * massstab) / 2, 4 + (py - y0) * massstab + (40 - (y1 - y0) * massstab) / 2];
};
const pfad3d = (linien) => linien.map(l => 'M' + l.map(p => aufRaster(p).map(v => v.toFixed(1)).join(' ')).join(' L')).join(' ');

/** Symbol je Schlüssel (Bauart oder Art des Anhängers) */
export const ICONS = {
  ...ZWEI_D,
  ...Object.fromEntries(Object.entries(MODELLE).map(([k, linien]) => [k, pfad3d(linien)]))
};
