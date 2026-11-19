// Akku-Chemie und Entladeverhalten. Ein Akku schaltet über sein BMS ab, sobald eine Zelle den Entladeschluss erreicht.
// Unter Last fällt die Klemmenspannung um I·R (Innenwiderstand), deshalb schaltet ein Akku bei hoher Leistung früher ab
// und ein Teil seiner Energie ist nicht nutzbar. Die Werte sind Richtwerte typischer Zellen (Annahmen), keine Messungen.
// Reine Funktionen ohne Abhängigkeiten (läuft auf dem Server und im Browser).

// Spannungsverlauf der Zelle über den Füllstand (0 = leer, 1 = voll), Stützstellen als [Füllstand, Volt]
const KURVE_LI = [[0, 2.75], [0.03, 3.0], [0.05, 3.3], [0.1, 3.5], [0.2, 3.6], [0.5, 3.7], [0.8, 3.85], [0.95, 4.05], [1, 4.2]];
const KURVE_LFP = [[0, 2.5], [0.02, 2.9], [0.05, 3.1], [0.1, 3.2], [0.5, 3.3], [0.9, 3.35], [1, 3.45]];
const KURVE_LTO = [[0, 1.5], [0.05, 1.9], [0.2, 2.1], [0.5, 2.3], [0.9, 2.4], [1, 2.5]];

/**
 * Je Chemie: nenn_v (Nennspannung je Zelle), voll_v (Ladeschluss), schluss_v (Entladeschluss je Zelle, BMS),
 * r_ohm_ah (Innenwiderstand je Zelle in Ω·Ah: Widerstand = r_ohm_ah / Ah der Zelle), kurve (Spannungsverlauf)
 */
export const AKKU_CHEMIE = Object.freeze({
  nmc: Object.freeze({ name: 'NMC', nenn_v: 3.6, voll_v: 4.2, schluss_v: 3.0, r_ohm_ah: 0.10, kurve: KURVE_LI }),
  nca: Object.freeze({ name: 'NCA', nenn_v: 3.6, voll_v: 4.2, schluss_v: 3.0, r_ohm_ah: 0.09, kurve: KURVE_LI }),
  lfp: Object.freeze({ name: 'LFP', nenn_v: 3.2, voll_v: 3.65, schluss_v: 2.8, r_ohm_ah: 0.12, kurve: KURVE_LFP }),
  lto: Object.freeze({ name: 'LTO', nenn_v: 2.3, voll_v: 2.8, schluss_v: 1.8, r_ohm_ah: 0.08, kurve: KURVE_LTO })
});
export const AKKU_CHEMIE_ARTEN = Object.freeze(Object.keys(AKKU_CHEMIE));

/** Füllstand (0..1), bei dem die Zellspannung den Wert v erreicht (Umkehrung des Verlaufs; unterhalb leer = 0, oberhalb voll = 1) */
export function fuellstandBeiSpannung(kurve, v) {
  if (v <= kurve[0][1]) return 0;
  for (let i = 1; i < kurve.length; i++) {
    const [s0, v0] = kurve[i - 1];
    const [s1, v1] = kurve[i];
    if (v <= v1) return s0 + (s1 - s0) * (v - v0) / (v1 - v0);
  }
  return 1;
}

/**
 * Anteil der Nennkapazität, der bei dieser Leistung nicht mehr entnommen werden kann, weil der Akku vorher abschaltet.
 * b: { chemie, s (Zellen in Reihe), p (parallel), ah (Kapazität des Akkus), v_nom (Nennspannung des Akkus), schluss_v (optional) }
 * Fehlen Angaben, ist der Anteil 0 (keine Abschaltung berechnet).
 */
export function unbrauchbarAnteil(b, leistungW) {
  if (!b || !b.chemie || !b.s || !b.p || !(b.ah > 0) || !(b.v_nom > 0)) return 0;
  const c = AKKU_CHEMIE[b.chemie] ?? AKKU_CHEMIE.nmc;
  const zellAh = b.ah / b.p;
  const iZelle = Math.max(0, leistungW) / b.v_nom / b.p;   // Strom je Zelle in A
  const sag = iZelle * c.r_ohm_ah / zellAh;                  // Spannungseinbruch unter Last je Zelle in V
  const schluss = b.schluss_v ?? c.schluss_v;
  return fuellstandBeiSpannung(c.kurve, schluss + sag);
}

/**
 * Nicht nutzbare Energie in Wh für alle Akkus des Gespanns. Die Leistung teilt sich nach der Kapazität auf (parallel).
 * batterien: [{ wh, chemie, s, p, ah, v_nom, schluss_v }]
 */
export function unbrauchbarWh(batterien, leistungW) {
  const gesamt = batterien.reduce((s, b) => s + (b.wh || 0), 0);
  if (!(gesamt > 0)) return 0;
  return batterien.reduce((s, b) => s + (b.wh || 0) * unbrauchbarAnteil(b, leistungW * (b.wh || 0) / gesamt), 0);
}

/** Nennspannung des Akkus in V aus Zellzahl und Chemie (ohne Angabe: null) */
export function nennspannungV(s, chemie) {
  if (!s || !AKKU_CHEMIE[chemie]) return null;
  return s * AKKU_CHEMIE[chemie].nenn_v;
}
