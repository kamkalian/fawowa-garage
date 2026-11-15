// Prüft lib/speicher.js und die Migrationen gegen eine echte MySQL-Datenbank.
// Läuft nur, wenn TEST_DB_HOST gesetzt ist; die Datenbank (TEST_DB_NAME, Standard "garage_test") wird dabei geleert!
//   TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD=... npm test
// Auf dem Server: docker compose exec -e TEST_DB_HOST=garage-db ... (siehe README)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { erstellePool } from '../lib/db.js';
import { migriere, MIGRATIONEN } from '../lib/migrationen.js';
import { Speicher } from '../lib/speicher.js';
import { ARTEN, GESPANN_FELDER, pruefeEingabe } from '../lib/felder.js';

const aktiv = !!process.env.TEST_DB_HOST;
const opt = { skip: aktiv ? false : 'TEST_DB_HOST nicht gesetzt' };

let pool;
let sp;

let altGarage;

before(async () => {
  if (!aktiv) return;
  pool = erstellePool({
    DB_HOST: process.env.TEST_DB_HOST, DB_PORT: process.env.TEST_DB_PORT, DB_USER: process.env.TEST_DB_USER,
    DB_PASSWORD: process.env.TEST_DB_PASSWORD, DB_NAME: process.env.TEST_DB_NAME || 'garage_test'
  });
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const t of ['gespanne', 'anhaenger', 'fahrraeder', 'garagen', 'schema_version']) await pool.query(`DROP TABLE IF EXISTS ${t}`);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');

  // Stand der ersten Auslieferung (nur Migration 1) mit mehreren Gespannen in einer Garage: Migration 2 muss damit zurechtkommen
  await migriere(pool, MIGRATIONEN.slice(0, 1), () => {});
  const [g] = await pool.query("INSERT INTO garagen (token_hash) VALUES ('alt')");
  altGarage = g.insertId;
  const [r] = await pool.query('INSERT INTO fahrraeder (garage_id, `name`) VALUES (?, ?)', [altGarage, 'Altes Rad']);
  const [w] = await pool.query('INSERT INTO anhaenger (garage_id, `name`) VALUES (?, ?)', [altGarage, 'Alter Wagen']);
  for (const name of ['Erstes', 'Zweites']) {
    await pool.query('INSERT INTO gespanne (garage_id, `name`, fahrrad_id, anhaenger_id) VALUES (?, ?, ?, ?)', [altGarage, name, r.insertId, w.insertId]);
  }

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

test('Migration 2 behält von mehreren alten Gespannen eines und lässt Plätze leer werden', opt, async () => {
  const [z] = await pool.query('SELECT `name`, fahrrad_id FROM gespanne WHERE garage_id = ?', [altGarage]);
  assert.equal(z.length, 1);
  assert.equal(z[0].name, 'Erstes');
  await pool.query('DELETE FROM fahrraeder WHERE garage_id = ?', [altGarage]);
  const [nach] = await pool.query('SELECT fahrrad_id, anhaenger_id FROM gespanne WHERE garage_id = ?', [altGarage]);
  assert.equal(nach[0].fahrrad_id, null, 'Platz ist leer, das Gespann bleibt');
  assert.notEqual(nach[0].anhaenger_id, null);
  const [[v]] = await pool.query('SELECT MAX(version) AS v FROM schema_version');
  assert.equal(v.v, MIGRATIONEN.length);
});

test('Migration 3: bestehende Einträge bekommen die Sortierung ihrer Nummer', opt, async () => {
  const [z] = await pool.query('SELECT id, sortierung FROM anhaenger WHERE garage_id = ?', [altGarage]);
  assert.equal(z[0].sortierung, z[0].id);
});

test('Fahrername: speichern, lesen, ändern; alte Garagen haben keinen', opt, async () => {
  const { id } = await sp.garageAnlegen('Anja Ö');
  assert.equal((await sp.alles(id)).fahrer_name, 'Anja Ö');
  await sp.fahrerNameSetzen(id, 'Jo');
  assert.equal((await sp.alles(id)).fahrer_name, 'Jo');
  assert.equal((await sp.alles(altGarage)).fahrer_name, null);
});

test('E-Mail: bestätigen, nur einer Garage, Zugangslink dreht den Schlüssel, Links nur einmal und nur als Hash', opt, async () => {
  const a = await sp.garageAnlegen('A');
  const b = await sp.garageAnlegen('B');
  const adresse = `test-${Date.now()}@example.org`;

  const t1 = await sp.emailAnfordern(a.id, adresse);
  const [[h]] = await pool.query('SELECT token_hash FROM garage_tokens WHERE garage_id = ?', [a.id]);
  assert.notEqual(h.token_hash, t1);
  assert.equal((await sp.alles(a.id)).email_offen, adresse);
  assert.equal((await sp.alles(a.id)).email, null);
  assert.equal(await sp.zugangAnfordern(adresse), null, 'unbestätigt: kein Zugangslink');

  // Neue Anforderung ersetzt die alte
  const t2 = await sp.emailAnfordern(a.id, adresse);
  await assert.rejects(sp.emailBestaetigen(t1), { code: 'token_ungueltig' });
  assert.deepEqual(await sp.emailBestaetigen(t2), { email: adresse });
  await assert.rejects(sp.emailBestaetigen(t2), { code: 'token_ungueltig' });
  assert.equal((await sp.alles(a.id)).email, adresse);
  assert.equal((await sp.alles(a.id)).email_offen, null);

  // Dieselbe Adresse für eine andere Garage: Konflikt
  const tb = await sp.emailAnfordern(b.id, adresse);
  await assert.rejects(sp.emailBestaetigen(tb), { status: 409, code: 'email_vergeben' });

  // Zugangslink: neuer Schlüssel, alter ungültig, Einträge bleiben
  await sp.anlegen(a.id, 'fahrraeder', werte('fahrraeder', { name: 'Bleibt' }));
  const z = await sp.zugangAnfordern(adresse);
  assert.match(z, /^[A-Za-z0-9_-]{43}$/);
  await assert.rejects(sp.emailBestaetigen(z), { code: 'token_ungueltig' }, 'ein Zugangslink bestätigt keine Adresse');
  const neu = await sp.zugangEinloesen(z);
  assert.equal(await sp.garageFinden(a.token), null);
  const g = await sp.garageFinden(neu);
  assert.equal(g.id, a.id);
  assert.equal((await sp.alles(a.id)).fahrraeder[0].name, 'Bleibt');
  await assert.rejects(sp.zugangEinloesen(z), { code: 'token_ungueltig' });

  // Abgelaufen
  const z2 = await sp.zugangAnfordern(adresse);
  await pool.query("UPDATE garage_tokens SET gueltig_bis = UTC_TIMESTAMP() - INTERVAL 1 SECOND WHERE garage_id = ?", [a.id]);
  await assert.rejects(sp.zugangEinloesen(z2), { code: 'token_ungueltig' });

  // Entfernen
  await sp.emailAnfordern(a.id, 'neu@example.org');
  await sp.emailEntfernen(a.id);
  const alles = await sp.alles(a.id);
  assert.equal(alles.email, null);
  assert.equal(alles.email_offen, null);
  assert.equal(await sp.zugangAnfordern(adresse), null);
  // Die Adresse ist wieder frei
  const tb2 = await sp.emailAnfordern(b.id, adresse);
  assert.deepEqual(await sp.emailBestaetigen(tb2), { email: adresse });
});

test('Garage löschen entfernt auch die Links', opt, async () => {
  const { id } = await sp.garageAnlegen('X');
  await sp.emailAnfordern(id, 'weg-egal@example.org');
  await sp.garageLoeschen(id);
  const [[z]] = await pool.query('SELECT COUNT(*) AS n FROM garage_tokens WHERE garage_id = ?', [id]);
  assert.equal(Number(z.n), 0);
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

test('Reihenfolge: neue Einträge ans Ende, gemeinsame Liste umsortieren, fremde Einträge unberührt', opt, async () => {
  const { id: g } = await sp.garageAnlegen();
  const { id: h } = await sp.garageAnlegen();
  const a = await sp.anlegen(g, 'fahrraeder', werte('fahrraeder', { name: 'A' }));
  const b = await sp.anlegen(g, 'anhaenger', werte('anhaenger', { name: 'B' }));
  const c = await sp.anlegen(g, 'fahrraeder', werte('fahrraeder', { name: 'C' }));
  const fremd = await sp.anlegen(h, 'fahrraeder', werte('fahrraeder', { name: 'Fremd' }));
  assert.ok(a.sortierung < b.sortierung && b.sortierung < c.sortierung);

  await sp.reihenfolgeSetzen(g, [{ art: 'fahrraeder', id: c.id }, { art: 'anhaenger', id: b.id }, { art: 'fahrraeder', id: a.id }, { art: 'fahrraeder', id: fremd.id }]);
  const alles = await sp.alles(g);
  const geordnet = [...alles.fahrraeder, ...alles.anhaenger].sort((x, y) => x.sortierung - y.sortierung).map(x => x.name);
  assert.deepEqual(geordnet, ['C', 'B', 'A']);
  assert.equal((await sp.alles(h)).fahrraeder[0].sortierung, fremd.sortierung, 'Eintrag einer anderen Garage bleibt');

  const nachher = await sp.anlegen(g, 'anhaenger', werte('anhaenger', { name: 'D' }));
  assert.ok(nachher.sortierung > a.sortierung && nachher.sortierung > b.sortierung && nachher.sortierung > c.sortierung);
  // Ändern lässt die Reihenfolge unberührt
  const geaendert = await sp.aendern(g, 'fahrraeder', c.id, werte('fahrraeder', { name: 'C2' }));
  assert.equal(geaendert.sortierung, 1);
});

test('Gespann: fremde Verweise abgelehnt, leere Plätze erlaubt, ein Gespann je Garage', opt, async () => {
  const { id: a } = await sp.garageAnlegen();
  const { id: b } = await sp.garageAnlegen();
  const rad = await sp.anlegen(a, 'fahrraeder', werte('fahrraeder', { name: 'Rad' }));
  const wagen = await sp.anlegen(a, 'anhaenger', werte('anhaenger', { name: 'Wagen' }));
  const fremd = await sp.anlegen(b, 'fahrraeder', werte('fahrraeder', { name: 'Fremd' }));
  const gw = (eingabe) => { const r = pruefeEingabe(GESPANN_FELDER, eingabe); assert.equal(r.fehler, null); return r.werte; };

  assert.equal((await sp.alles(a)).gespann, null);
  await assert.rejects(sp.gespannSetzen(a, gw({ fahrrad_id: fremd.id, anhaenger_id: wagen.id })), { status: 400 });

  const halb = await sp.gespannSetzen(a, gw({ anhaenger_id: wagen.id }));
  assert.equal(halb.fahrrad_id, null);
  assert.equal(halb.anhaenger_id, wagen.id);

  const voll = await sp.gespannSetzen(a, gw({ fahrrad_id: rad.id, anhaenger_id: wagen.id, fahrer_gewicht_kg: 80, gepaeck_kg: 12.5 }));
  assert.equal(voll.id, halb.id);
  assert.equal(voll.fahrer_gewicht_kg, 80);
  assert.equal(voll.status, 'ungeprueft');
  const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM gespanne WHERE garage_id = ?', [a]);
  assert.equal(Number(n.n), 1);

  // Ein Fahrrad löschen leert nur den Platz
  assert.equal(await sp.loeschen(a, 'fahrraeder', rad.id), true);
  const danach = (await sp.alles(a)).gespann;
  assert.equal(danach.fahrrad_id, null);
  assert.equal(danach.anhaenger_id, wagen.id);
  assert.equal(danach.fahrer_gewicht_kg, 80);
});

test('Gespann wird als ungeprüft zurückgesetzt, wenn es geändert wird', opt, async () => {
  const { id: a } = await sp.garageAnlegen();
  const gw = (eingabe) => pruefeEingabe(GESPANN_FELDER, eingabe).werte;
  await sp.gespannSetzen(a, gw({ fahrer_gewicht_kg: 70 }));
  await pool.query("UPDATE gespanne SET status = 'geprueft', geprueft_am = UTC_TIMESTAMP() WHERE garage_id = ?", [a]);
  const neu = await sp.gespannSetzen(a, gw({ fahrer_gewicht_kg: 71 }));
  assert.equal(neu.status, 'ungeprueft');
  const [[z]] = await pool.query('SELECT geprueft_am FROM gespanne WHERE garage_id = ?', [a]);
  assert.equal(z.geprueft_am, null);
});

test('Höchstzahl wird eingehalten', opt, async () => {
  const { id: g } = await sp.garageAnlegen();
  for (let i = 0; i < ARTEN.anhaenger.max; i++) await sp.anlegen(g, 'anhaenger', werte('anhaenger', { name: `A${i}` }));
  await assert.rejects(sp.anlegen(g, 'anhaenger', werte('anhaenger', { name: 'zu viel' })), { status: 409, code: 'limit' });
});

test('Garage löschen entfernt alle Einträge einschließlich Gespann', opt, async () => {
  const { id: g, token } = await sp.garageAnlegen();
  const rad = await sp.anlegen(g, 'fahrraeder', werte('fahrraeder', { name: 'Rad' }));
  const wagen = await sp.anlegen(g, 'anhaenger', werte('anhaenger', { name: 'Wagen' }));
  await sp.gespannSetzen(g, pruefeEingabe(GESPANN_FELDER, { fahrrad_id: rad.id, anhaenger_id: wagen.id }).werte);
  await sp.garageLoeschen(g);
  assert.equal(await sp.garageFinden(token), null);
  for (const t of ['fahrraeder', 'anhaenger', 'gespanne']) {
    const [[z]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE garage_id = ?`, [g]);
    assert.equal(Number(z.n), 0, t);
  }
});

test('alles() liefert Fahrräder, Anhänger und Gespann ohne garage_id und ohne Prüfnotiz', opt, async () => {
  const { id: g } = await sp.garageAnlegen();
  await sp.anlegen(g, 'fahrraeder', werte('fahrraeder', { name: 'Rad' }));
  const alles = await sp.alles(g);
  assert.deepEqual(Object.keys(alles), ['fahrer_name', 'email', 'email_offen', 'fahrraeder', 'anhaenger', 'gespann']);
  assert.ok(!('garage_id' in alles.fahrraeder[0]) && !('pruefnotiz' in alles.fahrraeder[0]));
});
