// Datenzugriff auf Garagen und ihre Einträge (MySQL). Spalten- und Tabellennamen kommen ausschließlich aus lib/felder.js
// (feste Liste), Werte immer als Parameter. Die Eingaben sind vorher mit pruefeEingabe() geprüft.
//
// Die Tests nutzen eine Nachbildung mit derselben Schnittstelle (tests/hilfen.js); tests/speicher.integration.test.js
// prüft diese Datei gegen eine echte Datenbank, sobald TEST_DB_HOST gesetzt ist.

import { createHash, randomBytes } from 'crypto';
import { ARTEN, GESPANN_FELDER } from './felder.js';
import { FehlerEingabe } from './fehler.js';

export const TOKEN_MUSTER = /^[A-Za-z0-9_-]{43}$/;

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

  /** Löscht die Garage mit allen Einträgen (Fahrräder, Anhänger und Gespann folgen per CASCADE). */
  async garageLoeschen(garageId) {
    await this.pool.query('DELETE FROM garagen WHERE id = ?', [garageId]);
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

  /** Alle Einträge einer Garage; gespann ist das aktuelle Gespann oder null, solange noch keins gespeichert wurde */
  async alles(garageId) {
    const [fahrraeder, anhaenger, [gespann]] = await Promise.all([
      this._liste(garageId, 'fahrraeder'), this._liste(garageId, 'anhaenger'),
      this.pool.query(
        `SELECT id, ${GESPANN_FELDER.map(f => `\`${f.key}\``).join(', ')}, status, geaendert_am FROM gespanne WHERE garage_id = ?`, [garageId]).then(r => r[0])
    ]);
    return { fahrraeder, anhaenger, gespann: gespann ?? null };
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

    const schluessel = cfg.felder.map(f => f.key);
    await this.pool.query(
      `UPDATE \`${cfg.tabelle}\` SET ${schluessel.map(k => `\`${k}\` = ?`).join(', ')}, status = 'ungeprueft', geprueft_am = NULL WHERE id = ? AND garage_id = ?`,
      [...schluessel.map(k => werte[k]), id, garageId]);
    return this._eintrag(garageId, art, id);
  }

  /** Ergebnis: true (gelöscht) oder false (gibt es nicht). Ein Platz im Gespann, der den Eintrag benutzte, wird leer. */
  async loeschen(garageId, art, id) {
    const [r] = await this.pool.query(`DELETE FROM \`${ARTEN[art].tabelle}\` WHERE id = ? AND garage_id = ?`, [id, garageId]);
    return r.affectedRows > 0;
  }
}
