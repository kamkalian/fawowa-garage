import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';

test('Antriebe: Volt und Getriebe werden gespeichert; ungültige Werte werden abgelehnt', async () => {
  const s = await starteTestServer();
  try {
    const token = (await s.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'Anja' } })).json.token;
    const rad = (await s.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: 'Rad' } })).json;
    const url = `/api/v1/garage/antriebe/fahrraeder/${rad.id}`;
    const ok = await s.anfrage('PUT', url, { token, body: {
      motoren: [{ motor_art: 'mittelmotor', leistung_w: 250, spannung_v: 36, getriebe: 'direkt' }],
      akkus: [{ kapazitaet_wh: 500, spannung_v: 36 }]
    } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.motoren[0].spannung_v, 36);
    assert.equal(ok.json.motoren[0].getriebe, 'direkt');
    assert.equal(ok.json.akkus[0].spannung_v, 36);

    const motorGetriebe = await s.anfrage('PUT', url, { token, body: { motoren: [{ motor_art: 'mittelmotor', leistung_w: 250, getriebe: 'raketen' }], akkus: [] } });
    assert.equal(motorGetriebe.status, 400);
    const akkuVolt = await s.anfrage('PUT', url, { token, body: { motoren: [], akkus: [{ kapazitaet_wh: 500, spannung_v: 5000 }] } });
    assert.equal(akkuVolt.status, 400);
  } finally { await s.schliessen(); }
});
