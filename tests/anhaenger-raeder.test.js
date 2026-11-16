import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anzahlRaederAbleiten, ARTEN } from '../lib/felder.js';

test('Anhänger: Art mit einer Achse hat 2 Räder, Doppelachse 4; andere Arten bleiben unverändert', () => {
  assert.equal(anzahlRaederAbleiten({ aufbau: 'einachser', anzahl_raeder: 3 }).anzahl_raeder, 2);
  assert.equal(anzahlRaederAbleiten({ aufbau: 'doppelachser', anzahl_raeder: 2 }).anzahl_raeder, 4);
  assert.equal(anzahlRaederAbleiten({ aufbau: 'drehschemel', anzahl_raeder: 3 }).anzahl_raeder, 3);
});

test('Bauart: Fahrrad mit Wohnkabine ist auswählbar', () => {
  const bauart = ARTEN.fahrraeder.felder.find(f => f.key === 'bauart');
  assert.ok(bauart.optionen.some(o => o.wert === 'fahrrad_kabine'));
});
