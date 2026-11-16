import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { RoutingDienst } from '../lib/routing-dienst.js';
import { Begrenzung } from '../lib/begrenzung.js';
import { starteTestServer } from './hilfen.js';
import { gitterNetz } from './hilfen-netz.js';

let dienst;
before(async () => {
  dienst = new RoutingDienst({ ordner: gitterNetz(31), minKomponente: 1, maxWarteschlange: 3 });
  await dienst.starten();
});
after(async () => { await dienst.beenden(); });

const RAD = { name: 'Rad', motor_art: 'mittelmotor', akku_kapazitaet_wh: 10, gewicht_kg: 25 };
const START = { lat: 51.075, lon: 7.12 };

async function mitServer(optionen = {}) {
  const t = await starteTestServer({ app: { routing: dienst, ...optionen } });
  const token = (await t.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'Anja' } })).json.token;
  const rad = (await t.anfrage('POST', '/api/v1/garage/fahrraeder', { token, body: { name: RAD.name, gewicht_kg: RAD.gewicht_kg } })).json;
  // Motor und Akku kommen über die Liste der Antriebe, nicht über Felder des Fahrrads
  await t.anfrage('PUT', `/api/v1/garage/antriebe/fahrraeder/${rad.id}`, { token, body: { motoren: [{ motor_art: RAD.motor_art, leistung_w: 250 }], akkus: [{ kapazitaet_wh: RAD.akku_kapazitaet_wh }] } });
  const wagen = (await t.anfrage('POST', '/api/v1/garage/anhaenger', { token, body: { name: 'Wagen', leergewicht_kg: 40 } })).json;
  // Setzt Zugfahrzeug und Anhänger im Gespann (null nimmt den bisherigen heraus)
  const aktiv = { fahrraeder: null, anhaenger: null };
  const gespannSetzen = async (werte) => {
    for (const [feld, art] of [['fahrrad_id', 'fahrraeder'], ['anhaenger_id', 'anhaenger']]) {
      if (!(feld in werte)) continue;
      const neu = werte[feld];
      if (aktiv[art] !== null && aktiv[art] !== neu) await t.anfrage('PUT', '/api/v1/garage/mitglied', { token, body: { art, id: aktiv[art], im: false } });
      if (neu !== null) await t.anfrage('PUT', '/api/v1/garage/mitglied', { token, body: { art, id: neu, im: true } });
      aktiv[art] = neu;
    }
    return t.anfrage('PUT', '/api/v1/garage/gespann', { token, body: { fahrer_gewicht_kg: 80, ...werte, fahrrad_id: undefined, anhaenger_id: undefined } });
  };
  return { t, token, rad, wagen, gespannSetzen };
}

test('Dienst: Netz geladen, Reichweite und Kartenlinien kommen aus dem Thread', async () => {
  assert.equal(dienst.bereit, true);
  assert.ok(dienst.info.knoten === 961 && dienst.info.bbox.minLat === 51);
  const r = await dienst.berechne({ fahrrad: RAD, gespann: { fahrer_gewicht_kg: 80 }, einstellungen: {}, start: START, modus: 'alle' });
  assert.equal(r.ok, true);
  const buf = await dienst.linien(14, 8570, 5516);
  assert.ok(buf instanceof ArrayBuffer);
});

test('Dienst: ist die Warteschlange voll, wird abgelehnt (ausgelastet)', async () => {
  const auftraege = Array.from({ length: 12 }, () => dienst.berechne({ fahrrad: RAD, gespann: { fahrer_gewicht_kg: 80 }, einstellungen: {}, start: START, modus: 'alle' }).then(() => 'ok', (e) => e.code));
  const ergebnisse = await Promise.all(auftraege);
  assert.ok(ergebnisse.includes('ok'));
  assert.ok(ergebnisse.includes('ausgelastet'), ergebnisse.join());
  assert.equal(dienst.wartend, 0, 'nach dem Abarbeiten wartet nichts mehr');
});

test('Dienst: nach dem Beenden antwortet er mit routing_aus', async () => {
  const d = new RoutingDienst({ ordner: dienst.ordner, minKomponente: 1 });
  await d.starten();
  await d.beenden();
  await assert.rejects(d.berechne({}), { code: 'routing_aus', status: 503 });
});

test('Einstellungen melden, ob der Reichweiten-Planer aktiv ist', async () => {
  const t = await starteTestServer({ app: { routing: dienst } });
  try {
    const r = (await t.anfrage('GET', '/api/v1/einstellungen')).json;
    assert.equal(r.reichweite.aktiv, true);
    assert.equal(r.reichweite.bbox.minLat, 51);
    assert.deepEqual(r.reichweite.modi, ['alle', 'strasse', 'ruhig']);
    assert.ok(r.reichweite.zoom[0] < r.reichweite.zoom[1]);
  } finally { await t.schliessen(); }
  const ohne = await starteTestServer();
  try {
    assert.deepEqual((await ohne.anfrage('GET', '/api/v1/einstellungen')).json.reichweite, { aktiv: false });
    assert.equal((await ohne.anfrage('GET', '/api/v1/karte/orte')).json.code, 'routing_aus');
    const token = (await ohne.anfrage('POST', '/api/v1/garagen', { body: { fahrer_name: 'A' } })).json.token;
    assert.equal((await ohne.anfrage('POST', '/api/v1/garage/reichweite', { token, body: { lat: 51, lon: 7 } })).json.code, 'routing_aus');
  } finally { await ohne.schliessen(); }
});

test('Reichweite: braucht Schlüssel, Gespann mit Fahrrad und gültige Angaben', async () => {
  const s = await mitServer();
  try {
    assert.equal((await s.t.anfrage('POST', '/api/v1/garage/reichweite', { body: { ...START } })).status, 401);
    const koerper = { ...START, modus: 'alle', einstellungen: {} };
    const ohneGespann = await s.t.anfrage('POST', '/api/v1/garage/reichweite', { token: s.token, body: koerper });
    assert.equal(ohneGespann.status, 400);
    assert.equal(ohneGespann.json.code, 'fahrrad_fehlt');

    await s.gespannSetzen({ anhaenger_id: s.wagen.id });
    assert.equal((await s.t.anfrage('POST', '/api/v1/garage/reichweite', { token: s.token, body: koerper })).json.code, 'fahrrad_fehlt', 'nur Anhänger genügt nicht');

    await s.gespannSetzen({ fahrrad_id: s.rad.id, anhaenger_id: s.wagen.id });
    const r = await s.t.anfrage('POST', '/api/v1/garage/reichweite', { token: s.token, body: koerper });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.ok(r.json.ok && r.json.kennzahlen.punkte_gesamt >= 0 && r.json.budget.art === 'akku');
    assert.ok(r.json.modell.masse_kg >= 25 + 80 + 40, 'Gewichte aus Fahrrad, Anhänger und Gespann');

    // Ohne Anhänger im Gespann
    await s.gespannSetzen({ fahrrad_id: s.rad.id, anhaenger_id: null });
    assert.equal((await s.t.anfrage('POST', '/api/v1/garage/reichweite', { token: s.token, body: koerper })).status, 200);
  } finally { await s.t.schliessen(); }
});

test('Reichweite: ungültige Eingaben werden mit Codes abgelehnt', async () => {
  const s = await mitServer();
  try {
    await s.gespannSetzen({ fahrrad_id: s.rad.id });
    const post = (body) => s.t.anfrage('POST', '/api/v1/garage/reichweite', { token: s.token, body });
    for (const [body, code, status] of [
      [{}, 'start_ungueltig', 400], [{ lat: '51', lon: '7' }, 'start_ungueltig', 400], [{ lat: null, lon: 7 }, 'start_ungueltig', 400],
      [{ ...START, modus: 'radweg' }, 'modus_ungueltig', 400], [{ ...START, modus: 5 }, 'modus_ungueltig', 400],
      [{ ...START, einstellungen: { wind_ms: 500 } }, 'eingabe', 400], [{ lat: 53.5, lon: 10 }, 'ausserhalb', 400],
      [{ ...START, einstellungen: { akku_rest_prozent: 2, reserve_prozent: 5 } }, 'akku_leer', 400]
    ]) {
      const r = await post(body);
      assert.equal(r.status, status, JSON.stringify(body));
      assert.equal(r.json.code, code, JSON.stringify(body));
    }
    const e = await post({ ...START, einstellungen: { wind_ms: 500, unterstuetzung: 'raketen' } });
    assert.deepEqual(e.json.felder, { wind_ms: 'zu_gross', unterstuetzung: 'ungueltig' });
  } finally { await s.t.schliessen(); }
});

test('Reichweite: Begrenzung je Besucher', async () => {
  const s = await mitServer({ begrenzungen: { reichweite: new Begrenzung({ max: 2 }) } });
  try {
    await s.gespannSetzen({ fahrrad_id: s.rad.id });
    const post = () => s.t.anfrage('POST', '/api/v1/garage/reichweite', { token: s.token, body: START });
    assert.equal((await post()).status, 200);
    assert.equal((await post()).status, 200);
    const r = await post();
    assert.equal(r.status, 429);
    assert.equal(r.json.code, 'zu_viele');
  } finally { await s.t.schliessen(); }
});

test('Kartenkacheln und Orte: Binärformat, Zwischenspeicher, ungültige Kacheln', async () => {
  const t = await starteTestServer({ app: { routing: dienst } });
  try {
    const res = await fetch(`${t.url}/api/v1/karte/14/8570/5516`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.match(res.headers.get('cache-control'), /public, max-age=/);
    const buf = await res.arrayBuffer();
    assert.ok(new DataView(buf).getUint32(0, true) >= 0);

    for (const pfad of ['/api/v1/karte/3/0/0', '/api/v1/karte/20/0/0', '/api/v1/karte/14/-1/0', '/api/v1/karte/14/99999/0', '/api/v1/karte/14/x/y', '/api/v1/karte/14/1.5/2']) {
      assert.equal((await fetch(t.url + pfad)).status, 404, pfad);
    }
    const orte = await fetch(`${t.url}/api/v1/karte/orte`);
    assert.equal(orte.status, 200);
    assert.match(orte.headers.get('cache-control'), /public/);
    assert.ok(Array.isArray(await orte.json()));
  } finally { await t.schliessen(); }
});

test('Kartenkacheln: Begrenzung je Besucher', async () => {
  const t = await starteTestServer({ app: { routing: dienst, begrenzungen: { karte: new Begrenzung({ max: 2 }) } } });
  try {
    assert.equal((await fetch(`${t.url}/api/v1/karte/14/8570/5516`)).status, 200);
    assert.equal((await fetch(`${t.url}/api/v1/karte/14/8570/5516`)).status, 200);
    assert.equal((await fetch(`${t.url}/api/v1/karte/14/8570/5516`)).status, 429);
  } finally { await t.schliessen(); }
});

test('Die Seite darf den Standort abfragen (Permissions-Policy)', async () => {
  const t = await starteTestServer();
  try {
    const r = await t.anfrage('GET', '/api/health');
    assert.match(r.headers.get('permissions-policy'), /geolocation=\(self\)/);
    assert.match(r.headers.get('permissions-policy'), /camera=\(\)/);
  } finally { await t.schliessen(); }
});
