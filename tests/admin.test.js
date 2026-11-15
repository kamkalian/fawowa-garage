import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { starteTestServer } from './hilfen.js';
import { hashPasswort, _intern } from '../lib/auth.js';

const PW = 'ein-langes-test-passwort';
beforeEach(() => _intern.reset());

/** Server mit Admin-Passwort; liefert zusätzlich anfrage-Funktionen für die Admin-API mit Sitzungs-Cookie */
async function mitAdmin(optionen = {}) {
  const env = { ADMIN_PASSWORD_HASH: hashPasswort(PW), ...optionen.env };
  const t = await starteTestServer({ app: { env, ...optionen.app } });

  async function roh(methode, pfad, { body, cookie, headers = {}, json = true } = {}) {
    const res = await fetch(t.url + pfad, {
      method: methode,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined && json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? (json ? JSON.stringify(body) : body) : undefined
    });
    const text = await res.text();
    let daten = null;
    try { daten = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
    return { status: res.status, json: daten, text, headers: res.headers };
  }

  const login = await roh('POST', '/api/admin/login', { body: { passwort: PW } });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const a = (methode, pfad, body, extra = {}) => roh(methode, `/api/admin${pfad}`, { body, cookie, ...extra });
  const neueGarage = async (name = 'Anja') => (await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: name } })).json.token;
  return { t, roh, a, cookie, login, neueGarage };
}

test('Ohne ADMIN_PASSWORD_HASH ist der Zugang nicht eingerichtet (503)', async () => {
  const t = await starteTestServer({ app: { env: {} } });
  try {
    const r = await t.anfrage('POST', '/api/admin/login', { body: { passwort: 'irgendwas' } });
    assert.equal(r.status, 503);
  } finally { await t.schliessen(); }
});

test('Anmeldung: falsches Passwort 401, richtiges setzt ein sicheres Cookie, Abmelden beendet die Sitzung', async () => {
  const s = await mitAdmin();
  try {
    assert.equal((await s.roh('POST', '/api/admin/login', { body: { passwort: 'falsch' } })).status, 401);
    assert.equal(s.login.status, 200);
    const setCookie = s.login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.equal(s.login.headers.get('cache-control'), 'no-store');

    assert.deepEqual((await s.a('GET', '/sitzung')).json, { angemeldet: true });
    await s.a('POST', '/logout', {});
    assert.deepEqual((await s.a('GET', '/sitzung')).json, { angemeldet: false });
    assert.equal((await s.a('GET', '/uebersicht')).status, 401);
  } finally { await s.t.schliessen(); }
});

test('Alle Admin-Funktionen verlangen eine Sitzung', async () => {
  const s = await mitAdmin();
  try {
    for (const [methode, pfad, body] of [
      ['GET', '/uebersicht'], ['GET', '/garagen'], ['GET', '/garagen/1'], ['PATCH', '/garagen/1', { fahrer_name: 'X' }],
      ['POST', '/garagen/1/pruefen', { status: 'geprueft' }], ['DELETE', '/garagen/1'],
      ['PATCH', '/eintraege/fahrraeder/1', { status: 'geprueft' }], ['DELETE', '/eintraege/fahrraeder/1']
    ]) {
      const r = await s.roh(methode, `/api/admin${pfad}`, { body });
      assert.equal(r.status, 401, `${methode} ${pfad}`);
    }
    // ein erfundenes Cookie hilft nicht
    assert.equal((await s.roh('GET', '/api/admin/uebersicht', { cookie: 'admin_sitzung=' + 'a'.repeat(64) })).status, 401);
  } finally { await s.t.schliessen(); }
});

test('Anmeldung: nach fünf Fehlversuchen gesperrt, auch mit richtigem Passwort', async () => {
  const s = await mitAdmin();
  try {
    for (let i = 0; i < 5; i++) await s.roh('POST', '/api/admin/login', { body: { passwort: 'falsch' + i } });
    const r = await s.roh('POST', '/api/admin/login', { body: { passwort: PW } });
    assert.equal(r.status, 429);
  } finally { await s.t.schliessen(); }
});

test('Schutz vor fremden Seiten: fremder Origin 403, kein JSON 415, gleicher Origin geht', async () => {
  const s = await mitAdmin();
  try {
    const fremd = await s.a('POST', '/garagen/1/pruefen', { status: 'geprueft' }, { headers: { Origin: 'https://boese.example.net' } });
    assert.equal(fremd.status, 403);
    const eigener = new URL(s.t.url).host;
    const ok = await s.a('POST', '/garagen/1/pruefen', { status: 'geprueft' }, { headers: { Origin: `http://${eigener}` } });
    assert.notEqual(ok.status, 403);
    const text = await s.a('POST', '/garagen/1/pruefen', 'status=geprueft', { json: false, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    assert.equal(text.status, 415);
    // Lesen ist davon nicht betroffen
    assert.equal((await s.a('GET', '/uebersicht', undefined, { headers: { Origin: 'https://boese.example.net' } })).status, 200);
  } finally { await s.t.schliessen(); }
});

test('Verwaltung: Übersicht, Liste mit Suche und Filter, Detail', async () => {
  const s = await mitAdmin();
  try {
    const a = await s.neueGarage('Anja Beispiel');
    await s.neueGarage('Bernd');
    await s.t.anfrage('POST', '/api/v1/garage/fahrraeder', { token: a, body: { name: 'Lastenrad' } });
    await s.t.anfrage('POST', '/api/v1/garage/anhaenger', { token: a, body: { name: 'Wagen', notiz: 'geheim?' } });

    const u = (await s.a('GET', '/uebersicht')).json;
    assert.deepEqual([u.garagen, u.fahrraeder, u.anhaenger, u.ungeprueft, u.garagen_mit_ungeprueften], [2, 1, 1, 2, 1]);

    const alle = (await s.a('GET', '/garagen')).json;
    assert.equal(alle.gesamt, 2);
    assert.equal(alle.garagen[0].fahrer_name, 'Bernd', 'neueste zuerst');
    const anja = alle.garagen.find(g => g.fahrer_name === 'Anja Beispiel');
    assert.deepEqual([anja.fahrraeder, anja.anhaenger, anja.ungeprueft], [1, 1, 2]);

    assert.equal((await s.a('GET', '/garagen?suche=anja')).json.gesamt, 1);
    assert.equal((await s.a('GET', `/garagen?suche=${anja.id}`)).json.garagen[0].id, anja.id);
    assert.equal((await s.a('GET', '/garagen?suche=gibtsnicht')).json.gesamt, 0);
    assert.equal((await s.a('GET', '/garagen?ungeprueft=1')).json.gesamt, 1);

    const detail = (await s.a('GET', `/garagen/${anja.id}`)).json;
    assert.equal(detail.fahrer_name, 'Anja Beispiel');
    assert.equal(detail.fahrraeder[0].name, 'Lastenrad');
    assert.equal(detail.anhaenger[0].notiz, 'geheim?');
    assert.equal(detail.fahrraeder[0].status, 'ungeprueft');
  } finally { await s.t.schliessen(); }
});

test('Verwaltung: Prüfstatus und Notiz setzen, Nutzer sieht die Notiz nie, Änderung durch den Nutzer setzt zurück', async () => {
  const s = await mitAdmin();
  try {
    const token = await s.neueGarage();
    const rad = (await s.t.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'Rad' } })).json;
    const id = (await s.a('GET', '/garagen')).json.garagen[0].id;

    const r = await s.a('PATCH', `/eintraege/fahrraeder/${rad.id}`, { status: 'geprueft', pruefnotiz: '  Beim Treffen gesehen\u0007 ' });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, 'geprueft');
    assert.ok(r.json.geprueft_am);
    assert.equal(r.json.pruefnotiz, 'Beim Treffen gesehen');

    // Der Nutzer sieht den Status, aber keine Notiz und kein Prüfdatum
    const nutzer = (await s.t.anfrage('GET', '/api/v1/garage', { token })).json.fahrraeder[0];
    assert.equal(nutzer.status, 'geprueft');
    assert.ok(!('pruefnotiz' in nutzer) && !('geprueft_am' in nutzer));

    // Nur die Notiz ändern lässt den Status stehen; leere Notiz löscht sie
    assert.equal((await s.a('PATCH', `/eintraege/fahrraeder/${rad.id}`, { pruefnotiz: '' })).json.pruefnotiz, null);
    assert.equal((await s.a('GET', `/garagen/${id}`)).json.fahrraeder[0].status, 'geprueft');

    // Ändert der Nutzer den Eintrag, gilt er wieder als ungeprüft
    await s.t.anfrage('PUT', `/api/v1/garage/fahrraeder/${rad.id}`, { token, body: { name: 'Rad neu' } });
    assert.equal((await s.a('GET', `/garagen/${id}`)).json.fahrraeder[0].status, 'ungeprueft');

    // Zurücksetzen
    await s.a('PATCH', `/eintraege/fahrraeder/${rad.id}`, { status: 'geprueft' });
    const zurueck = await s.a('PATCH', `/eintraege/fahrraeder/${rad.id}`, { status: 'ungeprueft' });
    assert.equal(zurueck.json.status, 'ungeprueft');
    assert.equal(zurueck.json.geprueft_am, null);
  } finally { await s.t.schliessen(); }
});

test('Verwaltung: ganze Garage prüfen, Gespann prüfen, Einträge und Garage löschen, Namen korrigieren', async () => {
  const s = await mitAdmin();
  try {
    const token = await s.neueGarage('Jo');
    const rad = (await s.t.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'Rad' } })).json;
    const wagen = (await s.t.anfrage('POST', '/api/v1/garage/anhaenger', { token, body: { name: 'Wagen' } })).json;
    await s.t.anfrage('PUT', '/api/v1/garage/gespann', { token, body: { fahrrad_id: rad.id, anhaenger_id: wagen.id, fahrer_gewicht_kg: 70 } });
    const id = (await s.a('GET', '/garagen')).json.garagen[0].id;

    assert.equal((await s.a('GET', `/garagen/${id}`)).json.gespann.status, 'ungeprueft');
    assert.equal((await s.a('POST', `/garagen/${id}/pruefen`, { status: 'geprueft' })).status, 200);
    const d = (await s.a('GET', `/garagen/${id}`)).json;
    assert.deepEqual([d.fahrraeder[0].status, d.anhaenger[0].status, d.gespann.status], ['geprueft', 'geprueft', 'geprueft']);
    assert.equal((await s.a('GET', '/uebersicht')).json.ungeprueft, 0);
    assert.equal((await s.a('POST', `/garagen/${id}/pruefen`, { status: 'egal' })).status, 400);

    assert.equal((await s.a('PATCH', `/garagen/${id}`, { fahrer_name: ' Jo Korrigiert ' })).status, 200);
    assert.equal((await s.a('GET', `/garagen/${id}`)).json.fahrer_name, 'Jo Korrigiert');
    assert.equal((await s.a('PATCH', `/garagen/${id}`, { fahrer_name: '' })).status, 400);

    assert.equal((await s.a('DELETE', `/eintraege/anhaenger/${wagen.id}`)).status, 204);
    assert.equal((await s.a('GET', `/garagen/${id}`)).json.anhaenger.length, 0);
    assert.equal((await s.a('DELETE', `/eintraege/gespanne/${d.gespann.id}`)).status, 204);
    assert.equal((await s.a('GET', `/garagen/${id}`)).json.gespann, null);

    assert.equal((await s.a('DELETE', `/garagen/${id}`)).status, 204);
    assert.equal((await s.a('GET', `/garagen/${id}`)).status, 404);
    assert.equal((await s.t.anfrage('GET', '/api/v1/garage', { token })).status, 401, 'der Link der gelöschten Garage gilt nicht mehr');
  } finally { await s.t.schliessen(); }
});

test('Verwaltung: ungültige Angaben und unbekannte Ziele', async () => {
  const s = await mitAdmin();
  try {
    await s.neueGarage();
    for (const [methode, pfad, body, erwartet] of [
      ['GET', '/garagen/abc', undefined, 404], ['GET', '/garagen/0', undefined, 404], ['GET', '/garagen/99999', undefined, 404],
      ['DELETE', '/garagen/99999', undefined, 404], ['POST', '/garagen/99999/pruefen', { status: 'geprueft' }, 404],
      ['PATCH', '/eintraege/motorraeder/1', { status: 'geprueft' }, 404], ['PATCH', '/eintraege/fahrraeder/99999', { status: 'geprueft' }, 404],
      ['DELETE', '/eintraege/fahrraeder/99999', undefined, 404], ['PATCH', '/eintraege/fahrraeder/1', {}, 400],
      ['PATCH', '/eintraege/fahrraeder/1', { status: 'vielleicht' }, 400], ['PATCH', '/eintraege/fahrraeder/1', { pruefnotiz: 'x'.repeat(501) }, 400],
      ['PATCH', '/eintraege/fahrraeder/1', { pruefnotiz: 5 }, 400]
    ]) {
      const r = await s.a(methode, pfad, body);
      assert.equal(r.status, erwartet, `${methode} ${pfad} ${JSON.stringify(body)}`);
      assert.ok(r.json?.error, 'Fehler als { error }');
    }
  } finally { await s.t.schliessen(); }
});

test('Suche: Sonderzeichen werden nicht als Muster gedeutet', async () => {
  const s = await mitAdmin();
  try {
    await s.neueGarage('Anja');
    for (const suche of ['%', '_', '\\', "' OR 1=1 --", 'a%a']) {
      const r = await s.a('GET', `/garagen?suche=${encodeURIComponent(suche)}`);
      assert.equal(r.status, 200, suche);
    }
    assert.equal((await s.a('GET', '/garagen?suche=%25')).json.gesamt, 0, '% findet nicht alles');
  } finally { await s.t.schliessen(); }
});

test('Oberfläche: nur unter dem Fantasiepfad, nicht unter /admin oder /admin.html, nie zwischengespeichert; robots.txt sperrt sie', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'garage-ui-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head></head><body>Start</body></html>');
  writeFileSync(join(dir, 'admin.html'), '<!doctype html><html><body>Verwaltung</body></html>');
  const s = await mitAdmin({ app: { produktion: true, oberflaeche: dir }, env: { ADMIN_PATH: 'meine-werkstatt' } });
  try {
    const seite = await s.roh('GET', '/meine-werkstatt');
    assert.equal(seite.status, 200);
    assert.match(seite.text, /Verwaltung/);
    assert.equal(seite.headers.get('cache-control'), 'no-store');
    assert.match(seite.headers.get('x-robots-tag'), /noindex/);
    for (const pfad of ['/admin', '/admin/', '/admin.html', '/wunderkammer']) {
      const r = await s.roh('GET', pfad);
      assert.ok(r.status === 404 || !/Verwaltung/.test(r.text), pfad);
    }
    assert.equal((await s.roh('GET', '/admin.html')).status, 404);
    assert.match((await s.roh('GET', '/robots.txt')).text, /Disallow: \/meine-werkstatt/);
    assert.match((await s.roh('GET', '/')).text, /Start/);
  } finally { await s.t.schliessen(); }
});
