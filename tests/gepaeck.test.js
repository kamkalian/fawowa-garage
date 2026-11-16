import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestServer } from './hilfen.js';
import { gespannFuerRechnung } from '../lib/gespann.js';

test('Gepäck: Kachel anlegen, dem Gespann zuordnen', async () => {
  const s = await starteTestServer();
  try {
    const token = (await s.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'Anja' } })).json.token;
    const g = await s.anfrage('POST', '/api/v1/garage/gepaecke', { token, body: { name: 'Einkauf', gewicht_kg: '12,5' } });
    assert.equal(g.status, 201);
    assert.equal(g.json.gewicht_kg, 12.5);
    const m = await s.anfrage('PUT', '/api/v1/garage/mitglied', { token, body: { art: 'gepaecke', id: g.json.id, im: true } });
    assert.equal(m.status, 200);
    assert.deepEqual(m.json.mitglieder.gepaecke, [g.json.id]);
  } finally { await s.schliessen(); }
});

test('Gespann: Zuladung ist die Summe der Gepäck-Kacheln im Gespann', () => {
  const rad = { id: 1, name: 'Rad', gewicht_kg: 20, motoren: [], akkus: [] };
  const gepaecke = [{ id: 7, gewicht_kg: 12.5 }, { id: 8, gewicht_kg: 4 }, { id: 9, gewicht_kg: 100 }];
  const g = gespannFuerRechnung([rad], [], { fahrraeder: [1], gepaecke: [7, 8] }, gepaecke);
  assert.equal(g.gepaeck_kg, 16.5, 'Gepäck 9 gehört nicht zum Gespann');
});
