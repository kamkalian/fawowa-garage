import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARTEN, GESPANN_FELDER, FAHRER_NAME_FELD, EMAIL_FELD, pruefeEingabe } from '../lib/felder.js';
import { MIGRATIONEN } from '../lib/migrationen.js';
import { gesamtgewicht } from '../lib/gewicht.js';

const fahrrad = ARTEN.fahrraeder.felder;

test('Pflichtfeld fehlt: beim Fahrrad ist kein Feld Pflicht (der Name bekommt einen Standardnamen)', () => {
  const { werte, fehler } = pruefeEingabe(fahrrad, {});
  assert.equal(fehler, null);
  assert.equal(werte.name, null);
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
  const ok = pruefeEingabe(fahrrad, { name: 'a', gewicht_kg: '25,5', radgroesse_zoll: 27.5, gaenge: '9' });
  assert.equal(ok.fehler, null);
  assert.equal(ok.werte.gewicht_kg, 25.5);
  assert.equal(ok.werte.gaenge, 9);
  assert.equal(pruefeEingabe(fahrrad, { name: 'a', gewicht_kg: 12.3456 }).werte.gewicht_kg, 12.35);

  const schlecht = pruefeEingabe(fahrrad, { name: 'a', gewicht_kg: 1, radgroesse_zoll: 99, gaenge: 2.5, anzahl_raeder: 7 });
  assert.deepEqual(schlecht.fehler, {
    gewicht_kg: 'zu_klein', radgroesse_zoll: 'zu_gross', gaenge: 'ungueltig', anzahl_raeder: 'zu_gross'
  });
});

test('Zahlen: keine Sonderwerte wie NaN, Infinity oder Exponent', () => {
  for (const v of ['NaN', 'Infinity', '1e3', '0x10', '1.2.3', {}, [], true]) {
    assert.equal(pruefeEingabe(fahrrad, { name: 'a', gewicht_kg: v }).fehler?.gewicht_kg, 'ungueltig', String(v));
  }
});

test('Auswahl nur mit bekannten Werten', () => {
  assert.equal(pruefeEingabe(fahrrad, { name: 'a', bauart: 'fahrrad' }).fehler, null);
  assert.deepEqual(pruefeEingabe(fahrrad, { name: 'a', bauart: 'raketenantrieb' }).fehler, { bauart: 'ungueltig' });
});

test('Text: Länge, Steuerzeichen, Typ', () => {
  assert.deepEqual(pruefeEingabe(fahrrad, { name: 'x'.repeat(81) }).fehler, { name: 'zu_lang' });
  assert.deepEqual(pruefeEingabe(fahrrad, { name: 5 }).fehler, { name: 'ungueltig' });
  assert.equal(pruefeEingabe(fahrrad, { name: 'a\u0000b\nc' }).werte.name, 'a b c');
  assert.equal(pruefeEingabe(fahrrad, { name: 'a', notiz: 'Zeile 1\r\nZeile 2\u0007' }).werte.notiz, 'Zeile 1\nZeile 2');
  assert.equal(pruefeEingabe(fahrrad, { name: '   ' }).werte.name, null);
});

test('Eingabe, die kein Objekt ist, zählt als leer', () => {
  for (const x of [null, undefined, 'text', 5, []]) assert.equal(pruefeEingabe(fahrrad, x).fehler, null);
});

test('Gespann: Fahrer und Gepäck, Gewichte prüfen', () => {
  const g = GESPANN_FELDER;
  assert.equal(pruefeEingabe(g, {}).fehler, null);
  // Gepäck ist keine Gespann-Angabe mehr (eigene Kachel)
  const ohneGepaeck = pruefeEingabe(g, { fahrer_gewicht_kg: 80, gepaeck_kg: '12,5' }).werte;
  assert.equal(ohneGepaeck.fahrer_gewicht_kg, 80);
  assert.ok(!('gepaeck_kg' in ohneGepaeck));
});
test('Jedes Feld hat eine Spalte in der Migration, Schlüssel sind eindeutig', () => {
  const sql = MIGRATIONEN.flatMap(m => m.sql);
  const gespann = { tabelle: 'gespanne', felder: GESPANN_FELDER };
  for (const [art, cfg] of [...Object.entries(ARTEN), ['gespann', gespann]]) {
    const tabelle = sql.find(s => s.includes(`CREATE TABLE IF NOT EXISTS ${cfg.tabelle} `));
    assert.ok(tabelle, `Tabelle ${cfg.tabelle} fehlt`);
    const keys = cfg.felder.map(f => f.key);
    assert.equal(new Set(keys).size, keys.length, `${art}: doppelte Schlüssel`);
    // Spalten stehen im CREATE oder in einer späteren Änderung (ALTER) der Tabelle
    for (const k of keys) assert.ok(sql.some(z => z.includes(cfg.tabelle) && z.includes('`' + k + '`')), art + ': Spalte ' + k + ' fehlt in der Migration');
    for (const f of cfg.felder) {
      assert.ok(f.label?.de && f.label?.en, `${art}.${f.key}: Beschriftung de/en fehlt`);
      if (f.typ === 'auswahl') for (const o of f.optionen) assert.ok(o.de && o.en, `${art}.${f.key}.${o.wert}: Text fehlt`);
      if (f.typ === 'zahl' || f.typ === 'ganzzahl') assert.ok(f.min < f.max);
    }
  }
});

test('Fahrername: Pflicht, höchstens 40 Zeichen, eine Zeile', () => {
  const f = [FAHRER_NAME_FELD];
  assert.deepEqual(pruefeEingabe(f, {}).fehler, { fahrer_name: 'pflicht' });
  assert.deepEqual(pruefeEingabe(f, { fahrer_name: 'x'.repeat(41) }).fehler, { fahrer_name: 'zu_lang' });
  assert.equal(pruefeEingabe(f, { fahrer_name: 'Anja\nMüller' }).werte.fahrer_name, 'Anja Müller');
  assert.ok(MIGRATIONEN.flatMap(m => m.sql).some(q => q.includes('garagen') && q.includes('`fahrer_name`')), 'Spalte fahrer_name fehlt in den Migrationen');
});

test('E-Mail-Feld: klein geschrieben, schlichte Prüfung, keine Zeilenumbrüche', () => {
  const f = [EMAIL_FELD];
  assert.equal(pruefeEingabe(f, { email: '  Anja.M@Mail.Example.ORG ' }).werte.email, 'anja.m@mail.example.org');
  for (const schlecht of ['', 'a', 'a@b', 'a@b.', '@b.de', 'a@.de', 'a b@c.de', 'a@b.de\nBcc: x@y.de', 'a@b.de,c@d.de', 'a@b.d', '<a@b.de>', 'a"b@c.de']) {
    assert.ok(pruefeEingabe(f, { email: schlecht }).fehler?.email, JSON.stringify(schlecht));
  }
  assert.ok(MIGRATIONEN.flatMap(m => m.sql).some(q => q.includes('garagen') && q.includes('`email`')), 'Spalte email fehlt');
  assert.ok(MIGRATIONEN.flatMap(m => m.sql).some(q => q.includes('garage_tokens')), 'Tabelle garage_tokens fehlt');
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
