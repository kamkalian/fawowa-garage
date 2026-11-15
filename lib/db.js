// Verbindung zur MySQL-Datenbank (Pool). Die Zugangsdaten kommen aus der Umgebung (.env).
import mysql from 'mysql2/promise';

export function erstellePool(env = process.env) {
  return mysql.createPool({
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT) || 3306,
    user: env.DB_USER || 'garage',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'garage',
    charset: 'utf8mb4',
    timezone: 'Z',          // alle Zeiten in UTC
    decimalNumbers: true,   // DECIMAL kommt als Zahl, nicht als Text
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 10000
  });
}

/** Wartet, bis die Datenbank antwortet (beim gemeinsamen Start von Docker braucht MySQL einige Sekunden). */
export async function warteAufDatenbank(pool, { versuche = 40, pauseMs = 2000, protokoll = console.log } = {}) {
  let letzter;
  for (let i = 1; i <= versuche; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      letzter = e;
      if (i === 1 || i % 5 === 0) protokoll(`Warte auf die Datenbank (${i}/${versuche}): ${e.code || e.message}`);
      await new Promise(r => setTimeout(r, pauseMs));
    }
  }
  throw new Error(`Die Datenbank ist nicht erreichbar: ${letzter?.code || letzter?.message}`);
}
