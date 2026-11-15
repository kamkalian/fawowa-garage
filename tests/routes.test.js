import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { Begrenzung } from '../lib/begrenzung.js';
import { ARTEN } from '../lib/felder.js';

let s;
before(async () => { s = await starteTestServer(); });
after(async () => { await s.schliessen(); });

async function neueGarage() {
  const r = await s.anfrage('POST', '/api/v1/garagen');
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
  assert.deepEqual(r.json.grenzen, { fahrraeder: 20, anhaenger: 20 });
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
  assert.deepEqual(r.json, { fahrraeder: [], anhaenger: [], gespann: null });
});

test('Fahrrad anlegen, ändern, löschen', async () => {
  const token = await neueGarage();
  const neu = await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'Lastenrad', akku_kapazitaet_wh: '625', status: 'geprueft', garage_id: 99 } });
  assert.equal(neu.status, 201);
  assert.equal(neu.json.name, 'Lastenrad');
  assert.equal(neu.json.akku_kapazitaet_wh, 625);
  assert.equal(neu.json.status, 'ungeprueft', 'neue Einträge sind immer ungeprüft, auch wenn die Eingabe anderes behauptet');
  assert.ok(!('garage_id' in neu.json));

  const geaendert = await s.anfrage('PUT', `/api/v1/garage/fahrraeder/${neu.json.id}`, { token, body: { name: 'Lastenrad 2', gewicht_kg: 32 } });
  assert.equal(geaendert.status, 200);
  assert.equal(geaendert.json.name, 'Lastenrad 2');
  assert.equal(geaendert.json.akku_kapazitaet_wh, null, 'PUT ersetzt den ganzen Eintrag');

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
  assert.deepEqual(r.json.felder, { name: 'pflicht', gewicht_kg: 'ungueltig' });
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

test('Gespann: Plätze setzen, leeren, Gewichte; Verweise nur in die eigene Garage', async () => {
  const a = await neueGarage();
  const b = await neueGarage();
  const rad = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token: a, body: { name: 'Rad' } })).json;
  const wagen = (await s.anfrage('POST', '/api/v1/garage/anhaenger', { token: a, body: { name: 'Wagen' } })).json;
  const fremdesRad = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token: b, body: { name: 'Rad von B' } })).json;

  const fremd = await s.anfrage('PUT', '/api/v1/garage/gespann', { token: a, body: { fahrrad_id: fremdesRad.id, anhaenger_id: wagen.id } });
  assert.equal(fremd.status, 400);
  assert.deepEqual(fremd.json.felder, { fahrrad_id: 'ungueltig' });

  // Nur ein Platz belegt ist erlaubt
  const halb = await s.anfrage('PUT', '/api/v1/garage/gespann', { token: a, body: { anhaenger_id: wagen.id } });
  assert.equal(halb.status, 200);
  assert.equal(halb.json.anhaenger_id, wagen.id);
  assert.equal(halb.json.fahrrad_id, null);

  const voll = await s.anfrage('PUT', '/api/v1/garage/gespann', { token: a, body: { fahrrad_id: rad.id, anhaenger_id: wagen.id, fahrer_gewicht_kg: 75, gepaeck_kg: '12,5' } });
  assert.equal(voll.status, 200);
  assert.equal(voll.json.gepaeck_kg, 12.5);
  assert.equal(voll.json.status, 'ungeprueft');
  assert.equal(voll.json.id, halb.json.id, 'es bleibt dasselbe Gespann');

  assert.equal((await s.anfrage('GET', '/api/v1/garage', { token: a })).json.gespann.fahrrad_id, rad.id);
  assert.equal((await s.anfrage('GET', '/api/v1/garage', { token: b })).json.gespann, null);

  const ungueltig = await s.anfrage('PUT', '/api/v1/garage/gespann', { token: a, body: { fahrer_gewicht_kg: 5, gepaeck_kg: 'viel' } });
  assert.equal(ungueltig.status, 400);
  assert.deepEqual(ungueltig.json.felder, { fahrer_gewicht_kg: 'zu_klein', gepaeck_kg: 'ungueltig' });
});

test('Fahrrad oder Anhänger löschen leert den Platz im Gespann', async () => {
  const token = await neueGarage();
  const rad = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'Rad' } })).json;
  const wagen = (await s.anfrage('POST', '/api/v1/garage/anhaenger', { token, body: { name: 'Wagen' } })).json;
  await s.anfrage('PUT', '/api/v1/garage/gespann', { token, body: { fahrrad_id: rad.id, anhaenger_id: wagen.id, fahrer_gewicht_kg: 80 } });

  assert.equal((await s.anfrage('DELETE', `/api/v1/garage/fahrraeder/${rad.id}`, { token })).status, 204);
  const g = (await s.anfrage('GET', '/api/v1/garage', { token })).json.gespann;
  assert.equal(g.fahrrad_id, null);
  assert.equal(g.anhaenger_id, wagen.id);
  assert.equal(g.fahrer_gewicht_kg, 80);
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
    assert.equal((await t.anfrage('POST', '/api/v1/garagen')).status, 201);
    assert.equal((await t.anfrage('POST', '/api/v1/garagen')).status, 201);
    const zuViele = await t.anfrage('POST', '/api/v1/garagen');
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
    assert.equal((await t.anfrage('POST', '/api/v1/garagen')).status, 201);
    const r = await t.anfrage('POST', '/api/v1/garagen');
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
