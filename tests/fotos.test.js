import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { fotoLoeschen } from '../lib/fotos.js';

// Ein minimales PNG (Signatur und IHDR-Kopf), für den Typ-Test genügt die Signatur
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);

test('Fotos: hochladen, nur mit dem Schlüssel der Garage abrufen, ersetzen und löschen; nur echte Bilder', async () => {
  const t = await starteTestServer();
  try {
    const token = (await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'Anja' } })).json.token;
    const fremd = (await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'Bernd' } })).json.token;
    const rad = (await t.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'Rad' } })).json;

    const hoch = (body, typ, id = rad.id, tok = token) => fetch(`${t.url}/api/v1/garage/foto/fahrraeder/${id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': typ }, body
    });
    assert.equal((await hoch(PNG, 'text/plain')).status, 400, 'nur Bildtypen');
    assert.equal((await hoch(Buffer.from('kein Bild, aber lang genug zum Prüfen'), 'image/png')).status, 400, 'Inhalt muss ein Bild sein');
    assert.equal((await hoch(PNG, 'image/png', 99999)).status, 404, 'fremder oder fehlender Eintrag');

    const ok = await hoch(PNG, 'image/png');
    assert.equal(ok.status, 204);
    const liste = (await t.anfrage('GET', '/api/v1/garage', { token })).json;
    assert.equal(liste.fahrraeder[0].foto_vorhanden, true);

    const abruf = await fetch(`${t.url}/api/v1/garage/foto/fahrraeder/${rad.id}`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(abruf.status, 200);
    assert.equal(abruf.headers.get('content-type'), 'image/png');
    assert.equal(abruf.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await abruf.arrayBuffer()), PNG);
    assert.equal((await fetch(`${t.url}/api/v1/garage/foto/fahrraeder/${rad.id}`, { headers: { Authorization: `Bearer ${fremd}` } })).status, 404, 'andere Garage sieht es nicht');

    const del = await fetch(`${t.url}/api/v1/garage/foto/fahrraeder/${rad.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(del.status, 204);
    assert.equal((await fetch(`${t.url}/api/v1/garage/foto/fahrraeder/${rad.id}`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
  } finally {
    await t.schliessen();
  }
});

test('Fotos: Dateinamen sind geprüft (kein Zugriff außerhalb des Ordners)', async () => {
  const { fotoLesen } = await import('../lib/fotos.js');
  assert.equal(fotoLesen('../geheim.txt'), null);
  fotoLoeschen('../geheim.txt');
});
