import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTEN, pruefeEingabe } from '../lib/felder.js';
import { MIGRATIONEN } from '../lib/migrationen.js';
import { gesamtgewicht } from '../lib/gewicht.js';

const fahrrad = ARTEN.fahrraeder.felder;

test('Pflichtfeld fehlt: nur der Name ist Pflicht beim Fahrrad', () => {
  const { werte, fehler } = pruefeEingabe(fahrrad, {});
  assert.deepEqual(fehler, { name: 'pflicht' });
  assert.equal(werte.gewicht_kg, null);
});

test('Leere Felder werden zu null, Unbekanntes wird ignoriert', () => {
  const { werte, fehler } = pruefeEingabe(fahrrad, { name: ' Rad ', gewicht_kg: '', foo: 'bar', garage_id: 7, status: 'geprueft' });
  assert.equal(fehler, null);
  assert.equal(werte.name, 'Rad');
  assert.equal(werte.gewicht_kg, null);
  assert.ok(!('foo' in werte) && !('garage_id' in werte) && !('status' in werte));
});

test('Zahlen: Komma, Text, Grenzen, Rundung', () => {
  const ok = pruefeEingabe(fahrrad, { name: 'a', akku_kapazitaet_wh: '625,5', radgroesse_zoll: 27.5, gaenge: '9' });
  assert.equal(ok.fehler, null);
  assert.equal(ok.werte.akku_kapazitaet_wh, 625.5);
  assert.equal(ok.werte.gaenge, 9);
  assert.equal(pruefeEingabe(fahrrad, { name: 'a', akku_kapazitaet_wh: 12.3456 }).werte.akku_kapazitaet_wh, 12.35);

  const schlecht = pruefeEingabe(fahrrad, { name: 'a', akku_kapazitaet_wh: -1, motor_nennleistung_w: 99999, gewicht_kg: 'schwer', gaenge: 2.5, anzahl_raeder: 7 });
  assert.deepEqual(schlecht.fehler, {
    akku_kapazitaet_wh: 'zu_klein', motor_nennleistung_w: 'zu_gross', gewicht_kg: 'ungueltig', gaenge: 'ungueltig', anzahl_raeder: 'zu_gross'
  });
});

test('Zahlen: keine Sonderwerte wie NaN, Infinity oder Exponent', () => {
  for (const v of ['NaN', 'Infinity', '1e3', '0x10', '1.2.3', {}, [], true]) {
    assert.equal(pruefeEingabe(fahrrad, { name: 'a', gewicht_kg: v }).fehler?.gewicht_kg, 'ungueltig', String(v));
  }
});

test('Auswahl nur mit bekannten Werten', () => {
  assert.equal(pruefeEingabe(fahrrad, { name: 'a', motor_art: 'mittelmotor' }).fehler, null);
  assert.deepEqual(pruefeEingabe(fahrrad, { name: 'a', motor_art: 'raketenantrieb' }).fehler, { motor_art: 'ungueltig' });
});

test('Text: Länge, Steuerzeichen, Typ', () => {
  assert.deepEqual(pruefeEingabe(fahrrad, { name: 'x'.repeat(81) }).fehler, { name: 'zu_lang' });
  assert.deepEqual(pruefeEingabe(fahrrad, { name: 5 }).fehler, { name: 'ungueltig' });
  assert.equal(pruefeEingabe(fahrrad, { name: 'a\u0000b\nc' }).werte.name, 'a b c');
  assert.equal(pruefeEingabe(fahrrad, { name: 'a', notiz: 'Zeile 1\r\nZeile 2\u0007' }).werte.notiz, 'Zeile 1\nZeile 2');
  assert.deepEqual(pruefeEingabe(fahrrad, { name: '   ' }).fehler, { name: 'pflicht' });
});

test('Eingabe, die kein Objekt ist, zählt als leer', () => {
  for (const x of [null, undefined, 'text', 5, []]) assert.deepEqual(pruefeEingabe(fahrrad, x).fehler, { name: 'pflicht' });
});

test('Gespann: Verweise müssen positive ganze Zahlen sein', () => {
  const g = ARTEN.gespanne.felder;
  assert.deepEqual(pruefeEingabe(g, { name: 'a' }).fehler, { fahrrad_id: 'pflicht', anhaenger_id: 'pflicht' });
  assert.deepEqual(pruefeEingabe(g, { name: 'a', fahrrad_id: 0, anhaenger_id: 'x' }).fehler, { fahrrad_id: 'ungueltig', anhaenger_id: 'ungueltig' });
  const ok = pruefeEingabe(g, { name: 'a', fahrrad_id: '3', anhaenger_id: 4 });
  assert.equal(ok.fehler, null);
  assert.equal(ok.werte.fahrrad_id, 3);
});

test('Jedes Feld hat eine Spalte in der Migration, Schlüssel sind eindeutig', () => {
  const sql = MIGRATIONEN.flatMap(m => m.sql);
  for (const [art, cfg] of Object.entries(ARTEN)) {
    const tabelle = sql.find(s => s.includes(`CREATE TABLE IF NOT EXISTS ${cfg.tabelle} `));
    assert.ok(tabelle, `Tabelle ${cfg.tabelle} fehlt`);
    const keys = cfg.felder.map(f => f.key);
    assert.equal(new Set(keys).size, keys.length, `${art}: doppelte Schlüssel`);
    for (const k of keys) assert.ok(tabelle.includes(`\`${k}\``), `${art}: Spalte ${k} fehlt in der Migration`);
    for (const f of cfg.felder) {
      assert.ok(f.label?.de && f.label?.en, `${art}.${f.key}: Beschriftung de/en fehlt`);
      if (f.typ === 'auswahl') for (const o of f.optionen) assert.ok(o.de && o.en, `${art}.${f.key}.${o.wert}: Text fehlt`);
      if (f.typ === 'zahl' || f.typ === 'ganzzahl') assert.ok(f.min < f.max);
    }
  }
});

test('Migrationen: Versionen aufsteigend und ohne Lücken', () => {
  MIGRATIONEN.forEach((m, i) => assert.equal(m.version, i + 1));
});

test('Gesamtgewicht: Summe inklusive Zusatzakkus, fehlende Angaben werden gemeldet', () => {
  const r = gesamtgewicht(
    { fahrer_gewicht_kg: 80, gepaeck_kg: 40.5 },
    { gewicht_kg: 30, zusatzakku_gewicht_kg: 3.2 },
    { leergewicht_kg: 60, zusatzakku_gewicht_kg: 8 });
  assert.equal(r.summe, 221.7);
  assert.deepEqual(r.fehlt, []);

  const teil = gesamtgewicht({ fahrer_gewicht_kg: null, gepaeck_kg: 10 }, { gewicht_kg: 25 }, { leergewicht_kg: null });
  assert.equal(teil.summe, 35);
  assert.deepEqual(teil.fehlt, ['leergewicht_kg', 'fahrer_gewicht_kg']);
  assert.deepEqual(gesamtgewicht(null, null, null), { summe: 0, fehlt: ['gewicht_kg', 'leergewicht_kg', 'fahrer_gewicht_kg'] });
});
