// Schema der Datenbank. Jede Migration läuft genau einmal (Tabelle schema_version) und wird danach nie mehr geändert:
// Änderungen kommen als neue Migration ans Ende der Liste. Alle Statements sind wiederholbar (IF NOT EXISTS), falls ein Lauf
// mittendrin abbricht (DDL lässt sich in MySQL nicht zurückrollen).

const TABELLE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';

// Spalten, die jede Art von Eintrag hat. status: ungeprueft/geprueft setzt der Betreiber von Hand im Verwaltungsbereich.
const KOPF = `
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  garage_id INT UNSIGNED NOT NULL`;
const FUSS = `
  status ENUM('ungeprueft','geprueft') NOT NULL DEFAULT 'ungeprueft',
  geprueft_am DATETIME NULL,
  pruefnotiz VARCHAR(500) NULL,
  erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  geaendert_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_garage (garage_id)`;

export const MIGRATIONEN = [
  {
    version: 1,
    beschreibung: 'Garagen, Fahrräder, Anhänger, Gespanne',
    sql: [
      // Der Zugangs-Schlüssel steht nur als SHA-256-Hash in der Datenbank
      `CREATE TABLE IF NOT EXISTS garagen (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        token_hash CHAR(64) NOT NULL,
        erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        zuletzt_genutzt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_token (token_hash)
      ) ${TABELLE}`,

      `CREATE TABLE IF NOT EXISTS fahrraeder (${KOPF},
        \`name\` VARCHAR(80) NOT NULL,
        \`motor_system\` VARCHAR(80) NULL,
        \`motor_art\` VARCHAR(20) NULL,
        \`motor_nennleistung_w\` DECIMAL(8,2) NULL,
        \`motor_drehmoment_nm\` DECIMAL(8,2) NULL,
        \`akku_kapazitaet_wh\` DECIMAL(8,2) NULL,
        \`akku_spannung_v\` DECIMAL(8,2) NULL,
        \`schaltung_art\` VARCHAR(20) NULL,
        \`gaenge\` SMALLINT UNSIGNED NULL,
        \`radgroesse_zoll\` DECIMAL(8,2) NULL,
        \`reifenbreite_mm\` DECIMAL(8,2) NULL,
        \`anzahl_raeder\` TINYINT UNSIGNED NULL,
        \`gewicht_kg\` DECIMAL(8,2) NULL,
        \`zusatzakku_wh\` DECIMAL(8,2) NULL,
        \`zusatzakku_gewicht_kg\` DECIMAL(8,2) NULL,
        \`notiz\` VARCHAR(500) NULL,
        ${FUSS},
        CONSTRAINT fk_fahrrad_garage FOREIGN KEY (garage_id) REFERENCES garagen(id) ON DELETE CASCADE
      ) ${TABELLE}`,

      `CREATE TABLE IF NOT EXISTS anhaenger (${KOPF},
        \`name\` VARCHAR(80) NOT NULL,
        \`aufbau\` VARCHAR(20) NULL,
        \`anzahl_raeder\` TINYINT UNSIGNED NULL,
        \`radgroesse_zoll\` DECIMAL(8,2) NULL,
        \`reifenbreite_mm\` DECIMAL(8,2) NULL,
        \`leergewicht_kg\` DECIMAL(8,2) NULL,
        \`max_zuladung_kg\` DECIMAL(8,2) NULL,
        \`breite_cm\` DECIMAL(8,2) NULL,
        \`hoehe_cm\` DECIMAL(8,2) NULL,
        \`laenge_cm\` DECIMAL(8,2) NULL,
        \`solar_wp\` DECIMAL(8,2) NULL,
        \`zusatzakku_wh\` DECIMAL(8,2) NULL,
        \`zusatzakku_gewicht_kg\` DECIMAL(8,2) NULL,
        \`notiz\` VARCHAR(500) NULL,
        ${FUSS},
        CONSTRAINT fk_anhaenger_garage FOREIGN KEY (garage_id) REFERENCES garagen(id) ON DELETE CASCADE
      ) ${TABELLE}`,

      // Fahrrad und Anhänger lassen sich nicht löschen, solange ein Gespann sie benutzt (RESTRICT)
      `CREATE TABLE IF NOT EXISTS gespanne (${KOPF},
        \`name\` VARCHAR(80) NOT NULL,
        \`fahrrad_id\` INT UNSIGNED NOT NULL,
        \`anhaenger_id\` INT UNSIGNED NOT NULL,
        \`fahrer_gewicht_kg\` DECIMAL(8,2) NULL,
        \`gepaeck_kg\` DECIMAL(8,2) NULL,
        \`notiz\` VARCHAR(500) NULL,
        ${FUSS},
        KEY idx_fahrrad (fahrrad_id),
        KEY idx_anhaenger (anhaenger_id),
        CONSTRAINT fk_gespann_garage FOREIGN KEY (garage_id) REFERENCES garagen(id) ON DELETE CASCADE,
        CONSTRAINT fk_gespann_fahrrad FOREIGN KEY (fahrrad_id) REFERENCES fahrraeder(id) ON DELETE RESTRICT,
        CONSTRAINT fk_gespann_anhaenger FOREIGN KEY (anhaenger_id) REFERENCES anhaenger(id) ON DELETE RESTRICT
      ) ${TABELLE}`
    ]
  }
];

/** Führt alle noch nicht angewendeten Migrationen aus. Eine Sperre in der Datenbank verhindert parallele Läufe. */
export async function migriere(pool, liste = MIGRATIONEN, protokoll = console.log) {
  const verbindung = await pool.getConnection();
  try {
    const [[sperre]] = await verbindung.query("SELECT GET_LOCK('fawowa_garage_migration', 60) AS ok");
    if (sperre.ok !== 1) throw new Error('Die Sperre für die Migration war nicht zu bekommen.');
    try {
      await verbindung.query(`CREATE TABLE IF NOT EXISTS schema_version (
        version INT UNSIGNED NOT NULL PRIMARY KEY,
        angewendet_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ${TABELLE}`);
      const [zeilen] = await verbindung.query('SELECT version FROM schema_version');
      const fertig = new Set(zeilen.map(z => z.version));
      for (const m of liste) {
        if (fertig.has(m.version)) continue;
        for (const statement of m.sql) await verbindung.query(statement);
        await verbindung.query('INSERT INTO schema_version (version) VALUES (?)', [m.version]);
        protokoll(`Datenbank: Migration ${m.version} angewendet (${m.beschreibung})`);
      }
    } finally {
      await verbindung.query("SELECT RELEASE_LOCK('fawowa_garage_migration')");
    }
  } finally {
    verbindung.release();
  }
}
