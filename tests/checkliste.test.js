import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

test('Checkliste: Punkte anlegen, abhaken, Haken entfernen, löschen', async () => {
  const s = await starteTestServer();
  try {
    const token = (await s.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'Anja' } })).json.token;
    const leer = await s.anfrage('POST', '/api/v1/garage/checkliste', { token, body: { name: '   ' } });
    assert.equal(leer.status, 400);
    const p = await s.anfrage('POST', '/api/v1/garage/checkliste', { token, body: { name: 'Ladegerät' } });
    assert.equal(p.status, 201);
    const haken = await s.anfrage('PUT', '/api/v1/garage/checkliste/' + p.json.id, { token, body: { gepackt: true } });
    assert.equal(haken.json.gepackt, true);
    const kaputt = await s.anfrage('PUT', '/api/v1/garage/checkliste/' + p.json.id, { token, body: { gepackt: 'ja' } });
    assert.equal(kaputt.status, 400);
    const liste = (await s.anfrage('GET', '/api/v1/garage', { token })).json;
    assert.deepEqual(liste.checkliste, [{ id: p.json.id, name: 'Ladegerät', gepackt: true }]);
    assert.equal((await s.anfrage('POST', '/api/v1/garage/checkliste/zuruecksetzen', { token })).status, 200);
    const nach = (await s.anfrage('GET', '/api/v1/garage', { token })).json;
    assert.equal(nach.checkliste[0].gepackt, false);
    assert.equal((await s.anfrage('DELETE', '/api/v1/garage/checkliste/' + p.json.id, { token })).status, 204);
    assert.equal((await s.anfrage('DELETE', '/api/v1/garage/checkliste/' + p.json.id, { token })).status, 404);
  } finally { await s.schliessen(); }
});
