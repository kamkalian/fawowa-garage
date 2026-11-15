// Datenzugriff auf Garagen und ihre Einträge (MySQL). Spalten- und Tabellennamen kommen ausschließlich aus lib/felder.js
// (feste Liste), Werte immer als Parameter. Die Eingaben sind vorher mit pruefeEingabe() geprüft.
//
// Die Tests nutzen eine Nachbildung mit derselben Schnittstelle (tests/hilfen.js); tests/speicher.integration.test.js
// prüft diese Datei gegen eine echte Datenbank, sobald TEST_DB_HOST gesetzt ist.

import { createHash, randomBytes } from 'crypto';
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
    await this.pool.query('DELETE FROM garagen WHERE id = ?', [garageId]);
  }

  _spalten(art) {
    return ARTEN[art].felder.map(f => `\`${f.key}\``).join(', ');
  }

  async _liste(garageId, art) {
    const [zeilen] = await this.pool.query(
      `SELECT id, ${this._spalten(art)}, sortierung, status, erstellt_am, geaendert_am FROM \`${ARTEN[art].tabelle}\` WHERE garage_id = ? ORDER BY sortierung, id`,
      [garageId]);
    return zeilen;
  }

  async _eintrag(garageId, art, id) {
    const [zeilen] = await this.pool.query(
      `SELECT id, ${this._spalten(art)}, sortierung, status, erstellt_am, geaendert_am FROM \`${ARTEN[art].tabelle}\` WHERE garage_id = ? AND id = ?`,
      [garageId, id]);
    return zeilen[0] ?? null;
  }

  /** Alle Einträge einer Garage mit Name und E-Mail-Adresse; gespann ist das aktuelle Gespann oder null, solange noch keins gespeichert wurde */
  async alles(garageId) {
    const [fahrraeder, anhaenger, [gespann], [[garage]], [[offen]]] = await Promise.all([
      this._liste(garageId, 'fahrraeder'), this._liste(garageId, 'anhaenger'),
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
      fahrraeder, anhaenger, gespann: gespann ?? null
    };
  }

  /** Das Gespann darf nur Fahrräder und Anhänger derselben Garage benutzen (leere Plätze sind erlaubt) */
  async _pruefeVerweise(garageId, werte) {
    const felder = {};
    for (const [feld, art] of [['fahrrad_id', 'fahrraeder'], ['anhaenger_id', 'anhaenger']]) {
      if (werte[feld] === null || werte[feld] === undefined) continue;
      const [z] = await this.pool.query(`SELECT id FROM \`${ARTEN[art].tabelle}\` WHERE id = ? AND garage_id = ?`, [werte[feld], garageId]);
      if (!z.length) felder[feld] = 'ungueltig';
    }
    if (Object.keys(felder).length) throw new FehlerEingabe('Fahrrad oder Anhänger gehört nicht zu dieser Garage.', 400, { code: 'eingabe', felder });
  }

  /** Speichert das aktuelle Gespann (legt es an oder ersetzt es). Eine Änderung gilt wieder als ungeprüft. */
  async gespannSetzen(garageId, werte) {
    await this._pruefeVerweise(garageId, werte);
    const schluessel = GESPANN_FELDER.map(f => f.key);
    await this.pool.query(
      `INSERT INTO gespanne (garage_id, ${schluessel.map(k => `\`${k}\``).join(', ')}) VALUES (?${', ?'.repeat(schluessel.length)})
       ON DUPLICATE KEY UPDATE ${schluessel.map(k => `\`${k}\` = VALUES(\`${k}\`)`).join(', ')}, status = 'ungeprueft', geprueft_am = NULL`,
      [garageId, ...schluessel.map(k => werte[k])]);
    return (await this.alles(garageId)).gespann;
  }

  async anlegen(garageId, art, werte) {
    const cfg = ARTEN[art];
    const [[z]] = await this.pool.query(`SELECT COUNT(*) AS n FROM \`${cfg.tabelle}\` WHERE garage_id = ?`, [garageId]);
    if (Number(z.n) >= cfg.max) throw new FehlerEingabe(`Mehr als ${cfg.max} Einträge sind nicht möglich.`, 409, { code: 'limit' });

    // Neue Fahrzeuge stehen am Ende der gemeinsamen Reihenfolge
    const [[m]] = await this.pool.query(
      `SELECT GREATEST((SELECT COALESCE(MAX(sortierung), 0) FROM fahrraeder WHERE garage_id = ?), (SELECT COALESCE(MAX(sortierung), 0) FROM anhaenger WHERE garage_id = ?)) AS m`,
      [garageId, garageId]);
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
    const [r] = await this.pool.query(`DELETE FROM \`${ARTEN[art].tabelle}\` WHERE id = ? AND garage_id = ?`, [id, garageId]);
    return r.affectedRows > 0;
  }
}
