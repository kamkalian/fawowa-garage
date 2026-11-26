import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer, fakeMailer } from './hilfen.js';
import { Begrenzung } from '../lib/begrenzung.js';
import { ARTEN } from '../lib/felder.js';

let s;
before(async () => { s = await starteTestServer(); });
after(async () => { await s.schliessen(); });

async function neueGarage(name = 'Anja') {
  const r = await s.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: name } });
  assert.equal(r.status, 201);
  assert.match(r.json.token, /^[A-Za-z0-9_-]{43}$/);
  return r.json.token;
}

test('Sicherheits-Header sind gesetzt, die CSP erlaubt keine Inline-Stile', async () => {
  const r = await s.anfrage('GET', '/api/health');
  assert.match(r.headers.get('content-security-policy'), /style-src 'self'(;|$)/);
  assert.doesNotMatch(r.headers.get('content-security-policy'), /unsafe-inline/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-powered-by'), null);
});

test('Health: 200, bei ausgefallener Datenbank 503', async () => {
  assert.equal((await s.anfrage('GET', '/api/health')).status, 200);
  s.speicher.kaputt = true;
  assert.equal((await s.anfrage('GET', '/api/health')).status, 503);
  s.speicher.kaputt = false;
});

test('Einstellungen enthalten die Grenzen und keine Geheimnisse', async () => {
  const r = await s.anfrage('GET', '/api/v1/einstellungen');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.grenzen, { fahrraeder: 20, anhaenger: 20, gepaecke: 10 });
  assert.equal(r.json.testinstanz, false);
});

test('Ohne Schlüssel, mit falschem oder falsch geformtem Schlüssel: 401', async () => {
  for (const token of [undefined, 'abc', 'x'.repeat(43), '../'.repeat(15)]) {
    const r = await s.anfrage('GET', '/api/v1/garage', { token });
    assert.equal(r.status, 401, String(token));
    assert.equal(r.json.code, 'link_ungueltig');
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
});

test('Garage-Antworten werden nicht zwischengespeichert', async () => {
  const token = await neueGarage();
  const r = await s.anfrage('GET', '/api/v1/garage', { token });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(r.json, { fahrer_name: 'Anja', email: null, email_offen: null, fahrraeder: [], anhaenger: [], gepaecke: [], gespann: null, mitglieder: { fahrraeder: [], anhaenger: [], gepaecke: [] }, checkliste: [] });
});

test('Garage anlegen braucht den Namen der Fahrerin oder des Fahrers', async () => {
  for (const body of [undefined, {}, { fahrer_name: '' }, { fahrer_name: '   ' }, { fahrer_name: 5 }, { fahrer_name: 'x'.repeat(41) }]) {
    const r = await s.anfrage('POST', '/api/v1/garagen', body === undefined ? {} : { body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.code, 'eingabe');
    assert.ok(r.json.felder.fahrer_name);
  }
  const ok = await neueGarage('  Jo\u0007Müller ');
  assert.equal((await s.anfrage('GET', '/api/v1/garage', { token: ok })).json.fahrer_name, 'Jo Müller');
});

test('Name der Fahrerin oder des Fahrers ändern', async () => {
  const token = await neueGarage('Alt');
  const r = await s.anfrage('PUT', '/api/v1/garage/fahrer', { token, body: { fahrer_name: 'Neu' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { fahrer_name: 'Neu' });
  assert.equal((await s.anfrage('GET', '/api/v1/garage', { token })).json.fahrer_name, 'Neu');
  assert.equal((await s.anfrage('PUT', '/api/v1/garage/fahrer', { token, body: { fahrer_name: '' } })).status, 400);
  assert.equal((await s.anfrage('PUT', '/api/v1/garage/fahrer', { body: { fahrer_name: 'X' } })).status, 401);
});

test('Fahrrad anlegen, ändern, löschen', async () => {
  const token = await neueGarage();
  const neu = await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'Lastenrad', gaenge: '18', status: 'geprueft', garage_id: 99 } });
  assert.equal(neu.status, 201);
  assert.equal(neu.json.name, 'Lastenrad');
  assert.equal(neu.json.gaenge, 18);
  assert.equal(neu.json.status, 'ungeprueft', 'neue Einträge sind immer ungeprüft, auch wenn die Eingabe anderes behauptet');
  assert.ok(!('garage_id' in neu.json));

  const geaendert = await s.anfrage('PUT', `/api/v1/garage/fahrraeder/${neu.json.id}`, { token, body: { name: 'Lastenrad 2', gewicht_kg: 32 } });
  assert.equal(geaendert.status, 200);
  assert.equal(geaendert.json.name, 'Lastenrad 2');
  assert.equal(geaendert.json.gaenge, null, 'PUT ersetzt den ganzen Eintrag');

  assert.equal((await s.anfrage('DELETE', `/api/v1/garage/fahrraeder/${neu.json.id}`, { token })).status, 204);
  assert.equal((await s.anfrage('DELETE', `/api/v1/garage/fahrraeder/${neu.json.id}`, { token })).status, 404);
});

test('Änderung setzt einen geprüften Eintrag zurück auf ungeprüft', async () => {
  const token = await neueGarage();
  const neu = await s.anfrage('POST', '/api/v1/garage/anhaenger', { token, body: { name: 'Wagen' } });
  s.speicher.daten.anhaenger.find(z => z.id === neu.json.id).status = 'geprueft'; // wie im Verwaltungsbereich
  const r = await s.anfrage('PUT', `/api/v1/garage/anhaenger/${neu.json.id}`, { token, body: { name: 'Wagen' } });
  assert.equal(r.json.status, 'ungeprueft');
});

test('Ungültige Eingabe: 400 mit Feldhinweisen', async () => {
  const token = await neueGarage();
  const r = await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { gewicht_kg: 'schwer' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, 'eingabe');
  assert.deepEqual(r.json.felder, { gewicht_kg: 'ungueltig' });
});

test('Unbekannte Art und ungültige ID: 404', async () => {
  const token = await neueGarage();
  assert.equal((await s.anfrage('POST', '/api/v1/garage/motorraeder', { token, body: { name: 'x' } })).status, 404);
  assert.equal((await s.anfrage('PUT', '/api/v1/garage/fahrraeder/abc', { token, body: { name: 'x' } })).status, 404);
  assert.equal((await s.anfrage('DELETE', '/api/v1/garage/fahrraeder/0', { token })).status, 404);
  assert.equal((await s.anfrage('PUT', '/api/v1/garage/fahrraeder/99999', { token, body: { name: 'x' } })).status, 404);
});

test('Garagen sehen und ändern nur ihre eigenen Einträge', async () => {
  const a = await neueGarage();
  const b = await neueGarage();
  const rad = await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token: a, body: { name: 'Nur von A' } });
  assert.deepEqual((await s.anfrage('GET', '/api/v1/garage', { token: b })).json.fahrraeder, []);
  assert.equal((await s.anfrage('PUT', `/api/v1/garage/fahrraeder/${rad.json.id}`, { token: b, body: { name: 'Fremd' } })).status, 404);
  assert.equal((await s.anfrage('DELETE', `/api/v1/garage/fahrraeder/${rad.json.id}`, { token: b })).status, 404);
  assert.equal((await s.anfrage('GET', '/api/v1/garage', { token: a })).json.fahrraeder[0].name, 'Nur von A');
});

test('Reihenfolge: gemeinsame Liste aus Fahrrädern und Anhängern, neue Einträge kommen ans Ende', async () => {
  const token = await neueGarage();
  const a = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'A' } })).json;
  const b = (await s.anfrage('POST', '/api/v1/garage/anhaenger', { token, body: { name: 'B' } })).json;
  const c = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'C' } })).json;
  assert.ok(a.sortierung < b.sortierung && b.sortierung < c.sortierung);

  const neu = await s.anfrage('PUT', '/api/v1/garage/reihenfolge', { token, body: { reihenfolge: [{ art: 'fahrraeder', id: c.id }, { art: 'anhaenger', id: b.id }, { art: 'fahrraeder', id: a.id }] } });
  assert.equal(neu.status, 204);
  const g = (await s.anfrage('GET', '/api/v1/garage', { token })).json;
  const alle = [...g.fahrraeder.map(x => ({ ...x, art: 'f' })), ...g.anhaenger.map(x => ({ ...x, art: 'a' }))].sort((x, y) => x.sortierung - y.sortierung);
  assert.deepEqual(alle.map(x => x.name), ['C', 'B', 'A']);
});

test('Reihenfolge: fremde Einträge ändern nichts, ungültige Eingaben werden abgelehnt', async () => {
  const a = await neueGarage();
  const b = await neueGarage();
  const mein = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token: a, body: { name: 'Mein' } })).json;
  const fremd = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token: b, body: { name: 'Fremd' } })).json;
  const vorher = (await s.anfrage('GET', '/api/v1/garage', { token: b })).json.fahrraeder[0].sortierung;

  await s.anfrage('PUT', '/api/v1/garage/reihenfolge', { token: a, body: { reihenfolge: [{ art: 'fahrraeder', id: fremd.id }, { art: 'fahrraeder', id: mein.id }] } });
  assert.equal((await s.anfrage('GET', '/api/v1/garage', { token: b })).json.fahrraeder[0].sortierung, vorher);

  for (const body of [{}, { reihenfolge: 'x' }, { reihenfolge: [{ art: 'gespanne', id: 1 }] }, { reihenfolge: [{ art: 'fahrraeder', id: '1; DROP' }] },
    { reihenfolge: [null] }, { reihenfolge: Array.from({ length: 100 }, () => ({ art: 'fahrraeder', id: 1 })) }]) {
    const r = await s.anfrage('PUT', '/api/v1/garage/reihenfolge', { token: a, body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
  }
});

test('Gespann: beliebig viele Zugfahrzeuge und Anhänger, Fahrer und Gepäck; nur eigene Einträge', async () => {
  const a = await neueGarage();
  const b = await neueGarage();
  const rad1 = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token: a, body: { name: 'Rad 1' } })).json;
  const rad2 = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token: a, body: { name: 'Rad 2' } })).json;
  const wagen1 = (await s.anfrage('POST', '/api/v1/garage/anhaenger', { token: a, body: { name: 'Wagen 1' } })).json;
  const wagen2 = (await s.anfrage('POST', '/api/v1/garage/anhaenger', { token: a, body: { name: 'Wagen 2' } })).json;
  const fremdesRad = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token: b, body: { name: 'Rad von B' } })).json;

  const fremd = await s.anfrage('PUT', '/api/v1/garage/mitglied', { token: a, body: { art: 'fahrraeder', id: fremdesRad.id, im: true } });
  assert.equal(fremd.status, 400);

  await s.anfrage('PUT', '/api/v1/garage/mitglied', { token: a, body: { art: 'fahrraeder', id: rad1.id, im: true } });
  await s.anfrage('PUT', '/api/v1/garage/mitglied', { token: a, body: { art: 'fahrraeder', id: rad2.id, im: true } });
  const z = await s.anfrage('PUT', '/api/v1/garage/mitglied', { token: a, body: { art: 'anhaenger', id: wagen1.id, im: true } });
  assert.equal(z.status, 200);
  assert.deepEqual(z.json.mitglieder, { fahrraeder: [rad1.id, rad2.id], anhaenger: [wagen1.id], gepaecke: [] }, 'zwei Zugfahrzeuge, ein Anhänger');
  await s.anfrage('PUT', '/api/v1/garage/mitglied', { token: a, body: { art: 'anhaenger', id: wagen2.id, im: true } });
  await s.anfrage('PUT', '/api/v1/garage/mitglied', { token: a, body: { art: 'anhaenger', id: wagen1.id, im: false } });
  assert.deepEqual((await s.anfrage('GET', '/api/v1/garage', { token: a })).json.mitglieder, { fahrraeder: [rad1.id, rad2.id], anhaenger: [wagen2.id], gepaecke: [] });

  const voll = await s.anfrage('PUT', '/api/v1/garage/gespann', { token: a, body: { fahrer_gewicht_kg: 75 } });
  assert.equal(voll.status, 200);
  assert.equal(voll.json.fahrer_gewicht_kg, 75);
  assert.equal((await s.anfrage('GET', '/api/v1/garage', { token: b })).json.mitglieder.fahrraeder.length, 0);

  const ungueltig = await s.anfrage('PUT', '/api/v1/garage/gespann', { token: a, body: { fahrer_gewicht_kg: 5 } });
  assert.equal(ungueltig.status, 400);
  assert.deepEqual(ungueltig.json.felder, { fahrer_gewicht_kg: 'zu_klein' });
});

test('Fahrrad oder Anhänger löschen nimmt es aus dem Gespann', async () => {
  const token = await neueGarage();
  const rad = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'Rad' } })).json;
  const wagen = (await s.anfrage('POST', '/api/v1/garage/anhaenger', { token, body: { name: 'Wagen' } })).json;
  await s.anfrage('PUT', '/api/v1/garage/mitglied', { token, body: { art: 'fahrraeder', id: rad.id, im: true } });
  await s.anfrage('PUT', '/api/v1/garage/mitglied', { token, body: { art: 'anhaenger', id: wagen.id, im: true } });

  assert.equal((await s.anfrage('DELETE', `/api/v1/garage/fahrraeder/${rad.id}`, { token })).status, 204);
  const m = (await s.anfrage('GET', '/api/v1/garage', { token })).json.mitglieder;
  assert.deepEqual(m, { fahrraeder: [], anhaenger: [wagen.id], gepaecke: [] });
});

test('Gespann ist keine Eintragsart: POST darauf gibt es nicht', async () => {
  const token = await neueGarage();
  assert.equal((await s.anfrage('POST', '/api/v1/garage/gespann', { token, body: {} })).status, 404);
  assert.equal((await s.anfrage('POST', '/api/v1/garage/gespanne', { token, body: { name: 'x' } })).status, 404);
});

test('Höchstzahl je Art: 409 limit', async () => {
  const token = await neueGarage();
  for (let i = 0; i < ARTEN.fahrraeder.max; i++) {
    assert.equal((await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: `R${i}` } })).status, 201);
  }
  const r = await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'zu viel' } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'limit');
});

test('Garage löschen entfernt alles, der Link gilt danach nicht mehr', async () => {
  const token = await neueGarage();
  await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'Rad' } });
  assert.equal((await s.anfrage('DELETE', '/api/v1/garage', { token })).status, 204);
  assert.equal((await s.anfrage('GET', '/api/v1/garage', { token })).status, 401);
});

test('Kaputtes JSON: 400 ohne Interna', async () => {
  const token = await neueGarage();
  const res = await fetch(`${s.url}/api/v1/garage/fahrraeder`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{kaputt'
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Ungültige Anfrage' });
});

test('Zu große Anfrage: 413', async () => {
  const token = await neueGarage();
  const res = await fetch(`${s.url}/api/v1/garage/fahrraeder`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', notiz: 'y'.repeat(30000) })
  });
  assert.equal(res.status, 413);
});

test('Unbekannte API-Adresse: 404 als JSON', async () => {
  const r = await s.anfrage('GET', '/api/v1/gibtsnicht');
  assert.equal(r.status, 404);
  assert.deepEqual(r.json, { error: 'Not found' });
});

test('Begrenzung: neue Garagen je Adresse, falsche Schlüssel je Adresse', async () => {
  const t = await starteTestServer({ app: { begrenzungen: { neu: new Begrenzung({ max: 2 }), falsch: new Begrenzung({ max: 3 }) } } });
  try {
    assert.equal((await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'A' } })).status, 201);
    assert.equal((await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'A' } })).status, 201);
    const zuViele = await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'A' } });
    assert.equal(zuViele.status, 429);
    assert.equal(zuViele.json.code, 'zu_viele');

    for (let i = 0; i < 3; i++) assert.equal((await t.anfrage('GET', '/api/v1/garage', { token: 'x'.repeat(43) })).status, 401);
    assert.equal((await t.anfrage('GET', '/api/v1/garage', { token: 'x'.repeat(43) })).status, 429);
  } finally {
    await t.schliessen();
  }
});

test('Obergrenze für Garagen insgesamt: 503', async () => {
  const t = await starteTestServer({ app: { env: { MAX_GARAGEN: '1' } } });
  try {
    assert.equal((await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'A' } })).status, 201);
    const r = await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'A' } });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'voll');
  } finally {
    await t.schliessen();
  }
});

test('Testinstanz: Hinweis in den Einstellungen und Header gegen Suchmaschinen', async () => {
  const t = await starteTestServer({ app: { env: { TESTINSTANZ: '1' } } });
  try {
    const r = await t.anfrage('GET', '/api/v1/einstellungen');
    assert.equal(r.json.testinstanz, true);
    assert.match(r.headers.get('x-robots-tag'), /noindex/);
  } finally {
    await t.schliessen();
  }
});


// ---------- E-Mail ----------

const URL_ = 'https://garage.example.org';

async function mitMail(optionen = {}) {
  const mailer = fakeMailer();
  const t = await starteTestServer({ app: { mailer, url: URL_, ...optionen } });
  const neu = async (name = 'Anja') => (await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: name } })).json.token;
  return { t, mailer, neu };
}

test('E-Mail ohne SMTP: abgeschaltet, Einstellungen sagen es, Anfragen werden mit 503 abgelehnt', async () => {
  const token = await neueGarage();
  assert.equal((await s.anfrage('GET', '/api/v1/einstellungen')).json.emailAktiv, false);
  assert.equal((await s.anfrage('PUT', '/api/v1/garage/email', { token, body: { email: 'a@b.de' } })).json.code, 'email_aus');
  assert.equal((await s.anfrage('POST', '/api/v1/zugang/anfordern', { body: { email: 'a@b.de' } })).status, 503);
  assert.equal((await s.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: 'x'.repeat(43) } })).status, 503);
});

test('E-Mail: Adresse angeben, Link in der Mail, bestätigen, Link nur einmal nutzbar', async () => {
  const { t, mailer, neu } = await mitMail();
  try {
    assert.equal((await t.anfrage('GET', '/api/v1/einstellungen')).json.emailAktiv, true);
    const token = await neu();
    const r = await t.anfrage('PUT', '/api/v1/garage/email', { token, body: { email: '  Anja@Example.ORG ' } });
    assert.equal(r.status, 202);
    assert.equal(r.json.email_offen, 'anja@example.org');

    assert.equal(mailer.gesendet.length, 1);
    assert.equal(mailer.gesendet[0].an, 'anja@example.org');
    assert.match(mailer.gesendet[0].text, new RegExp(`${URL_}/#bestaetigen=[A-Za-z0-9_-]{43}`));
    assert.doesNotMatch(mailer.gesendet[0].text, new RegExp(token), 'der Zugangsschlüssel steht nie in einer Mail');

    let g = (await t.anfrage('GET', '/api/v1/garage', { token })).json;
    assert.equal(g.email, null);
    assert.equal(g.email_offen, 'anja@example.org');

    const bestaetigung = mailer.letzterToken();
    const ok = await t.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: bestaetigung } });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { email: 'anja@example.org' });
    g = (await t.anfrage('GET', '/api/v1/garage', { token })).json;
    assert.equal(g.email, 'anja@example.org');
    assert.equal(g.email_offen, null);

    const nochmal = await t.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: bestaetigung } });
    assert.equal(nochmal.status, 400);
    assert.equal(nochmal.json.code, 'token_ungueltig');
  } finally { await t.schliessen(); }
});

test('E-Mail: ungültige Adressen und Schlüssel werden abgelehnt', async () => {
  const { t, neu } = await mitMail();
  try {
    const token = await neu();
    for (const email of [undefined, '', 'ohne-at', 'a@b', 'a@b.', 'a b@c.de', 'a@b.de, c@d.de', 'a@b.de\r\nBcc: x@y.de', '<a@b.de>', 5, 'x'.repeat(250) + '@b.de']) {
      const r = await t.anfrage('PUT', '/api/v1/garage/email', { token, body: { email } });
      assert.equal(r.status, 400, String(email).slice(0, 30));
      assert.equal(r.json.code, 'eingabe');
    }
    for (const x of [undefined, '', 'kurz', 'x'.repeat(43), 5]) {
      const r = await t.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: x } });
      assert.equal(r.status, 400, String(x));
      assert.equal(r.json.code, 'token_ungueltig');
    }
  } finally { await t.schliessen(); }
});

test('E-Mail: eine bestätigte Adresse gehört nur einer Garage', async () => {
  const { t, mailer, neu } = await mitMail();
  try {
    const a = await neu('A');
    const b = await neu('B');
    await t.anfrage('PUT', '/api/v1/garage/email', { token: a, body: { email: 'gleich@example.org' } });
    await t.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: mailer.letzterToken() } });
    await t.anfrage('PUT', '/api/v1/garage/email', { token: b, body: { email: 'gleich@example.org' } });
    const r = await t.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: mailer.letzterToken() } });
    assert.equal(r.status, 409);
    assert.equal(r.json.code, 'email_vergeben');
  } finally { await t.schliessen(); }
});

test('E-Mail: Adresse entfernen löscht auch offene Links', async () => {
  const { t, mailer, neu } = await mitMail();
  try {
    const token = await neu();
    await t.anfrage('PUT', '/api/v1/garage/email', { token, body: { email: 'weg@example.org' } });
    const offen = mailer.letzterToken();
    assert.equal((await t.anfrage('DELETE', '/api/v1/garage/email', { token })).status, 204);
    assert.equal((await t.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: offen } })).status, 400);
    const g = (await t.anfrage('GET', '/api/v1/garage', { token })).json;
    assert.equal(g.email, null);
    assert.equal(g.email_offen, null);
  } finally { await t.schliessen(); }
});

test('E-Mail: abgelaufener Bestätigungslink gilt nicht', async () => {
  const { t, mailer, neu } = await mitMail();
  try {
    const token = await neu();
    await t.anfrage('PUT', '/api/v1/garage/email', { token, body: { email: 'spaet@example.org' } });
    for (const eintrag of t.speicher.tokens.values()) eintrag.bis = Date.now() - 1000;
    assert.equal((await t.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: mailer.letzterToken() } })).status, 400);
    assert.equal((await t.anfrage('GET', '/api/v1/garage', { token })).json.email_offen, null);
  } finally { await t.schliessen(); }
});

test('Zugang per E-Mail: neuer Schlüssel, alter gilt nicht mehr, Daten bleiben, Link nur einmal', async () => {
  const { t, mailer, neu } = await mitMail();
  try {
    const alt = await neu('Jo');
    await t.anfrage('POST', '/api/v1/garage/fahrraeder', { token: alt, body: { name: 'Rad' } });
    await t.anfrage('PUT', '/api/v1/garage/email', { token: alt, body: { email: 'jo@example.org' } });
    await t.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: mailer.letzterToken() } });

    const anfrage = await t.anfrage('POST', '/api/v1/zugang/anfordern', { body: { email: 'JO@example.org', lang: 'en' } });
    assert.equal(anfrage.status, 202);
    const mail = mailer.gesendet.at(-1);
    assert.equal(mail.an, 'jo@example.org');
    assert.match(mail.betreff, /access/i, 'Sprache en');
    assert.match(mail.text, new RegExp(`${URL_}/#zugang=`));
    const link = mailer.letzterToken();

    const ein = await t.anfrage('POST', '/api/v1/zugang/einloesen', { body: { token: link } });
    assert.equal(ein.status, 200);
    assert.match(ein.json.token, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(ein.json.token, alt);

    assert.equal((await t.anfrage('GET', '/api/v1/garage', { token: alt })).status, 401);
    const g = (await t.anfrage('GET', '/api/v1/garage', { token: ein.json.token })).json;
    assert.equal(g.fahrer_name, 'Jo');
    assert.equal(g.fahrraeder.length, 1);
    assert.equal((await t.anfrage('POST', '/api/v1/zugang/einloesen', { body: { token: link } })).status, 400);
  } finally { await t.schliessen(); }
});

test('Zugang per E-Mail: unbekannte und bekannte Adressen bekommen dieselbe Antwort', async () => {
  const { t, mailer, neu } = await mitMail();
  try {
    const token = await neu();
    await t.anfrage('PUT', '/api/v1/garage/email', { token, body: { email: 'bekannt@example.org' } });
    await t.anfrage('POST', '/api/v1/email/bestaetigen', { body: { token: mailer.letzterToken() } });
    const vorher = mailer.gesendet.length;

    const bekannt = await t.anfrage('POST', '/api/v1/zugang/anfordern', { body: { email: 'bekannt@example.org' } });
    const unbekannt = await t.anfrage('POST', '/api/v1/zugang/anfordern', { body: { email: 'niemand@example.org' } });
    assert.equal(bekannt.status, unbekannt.status);
    assert.deepEqual(bekannt.json, unbekannt.json);
    assert.equal(mailer.gesendet.length, vorher + 1, 'nur an die bekannte Adresse geht eine Mail');
    assert.equal((await t.anfrage('POST', '/api/v1/zugang/anfordern', { body: { email: 'kaputt' } })).status, 400);
  } finally { await t.schliessen(); }
});

test('Zugang per E-Mail: ein nur angegebener, nicht bestätigter Wert öffnet nichts', async () => {
  const { t, mailer, neu } = await mitMail();
  try {
    const token = await neu();
    await t.anfrage('PUT', '/api/v1/garage/email', { token, body: { email: 'offen@example.org' } });
    const vorher = mailer.gesendet.length;
    await t.anfrage('POST', '/api/v1/zugang/anfordern', { body: { email: 'offen@example.org' } });
    assert.equal(mailer.gesendet.length, vorher, 'ohne Bestätigung keine Zugangs-Mail');
    // Der Bestätigungslink ist kein Zugangslink
    assert.equal((await t.anfrage('POST', '/api/v1/zugang/einloesen', { body: { token: mailer.letzterToken() } })).status, 400);
  } finally { await t.schliessen(); }
});

test('E-Mail: Begrenzung je Adresse und je Besucher; Fehler beim Senden wird gemeldet', async () => {
  const { t, mailer, neu } = await mitMail();
  try {
    const token = await neu();
    for (let i = 0; i < 3; i++) assert.equal((await t.anfrage('PUT', '/api/v1/garage/email', { token, body: { email: 'viel@example.org' } })).status, 202);
    assert.equal((await t.anfrage('PUT', '/api/v1/garage/email', { token, body: { email: 'viel@example.org' } })).status, 429);
    // Zugang: bei Überschreitung je Adresse still keine weitere Mail, Antwort bleibt gleich
    const vorher = mailer.gesendet.length;
    assert.equal((await t.anfrage('POST', '/api/v1/zugang/anfordern', { body: { email: 'viel@example.org' } })).status, 202);
    assert.equal(mailer.gesendet.length, vorher);

    mailer.fehler = true;
    const r = await t.anfrage('PUT', '/api/v1/garage/email', { token, body: { email: 'andere@example.org' } });
    assert.equal(r.status, 503);
    assert.equal(r.json.code, 'mail_fehler');
  } finally { await t.schliessen(); }
});

test('E-Mail: Antworten dieser Pfade werden nicht zwischengespeichert', async () => {
  const { t } = await mitMail();
  try {
    for (const pfad of ['/api/v1/email/bestaetigen', '/api/v1/zugang/einloesen']) {
      const r = await t.anfrage('POST', pfad, { body: { token: 'x'.repeat(43) } });
      assert.equal(r.headers.get('cache-control'), 'no-store', pfad);
    }
  } finally { await t.schliessen(); }
});
