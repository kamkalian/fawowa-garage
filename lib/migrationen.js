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
  },
  {
    version: 2,
    beschreibung: 'Ein aktuelles Gespann je Garage mit leeren Plätzen',
    sql: [
      // Es gibt genau ein Gespann je Garage (überzählige alte Gespanne fallen weg, das mit der kleinsten Nummer bleibt)
      `DELETE g1 FROM gespanne g1 JOIN gespanne g2 ON g1.garage_id = g2.garage_id AND g1.id > g2.id`,
      `ALTER TABLE gespanne DROP FOREIGN KEY fk_gespann_fahrrad`,
      `ALTER TABLE gespanne DROP FOREIGN KEY fk_gespann_anhaenger`,
      `ALTER TABLE gespanne
         MODIFY \`name\` VARCHAR(80) NULL,
         MODIFY \`fahrrad_id\` INT UNSIGNED NULL,
         MODIFY \`anhaenger_id\` INT UNSIGNED NULL,
         ADD UNIQUE KEY uq_garage (garage_id)`,
      // Wird ein Fahrrad oder Anhänger gelöscht, wird sein Platz im Gespann leer
      `ALTER TABLE gespanne
         ADD CONSTRAINT fk_gespann_fahrrad FOREIGN KEY (fahrrad_id) REFERENCES fahrraeder(id) ON DELETE SET NULL,
         ADD CONSTRAINT fk_gespann_anhaenger FOREIGN KEY (anhaenger_id) REFERENCES anhaenger(id) ON DELETE SET NULL`
    ]
  },
  {
    version: 3,
    beschreibung: 'Reihenfolge der Fahrzeuge (Fahrräder und Anhänger gemeinsam)',
    sql: [
      // Fahrräder und Anhänger stehen in einer gemeinsamen Reihenfolge je Garage; bestehende Einträge behalten ihre Anlegereihenfolge
      `ALTER TABLE fahrraeder ADD COLUMN \`sortierung\` INT UNSIGNED NOT NULL DEFAULT 0 AFTER garage_id`,
      `ALTER TABLE anhaenger ADD COLUMN \`sortierung\` INT UNSIGNED NOT NULL DEFAULT 0 AFTER garage_id`,
      `UPDATE fahrraeder SET \`sortierung\` = id`,
      `UPDATE anhaenger SET \`sortierung\` = id`
    ]
  },
  {
    version: 4,
    beschreibung: 'Name der Fahrerin oder des Fahrers',
    // NULL für Garagen, die vor dieser Änderung angelegt wurden; die Oberfläche zeigt dann „Fahrer“ und lässt den Namen nachtragen
    sql: [`ALTER TABLE garagen ADD COLUMN \`fahrer_name\` VARCHAR(40) NULL AFTER token_hash`]
  },
  {
    version: 5,
    beschreibung: 'E-Mail-Adresse (bestätigt) und einmalige Links per E-Mail',
    sql: [
      // email gilt erst nach der Bestätigung und gehört höchstens einer Garage
      `ALTER TABLE garagen
         ADD COLUMN \`email\` VARCHAR(254) NULL AFTER fahrer_name,
         ADD COLUMN \`email_bestaetigt_am\` DATETIME NULL AFTER email,
         ADD UNIQUE KEY uq_email (email)`,
      // Einmalige Links: 'email' bestätigt eine Adresse (24 Stunden), 'zugang' gibt nach einer Anforderung einen neuen Zugangslink (1 Stunde).
      // Wie der Zugangsschlüssel stehen sie nur als Hash in der Datenbank.
      `CREATE TABLE IF NOT EXISTS garage_tokens (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        garage_id INT UNSIGNED NOT NULL,
        art ENUM('email','zugang') NOT NULL,
        token_hash CHAR(64) NOT NULL,
        email VARCHAR(254) NOT NULL,
        gueltig_bis DATETIME NOT NULL,
        erstellt_am DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_token (token_hash),
        KEY idx_garage_art (garage_id, art),
        CONSTRAINT fk_token_garage FOREIGN KEY (garage_id) REFERENCES garagen(id) ON DELETE CASCADE
      ) ${TABELLE}`
    ]
  },
  {
    version: 6,
    beschreibung: 'Gespann aus mehreren Zugfahrzeugen und Anhängern (Mitglieder je Stellplatz)',
    sql: [
      `CREATE TABLE IF NOT EXISTS gespann_mitglieder (
        garage_id INT UNSIGNED NOT NULL,
        art ENUM('fahrraeder','anhaenger') NOT NULL,
        eintrag_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (garage_id, art, eintrag_id),
        CONSTRAINT fk_mitglied_garage FOREIGN KEY (garage_id) REFERENCES garagen(id) ON DELETE CASCADE
      ) ${TABELLE}`,
      // Bisheriges Gespann (ein Fahrrad, ein Anhänger) wird zu Mitgliedern
      `INSERT IGNORE INTO gespann_mitglieder (garage_id, art, eintrag_id) SELECT garage_id, 'fahrraeder', fahrrad_id FROM gespanne WHERE fahrrad_id IS NOT NULL`,
      `INSERT IGNORE INTO gespann_mitglieder (garage_id, art, eintrag_id) SELECT garage_id, 'anhaenger', anhaenger_id FROM gespanne WHERE anhaenger_id IS NOT NULL`
    ]  },
  {
    version: 7,
    beschreibung: 'Bauart der Fahrräder; Anhänger-Aufbau mit neuen Werten',
    sql: [
      'ALTER TABLE fahrraeder ADD COLUMN `bauart` VARCHAR(30) NULL AFTER garage_id',
      "UPDATE anhaenger SET aufbau = 'wohnkabine' WHERE aufbau = 'wohnwagen'",
      "UPDATE anhaenger SET aufbau = 'sonstiges' WHERE aufbau = 'kinderanhaenger'"
    ]
  },
  {
    version: 8,
    beschreibung: 'Foto je Fahrrad und Anhänger (Dateiname auf dem Server)',
    sql: [
      'ALTER TABLE fahrraeder ADD COLUMN `foto_datei` VARCHAR(40) NULL',
      'ALTER TABLE anhaenger ADD COLUMN `foto_datei` VARCHAR(40) NULL'
    ]
  },
  {
    version: 9,
    beschreibung: 'Mehrere Motoren und Akkus je Fahrrad und Anhänger (Tabelle antriebe); bisherige Werte werden übernommen',
    sql: [
      'CREATE TABLE IF NOT EXISTS antriebe (' +
        'id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, ' +
        'garage_id INT UNSIGNED NOT NULL, ' +
        "art ENUM('fahrraeder','anhaenger') NOT NULL, " +
        'eintrag_id INT UNSIGNED NOT NULL, ' +
        "typ ENUM('motor','akku') NOT NULL, " +
        'motor_art VARCHAR(20) NULL, ' +
        'wert INT UNSIGNED NOT NULL, ' +
        'sortierung INT UNSIGNED NOT NULL DEFAULT 0, ' +
        'KEY idx_eintrag (garage_id, art, eintrag_id), ' +
        'CONSTRAINT fk_antrieb_garage FOREIGN KEY (garage_id) REFERENCES garagen(id) ON DELETE CASCADE' +
        ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci',
      "INSERT INTO antriebe (garage_id, art, eintrag_id, typ, motor_art, wert, sortierung) SELECT garage_id, 'fahrraeder', id, 'motor', motor_art, ROUND(motor_nennleistung_w), 1 FROM fahrraeder WHERE motor_art IS NOT NULL AND motor_art <> 'ohne' AND motor_nennleistung_w > 0",
      "INSERT INTO antriebe (garage_id, art, eintrag_id, typ, motor_art, wert, sortierung) SELECT garage_id, 'fahrraeder', id, 'akku', NULL, ROUND(akku_kapazitaet_wh), 1 FROM fahrraeder WHERE akku_kapazitaet_wh > 0",
      "INSERT INTO antriebe (garage_id, art, eintrag_id, typ, motor_art, wert, sortierung) SELECT garage_id, 'fahrraeder', id, 'akku', NULL, ROUND(zusatzakku_wh), 2 FROM fahrraeder WHERE zusatzakku_wh > 0",
      "INSERT INTO antriebe (garage_id, art, eintrag_id, typ, motor_art, wert, sortierung) SELECT garage_id, 'anhaenger', id, 'akku', NULL, ROUND(zusatzakku_wh), 1 FROM anhaenger WHERE zusatzakku_wh > 0"
    ]
  },
  {
    version: 10,
    beschreibung: 'Spannung (Volt) je Motor und Akku; Getriebe oder Direktläufer je Motor',
    sql: [
      'ALTER TABLE antriebe ADD COLUMN spannung_v SMALLINT UNSIGNED NULL AFTER wert, ADD COLUMN getriebe VARCHAR(12) NULL AFTER spannung_v'
    ]
  },
  {
    version: 11,
    beschreibung: 'Gepäck als eigene Kachel (Tabelle gepaecke), dem Gespann zuordenbar; bisherige Zuladung wird übernommen',
    sql: [
      `CREATE TABLE IF NOT EXISTS gepaecke (${KOPF},
        \`name\` VARCHAR(80) NOT NULL,
        \`gewicht_kg\` DECIMAL(8,2) NULL,
        \`notiz\` VARCHAR(500) NULL,
        ${FUSS},
        CONSTRAINT fk_gepaeck_garage FOREIGN KEY (garage_id) REFERENCES garagen(id) ON DELETE CASCADE
      ) ${TABELLE}`,
      "ALTER TABLE gespann_mitglieder MODIFY art ENUM('fahrraeder','anhaenger','gepaecke') NOT NULL",
      "INSERT INTO gepaecke (garage_id, sortierung, name, gewicht_kg) SELECT garage_id, 1, 'Gepäck', gepaeck_kg FROM gespanne WHERE gepaeck_kg > 0",
      "INSERT IGNORE INTO gespann_mitglieder (garage_id, art, eintrag_id) SELECT p.garage_id, 'gepaecke', p.id FROM gepaecke p WHERE p.name = 'Gepäck' AND p.garage_id IN (SELECT garage_id FROM gespanne WHERE gepaeck_kg > 0)"
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
