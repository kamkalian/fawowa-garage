import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { erstellePool, warteAufDatenbank } from './lib/db.js';
import { migriere } from './lib/migrationen.js';
import { Speicher } from './lib/speicher.js';
import { erstelleApp } from './lib/app.js';
import { erstelleMailer, oeffentlicheUrl } from './lib/mail.js';
import { Jobs } from './lib/jobs.js';
import { planerLader } from './lib/planer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Umgebungsvariablen aus .env laden. Bestehende Variablen bleiben unverändert.
const ENV_PATH = join(__dirname, '.env');
if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH);

const PORT = process.env.PORT || 3470;
const PRODUCTION = process.env.NODE_ENV === 'production';

const pool = erstellePool();
try {
  await warteAufDatenbank(pool);
  await migriere(pool);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const mailer = erstelleMailer();
const url = oeffentlicheUrl();
if (mailer && !url) console.warn('SMTP ist eingerichtet, aber PUBLIC_URL fehlt oder ist ungültig: die E-Mail-Funktionen bleiben abgeschaltet.');
console.log(mailer && url ? 'E-Mail: eingerichtet' : 'E-Mail: nicht eingerichtet (SMTP_HOST, MAIL_FROM und PUBLIC_URL in der .env setzen)');

// Reichweiten-Planer: der Webdienst liest nur die kleinen Angaben zum Wegenetz (NETZ_DIR); gerechnet wird im Garage-Worker (lib/worker.js)
// Wird bei jeder Anfrage geprüft: ein neuer Netzbau gilt ohne Neustart
const planer = planerLader(process.env.NETZ_DIR);
console.log(planer() ? `Reichweiten-Planer: eingerichtet (${process.env.NETZ_DIR})` : 'Reichweiten-Planer: noch nicht eingerichtet (kein Wegenetz in NETZ_DIR)');

const app = erstelleApp(new Speicher(pool), { produktion: PRODUCTION, oberflaeche: join(__dirname, 'dist'), mailer, url, planer, jobs: new Jobs(pool) });

const server = app.listen(PORT, () => {
  console.log(`FaWoWa-Garage läuft auf http://localhost:${PORT}${process.env.TESTINSTANZ ? ' (Testinstanz)' : ''}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} ist schon belegt. Läuft noch eine ältere Instanz?`);
  else console.error(err);
  process.exit(1);
});

// Sauber beenden (docker stop sendet SIGTERM; ohne Handler würde Node als Hauptprozess erst nach 10 Sekunden beendet)
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
