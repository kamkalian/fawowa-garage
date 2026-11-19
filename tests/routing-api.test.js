// Reichweiten-Planer in der Web-Anwendung: die Berechnung läuft als Auftrag im Garage-Worker (siehe tests/worker.test.js).
// Hier geht es um Annahme, Warteschlange je Garage, Ergebnis-Abruf und Kacheln von der Platte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { starteTestServer } from './hilfen.js';

const RAD = { name: 'Rad', motor_art: 'mittelmotor', akku_kapazitaet_wh: 10, gewicht_kg: 25 };
const START = { lat: 51.075, lon: 7.12 };
const PLANER = { bbox: { minLat: 50, maxLat: 52, minLon: 6, maxLon: 9 }, orte: [] };

/** Warteschlange im Speicher, mit denselben Regeln wie lib/jobs.js, ohne Datenbank */
class FakeJobs {
  constructor() { this.zeilen = []; this.id = 1; this.ergebnisse = new Map(); }
  async reichweiteAnlegen(garageId, eingabe) {
    this.zeilen = this.zeilen.filter(z => !(z.garageId === garageId && z.status === 'wartet'));
    const id = this.id++;
    this.zeilen.push({ id, garageId, status: 'wartet', eingabe });
    return id;
  }
  async reichweiteLesen(garageId) {
    const eigener = this.zeilen.find(z => z.garageId === garageId);
    const davor = eigener ? this.zeilen.filter(z => z.id < eigener.id).length : 0;
    const ergebnis = this.ergebnisse.get(garageId) ?? null;
    return { status: eigener ? 'wartet' : (ergebnis ? 'fertig' : null), davor, meldung: null, ergebnis };
  }
}

/** Legt eine eingerichtete Garage (Fahrrad im Gespann) auf dem Server an und liefert ihren Schlüssel */
async function garageAnlegen(t, name = 'Anja') {
  const token = (await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: name } })).json.token;
  const rad = (await t.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: RAD.name, gewicht_kg: RAD.gewicht_kg } })).json;
  await t.anfrage('PUT', `/api/v1/garage/antriebe/fahrraeder/${rad.id}`, { token, body: { motoren: [{ motor_art: RAD.motor_art, leistung_w: 250 }], akkus: [{ kapazitaet_wh: RAD.akku_kapazitaet_wh }] } });
  await t.anfrage('PUT', '/api/v1/garage/mitglied', { token, body: { art: 'fahrraeder', id: rad.id, im: true } });
  await t.anfrage('PUT', '/api/v1/garage/gespann', { token, body: { fahrer_gewicht_kg: 80 } });
  return token;
}

async function mitServer(optionen = {}, jobs = new FakeJobs()) {
  const t = await starteTestServer({ app: { planer: PLANER, jobs, ...optionen } });
  const token = await garageAnlegen(t);
  return { t, token, jobs };
}

test('Einstellungen: Planer aktiv nur mit Wegenetz; ohne Wegenetz gibt es 503', async () => {
  const t = await starteTestServer({ app: { planer: PLANER, jobs: new FakeJobs() } });
  try {
    const r = (await t.anfrage('GET', '/api/v1/einstellungen')).json;
    assert.equal(r.reichweite.aktiv, true);
    assert.equal(r.reichweite.bbox.minLat, 50);
    assert.deepEqual(r.reichweite.modi, ['alle', 'strasse', 'ruhig']);
  } finally { await t.schliessen(); }

  const ohne = await starteTestServer();
  try {
    assert.deepEqual((await ohne.anfrage('GET', '/api/v1/einstellungen')).json.reichweite, { aktiv: false });
    assert.equal((await ohne.anfrage('GET', '/api/v1/karte/orte')).json.code, 'routing_aus');
    const token = (await ohne.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'A' } })).json.token;
    assert.equal((await ohne.anfrage('POST', '/api/v1/garage/reichweite', { token, body: { lat: 51, lon: 7 } })).json.code, 'routing_aus');
  } finally { await ohne.schliessen(); }
});

test('Reichweite: braucht Schlüssel und ein Gespann mit Fahrrad', async () => {
  const s = await mitServer();
  try {
    assert.equal((await s.t.anfrage('POST', '/api/v1/garage/reichweite', { body: { ...START } })).status, 401);
  } finally { await s.t.schliessen(); }

  const leer = await starteTestServer({ app: { planer: PLANER, jobs: new FakeJobs() } });
  try {
    const token = (await leer.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'B' } })).json.token;
    const r = await leer.anfrage('POST', '/api/v1/garage/reichweite', { token, body: { ...START, modus: 'alle', einstellungen: {} } });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'fahrrad_fehlt');
  } finally { await leer.schliessen(); }
});

test('Reichweite: wird als Auftrag angenommen (202) mit dem Platz in der Warteschlange', async () => {
  const jobs = new FakeJobs();
  const s = await mitServer({}, jobs);
  try {
    const r = await s.t.anfrage('POST', '/api/v1/garage/reichweite', { token: s.token, body: { ...START, modus: 'alle', einstellungen: {} } });
    assert.equal(r.status, 202);
    assert.deepEqual({ status: r.json.status, davor: r.json.davor }, { status: 'wartet', davor: 0 });
    assert.equal(jobs.zeilen.length, 1);
  } finally { await s.t.schliessen(); }
});

test('Reichweite: eine neue Berechnung ersetzt die alte derselben Garage und hängt sich ans Ende', async () => {
  const jobs = new FakeJobs();
  const s = await mitServer({}, jobs);
  try {
    const andere = await garageAnlegen(s.t, 'Bernd');
    const post = (token) => s.t.anfrage('POST', '/api/v1/garage/reichweite', { token, body: { ...START, modus: 'alle', einstellungen: {} } });
    await post(s.token);
    await post(andere);
    const erneut = await post(s.token);
    assert.equal(erneut.json.davor, 1, 'die andere Garage steht davor, die alte Berechnung der eigenen ist weg');
    assert.equal(jobs.zeilen.length, 2);
    const stand = await s.t.anfrage('GET', '/api/v1/garage/reichweite', { token: s.token });
    assert.equal(stand.json.status, 'wartet');
    assert.equal(stand.json.davor, 1);
  } finally { await s.t.schliessen(); }
});

test('Reichweite: Startpunkt außerhalb des Kartengebiets wird sofort abgelehnt', async () => {
  const s = await mitServer();
  try {
    const r = await s.t.anfrage('POST', '/api/v1/garage/reichweite', { token: s.token, body: { lat: 53.5, lon: 10, modus: 'alle', einstellungen: {} } });
    assert.equal(r.status, 400);
    assert.equal(r.json.code, 'ausserhalb');
    assert.equal(s.jobs.zeilen.length, 0, 'nichts in die Warteschlange');
  } finally { await s.t.schliessen(); }
});

test('Reichweite: Ergebnis abrufen (nur mit Schlüssel, nie zwischengespeichert)', async () => {
  const jobs = new FakeJobs();
  const s = await mitServer({}, jobs);
  try {
    const leer = await s.t.anfrage('GET', '/api/v1/garage/reichweite', { token: s.token });
    assert.equal(leer.json.status, null);
    await s.t.anfrage('POST', '/api/v1/garage/reichweite', { token: s.token, body: { ...START, modus: 'alle', einstellungen: {} } });
    // Der Worker hat gerechnet: das Ergebnis liegt bei der Garage
    jobs.ergebnisse.set(jobs.zeilen[0].garageId, { ok: true, budget: { art: 'akku', wert: 900, einheit: 'Wh' } });
    const r = await s.t.anfrage('GET', '/api/v1/garage/reichweite', { token: s.token });
    assert.equal(r.json.status, 'wartet', 'solange die Zeile noch wartet, bleibt der Stand wartet');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await s.t.anfrage('GET', '/api/v1/garage/reichweite')).status, 401);
  } finally { await s.t.schliessen(); }
});

test('Die Seite darf den Standort abfragen (Permissions-Policy)', async () => {
  const t = await starteTestServer();
  try {
    const r = await t.anfrage('GET', '/api/health');
    assert.match(r.headers.get('permissions-policy'), /geolocation=\(self\)/);
    assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
  } finally { await t.schliessen(); }
});
