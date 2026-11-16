import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gespannFuerRechnung } from '../lib/gespann.js';

const RAD_A = { id: 1, name: 'Ebike', gewicht_kg: 25, motoren: [{ motor_art: 'mittelmotor', leistung_w: 250 }], akkus: [{ kapazitaet_wh: 625 }, { kapazitaet_wh: 300 }] };
const RAD_B = { id: 2, name: 'Zweitrad', gewicht_kg: 20, motoren: [{ motor_art: 'nabe_hinten', leistung_w: 250 }, { motor_art: 'nabe_vorn', leistung_w: 100 }], akkus: [{ kapazitaet_wh: 400 }] };
const WAGEN = { id: 5, name: 'Anhänger', leergewicht_kg: 40, solar_wp: 100, motoren: [], akkus: [{ kapazitaet_wh: 500 }] };

test('Gespann: Hauptakku je Fahrrad, weitere Akkus als Zusatzakku, Motorleistungen addiert', () => {
  const g = gespannFuerRechnung([RAD_A, RAD_B], [WAGEN], { fahrraeder: [1, 2], anhaenger: [5] });
  assert.equal(g.zugfahrzeuge, 2);
  assert.equal(g.fahrrad.akku_kapazitaet_wh, 1025, 'Hauptakkus 625 + 400');
  assert.equal(g.fahrrad.zusatzakku_wh, 300, 'Zusatzakku des ersten Rads');
  assert.equal(g.fahrrad.motor_nennleistung_w, 600, 'Motoren beider Räder: 250 + 250 + 100');
  assert.equal(g.fahrrad.motor_art, 'mittelmotor', 'Motorart des ersten Motors');
  assert.equal(g.fahrrad.gewicht_kg, 45);
  assert.equal(g.anhaenger.zusatzakku_wh, 500);
  assert.equal(g.anhaenger.leergewicht_kg, 40);
});

test('Gespann: ohne Motor und ohne Akku bleiben die Felder leer', () => {
  const ohne = { id: 3, name: 'Normal', gewicht_kg: 15, motoren: [], akkus: [] };
  const g = gespannFuerRechnung([ohne], [], { fahrraeder: [3], anhaenger: [] });
  assert.equal(g.fahrrad.motor_art, 'ohne');
  assert.equal(g.fahrrad.motor_nennleistung_w, 0);
  assert.equal(g.fahrrad.akku_kapazitaet_wh, null);
  assert.equal(g.anhaenger, null);
});

test('Gespann: leeres Gespann ergibt kein Fahrrad', () => {
  assert.deepEqual(gespannFuerRechnung([RAD_A], [WAGEN], {}), { fahrrad: null, anhaenger: null, zugfahrzeuge: 0, anhaengerAnzahl: 0, gepaeck_kg: null });
});
