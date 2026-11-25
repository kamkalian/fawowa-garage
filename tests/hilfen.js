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
    this.daten = { fahrraeder: [], anhaenger: [], gepaecke: [] }; // Zeilen mit garage_id
    this.gespanne = new Map(); // garage_id -> Gespann (Fahrer, Gepäck)
    this.mitglieder = new Map(); // garage_id -> { fahrraeder: Set, anhaenger: Set, gepaecke: Set } (Zugfahrzeuge, Anhänger und Gepäck im Gespann)
    this.namen = new Map(); // garage_id -> Name der Fahrerin oder des Fahrers
    this.emails = new Map(); // garage_id -> bestätigte Adresse
    this.tokens = new Map(); // hash -> { garageId, art, email, bis }
    this.naechsteId = 1;
    this.kaputt = false;
  }

  async ping() { if (this.kaputt) throw new Error('Datenbank aus'); }
  async anzahlGaragen() { return this.garagen.size; }

  async garageAnlegen(fahrerName = null) {
    const token = randomBytes(32).toString('base64url');
    const id = this.naechsteId++;
    this.garagen.set(hashToken(token), id);
    this.namen.set(id, fahrerName);
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
    this.mitglieder.delete(garageId);
    this.namen.delete(garageId);
    this.emails.delete(garageId);
    for (const [h, t] of this.tokens) if (t.garageId === garageId) this.tokens.delete(h);
    for (const [h, id] of this.garagen) if (id === garageId) this.garagen.delete(h);
  }

  _sicht(z) {
    // Wie die Datenbankabfrage: ohne Garage-Nummer und ohne Angaben des Betreibers (Prüfdatum, Prüfnotiz)
    const { garage_id, pruefnotiz, geprueft_am, foto_datei, ...rest } = z; // eslint-disable-line no-unused-vars
    return { ...rest, foto_vorhanden: !!foto_datei };
  }

  async alles(garageId) {
    const offen = [...this.tokens.values()].filter(t => t.garageId === garageId && t.art === 'email' && t.bis > Date.now()).pop();
    const r = { fahrer_name: this.namen.get(garageId) ?? null, email: this.emails.get(garageId) ?? null, email_offen: offen?.email ?? null };
    for (const a of Object.keys(this.daten)) r[a] = this.daten[a].filter(z => z.garage_id === garageId).sort((x, y) => x.sortierung - y.sortierung || x.id - y.id).map(z => this._sicht(z));
    r.gespann = this.gespanne.has(garageId) ? { ...this.gespanne.get(garageId) } : null;
    const m = this._mitgliederVon(garageId);
    r.mitglieder = { fahrraeder: [...m.fahrraeder], anhaenger: [...m.anhaenger], gepaecke: [...m.gepaecke] };
    if (m.positionen?.size) r.mitglieder.positionen = Object.fromEntries(m.positionen);
    return r;
  }

  async anlegen(garageId, art, werte) {
    const liste = this.daten[art];
    if (liste.filter(z => z.garage_id === garageId).length >= ARTEN[art].max) throw new FehlerEingabe('Limit', 409, { code: 'limit' });
    const alle = [...this.daten.fahrraeder, ...this.daten.anhaenger].filter(z => z.garage_id === garageId);
    const sortierung = Math.max(0, ...alle.map(z => z.sortierung)) + 1;
    const zeile = { id: this.naechsteId++, garage_id: garageId, sortierung, motoren: [], akkus: [], ...werte, status: 'ungeprueft' };
    liste.push(zeile);
    return this._sicht(zeile);
  }

  async fahrerNameSetzen(garageId, name) {
    this.namen.set(garageId, name);
    return name;
  }

  _tokenAnlegen(garageId, art, email, stunden) {
    for (const [h, t] of this.tokens) if (t.garageId === garageId && t.art === art) this.tokens.delete(h);
    const token = randomBytes(32).toString('base64url');
    this.tokens.set(hashToken(token), { garageId, art, email, bis: Date.now() + stunden * 3600 * 1000 });
    return token;
  }

  _tokenFinden(token, art) {
    const t = typeof token === 'string' && TOKEN_MUSTER.test(token) ? this.tokens.get(hashToken(token)) : null;
    if (!t || t.art !== art || t.bis < Date.now()) throw new FehlerEingabe('Der Link ist ungültig oder abgelaufen.', 400, { code: 'token_ungueltig' });
    return t;
  }

  async emailAnfordern(garageId, email) { return this._tokenAnlegen(garageId, 'email', email, 24); }

  async emailBestaetigen(token) {
    const t = this._tokenFinden(token, 'email');
    for (const [id, adresse] of this.emails) if (adresse === t.email && id !== t.garageId) throw new FehlerEingabe('vergeben', 409, { code: 'email_vergeben' });
    this.emails.set(t.garageId, t.email);
    this.tokens.delete(hashToken(token));
    return { email: t.email };
  }

  async emailEntfernen(garageId) {
    this.emails.delete(garageId);
    for (const [h, t] of this.tokens) if (t.garageId === garageId) this.tokens.delete(h);
  }

  async zugangAnfordern(email) {
    const eintrag = [...this.emails].find(([, a]) => a === email);
    return eintrag ? this._tokenAnlegen(eintrag[0], 'zugang', email, 1) : null;
  }

  async zugangEinloesen(token) {
    const t = this._tokenFinden(token, 'zugang');
    const neu = randomBytes(32).toString('base64url');
    for (const [h, id] of this.garagen) if (id === t.garageId) this.garagen.delete(h);
    this.garagen.set(hashToken(neu), t.garageId);
    for (const [h, x] of this.tokens) if (x.garageId === t.garageId && x.art === 'zugang') this.tokens.delete(h);
    return neu;
  }

  // --- Verwaltung ---
  _alleEintraege(art) {
    if (art === 'gespanne') return [...this.gespanne].map(([garage_id, g]) => ({ garage_id, ...g }));
    return this.daten[art];
  }

  _eintrag(art, id) {
    if (art === 'gespanne') {
      const e = [...this.gespanne.values()].find(g => g.id === id);
      return e ?? null;
    }
    return this.daten[art].find(z => z.id === id) ?? null;
  }

  _ungeprueft(garageId) {
    return ['fahrraeder', 'anhaenger', 'gespanne'].reduce((n, a) => n + this._alleEintraege(a).filter(z => z.garage_id === garageId && z.status === 'ungeprueft').length, 0);
  }

  async adminUebersicht() {
    const ids = [...this.garagen.values()];
    return {
      garagen: ids.length, mit_email: ids.filter(i => this.emails.has(i)).length,
      fahrraeder: this.daten.fahrraeder.length, anhaenger: this.daten.anhaenger.length,
      ungeprueft: ids.reduce((n, i) => n + this._ungeprueft(i), 0),
      garagen_mit_ungeprueften: ids.filter(i => this._ungeprueft(i) > 0).length
    };
  }

  async adminGaragen({ suche = '', nurUngeprueft = false, seite = 1, proSeite = 25 } = {}) {
    let ids = [...this.garagen.values()].sort((a, b) => b - a);
    const s = suche.toLowerCase();
    if (s) ids = ids.filter(i => (this.namen.get(i) ?? '').toLowerCase().includes(s) || (this.emails.get(i) ?? '').includes(s) || String(i) === s);
    if (nurUngeprueft) ids = ids.filter(i => this._ungeprueft(i) > 0);
    return {
      gesamt: ids.length, seite, proSeite,
      garagen: ids.slice((seite - 1) * proSeite, seite * proSeite).map(i => ({
        id: i, fahrer_name: this.namen.get(i) ?? null, email: this.emails.get(i) ?? null,
        fahrraeder: this.daten.fahrraeder.filter(z => z.garage_id === i).length,
        anhaenger: this.daten.anhaenger.filter(z => z.garage_id === i).length, ungeprueft: this._ungeprueft(i)
      }))
    };
  }

  async adminGarage(garageId) {
    if (![...this.garagen.values()].includes(garageId)) return null;
    const kopie = (z) => { const { garage_id, ...rest } = z; return { pruefnotiz: null, geprueft_am: null, ...rest }; }; // eslint-disable-line no-unused-vars
    return {
      id: garageId, fahrer_name: this.namen.get(garageId) ?? null, email: this.emails.get(garageId) ?? null,
      fahrraeder: this.daten.fahrraeder.filter(z => z.garage_id === garageId).map(kopie),
      anhaenger: this.daten.anhaenger.filter(z => z.garage_id === garageId).map(kopie),
      gespann: this.gespanne.has(garageId) ? kopie(this.gespanne.get(garageId)) : null
    };
  }

  async adminFahrerName(garageId, name) {
    if (![...this.garagen.values()].includes(garageId)) return false;
    this.namen.set(garageId, name);
    return true;
  }

  async adminGaragePruefen(garageId, status) {
    if (![...this.garagen.values()].includes(garageId)) return false;
    for (const a of ['fahrraeder', 'anhaenger']) for (const z of this.daten[a]) if (z.garage_id === garageId) z.status = status;
    const g = this.gespanne.get(garageId);
    if (g) g.status = status;
    return true;
  }

  async adminGarageLoeschen(garageId) {
    if (![...this.garagen.values()].includes(garageId)) return false;
    await this.garageLoeschen(garageId);
    return true;
  }

  async adminEintragAendern(art, id, aenderung) {
    const e = this._eintrag(art, id);
    if (!e) return null;
    if (aenderung.status !== undefined) { e.status = aenderung.status; e.geprueft_am = aenderung.status === 'geprueft' ? new Date().toISOString() : null; }
    if (aenderung.pruefnotiz !== undefined) e.pruefnotiz = aenderung.pruefnotiz;
    return { id: e.id, status: e.status, geprueft_am: e.geprueft_am ?? null, pruefnotiz: e.pruefnotiz ?? null };
  }

  async adminEintragLoeschen(art, id) {
    const e = this._eintrag(art, id);
    if (!e) return false;
    if (art === 'gespanne') {
      for (const [g, x] of this.gespanne) if (x === e) this.gespanne.delete(g);
    } else {
      this.daten[art].splice(this.daten[art].indexOf(e), 1);
    }
    return true;
  }

  async reihenfolgeSetzen(garageId, reihenfolge) {
    reihenfolge.forEach((x, i) => {
      const zeile = this.daten[x.art].find(z => z.id === x.id && z.garage_id === garageId);
      if (zeile) zeile.sortierung = i + 1;
    });
  }

  async fotoDatei(garageId, art, id) {
    const z = this.daten[art]?.find(x => x.id === id && x.garage_id === garageId);
    return z ? (z.foto_datei ?? null) : undefined;
  }

  async fotoSetzen(garageId, art, id, datei) {
    const alt = await this.fotoDatei(garageId, art, id);
    if (alt === undefined) return undefined;
    this.daten[art].find(x => x.id === id && x.garage_id === garageId).foto_datei = datei;
    return alt;
  }

  async gespannSetzen(garageId, werte) {
    const alt = this.gespanne.get(garageId);
    const neu = { id: alt?.id ?? this.naechsteId++, ...werte, status: 'ungeprueft' };
    this.gespanne.set(garageId, neu);
    return { ...neu };
  }

  async mitgliedSetzen(garageId, art, id, im) {
    if (!this.daten[art]?.some(z => z.id === id && z.garage_id === garageId)) throw new FehlerEingabe('Dieser Eintrag gehört nicht zu dieser Garage.', 400, { code: 'eingabe' });
    const m = this._mitgliederVon(garageId);
    if (im) { m[art].add(id); if (!this.gespanne.has(garageId)) this.gespanne.set(garageId, { id: this.naechsteId++, fahrer_gewicht_kg: null, gepaeck_kg: null, status: 'ungeprueft' }); }
    else m[art].delete(id);
    return this.alles(garageId);
  }

  // Gegenstände eines Gepäckstücks wie in der Datenbank, nur im Speicher
  _gepaeck(garageId, id) {
    return (this.daten.gepaecke ?? []).find(z => z.id === id && z.garage_id === garageId);
  }
  async gegenstandAnlegen(garageId, gepaeckId, name, platz) {
    const z = this._gepaeck(garageId, gepaeckId);
    if (!z) return undefined;
    z.inhalt ??= [];
    const nummer = platz ?? (z.inhalt.reduce((m, g) => Math.max(m, g.platz + 1), 0));
    const g = { id: this.naechsteId++, name, gepackt: false, platz: nummer };
    z.inhalt.push(g);
    return g;
  }
  _gegenstand(garageId, id) {
    for (const z of this.daten.gepaecke ?? []) {
      if (z.garage_id !== garageId) continue;
      const g = (z.inhalt ?? []).find(x => x.id === id);
      if (g) return { z, g };
    }
    return undefined;
  }
  async gegenstandAendern(garageId, id, { name, gepackt, platz }) {
    const f = this._gegenstand(garageId, id);
    if (!f) return undefined;
    let tausch = null;
    if (platz !== undefined && platz !== f.g.platz) {
      const andere = f.z.inhalt.find(x => x.platz === platz && x.id !== id);
      if (andere) { andere.platz = f.g.platz; tausch = { id: andere.id, platz: andere.platz }; }
    }
    if (name !== undefined) f.g.name = name;
    if (gepackt !== undefined) f.g.gepackt = gepackt;
    if (platz !== undefined) f.g.platz = platz;
    return { gegenstand: { id, name: f.g.name, gepackt: f.g.gepackt, platz: f.g.platz }, tausch };
  }
  async gegenstandLoeschen(garageId, id) {
    const f = this._gegenstand(garageId, id);
    if (!f) return false;
    f.z.inhalt = f.z.inhalt.filter(x => x.id !== id);
    return true;
  }

  async antriebSetzen(garageId, art, id, { motoren, akkus }) {
    const zeile = this.daten[art]?.find(z => z.id === id && z.garage_id === garageId);
    if (!zeile) return undefined;
    zeile.motoren = motoren.map(m => ({ id: this.naechsteId++, ...m }));
    zeile.akkus = akkus.map(a => ({ id: this.naechsteId++, ...a }));
    return { motoren: zeile.motoren, akkus: zeile.akkus };
  }

  async mitgliedPositionSetzen(garageId, art, id, x, y, s, e) {
    const m = this._mitgliederVon(garageId);
    if (!m[art]?.has(id)) return false;
    m.positionen ??= new Map();
    m.positionen.set(art + '-' + id, { x, y, s, e });
    return true;
  }
  _mitgliederVon(garageId) {
    if (!this.mitglieder.has(garageId)) this.mitglieder.set(garageId, { fahrraeder: new Set(), anhaenger: new Set(), gepaecke: new Set() });
    return this.mitglieder.get(garageId);
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
    if (['fahrraeder', 'anhaenger', 'gepaecke'].includes(art)) this._mitgliederVon(garageId)[art].delete(id);
    return true;
  }
}

/** Mailer, der Nachrichten sammelt statt zu senden */
export function fakeMailer() {
  const gesendet = [];
  return {
    gesendet,
    fehler: false,
    senden: async function (nachricht) {
      if (this.fehler) throw new Error('SMTP aus');
      gesendet.push(nachricht);
    },
    /** Schlüssel aus dem Link der letzten Nachricht */
    letzterToken() {
      const m = /#(?:bestaetigen|zugang)=([A-Za-z0-9_-]{43})/.exec(gesendet.at(-1)?.text ?? '');
      return m ? m[1] : null;
    }
  };
}

/** Startet die App mit Nachbildung des Datenzugriffs auf einem freien Port. Ergebnis: { url, speicher, anfrage(), schliessen() } */
export async function starteTestServer(optionen = {}) {
  const speicher = optionen.speicher ?? new FakeSpeicher();
  // Großzügige Grenzen, damit die Begrenzung nicht die anderen Tests stört (sie hat eigene Tests)
  const begrenzungen = { neu: new Begrenzung({ max: 10000 }), falsch: new Begrenzung({ max: 10000 }), mailIp: new Begrenzung({ max: 10000 }), ...optionen.app?.begrenzungen };
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
