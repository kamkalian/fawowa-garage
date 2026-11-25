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

test('Gepäck: Gegenstände auf Plätze legen, tauschen, abhaken, löschen', async () => {
  const s = await starteTestServer();
  try {
    const token = (await s.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'Anja' } })).json.token;
    const g = await s.anfrage('POST', '/api/v1/garage/gepaecke', { token, body: { name: 'Radreise', typ: 'kiste' } });
    assert.equal(g.status, 201);
    assert.equal(g.json.typ, 'kiste');
    const url = '/api/v1/garage/gepaecke/' + g.json.id + '/gegenstaende';
    const jacke = await s.anfrage('POST', url, { token, body: { name: 'Regenjacke' } });
    assert.equal(jacke.status, 201);
    assert.equal(jacke.json.platz, 0);
    const lade = await s.anfrage('POST', url, { token, body: { name: 'Ladegerät' } });
    assert.equal(lade.json.platz, 1);
    const tauschend = await s.anfrage('PUT', '/api/v1/garage/gegenstaende/' + jacke.json.id, { token, body: { platz: 1 } });
    assert.equal(tauschend.status, 200);
    assert.equal(tauschend.json.gegenstand.platz, 1);
    assert.deepEqual(tauschend.json.tausch, { id: lade.json.id, platz: 0 });
    const abgehakt = await s.anfrage('PUT', '/api/v1/garage/gegenstaende/' + jacke.json.id, { token, body: { gepackt: true } });
    assert.equal(abgehakt.json.gegenstand.gepackt, true);
    const liste = (await s.anfrage('GET', '/api/v1/garage', { token })).json.gepaecke.find(x => x.id === g.json.id);
    assert.deepEqual(liste.inhalt.map(x => [x.name, x.platz]).sort((p, q) => p[1] - q[1]), [['Ladegerät', 0], ['Regenjacke', 1]]);
    const kaputt = await s.anfrage('POST', url, { token, body: { name: '' } });
    assert.equal(kaputt.status, 400);
    assert.equal((await s.anfrage('DELETE', '/api/v1/garage/gegenstaende/' + jacke.json.id, { token })).status, 200);
  } finally { await s.schliessen(); }
});

test('Gespann: Zuladung ist die Summe der Gepäck-Kacheln im Gespann', () => {
  const rad = { id: 1, name: 'Rad', gewicht_kg: 20, motoren: [], akkus: [] };
  const gepaecke = [{ id: 7, gewicht_kg: 12.5 }, { id: 8, gewicht_kg: 4 }, { id: 9, gewicht_kg: 100 }];
  const g = gespannFuerRechnung([rad], [], { fahrraeder: [1], gepaecke: [7, 8] }, gepaecke);
  assert.equal(g.gepaeck_kg, 16.5, 'Gepäck 9 gehört nicht zum Gespann');
});
