// Prüft lib/speicher.js und die Migrationen gegen eine echte MySQL-Datenbank.
// Läuft nur, wenn TEST_DB_HOST gesetzt ist; die Datenbank (TEST_DB_NAME, Standard "garage_test") wird dabei geleert!
//   TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD=... npm test
// Auf dem Server: docker compose exec -e TEST_DB_HOST=garage-db ... (siehe README)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { erstellePool } from '../lib/db.js';
import { migriere } from '../lib/migrationen.js';
import { Speicher } from '../lib/speicher.js';
import { ARTEN, pruefeEingabe } from '../lib/felder.js';

const aktiv = !!process.env.TEST_DB_HOST;
const opt = { skip: aktiv ? false : 'TEST_DB_HOST nicht gesetzt' };

let pool;
let sp;

before(async () => {
  if (!aktiv) return;
  pool = erstellePool({
    DB_HOST: process.env.TEST_DB_HOST, DB_PORT: process.env.TEST_DB_PORT, DB_USER: process.env.TEST_DB_USER,
    DB_PASSWORD: process.env.TEST_DB_PASSWORD, DB_NAME: process.env.TEST_DB_NAME || 'garage_test'
  });
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['gespanne', 'anhaenger', 'fahrraeder', 'garagen', 'schema_version']) await pool.query(`DROP TABLE IF EXISTS ${t}`);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
  await migriere(pool, undefined, () => {});
  sp = new Speicher(pool);
});
after(async () => { if (pool) await pool.end(); });

const werte = (art, eingabe) => {
  const r = pruefeEingabe(ARTEN[art].felder, eingabe);
  assert.equal(r.fehler, null);
  return r.werte;
};

test('Migration lässt sich wiederholen', opt, async () => {
  await migriere(pool, undefined, () => {});
});

test('Garage: Schlüssel wird nur als Hash gespeichert und wiedergefunden', opt, async () => {
  const { id, token } = await sp.garageAnlegen();
  const [[z]] = await pool.query('SELECT token_hash FROM garagen WHERE id = ?', [id]);
  assert.notEqual(z.token_hash, token);
  assert.equal(z.token_hash.length, 64);
  assert.deepEqual(await sp.garageFinden(token), { id });
  assert.equal(await sp.garageFinden('x'.repeat(43)), null);
  assert.equal(await sp.garageFinden("' OR 1=1 --"), null);
});

test('Fahrrad: anlegen, lesen (Zahlen als Zahlen), ändern, löschen', opt, async () => {
  const { id: g } = await sp.garageAnlegen();
  const r = await sp.anlegen(g, 'fahrraeder', werte('fahrraeder', { name: 'Test', akku_kapazitaet_wh: 625.5, gaenge: 9, motor_art: 'mittelmotor' }));
  assert.equal(r.name, 'Test');
  assert.equal(r.akku_kapazitaet_wh, 625.5);
  assert.equal(r.gaenge, 9);
  assert.equal(r.gewicht_kg, null);
  assert.equal(r.status, 'ungeprueft');

  await pool.query("UPDATE fahrraeder SET status = 'geprueft', geprueft_am = UTC_TIMESTAMP() WHERE id = ?", [r.id]);
  const neu = await sp.aendern(g, 'fahrraeder', r.id, werte('fahrraeder', { name: 'Test 2' }));
  assert.equal(neu.name, 'Test 2');
  assert.equal(neu.akku_kapazitaet_wh, null);
  assert.equal(neu.status, 'ungeprueft');
  assert.equal(await sp.aendern(g, 'fahrraeder', 999999, werte('fahrraeder', { name: 'x' })), null);

  assert.equal(await sp.loeschen(g, 'fahrraeder', r.id), true);
  assert.equal(await sp.loeschen(g, 'fahrraeder', r.id), false);
});

test('Sonderzeichen und Umlaute bleiben erhalten, SQL-Zeichen sind harmlos', opt, async () => {
  const { id: g } = await sp.garageAnlegen();
  const name = "Größe 27,5\" – Käfer'; DROP TABLE garagen; --";
  const r = await sp.anlegen(g, 'anhaenger', werte('anhaenger', { name, notiz: 'ä ö ü ß 🚲' }));
  assert.equal(r.name, name);
  assert.equal(r.notiz, 'ä ö ü ß 🚲');
  assert.equal(await sp.anzahlGaragen() > 0, true);
});

test('Gespann: fremde Verweise abgelehnt, Löschen benutzter Einträge gesperrt', opt, async () => {
  const { id: a } = await sp.garageAnlegen();
  const { id: b } = await sp.garageAnlegen();
  const rad = await sp.anlegen(a, 'fahrraeder', werte('fahrraeder', { name: 'Rad' }));
  const wagen = await sp.anlegen(a, 'anhaenger', werte('anhaenger', { name: 'Wagen' }));
  const fremd = await sp.anlegen(b, 'fahrraeder', werte('fahrraeder', { name: 'Fremd' }));

  await assert.rejects(sp.anlegen(a, 'gespanne', werte('gespanne', { name: 'G', fahrrad_id: fremd.id, anhaenger_id: wagen.id })), { status: 400 });
  const g = await sp.anlegen(a, 'gespanne', werte('gespanne', { name: 'G', fahrrad_id: rad.id, anhaenger_id: wagen.id, fahrer_gewicht_kg: 80 }));
  assert.equal(g.fahrer_gewicht_kg, 80);

  await assert.rejects(sp.loeschen(a, 'fahrraeder', rad.id), { status: 409, code: 'verwendet' });
  await assert.rejects(sp.loeschen(a, 'anhaenger', wagen.id), { status: 409, code: 'verwendet' });
  await sp.loeschen(a, 'gespanne', g.id);
  assert.equal(await sp.loeschen(a, 'fahrraeder', rad.id), true);
});

test('Höchstzahl wird eingehalten', opt, async () => {
  const { id: g } = await sp.garageAnlegen();
  for (let i = 0; i < ARTEN.anhaenger.max; i++) await sp.anlegen(g, 'anhaenger', werte('anhaenger', { name: `A${i}` }));
  await assert.rejects(sp.anlegen(g, 'anhaenger', werte('anhaenger', { name: 'zu viel' })), { status: 409, code: 'limit' });
});

test('Garage löschen entfernt alle Einträge einschließlich benutzter', opt, async () => {
  const { id: g, token } = await sp.garageAnlegen();
  const rad = await sp.anlegen(g, 'fahrraeder', werte('fahrraeder', { name: 'Rad' }));
  const wagen = await sp.anlegen(g, 'anhaenger', werte('anhaenger', { name: 'Wagen' }));
  await sp.anlegen(g, 'gespanne', werte('gespanne', { name: 'G', fahrrad_id: rad.id, anhaenger_id: wagen.id }));
  await sp.garageLoeschen(g);
  assert.equal(await sp.garageFinden(token), null);
  for (const t of ['fahrraeder', 'anhaenger', 'gespanne']) {
    const [[z]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE garage_id = ?`, [g]);
    assert.equal(Number(z.n), 0, t);
  }
});

test('alles() liefert die drei Listen ohne garage_id und ohne Prüfnotiz', opt, async () => {
  const { id: g } = await sp.garageAnlegen();
  await sp.anlegen(g, 'fahrraeder', werte('fahrraeder', { name: 'Rad' }));
  const alles = await sp.alles(g);
  assert.deepEqual(Object.keys(alles), ['fahrraeder', 'anhaenger', 'gespanne']);
  assert.ok(!('garage_id' in alles.fahrraeder[0]) && !('pruefnotiz' in alles.fahrraeder[0]));
});
