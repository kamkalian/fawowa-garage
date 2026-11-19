import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unbrauchbarAnteil, unbrauchbarWh, nennspannungV, fuellstandBeiSpannung, AKKU_CHEMIE } from '../lib/akku.js';
import { baueModell, berechneSegment, reichweiteEntlang } from '../lib/rechenmodell.js';

const pack = (extra = {}) => ({ chemie: 'nmc', s: 10, p: 1, ah: 13.9, v_nom: 36, wh: 500, ...extra });

test('Nennspannung ergibt sich aus Zellzahl und Chemie', () => {
  assert.equal(nennspannungV(10, 'nmc'), 36);
  assert.ok(Math.abs(nennspannungV(16, 'lfp') - 51.2) < 1e-9);
  assert.equal(nennspannungV(null, 'nmc'), null);
});

test('Füllstand bei Spannung: Umkehrung des Verlaufs', () => {
  const k = AKKU_CHEMIE.nmc.kurve;
  assert.equal(fuellstandBeiSpannung(k, 2), 0);
  assert.equal(fuellstandBeiSpannung(k, 5), 1);
  assert.ok(Math.abs(fuellstandBeiSpannung(k, 3.6) - 0.2) < 1e-9);
});

test('Abschaltung: bei hoher Last ist mehr Energie nicht nutzbar', () => {
  const wenig = unbrauchbarAnteil(pack(), 50);
  const viel = unbrauchbarAnteil(pack(), 800);
  assert.ok(viel > wenig, `800 W (${viel}) mehr als 50 W (${wenig})`);
  assert.ok(wenig > 0 && viel < 1);
});

test('Abschaltung: höhere Abschaltspannung je Zelle schaltet früher ab', () => {
  const tief = unbrauchbarAnteil(pack({ schluss_v: 2.8 }), 300);
  const hoch = unbrauchbarAnteil(pack({ schluss_v: 3.2 }), 300);
  assert.ok(hoch > tief);
});

test('Chemie: LFP schaltet bei gleicher Last anders ab als NMC', () => {
  const nmc = unbrauchbarAnteil(pack(), 300);
  const lfp = unbrauchbarAnteil({ chemie: 'lfp', s: 10, p: 1, ah: 13.9, v_nom: 32, wh: 445 }, 300);
  assert.notEqual(Math.round(nmc * 1000), Math.round(lfp * 1000));
});

test('Ohne Angaben wird nichts abgezogen', () => {
  assert.equal(unbrauchbarAnteil({ wh: 500 }, 300), 0);
  assert.equal(unbrauchbarWh([{ wh: 500 }], 300), 0);
});

test('Gespann: die Akkus mit Angaben verringern die nutzbare Energie', () => {
  const rad = { motor_art: 'mittelmotor', motor_nennleistung_w: 250, schaltung_art: 'kette', gewicht_kg: 25, akku_kapazitaet_wh: 500,
    akkuListe: [{ key: 'rad1_0', name: 'Rad', nummer: 1, kapazitaet_wh: 500, chemie: 'nmc', zellen_s: 10, zellen_p: 1, ah: 13.9, spannung_v: null }] };
  const { modell } = baueModell(rad, null, { fahrer_gewicht_kg: 75 }, { unterstuetzung: 'tour', budget_art: 'akku', akku_rest_prozent: 100, reserve_prozent: 0, akku_staende: {} });
  assert.equal(modell.akku.nutzbar_wh, Math.max(0, modell.akku.start_wh - modell.akku.reserve_wh));
  assert.ok(modell.akku.batterien.length === 1);
});

test('Reichweite: starke Last auf dem Berg schaltet den Akku früher ab', () => {
  const rad = { motor_art: 'mittelmotor', motor_nennleistung_w: 250, schaltung_art: 'kette', gewicht_kg: 25, akku_kapazitaet_wh: 500,
    akkuListe: [{ key: 'rad1_0', name: 'Rad', nummer: 1, kapazitaet_wh: 500, chemie: 'nmc', zellen_s: 10, zellen_p: 1, ah: 13.9, spannung_v: null }] };
  const { modell } = baueModell(rad, null, { fahrer_gewicht_kg: 75 }, { unterstuetzung: 'sport', eigenleistung_modus: 'volle_power', geschwindigkeit_kmh: 18, reserve_prozent: 0 });
  const eben = { laenge_m: 1000, steigung: 0, richtung_grad: 0 };
  const berg = { ...eben, steigung: 0.08 };
  const r = berechneSegment(modell, berg);
  assert.ok(r.akku_leistung_w > 0);
  const ebene = reichweiteEntlang(modell, Array(200).fill(eben));
  const bergig = reichweiteEntlang(modell, Array(200).fill(berg));
  assert.ok(bergig.strecke_m < ebene.strecke_m);
});

test('Suche: die Abschaltung je Teilstück verkleinert das erreichbare Gebiet, ohne Chemie gibt es keine Abschaltung', async () => {
  const { Netz } = await import('../lib/netz.js');
  const { gitterNetz } = await import('./hilfen-netz.js');
  const netz = new Netz(gitterNetz(31), { minKomponente: 1 });
  const basis = { motor_art: 'mittelmotor', motor_nennleistung_w: 250, akku_kapazitaet_wh: 5, schaltung_art: 'kette', gewicht_kg: 25 };
  const liste = (chemie) => [{ key: 'rad1_0', name: 'Rad', nummer: 1, kapazitaet_wh: 5, chemie, zellen_s: 3, zellen_p: 1, ah: 1.7, spannung_v: null }];
  const erreichbar = (chemie) => {
    const { modell } = baueModell({ ...basis, akkuListe: liste(chemie) }, null, { fahrer_gewicht_kg: 80 }, { unterstuetzung: 'sport', eigenleistung_modus: 'volle_power', reserve_prozent: 0 });
    const r = netz.reichweite(modell, netz.naechster(51.075, 7.12).knoten, 'alle');
    return r.dist.filter((d) => Number.isFinite(d)).length;
  };
  const ohne = erreichbar(null);
  const lfp = erreichbar('lfp');
  assert.ok(ohne > 0);
  assert.ok(lfp < ohne, 'mit Abschaltung weniger erreichbare Knoten (' + lfp + ' < ' + ohne + ')');
  assert.equal(erreichbar(null), ohne, 'ohne Chemie keine Abschaltung');
});
