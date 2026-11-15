import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bewerteWeg, belagsfaktor, KLASSE } from '../tools/routing/tags.js';
import { Netz, MODI } from '../lib/netz.js';
import { baueModell } from '../lib/rechenmodell.js';
import { testNetz } from './hilfen-netz.js';

const t = (tags) => bewerteWeg(tags);

test('Wege: Straßen sind befahrbar, Autobahn und Treppen nicht', () => {
  assert.equal(t({ highway: 'residential' }).klasse, KLASSE.STRASSE);
  assert.equal(t({ highway: 'tertiary' }).haupt, true);
  assert.equal(t({ highway: 'residential' }).haupt, false);
  for (const hw of ['motorway', 'motorway_link', 'steps', 'construction', 'proposed', 'corridor', undefined]) assert.equal(t({ highway: hw }), null, String(hw));
  assert.equal(t({ highway: 'trunk' }), null, 'Schnellstraße nur mit Freigabe');
  assert.ok(t({ highway: 'trunk', bicycle: 'yes' }));
});

test('Wege: Radwege, Wirtschaftswege, Pfade, Fußwege nach Freigabe', () => {
  assert.equal(t({ highway: 'cycleway' }).klasse, KLASSE.RADWEG);
  assert.equal(t({ highway: 'track' }).klasse, KLASSE.WEG);
  assert.equal(t({ highway: 'path' }).klasse, KLASSE.WEG);
  assert.equal(t({ highway: 'path', bicycle: 'designated' }).klasse, KLASSE.RADWEG);
  assert.equal(t({ highway: 'footway' }), null, 'Fußweg nur mit Freigabe');
  assert.equal(t({ highway: 'footway', bicycle: 'yes' }).klasse, KLASSE.WEG);
  assert.equal(t({ highway: 'pedestrian' }), null);
  assert.equal(t({ highway: 'bridleway' }), null);
});

test('Wege: Verbote und Zugangsbeschränkungen', () => {
  assert.equal(t({ highway: 'residential', bicycle: 'no' }), null);
  assert.equal(t({ highway: 'residential', bicycle: 'dismount' }), null);
  assert.equal(t({ highway: 'residential', access: 'private' }), null);
  assert.ok(t({ highway: 'residential', access: 'private', bicycle: 'yes' }), 'Freigabe für Räder geht vor');
  assert.equal(t({ highway: 'track', vehicle: 'no' }), null);
  assert.equal(t({ highway: 'service', service: 'driveway' }), null);
  assert.equal(t({ highway: 'service', service: 'parking_aisle' }), null);
  assert.ok(t({ highway: 'service' }));
  assert.equal(t({ highway: 'primary', motorroad: 'yes' }), null);
  // Radweg-Pflicht: erlaubt, aber markiert
  assert.equal(t({ highway: 'secondary', bicycle: 'use_sidepath' }).sidepath, true);
  assert.equal(t({ highway: 'secondary' }).sidepath, false);
});

test('Einbahnstraßen: Fahrtrichtungen für Fahrräder', () => {
  assert.equal(t({ highway: 'residential' }).fahrt, 3);
  assert.equal(t({ highway: 'residential', oneway: 'yes' }).fahrt, 1);
  assert.equal(t({ highway: 'residential', oneway: '-1' }).fahrt, 2);
  assert.equal(t({ highway: 'residential', oneway: 'yes', 'oneway:bicycle': 'no' }).fahrt, 3, 'für Räder frei');
  assert.equal(t({ highway: 'residential', oneway: 'yes', cycleway: 'opposite_lane' }).fahrt, 3);
  assert.equal(t({ highway: 'residential', oneway: 'yes', 'cycleway:left': 'opposite_track' }).fahrt, 3);
  assert.equal(t({ highway: 'primary', junction: 'roundabout' }).fahrt, 1);
  assert.equal(t({ highway: 'cycleway', oneway: 'yes' }).fahrt, 1);
});

test('Belag und Brücken', () => {
  assert.equal(belagsfaktor({ highway: 'residential', surface: 'asphalt' }), 1);
  assert.ok(belagsfaktor({ highway: 'residential', surface: 'cobblestone' }) > belagsfaktor({ highway: 'residential', surface: 'asphalt' }));
  assert.ok(belagsfaktor({ highway: 'track', tracktype: 'grade4' }) > belagsfaktor({ highway: 'track', tracktype: 'grade1' }));
  assert.ok(belagsfaktor({ highway: 'path', surface: 'sand' }) <= 4);
  assert.ok(belagsfaktor({ highway: 'residential', smoothness: 'bad' }) > belagsfaktor({ highway: 'residential' }));
  assert.ok(belagsfaktor({ highway: 'residential', surface: 'asphalt', smoothness: 'horrible' }) >= 1.5);
  assert.equal(t({ highway: 'residential', bridge: 'yes' }).bruecke, true);
  assert.equal(t({ highway: 'residential', tunnel: 'yes' }).bruecke, true);
  assert.equal(t({ highway: 'residential', bridge: 'no' }).bruecke, false);
  assert.equal(t({ highway: 'residential', tunnel: 'building_passage' }).bruecke, false);
});

const modell = baueModell({ motor_art: 'mittelmotor', akku_kapazitaet_wh: 625, gewicht_kg: 25 }, null, { fahrer_gewicht_kg: 80 }).modell;

test('Netz: nächster Knoten im gewählten Modus', () => {
  const netz = testNetz();
  assert.equal(netz.naechster(51.0001, 7.0001, MODI.alle).knoten, 0);
  assert.equal(netz.naechster(51.0001, 7.0101, MODI.alle).knoten, 1);
  // nur Radweg: nur Knoten 1 und 2 haben so eine Kante
  assert.equal(netz.naechster(51.0001, 7.0001, MODI.radweg).knoten, 1);
  // große Netzteile: die Insel (2 Knoten) zählt bei höherer Mindestgröße nicht
  netz.minKomponente = 4;
  netz._komp = undefined;
  assert.ok(netz.naechster(51.1, 7.0, MODI.alle).knoten <= 3, 'Insel mit 2 Knoten wird übergangen');
});

test('Netz: kürzester Weg nach Länge, Einbahn und Modi', () => {
  const netz = testNetz();
  assert.equal(netz.kuerzesterWeg(0, 3, 'alle'), 3000);
  assert.equal(netz.kuerzesterWeg(3, 0, 'alle'), null, 'Einbahn 2→3: zurück gesperrt');
  assert.equal(netz.kuerzesterWeg(2, 3, 'alle'), 1000);
  assert.equal(netz.kuerzesterWeg(0, 2, 'radweg'), null, 'Straße zählt im Radweg-Modus nicht');
  assert.equal(netz.kuerzesterWeg(1, 2, 'radweg'), 1000);
  assert.equal(netz.kuerzesterWeg(0, 2, 'strasse'), null, 'der Radweg zählt im Straßen-Modus nicht');
  assert.equal(netz.kuerzesterWeg(0, 4, 'alle'), null, 'Insel');
});

test('Netz: Energie bergauf kostet mehr als bergab, eben ist dazwischen', () => {
  const netz = testNetz();
  const tab = netz.kostenTabelle(modell);
  const eben = netz.kantenEnergie(tab, 0, 0);
  const bergauf = netz.kantenEnergie(tab, 1, 0);   // 1 → 2, +4 %
  const bergab = netz.kantenEnergie(tab, 1, 1);    // 2 → 1, −4 %
  assert.ok(bergauf > eben && eben > bergab && bergab >= 0, `${bergauf} > ${eben} > ${bergab}`);
  assert.ok(Math.abs(netz.kantenEnergie(tab, 0, 0) - netz.kantenEnergie(tab, 0, 1)) < 1e-6, 'ebene Kante ist symmetrisch');
});

test('Netz: Reichweite nach Energie endet beim Budget', () => {
  const netz = testNetz();
  assert.ok(Number.isFinite(netz.reichweite(modell, 0, 'alle').dist[3]));
  const klein = baueModell({ motor_art: 'mittelmotor', akku_kapazitaet_wh: 30, gewicht_kg: 25 }, null, { fahrer_gewicht_kg: 80 }, { reserve_prozent: 0 }).modell;
  const r = netz.reichweite(klein, 0, 'alle');
  assert.equal(r.dist[0], 0);
  for (let i = 0; i < netz.N; i++) if (Number.isFinite(r.dist[i])) assert.ok(r.dist[i] <= klein.akku.nutzbar_wh + 1e-9);
  assert.equal(r.dist[4], Infinity, 'Insel bleibt unerreichbar');
});
