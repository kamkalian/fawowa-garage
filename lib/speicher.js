// Datenzugriff auf Garagen und ihre Einträge (MySQL). Spalten- und Tabellennamen kommen ausschließlich aus lib/felder.js
// (feste Liste), Werte immer als Parameter. Die Eingaben sind vorher mit pruefeEingabe() geprüft.
//
// Die Tests nutzen eine Nachbildung mit derselben Schnittstelle (tests/hilfen.js); tests/speicher.integration.test.js
// prüft diese Datei gegen eine echte Datenbank, sobald TEST_DB_HOST gesetzt ist.

import { createHash, randomBytes } from 'crypto';
import { ARTEN } from './felder.js';
import { FehlerEingabe } from './fehler.js';

export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Fehlernummern von MySQL
const ER_ROW_IS_REFERENCED = 1451;
const ER_NO_REFERENCED_ROW = 1452;

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
  async garageAnlegen() {
    const token = randomBytes(32).toString('base64url'); // 43 Zeichen
    const [r] = await this.pool.query('INSERT INTO garagen (token_hash) VALUES (?)', [hashToken(token)]);
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

  /** Löscht die Garage mit allen Einträgen. Gespanne zuerst, weil sie Fahrräder und Anhänger festhalten. */
  async garageLoeschen(garageId) {
    const v = await this.pool.getConnection();
    try {
      await v.beginTransaction();
      await v.query('DELETE FROM gespanne WHERE garage_id = ?', [garageId]);
      await v.query('DELETE FROM garagen WHERE id = ?', [garageId]); // Fahrräder und Anhänger folgen per CASCADE
      await v.commit();
    } catch (e) {
      await v.rollback();
      throw e;
    } finally {
      v.release();
    }
  }

  _spalten(art) {
    return ARTEN[art].felder.map(f => `\`${f.key}\``).join(', ');
  }

  async _liste(garageId, art) {
    const [zeilen] = await this.pool.query(
      `SELECT id, ${this._spalten(art)}, status, erstellt_am, geaendert_am FROM \`${ARTEN[art].tabelle}\` WHERE garage_id = ? ORDER BY id`,
      [garageId]);
    return zeilen;
  }

  async _eintrag(garageId, art, id) {
    const [zeilen] = await this.pool.query(
      `SELECT id, ${this._spalten(art)}, status, erstellt_am, geaendert_am FROM \`${ARTEN[art].tabelle}\` WHERE garage_id = ? AND id = ?`,
      [garageId, id]);
    return zeilen[0] ?? null;
  }

  /** Alle Einträge einer Garage */
  async alles(garageId) {
    const [fahrraeder, anhaenger, gespanne] = await Promise.all([
      this._liste(garageId, 'fahrraeder'), this._liste(garageId, 'anhaenger'), this._liste(garageId, 'gespanne')
    ]);
    return { fahrraeder, anhaenger, gespanne };
  }

  /** Ein Gespann darf nur Fahrräder und Anhänger derselben Garage benutzen */
  async _pruefeVerweise(garageId, werte) {
    const felder = {};
    for (const [feld, art] of [['fahrrad_id', 'fahrraeder'], ['anhaenger_id', 'anhaenger']]) {
      const [z] = await this.pool.query(`SELECT id FROM \`${ARTEN[art].tabelle}\` WHERE id = ? AND garage_id = ?`, [werte[feld], garageId]);
      if (!z.length) felder[feld] = 'ungueltig';
    }
    if (Object.keys(felder).length) throw new FehlerEingabe('Fahrrad oder Anhänger gehört nicht zu dieser Garage.', 400, { code: 'eingabe', felder });
  }

  async anlegen(garageId, art, werte) {
    const cfg = ARTEN[art];
    const [[z]] = await this.pool.query(`SELECT COUNT(*) AS n FROM \`${cfg.tabelle}\` WHERE garage_id = ?`, [garageId]);
    if (Number(z.n) >= cfg.max) throw new FehlerEingabe(`Mehr als ${cfg.max} Einträge sind nicht möglich.`, 409, { code: 'limit' });
    if (art === 'gespanne') await this._pruefeVerweise(garageId, werte);

    const schluessel = cfg.felder.map(f => f.key);
    const [r] = await this.pool.query(
      `INSERT INTO \`${cfg.tabelle}\` (garage_id, ${schluessel.map(k => `\`${k}\``).join(', ')}) VALUES (?${', ?'.repeat(schluessel.length)})`,
      [garageId, ...schluessel.map(k => werte[k])]);
    return this._eintrag(garageId, art, r.insertId);
  }

  /** Ändert einen Eintrag. Ein geänderter Eintrag gilt wieder als ungeprüft. Ergebnis: der Eintrag oder null, wenn es ihn nicht gibt. */
  async aendern(garageId, art, id, werte) {
    const cfg = ARTEN[art];
    if (!(await this._eintrag(garageId, art, id))) return null;
    if (art === 'gespanne') await this._pruefeVerweise(garageId, werte);

    const schluessel = cfg.felder.map(f => f.key);
    await this.pool.query(
      `UPDATE \`${cfg.tabelle}\` SET ${schluessel.map(k => `\`${k}\` = ?`).join(', ')}, status = 'ungeprueft', geprueft_am = NULL WHERE id = ? AND garage_id = ?`,
      [...schluessel.map(k => werte[k]), id, garageId]);
    return this._eintrag(garageId, art, id);
  }

  /** Ergebnis: true (gelöscht), false (gibt es nicht); wirft FehlerEingabe 'verwendet', wenn ein Gespann den Eintrag benutzt */
  async loeschen(garageId, art, id) {
    try {
      const [r] = await this.pool.query(`DELETE FROM \`${ARTEN[art].tabelle}\` WHERE id = ? AND garage_id = ?`, [id, garageId]);
      return r.affectedRows > 0;
    } catch (e) {
      if (e?.errno === ER_ROW_IS_REFERENCED) {
        throw new FehlerEingabe('Der Eintrag wird noch von einem Gespann benutzt.', 409, { code: 'verwendet' });
      }
      if (e?.errno === ER_NO_REFERENCED_ROW) throw new FehlerEingabe('Ungültiger Verweis.', 400, { code: 'eingabe' });
      throw e;
    }
  }
}
