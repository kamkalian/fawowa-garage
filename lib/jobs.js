// Job-Warteschlange: Einspielen von Paketen und Reichweiten-Berechnung (Karten und Wegenetz baut das Daten-Werkzeug). Die Jobs stehen in der
// Datenbank; der Worker (lib/worker.js) arbeitet sie nacheinander ab. Jede Reichweiten-Berechnung einer Garage ersetzt die
// vorherige: wartende Jobs derselben Garage werden gelöscht, bevor der neue Job ans Ende kommt.

export const JOB_ARTEN = ['entpacken', 'reichweite', 'paket_einspielen'];
const SCHRITT = 1000;

export class Jobs {
  constructor(pool) {
    this.pool = pool;
  }

  /** Ans Ende der Warteschlange hängen; liefert die Job-ID */
  async anlegen(art, { parameter = null, garageId = null } = {}) {
    if (!JOB_ARTEN.includes(art)) throw new Error(`Unbekannte Jobart: ${art}`);
    const [[m]] = await this.pool.query("SELECT COALESCE(MAX(position), 0) + ? AS p FROM jobs WHERE status = 'wartet'", [SCHRITT]);
    const [r] = await this.pool.query(
      "INSERT INTO jobs (art, position, status, garage_id, parameter) VALUES (?, ?, 'wartet', ?, ?)",
      [art, Number(m.p), garageId, parameter === null ? null : JSON.stringify(parameter)]);
    return r.insertId;
  }

  /** Reichweiten-Berechnung für eine Garage: alte wartende Jobs dieser Garage werden entfernt, der neue hängt am Ende */
  async reichweiteAnlegen(garageId, eingabe) {
    const v = await this.pool.getConnection();
    try {
      await v.beginTransaction();
      await v.query("DELETE FROM jobs WHERE garage_id = ? AND status = 'wartet'", [garageId]);
      const [[m]] = await v.query("SELECT COALESCE(MAX(position), 0) + ? AS p FROM jobs WHERE status = 'wartet'", [SCHRITT]);
      const [r] = await v.query(
        "INSERT INTO jobs (art, position, status, garage_id, parameter) VALUES ('reichweite', ?, 'wartet', ?, ?)",
        [Number(m.p), garageId, JSON.stringify(eingabe)]);
      await v.query('INSERT INTO reichweiten (garage_id, job_id, eingabe, ergebnis) VALUES (?, ?, ?, NULL) ON DUPLICATE KEY UPDATE job_id = VALUES(job_id), eingabe = VALUES(eingabe), ergebnis = NULL, routen = NULL, erstellt_am = CURRENT_TIMESTAMP',
        [garageId, r.insertId, JSON.stringify(eingabe)]);
      await v.commit();
      return r.insertId;
    } catch (e) {
      await v.rollback();
      throw e;
    } finally {
      v.release();
    }
  }

  /** Nächster wartender Job (kleinste Position) */
  async naechster() {
    const [zeilen] = await this.pool.query("SELECT * FROM jobs WHERE status = 'wartet' ORDER BY position, id LIMIT 1");
    return zeilen[0] ?? null;
  }

  async setze(id, felder) {
    const schluessel = Object.keys(felder);
    if (!schluessel.length) return;
    await this.pool.query(`UPDATE jobs SET ${schluessel.map(k => `\`${k}\` = ?`).join(', ')} WHERE id = ?`, [...schluessel.map(k => felder[k]), id]);
  }

  /** Liste für die Verwaltung: neueste Aufträge zuerst (absteigend nach Nummer), die letzten 60 */
  async liste() {
    const [zeilen] = await this.pool.query(
      `SELECT id, art, position, status, garage_id, fortschritt, gesamt, erledigt, meldung, erstellt_am, begonnen_am, beendet_am
       FROM jobs ORDER BY id DESC LIMIT 60`);
    return zeilen;
  }

  /** Letzter erfolgreicher Abschluss je Auftragsart: { download: Date, karte: Date, ... } */
  async letzteZeiten() {
    const [zeilen] = await this.pool.query("SELECT art, MAX(beendet_am) AS zeit FROM jobs WHERE status = 'fertig' GROUP BY art");
    return Object.fromEntries(zeilen.map(z => [z.art, z.zeit ? new Date(z.zeit) : null]));
  }

  /** Wartender Job löschen; laufende und erledigte bleiben */
  async loeschen(id) {
    const [r] = await this.pool.query("DELETE FROM jobs WHERE id = ? AND status = 'wartet'", [id]);
    return r.affectedRows > 0;
  }

  /** Wartenden Job um eine Stelle nach oben (-1) oder unten (+1) verschieben: Positionen werden mit dem Nachbarn getauscht */
  async verschieben(id, richtung) {
    const v = await this.pool.getConnection();
    try {
      await v.beginTransaction();
      const [[job]] = await v.query("SELECT id, position FROM jobs WHERE id = ? AND status = 'wartet' FOR UPDATE", [id]);
      if (!job) { await v.rollback(); return false; }
      const sql = richtung < 0
        ? "SELECT id, position FROM jobs WHERE status = 'wartet' AND (position < ? OR (position = ? AND id < ?)) ORDER BY position DESC, id DESC LIMIT 1"
        : "SELECT id, position FROM jobs WHERE status = 'wartet' AND (position > ? OR (position = ? AND id > ?)) ORDER BY position, id LIMIT 1";
      const [[nachbar]] = await v.query(sql, [job.position, job.position, job.id]);
      if (!nachbar) { await v.rollback(); return false; }
      await v.query('UPDATE jobs SET position = ? WHERE id = ?', [nachbar.position, job.id]);
      await v.query('UPDATE jobs SET position = ? WHERE id = ?', [job.position, nachbar.id]);
      await v.commit();
      return true;
    } catch (e) {
      await v.rollback();
      throw e;
    } finally {
      v.release();
    }
  }

  /** Stand für eine Garage: eigener Job und wie viele Jobs davor liegen */
  async standFuerGarage(garageId) {
    const [[job]] = await this.pool.query(
      "SELECT id, status, position FROM jobs WHERE garage_id = ? AND art = 'reichweite' AND status IN ('wartet', 'laeuft') ORDER BY id DESC LIMIT 1", [garageId]);
    if (!job) return null;
    if (job.status === 'laeuft') return { status: 'laeuft', davor: 0, anzahl: 1 };
    const [[z]] = await this.pool.query("SELECT COUNT(*) AS n FROM jobs WHERE status = 'wartet' AND (position < ? OR (position = ? AND id < ?))", [job.position, job.position, job.id]);
    const [[l]] = await this.pool.query("SELECT COUNT(*) AS n FROM jobs WHERE status = 'laeuft'");
    return { status: 'wartet', davor: Number(z.n) + Number(l.n), anzahl: null };
  }

  /** Ergebnis der letzten Reichweiten-Berechnung einer Garage, mit Stand der Warteschlange */
  /** Routen und 1-km-Punkte der letzten Reichweiten-Berechnung (null, wenn es keine gibt) */
  async reichweiteRouten(garageId) {
    const [[zeile]] = await this.pool.query('SELECT routen FROM reichweiten WHERE garage_id = ?', [garageId]);
    return zeile?.routen ? JSON.parse(zeile.routen) : null;
  }

  async reichweiteLesen(garageId) {
    const [[zeile]] = await this.pool.query('SELECT job_id, ergebnis FROM reichweiten WHERE garage_id = ?', [garageId]);
    const stand = await this.standFuerGarage(garageId);
    const [[job]] = await this.pool.query("SELECT status, meldung, fortschritt FROM jobs WHERE garage_id = ? AND art = 'reichweite' ORDER BY id DESC LIMIT 1", [garageId]);
    // Zeitpunkt des Ergebnisses: Ende des Jobs, zu dem es gehört
    const [[lauf]] = zeile?.job_id ? await this.pool.query('SELECT beendet_am FROM jobs WHERE id = ?', [zeile.job_id]) : [[]];
    return {
      status: stand?.status ?? job?.status ?? (zeile?.ergebnis ? 'fertig' : null),
      davor: stand?.davor ?? 0,
      meldung: job?.status === 'fehler' ? job.meldung : null,
      // Während der Berechnung: Phase (Meldung) und Fortschritt in Prozent
      phase: job?.status === 'laeuft' ? job.meldung ?? null : null,
      fortschritt: job?.status === 'laeuft' ? job.fortschritt ?? 0 : null,
      ergebnis: zeile?.ergebnis ? JSON.parse(zeile.ergebnis) : null,
      zeitpunkt: zeile?.ergebnis ? (lauf?.beendet_am ?? null) : null
    };
  }

  /**
   * Einspielen eines Pakets (Ordnername) anlegen. Der Wächter (automatisch) legt keinen neuen Auftrag an, wenn der letzte für diesen
   * Ordner wartet, läuft oder fehlgeschlagen ist. Von Hand (nach Fehler erneut) zählt nur, ob er wartet oder läuft.
   * Liefert die Job-ID oder null, wenn nichts angelegt wurde.
   */
  async paketAnlegen(ordner, { auto = false } = {}) {
    const [[z]] = await this.pool.query(
      "SELECT status FROM jobs WHERE art = 'paket_einspielen' AND JSON_UNQUOTE(JSON_EXTRACT(parameter, '$.ordner')) = ? ORDER BY id DESC LIMIT 1", [ordner]);
    const sperren = auto ? ['wartet', 'laeuft', 'fehler'] : ['wartet', 'laeuft'];
    if (z && sperren.includes(z.status)) return null;
    return this.anlegen('paket_einspielen', { parameter: { ordner } });
  }

  /** Ob ein Job dieser Art noch wartet oder läuft */
  async artAktiv(art) {
    const [[z]] = await this.pool.query("SELECT COUNT(*) AS n FROM jobs WHERE art = ? AND status IN ('wartet', 'laeuft')", [art]);
    return Number(z.n) > 0;
  }

  /** Nach einem Neustart des Workers: Jobs, die er nicht mehr zu Ende führen konnte, werden als fehlgeschlagen markiert */
  async unterbrochenMarkieren() {
    await this.pool.query("UPDATE jobs SET status = 'fehler', meldung = 'Durch einen Neustart unterbrochen', beendet_am = CURRENT_TIMESTAMP WHERE status = 'laeuft'");
  }
}
