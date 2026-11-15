// Gemeinsame Hilfen der Tests: Nachbildung des Datenzugriffs im Arbeitsspeicher (gleiche Schnittstelle wie lib/speicher.js)
// und ein Server auf freiem Port.
import { randomBytes } from 'crypto';
import { ARTEN } from '../lib/felder.js';
import { FehlerEingabe } from '../lib/fehler.js';
import { hashToken, TOKEN_MUSTER } from '../lib/speicher.js';
import { erstelleApp } from '../lib/app.js';
import { Begrenzung } from '../lib/begrenzung.js';

export class FakeSpeicher {
  constructor() {
    this.garagen = new Map(); // hash -> id
    this.daten = { fahrraeder: [], anhaenger: [] }; // Zeilen mit garage_id
    this.gespanne = new Map(); // garage_id -> Gespann
    this.naechsteId = 1;
    this.kaputt = false;
  }

  async ping() { if (this.kaputt) throw new Error('Datenbank aus'); }
  async anzahlGaragen() { return this.garagen.size; }

  async garageAnlegen() {
    const token = randomBytes(32).toString('base64url');
    const id = this.naechsteId++;
    this.garagen.set(hashToken(token), id);
    return { id, token };
  }

  async garageFinden(token) {
    if (typeof token !== 'string' || !TOKEN_MUSTER.test(token)) return null;
    const id = this.garagen.get(hashToken(token));
    return id ? { id } : null;
  }

  async garageLoeschen(garageId) {
    for (const a of Object.keys(this.daten)) this.daten[a] = this.daten[a].filter(z => z.garage_id !== garageId);
    this.gespanne.delete(garageId);
    for (const [h, id] of this.garagen) if (id === garageId) this.garagen.delete(h);
  }

  _sicht(z) {
    const { garage_id, ...rest } = z; // eslint-disable-line no-unused-vars
    return rest;
  }

  async alles(garageId) {
    const r = {};
    for (const a of Object.keys(this.daten)) r[a] = this.daten[a].filter(z => z.garage_id === garageId).sort((x, y) => x.sortierung - y.sortierung || x.id - y.id).map(z => this._sicht(z));
    r.gespann = this.gespanne.has(garageId) ? { ...this.gespanne.get(garageId) } : null;
    return r;
  }

  async anlegen(garageId, art, werte) {
    const liste = this.daten[art];
    if (liste.filter(z => z.garage_id === garageId).length >= ARTEN[art].max) throw new FehlerEingabe('Limit', 409, { code: 'limit' });
    const alle = [...this.daten.fahrraeder, ...this.daten.anhaenger].filter(z => z.garage_id === garageId);
    const sortierung = Math.max(0, ...alle.map(z => z.sortierung)) + 1;
    const zeile = { id: this.naechsteId++, garage_id: garageId, sortierung, ...werte, status: 'ungeprueft' };
    liste.push(zeile);
    return this._sicht(zeile);
  }

  async reihenfolgeSetzen(garageId, reihenfolge) {
    reihenfolge.forEach((x, i) => {
      const zeile = this.daten[x.art].find(z => z.id === x.id && z.garage_id === garageId);
      if (zeile) zeile.sortierung = i + 1;
    });
  }

  async gespannSetzen(garageId, werte) {
    const felder = {};
    if (werte.fahrrad_id !== null && !this.daten.fahrraeder.some(z => z.id === werte.fahrrad_id && z.garage_id === garageId)) felder.fahrrad_id = 'ungueltig';
    if (werte.anhaenger_id !== null && !this.daten.anhaenger.some(z => z.id === werte.anhaenger_id && z.garage_id === garageId)) felder.anhaenger_id = 'ungueltig';
    if (Object.keys(felder).length) throw new FehlerEingabe('Verweis', 400, { code: 'eingabe', felder });
    const alt = this.gespanne.get(garageId);
    const neu = { id: alt?.id ?? this.naechsteId++, ...werte, status: 'ungeprueft' };
    this.gespanne.set(garageId, neu);
    return { ...neu };
  }

  async aendern(garageId, art, id, werte) {
    const zeile = this.daten[art].find(z => z.id === id && z.garage_id === garageId);
    if (!zeile) return null;
    Object.assign(zeile, werte, { status: 'ungeprueft' });
    return this._sicht(zeile);
  }

  // Wie in der Datenbank (ON DELETE SET NULL): ein benutzter Platz im Gespann wird leer
  async loeschen(garageId, art, id) {
    const i = this.daten[art].findIndex(z => z.id === id && z.garage_id === garageId);
    if (i < 0) return false;
    this.daten[art].splice(i, 1);
    const g = this.gespanne.get(garageId);
    const feld = art === 'fahrraeder' ? 'fahrrad_id' : 'anhaenger_id';
    if (g && g[feld] === id) g[feld] = null;
    return true;
  }
}

/** Startet die App mit Nachbildung des Datenzugriffs auf einem freien Port. Ergebnis: { url, speicher, anfrage(), schliessen() } */
export async function starteTestServer(optionen = {}) {
  const speicher = optionen.speicher ?? new FakeSpeicher();
  // Großzügige Grenzen, damit die Begrenzung nicht die anderen Tests stört (sie hat eigene Tests)
  const begrenzungen = { neu: new Begrenzung({ max: 10000 }), falsch: new Begrenzung({ max: 10000 }), ...optionen.app?.begrenzungen };
  const app = erstelleApp(speicher, { env: {}, ...optionen.app, begrenzungen });
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;

  async function anfrage(methode, pfad, { token, body } = {}) {
    const res = await fetch(url + pfad, {
      method: methode,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* keine JSON-Antwort */ }
    return { status: res.status, json, headers: res.headers };
  }

  return { url, speicher, anfrage, schliessen: () => new Promise(r => server.close(r)) };
}
