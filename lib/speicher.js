// Datenzugriff auf Garagen und ihre Einträge (MySQL). Spalten- und Tabellennamen kommen ausschließlich aus lib/felder.js
// (feste Liste), Werte immer als Parameter. Die Eingaben sind vorher mit pruefeEingabe() geprüft.
//
// Die Tests nutzen eine Nachbildung mit derselben Schnittstelle (tests/hilfen.js); tests/speicher.integration.test.js
// prüft diese Datei gegen eine echte Datenbank, sobald TEST_DB_HOST gesetzt ist.

import { createHash, randomBytes } from 'crypto';
import { fotoLoeschen } from './fotos.js';
import { ARTEN, GESPANN_FELDER } from './felder.js';
import { FehlerEingabe } from './fehler.js';

export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{43}$/;

// Fehlernummer von MySQL: doppelter Eintrag in einem eindeutigen Schlüssel
const ER_DUP_ENTRY = 1062;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export class Speicher {
  constructor(pool) {
    this.pool = pool;
  }

  async ping() {
    await this.pool.query('SELECT 1');
  }

  async anzahlGaragen() {
    const [[z]] = await this.pool.query('SELECT COUNT(*) AS n FROM garagen');
    return Number(z.n);
  }

  /** Legt eine Garage an. Der Schlüssel (token) wird nur hier im Klartext erzeugt und nirgends gespeichert. */
  async garageAnlegen(fahrerName = null) {
    const token = randomBytes(32).toString('base64url'); // 43 Zeichen
    const [r] = await this.pool.query('INSERT INTO garagen (token_hash, fahrer_name) VALUES (?, ?)', [hashToken(token), fahrerName]);
    return { id: r.insertId, token };
  }

  /** Findet die Garage zu einem Schlüssel oder null. Merkt sich höchstens einmal je Stunde den Zeitpunkt der Nutzung. */
  async garageFinden(token) {
    if (typeof token !== 'string' || !TOKEN_MUSTER.test(token)) return null;
    const [zeilen] = await this.pool.query('SELECT id FROM garagen WHERE token_hash = ?', [hashToken(token)]);
    if (!zeilen.length) return null;
    const id = zeilen[0].id;
    await this.pool.query(
      'UPDATE garagen SET zuletzt_genutzt_am = UTC_TIMESTAMP() WHERE id = ? AND zuletzt_genutzt_am < UTC_TIMESTAMP() - INTERVAL 1 HOUR', [id]);
    return { id };
  }

  async fahrerNameSetzen(garageId, name) {
    await this.pool.query('UPDATE garagen SET fahrer_name = ? WHERE id = ?', [name, garageId]);
    return name;
  }

  // --- E-Mail: Adresse bestätigen und Zugang per E-Mail ---

  /** Neuer einmaliger Link; ältere Links derselben Art und Garage und abgelaufene Links werden gelöscht. Ergebnis: der Schlüssel (nur hier im Klartext). */
  async _tokenAnlegen(garageId, art, email, stunden) {
    await this.pool.query('DELETE FROM garage_tokens WHERE gueltig_bis < UTC_TIMESTAMP()');
    await this.pool.query('DELETE FROM garage_tokens WHERE garage_id = ? AND art = ?', [garageId, art]);
    const token = randomBytes(32).toString('base64url');
    await this.pool.query(
      'INSERT INTO garage_tokens (garage_id, art, token_hash, email, gueltig_bis) VALUES (?, ?, ?, ?, UTC_TIMESTAMP() + INTERVAL ? HOUR)',
      [garageId, art, hashToken(token), email, stunden]);
    return token;
  }

  async _tokenFinden(token, art) {
    const ungueltig = () => new FehlerEingabe('Der Link ist ungültig oder abgelaufen.', 400, { code: 'token_ungueltig' });
    if (typeof token !== 'string' || !TOKEN_MUSTER.test(token)) throw ungueltig();
    const [z] = await this.pool.query(
      'SELECT id, garage_id, email FROM garage_tokens WHERE token_hash = ? AND art = ? AND gueltig_bis >= UTC_TIMESTAMP()', [hashToken(token), art]);
    if (!z.length) throw ungueltig();
    return z[0];
  }

  /** Beginnt die Bestätigung einer Adresse. Ergebnis: Schlüssel für den Link in der E-Mail (24 Stunden gültig). */
  async emailAnfordern(garageId, email) {
    return this._tokenAnlegen(garageId, 'email', email, 24);
  }

  /** Bestätigt die Adresse. Wirft 'token_ungueltig' (400) oder 'email_vergeben' (409, gehört schon zu einer anderen Garage). */
  async emailBestaetigen(token) {
    const z = await this._tokenFinden(token, 'email');
    try {
      await this.pool.query('UPDATE garagen SET email = ?, email_bestaetigt_am = UTC_TIMESTAMP() WHERE id = ?', [z.email, z.garage_id]);
    } catch (e) {
      if (e?.errno === ER_DUP_ENTRY) throw new FehlerEingabe('Diese Adresse gehört schon zu einer anderen Garage.', 409, { code: 'email_vergeben' });
      throw e;
    }
    await this.pool.query("DELETE FROM garage_tokens WHERE garage_id = ? AND art = 'email'", [z.garage_id]);
    return { email: z.email };
  }

  /** Entfernt die bestätigte Adresse, offene Bestätigungen und offene Zugangslinks */
  async emailEntfernen(garageId) {
    await this.pool.query('UPDATE garagen SET email = NULL, email_bestaetigt_am = NULL WHERE id = ?', [garageId]);
    await this.pool.query('DELETE FROM garage_tokens WHERE garage_id = ?', [garageId]);
  }

  /** Zugangslink anfordern: Ergebnis der Schlüssel für den Link (1 Stunde gültig) oder null, wenn die Adresse zu keiner Garage gehört */
  async zugangAnfordern(email) {
    const [g] = await this.pool.query('SELECT id FROM garagen WHERE email = ?', [email]);
    if (!g.length) return null;
    return this._tokenAnlegen(g[0].id, 'zugang', email, 1);
  }

  /** Löst einen Zugangslink ein: die Garage bekommt einen neuen Schlüssel, der alte gilt nicht mehr. Ergebnis: der neue Schlüssel. */
  async zugangEinloesen(token) {
    const z = await this._tokenFinden(token, 'zugang');
    const neu = randomBytes(32).toString('base64url');
    const v = await this.pool.getConnection();
    try {
      await v.beginTransaction();
      await v.query('UPDATE garagen SET token_hash = ?, zuletzt_genutzt_am = UTC_TIMESTAMP() WHERE id = ?', [hashToken(neu), z.garage_id]);
      await v.query("DELETE FROM garage_tokens WHERE garage_id = ? AND art = 'zugang'", [z.garage_id]);
      await v.commit();
    } catch (e) {
      await v.rollback();
      throw e;
    } finally {
      v.release();
    }
    return neu;
  }

  /** Löscht die Garage mit allen Einträgen (Fahrräder, Anhänger und Gespann folgen per CASCADE). */
  async garageLoeschen(garageId) {
    const [fotos] = await this.pool.query('SELECT foto_datei FROM fahrraeder WHERE garage_id = ? AND foto_datei IS NOT NULL UNION ALL SELECT foto_datei FROM anhaenger WHERE garage_id = ? AND foto_datei IS NOT NULL', [garageId, garageId]);
    await this.pool.query('DELETE FROM garagen WHERE id = ?', [garageId]);
    for (const f of fotos) fotoLoeschen(f.foto_datei);
  }

  _spalten(art) {
    return ARTEN[art].felder.map(f => `\`${f.key}\``).join(', ');
  }

  async _liste(garageId, art) {
    const [zeilen] = await this.pool.query(
      `SELECT id, ${this._spalten(art)}, sortierung, status, erstellt_am, geaendert_am, ${art === 'gepaecke' ? '0' : '(foto_datei IS NOT NULL)'} AS foto_vorhanden FROM \`${ARTEN[art].tabelle}\` WHERE garage_id = ? ORDER BY sortierung, id`,
      [garageId]);
    const antriebe = await this._antriebeVon(garageId, art);
    const inhalte = art === 'gepaecke' ? await this._inhaltVon(garageId) : {};
    return zeilen.map(z => ({ ...z, motoren: antriebe[z.id]?.motoren ?? [], akkus: antriebe[z.id]?.akkus ?? [], inhalt: inhalte[z.id] ?? [] }));
  }

  /** Motoren und Akkus aller Einträge einer Art in der Garage: { eintrag_id: { motoren, akkus } } */
  async _antriebeVon(garageId, art) {
    const [zeilen] = await this.pool.query('SELECT id, eintrag_id, typ, motor_art, wert, spannung_v, getriebe, akku_chemie, akku_zellen_s, akku_zellen_p, akku_ah, akku_entladeschluss_v, akku_max_strom_a FROM antriebe WHERE garage_id = ? AND art = ? ORDER BY sortierung, id', [garageId, art]);
    const map = {};
    for (const z of zeilen) {
      const e = map[z.eintrag_id] ?? (map[z.eintrag_id] = { motoren: [], akkus: [] });
      if (z.typ === 'motor') e.motoren.push({ id: z.id, motor_art: z.motor_art, leistung_w: z.wert, spannung_v: z.spannung_v, getriebe: z.getriebe });
      else e.akkus.push({
        id: z.id, kapazitaet_wh: z.wert, spannung_v: z.spannung_v, chemie: z.akku_chemie, zellen_s: z.akku_zellen_s, zellen_p: z.akku_zellen_p,
        ah: z.akku_ah == null ? null : Number(z.akku_ah), schluss_v: z.akku_entladeschluss_v == null ? null : Number(z.akku_entladeschluss_v),
        max_strom_a: z.akku_max_strom_a == null ? null : Number(z.akku_max_strom_a)
      });
    }
    return map;
  }

  /** Ersetzt die Motoren und Akkus eines Fahrrads oder Anhängers. Ergebnis: { motoren, akkus } oder undefined, wenn der Eintrag nicht zur Garage gehört */
  async antriebSetzen(garageId, art, id, { motoren, akkus }) {
    if (art !== 'fahrraeder' && art !== 'anhaenger') throw new FehlerEingabe('Unbekannte Art.', 400, { code: 'eingabe' });
    const [z] = await this.pool.query('SELECT id FROM `' + ARTEN[art].tabelle + '` WHERE id = ? AND garage_id = ?', [id, garageId]);
    if (!z.length) return undefined;
    await this.pool.query('DELETE FROM antriebe WHERE garage_id = ? AND art = ? AND eintrag_id = ?', [garageId, art, id]);
    let sortierung = 0;
    for (const m of motoren) {
      await this.pool.query("INSERT INTO antriebe (garage_id, art, eintrag_id, typ, motor_art, wert, spannung_v, getriebe, sortierung) VALUES (?, ?, ?, 'motor', ?, ?, ?, ?, ?)", [garageId, art, id, m.motor_art, m.leistung_w, m.spannung_v, m.getriebe, ++sortierung]);
    }
    for (const a of akkus) {
      await this.pool.query("INSERT INTO antriebe (garage_id, art, eintrag_id, typ, motor_art, wert, spannung_v, getriebe, sortierung, akku_chemie, akku_zellen_s, akku_zellen_p, akku_ah, akku_entladeschluss_v, akku_max_strom_a) VALUES (?, ?, ?, 'akku', NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)", [garageId, art, id, a.kapazitaet_wh, a.spannung_v, ++sortierung, a.chemie, a.zellen_s, a.zellen_p, a.ah, a.schluss_v, a.max_strom_a]);
    }
    return (await this._antriebeVon(garageId, art))[id] ?? { motoren: [], akkus: [] };
  }

  /** Gegenstände aller Gepäckstücke der Garage: { gepaeck_id: [{ id, name, gepackt, platz }] }, platz = Nummer des Inventarplatzes */
  async _inhaltVon(garageId) {
    const [zeilen] = await this.pool.query('SELECT id, gepaeck_id, name, gepackt, sortierung FROM gepaeck_inhalt WHERE garage_id = ? ORDER BY sortierung, id', [garageId]);
    const map = {};
    for (const z of zeilen) (map[z.gepaeck_id] ??= []).push({ id: z.id, name: z.name, gepackt: !!z.gepackt, platz: z.sortierung });
    return map;
  }

  /** Gegenstand in das Gepäckstück legen, auf den Platz (sonst der nächste freie hinter dem letzten); undefined, wenn das Gepäck nicht zur Garage gehört */
  async gegenstandAnlegen(garageId, gepaeckId, name, platz) {
    const [z] = await this.pool.query('SELECT id FROM gepaecke WHERE id = ? AND garage_id = ?', [gepaeckId, garageId]);
    if (!z.length) return undefined;
    let nummer = platz;
    if (nummer === undefined) {
      const [[mx]] = await this.pool.query('SELECT COALESCE(MAX(sortierung) + 1, 0) AS n FROM gepaeck_inhalt WHERE gepaeck_id = ?', [gepaeckId]);
      nummer = mx.n;
    }
    const [r] = await this.pool.query('INSERT INTO gepaeck_inhalt (garage_id, gepaeck_id, name, gepackt, sortierung) VALUES (?, ?, ?, 0, ?)', [garageId, gepaeckId, name, nummer]);
    return { id: r.insertId, name, gepackt: false, platz: nummer };
  }

  /** Gegenstand ändern: Name, Häkchen oder Platz. Ist der Zielplatz belegt, tauschen beide Gegenstände ihre Plätze.
   *  Ergebnis: der Gegenstand, plus tauscht (der andere Gegenstand mit seinem neuen Platz) oder null; undefined, wenn es ihn nicht gibt */
  async gegenstandAendern(garageId, id, { name, gepackt, platz }) {
    const [[g]] = await this.pool.query('SELECT id, gepaeck_id, sortierung FROM gepaeck_inhalt WHERE id = ? AND garage_id = ?', [id, garageId]);
    if (!g) return undefined;
    let tausch = null;
    if (platz !== undefined && platz !== g.sortierung) {
      const [[andere]] = await this.pool.query('SELECT id FROM gepaeck_inhalt WHERE gepaeck_id = ? AND sortierung = ? AND id <> ?', [g.gepaeck_id, platz, id]);
      if (andere) {
        await this.pool.query('UPDATE gepaeck_inhalt SET sortierung = ? WHERE id = ?', [g.sortierung, andere.id]);
        tausch = { id: andere.id, platz: g.sortierung };
      }
    }
    const satz = [];
    const werte = [];
    if (name !== undefined) { satz.push('name = ?'); werte.push(name); }
    if (gepackt !== undefined) { satz.push('gepackt = ?'); werte.push(gepackt ? 1 : 0); }
    if (platz !== undefined) { satz.push('sortierung = ?'); werte.push(platz); }
    if (satz.length) await this.pool.query(`UPDATE gepaeck_inhalt SET ${satz.join(', ')} WHERE id = ?`, [...werte, id]);
    const [[z]] = await this.pool.query('SELECT id, name, gepackt, sortierung FROM gepaeck_inhalt WHERE id = ?', [id]);
    return { gegenstand: { id: z.id, name: z.name, gepackt: !!z.gepackt, platz: z.sortierung }, tausch };
  }

  /** Gegenstand löschen; false, wenn es ihn nicht gibt */
  async gegenstandLoeschen(garageId, id) {
    const [z] = await this.pool.query('SELECT id FROM gepaeck_inhalt WHERE id = ? AND garage_id = ?', [id, garageId]);
    if (!z.length) return false;
    await this.pool.query('DELETE FROM gepaeck_inhalt WHERE id = ?', [id]);
    return true;
  }

  async _eintrag(garageId, art, id) {
    const [zeilen] = await this.pool.query(
      `SELECT id, ${this._spalten(art)}, sortierung, status, erstellt_am, geaendert_am FROM \`${ARTEN[art].tabelle}\` WHERE garage_id = ? AND id = ?`,
      [garageId, id]);
    return zeilen[0] ?? null;
  }

  /** Alle Einträge einer Garage mit Name und E-Mail-Adresse; gespann ist das aktuelle Gespann oder null, solange noch keins gespeichert wurde */
  async alles(garageId) {
    const [fahrraeder, anhaenger, gepaecke, [gespann], [[garage]], [[offen]]] = await Promise.all([
      this._liste(garageId, 'fahrraeder'), this._liste(garageId, 'anhaenger'), this._liste(garageId, 'gepaecke'),
      this.pool.query(
        `SELECT id, ${GESPANN_FELDER.map(f => `\`${f.key}\``).join(', ')}, status, geaendert_am FROM gespanne WHERE garage_id = ?`, [garageId]).then(r => r[0]),
      this.pool.query('SELECT fahrer_name, email FROM garagen WHERE id = ?', [garageId]),
      this.pool.query(
        "SELECT email FROM garage_tokens WHERE garage_id = ? AND art = 'email' AND gueltig_bis >= UTC_TIMESTAMP() ORDER BY id DESC LIMIT 1", [garageId])
    ]);
    return {
      fahrer_name: garage?.fahrer_name ?? null,
      email: garage?.email ?? null,            // bestätigte Adresse
      email_offen: offen?.email ?? null,       // Adresse, die noch auf die Bestätigung wartet
      fahrraeder, anhaenger, gepaecke, gespann: gespann ?? null,
      mitglieder: await this._mitglieder(garageId)
    };
  }

  /** Ids der Zugfahrzeuge und Anhänger im Gespann */
  async _mitglieder(garageId) {
    const [zeilen] = await this.pool.query('SELECT art, eintrag_id, x, y FROM gespann_mitglieder WHERE garage_id = ? ORDER BY art, eintrag_id', [garageId]);
    const positionen = {};
    for (const z of zeilen) if (z.x !== null && z.y !== null) positionen[z.art + '-' + z.eintrag_id] = { x: z.x, y: z.y };
    return {
      fahrraeder: zeilen.filter(z => z.art === 'fahrraeder').map(z => z.eintrag_id),
      anhaenger: zeilen.filter(z => z.art === 'anhaenger').map(z => z.eintrag_id),
      gepaecke: zeilen.filter(z => z.art === 'gepaecke').map(z => z.eintrag_id),
      positionen
    };
  }

  /** Ein Zugfahrzeug oder ein Anhänger gehört zum Gespann (im = true) oder nicht (im = false); nur Einträge derselben Garage */
  /** Position eines Mitglieds auf der Gespann-Fläche speichern; false, wenn es das Mitglied im Gespann nicht gibt */
  async mitgliedPositionSetzen(garageId, art, id, x, y) {
    const [r] = await this.pool.query('UPDATE gespann_mitglieder SET x = ?, y = ? WHERE garage_id = ? AND art = ? AND eintrag_id = ?', [x, y, garageId, art, id]);
    return r.affectedRows > 0;
  }

  async mitgliedSetzen(garageId, art, id, im) {
    if (!['fahrraeder', 'anhaenger', 'gepaecke'].includes(art)) throw new FehlerEingabe('Unbekannte Art.', 400, { code: 'eingabe' });
    const [z] = await this.pool.query('SELECT id FROM `' + ARTEN[art].tabelle + '` WHERE id = ? AND garage_id = ?', [id, garageId]);
    if (!z.length) throw new FehlerEingabe('Dieser Eintrag gehört nicht zu dieser Garage.', 400, { code: 'eingabe' });
    if (im) {
      await this.pool.query('INSERT IGNORE INTO gespann_mitglieder (garage_id, art, eintrag_id) VALUES (?, ?, ?)', [garageId, art, id]);
      // Die Gespann-Zeile für Fahrer und Gepäck gibt es ab dem ersten Mitglied
      await this.pool.query('INSERT IGNORE INTO gespanne (garage_id) VALUES (?)', [garageId]);
    } else {
      await this.pool.query('DELETE FROM gespann_mitglieder WHERE garage_id = ? AND art = ? AND eintrag_id = ?', [garageId, art, id]);
    }
    return this.alles(garageId);
  }

  /** Speichert das aktuelle Gespann (legt es an oder ersetzt es). Eine Änderung gilt wieder als ungeprüft. */
  /** Einstellungen des Planers im Profil der Garage; null, solange nichts gespeichert ist */
  async planerLesen(garageId) {
    const [[z]] = await this.pool.query('SELECT planer_einstellungen FROM garagen WHERE id = ?', [garageId]);
    return z?.planer_einstellungen ? JSON.parse(z.planer_einstellungen) : null;
  }

  async planerSetzen(garageId, werte) {
    await this.pool.query('UPDATE garagen SET planer_einstellungen = ? WHERE id = ?', [JSON.stringify(werte), garageId]);
    return werte;
  }

  async gespannSetzen(garageId, werte) {
    const schluessel = GESPANN_FELDER.map(f => f.key);
    await this.pool.query(
      `INSERT INTO gespanne (garage_id, ${schluessel.map(k => `\`${k}\``).join(', ')}) VALUES (?${', ?'.repeat(schluessel.length)})
       ON DUPLICATE KEY UPDATE ${schluessel.map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ')}, status = 'ungeprueft', geprueft_am = NULL`,
      [garageId, ...schluessel.map(k => werte[k])]);
    return (await this.alles(garageId)).gespann;
  }

  /** Dateiname des Fotos eines Fahrrads oder Anhängers (null: kein Foto; undefined: der Eintrag gehört nicht zur Garage) */
  async fotoDatei(garageId, art, id) {
    if (art === 'gepaecke') return undefined; // Gepäck hat kein Foto
    const [z] = await this.pool.query('SELECT foto_datei FROM `' + ARTEN[art].tabelle + '` WHERE id = ? AND garage_id = ?', [id, garageId]);
    return z.length ? z[0].foto_datei : undefined;
  }

  /** Setzt das Foto; liefert den bisherigen Dateinamen (null: keiner) oder undefined, wenn der Eintrag nicht zur Garage gehört */
  async fotoSetzen(garageId, art, id, datei) {
    const alt = await this.fotoDatei(garageId, art, id);
    if (alt === undefined) return undefined;
    await this.pool.query('UPDATE `' + ARTEN[art].tabelle + '` SET foto_datei = ? WHERE id = ? AND garage_id = ?', [datei, id, garageId]);
    return alt;
  }

  async anlegen(garageId, art, werte) {
    const cfg = ARTEN[art];
    const [[z]] = await this.pool.query(`SELECT COUNT(*) AS n FROM \`${cfg.tabelle}\` WHERE garage_id = ?`, [garageId]);
    if (Number(z.n) >= cfg.max) throw new FehlerEingabe(`Mehr als ${cfg.max} Einträge sind nicht möglich.`, 409, { code: 'limit' });

    // Neue Fahrzeuge stehen am Ende der gemeinsamen Reihenfolge
    const [[m]] = await this.pool.query(
      `SELECT GREATEST((SELECT COALESCE(MAX(sortierung), 0) FROM fahrraeder WHERE garage_id = ?), (SELECT COALESCE(MAX(sortierung), 0) FROM anhaenger WHERE garage_id = ?), (SELECT COALESCE(MAX(sortierung), 0) FROM gepaecke WHERE garage_id = ?)) AS m`,
      [garageId, garageId, garageId]);
    const schluessel = cfg.felder.map(f => f.key);
    const [r] = await this.pool.query(
      `INSERT INTO \`${cfg.tabelle}\` (garage_id, sortierung, ${schluessel.map(k => `\`${k}\``).join(', ')}) VALUES (?, ?${', ?'.repeat(schluessel.length)})`,
      [garageId, Number(m.m) + 1, ...schluessel.map(k => werte[k])]);
    return this._eintrag(garageId, art, r.insertId);
  }

  /** Ändert einen Eintrag. Ein geänderter Eintrag gilt wieder als ungeprüft. Ergebnis: der Eintrag oder null, wenn es ihn nicht gibt. */
  async aendern(garageId, art, id, werte) {
    const cfg = ARTEN[art];
    if (!(await this._eintrag(garageId, art, id))) return null;

    const schluessel = cfg.felder.map(f => f.key);
    await this.pool.query(
      `UPDATE \`${cfg.tabelle}\` SET ${schluessel.map(k => `\`${k}\` = ?`).join(', ')}, status = 'ungeprueft', geprueft_am = NULL WHERE id = ? AND garage_id = ?`,
      [...schluessel.map(k => werte[k]), id, garageId]);
    return this._eintrag(garageId, art, id);
  }

  /**
   * Setzt die gemeinsame Reihenfolge der Fahrzeuge: liste = [{ art, id }, ...] in der gewünschten Reihenfolge.
   * Einträge, die nicht zur Garage gehören, werden übergangen (sie bekommen keine Nummer); nicht genannte Einträge behalten ihre Nummer.
   */
  async reihenfolgeSetzen(garageId, liste) {
    const v = await this.pool.getConnection();
    try {
      await v.beginTransaction();
      for (let i = 0; i < liste.length; i++) {
        await v.query(`UPDATE \`${ARTEN[liste[i].art].tabelle}\` SET sortierung = ? WHERE id = ? AND garage_id = ?`, [i + 1, liste[i].id, garageId]);
      }
      await v.commit();
    } catch (e) {
      await v.rollback();
      throw e;
    } finally {
      v.release();
    }
  }

  /** Ergebnis: true (gelöscht) oder false (gibt es nicht). Ein Platz im Gespann, der den Eintrag benutzte, wird leer. */
  async loeschen(garageId, art, id) {
    const foto = art === 'gepaecke' ? null : await this.fotoDatei(garageId, art, id);
    await this.pool.query('DELETE FROM gespann_mitglieder WHERE garage_id = ? AND art = ? AND eintrag_id = ?', [garageId, art, id]);
    await this.pool.query('DELETE FROM antriebe WHERE garage_id = ? AND art = ? AND eintrag_id = ?', [garageId, art, id]);
    const [r] = await this.pool.query('DELETE FROM `' + ARTEN[art].tabelle + '` WHERE id = ? AND garage_id = ?', [id, garageId]);
    if (r.affectedRows > 0 && foto) fotoLoeschen(foto);
    return r.affectedRows > 0;
  }

  // --- Verwaltung (Betreiber): alle Garagen sehen, Einträge prüfen, Spam entfernen ---

  _adminTabelle(art) {
    return art === 'gespanne' ? 'gespanne' : ARTEN[art].tabelle;
  }

  async adminUebersicht() {
    const [[z]] = await this.pool.query(`SELECT
      (SELECT COUNT(*) FROM garagen) AS garagen,
      (SELECT COUNT(*) FROM garagen WHERE email IS NOT NULL) AS mit_email,
      (SELECT COUNT(*) FROM fahrraeder) AS fahrraeder,
      (SELECT COUNT(*) FROM anhaenger) AS anhaenger,
      (SELECT COUNT(*) FROM fahrraeder WHERE status = 'ungeprueft') + (SELECT COUNT(*) FROM anhaenger WHERE status = 'ungeprueft')
        + (SELECT COUNT(*) FROM gespanne WHERE status = 'ungeprueft') AS ungeprueft,
      (SELECT COUNT(*) FROM garagen g WHERE
        EXISTS (SELECT 1 FROM fahrraeder f WHERE f.garage_id = g.id AND f.status = 'ungeprueft')
        OR EXISTS (SELECT 1 FROM anhaenger a WHERE a.garage_id = g.id AND a.status = 'ungeprueft')
        OR EXISTS (SELECT 1 FROM gespanne s WHERE s.garage_id = g.id AND s.status = 'ungeprueft')) AS garagen_mit_ungeprueften`);
    return Object.fromEntries(Object.entries(z).map(([k, v]) => [k, Number(v)]));
  }

  /** Liste der Garagen, neueste zuerst. suche: Teil von Name oder E-Mail-Adresse oder die Nummer. */
  async adminGaragen({ suche = '', nurUngeprueft = false, seite = 1, proSeite = 25 } = {}) {
    const bedingungen = [];
    const werte = [];
    if (suche) {
      const muster = `%${suche.replace(/[\\%_]/g, m => `\\${m}`)}%`;
      bedingungen.push('(g.fahrer_name LIKE ? OR g.email LIKE ? OR g.id = ?)');
      werte.push(muster, muster, /^\d{1,10}$/.test(suche) ? Number(suche) : 0);
    }
    const ungeprueftSql = `(SELECT COUNT(*) FROM fahrraeder f WHERE f.garage_id = g.id AND f.status = 'ungeprueft')
        + (SELECT COUNT(*) FROM anhaenger a WHERE a.garage_id = g.id AND a.status = 'ungeprueft')
        + (SELECT COUNT(*) FROM gespanne s WHERE s.garage_id = g.id AND s.status = 'ungeprueft')`;
    if (nurUngeprueft) bedingungen.push(`(${ungeprueftSql}) > 0`);
    const wo = bedingungen.length ? `WHERE ${bedingungen.join(' AND ')}` : '';

    const [[gesamt]] = await this.pool.query(`SELECT COUNT(*) AS n FROM garagen g ${wo}`, werte);
    const [zeilen] = await this.pool.query(
      `SELECT g.id, g.fahrer_name, g.email, g.email_bestaetigt_am, g.erstellt_am, g.zuletzt_genutzt_am,
         (SELECT COUNT(*) FROM fahrraeder f WHERE f.garage_id = g.id) AS fahrraeder,
         (SELECT COUNT(*) FROM anhaenger a WHERE a.garage_id = g.id) AS anhaenger,
         ${ungeprueftSql} AS ungeprueft
       FROM garagen g ${wo} ORDER BY g.id DESC LIMIT ? OFFSET ?`,
      [...werte, proSeite, (seite - 1) * proSeite]);
    return {
      gesamt: Number(gesamt.n), seite, proSeite,
      garagen: zeilen.map(z => ({ ...z, fahrraeder: Number(z.fahrraeder), anhaenger: Number(z.anhaenger), ungeprueft: Number(z.ungeprueft) }))
    };
  }

  /** Eine Garage mit allen Einträgen, auch Prüfdatum und Prüfnotiz; null, wenn es sie nicht gibt */
  async adminGarage(garageId) {
    const [[g]] = await this.pool.query(
      'SELECT id, fahrer_name, email, email_bestaetigt_am, erstellt_am, zuletzt_genutzt_am FROM garagen WHERE id = ?', [garageId]);
    if (!g) return null;
    const liste = async (art, felder) => (await this.pool.query(
      `SELECT id, ${felder.map(f => `\`${f.key}\``).join(', ')}, status, geprueft_am, pruefnotiz, erstellt_am, geaendert_am${art === 'fahrraeder' || art === 'anhaenger' ? ', (foto_datei IS NOT NULL) AS foto_vorhanden' : ''}
       FROM \`${this._adminTabelle(art)}\` WHERE garage_id = ? ORDER BY ${art === 'gespanne' ? 'id' : 'sortierung, id'}`, [garageId]))[0];
    const [fahrraeder, anhaenger, gepaecke, gespanne, antriebeRad, antriebeAnh, mitglieder] = await Promise.all([
      liste('fahrraeder', ARTEN.fahrraeder.felder), liste('anhaenger', ARTEN.anhaenger.felder), liste('gepaecke', ARTEN.gepaecke.felder), liste('gespanne', GESPANN_FELDER),
      this._antriebeVon(garageId, 'fahrraeder'), this._antriebeVon(garageId, 'anhaenger'), this._mitglieder(garageId)
    ]);
    // Motoren und Akkus je Stellplatz, damit die Verwaltung sie sieht
    const mit = (liste, antriebe) => liste.map(e => ({ ...e, motoren: antriebe[e.id]?.motoren ?? [], akkus: antriebe[e.id]?.akkus ?? [] }));
    return { ...g, fahrraeder: mit(fahrraeder, antriebeRad), anhaenger: mit(anhaenger, antriebeAnh), gepaecke, gespann: gespanne[0] ?? null, mitglieder };
  }

  async adminFahrerName(garageId, name) {
    const [r] = await this.pool.query('UPDATE garagen SET fahrer_name = ? WHERE id = ?', [name, garageId]);
    return r.affectedRows > 0;
  }

  /** Setzt den Prüfstatus aller Einträge einer Garage. Ergebnis: false, wenn es die Garage nicht gibt. */
  async adminGaragePruefen(garageId, status) {
    const [[g]] = await this.pool.query('SELECT id FROM garagen WHERE id = ?', [garageId]);
    if (!g) return false;
    for (const art of ['fahrraeder', 'anhaenger', 'gepaecke', 'gespanne']) {
      await this.pool.query(
        `UPDATE \`${this._adminTabelle(art)}\` SET status = ?, geprueft_am = ${status === 'geprueft' ? 'UTC_TIMESTAMP()' : 'NULL'} WHERE garage_id = ?`, [status, garageId]);
    }
    return true;
  }

  async adminGarageLoeschen(garageId) {
    const [r] = await this.pool.query('DELETE FROM garagen WHERE id = ?', [garageId]);
    return r.affectedRows > 0;
  }

  /** aenderung: { status?, pruefnotiz? }. Ergebnis: { id, status, geprueft_am, pruefnotiz } oder null. */
  async adminEintragAendern(art, id, aenderung) {
    const tabelle = this._adminTabelle(art);
    const teile = [];
    const werte = [];
    if (aenderung.status !== undefined) {
      teile.push('status = ?', aenderung.status === 'geprueft' ? 'geprueft_am = UTC_TIMESTAMP()' : 'geprueft_am = NULL');
      werte.push(aenderung.status);
    }
    if (aenderung.pruefnotiz !== undefined) {
      teile.push('pruefnotiz = ?');
      werte.push(aenderung.pruefnotiz);
    }
    const [r] = await this.pool.query(`UPDATE \`${tabelle}\` SET ${teile.join(', ')} WHERE id = ?`, [...werte, id]);
    if (!r.affectedRows) {
      const [[da]] = await this.pool.query(`SELECT id FROM \`${tabelle}\` WHERE id = ?`, [id]);
      if (!da) return null;
    }
    const [[z]] = await this.pool.query(`SELECT id, status, geprueft_am, pruefnotiz FROM \`${tabelle}\` WHERE id = ?`, [id]);
    return z ?? null;
  }

  async adminEintragLoeschen(art, id) {
    const [r] = await this.pool.query(`DELETE FROM \`${this._adminTabelle(art)}\` WHERE id = ?`, [id]);
    return r.affectedRows > 0;
  }

}
