// Startet die Anwendung ohne MySQL mit einer Nachbildung im Arbeitsspeicher (Daten sind nach dem Beenden weg).
// Nur für die Entwicklung der Oberfläche: npm run dev:fake  (und in einem zweiten Terminal: npm run dev:web)
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { FakeSpeicher } from '../tests/hilfen.js';
import { erstelleApp } from '../lib/app.js';
import { Begrenzung } from '../lib/begrenzung.js';
import { hashPasswort } from '../lib/auth.js';
import { RoutingDienst } from '../lib/routing-dienst.js';

const PORT = process.env.PORT || 3470;
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
// Mit NETZ_DIR (Wegenetz vom Daten-Werkzeug) ist auch der Reichweiten-Planer aktiv
let routing = null;
if (process.env.NETZ_DIR) { routing = new RoutingDienst({ ordner: process.env.NETZ_DIR }); await routing.starten(); console.log('Routing geladen:', routing.info); }

// Mit NODE_ENV=production liefert dieser Server die gebaute Oberfläche (npm run build) selbst aus
const app = erstelleApp(new FakeSpeicher(), {
  produktion: process.env.NODE_ENV === 'production', oberflaeche: dist, routing,
  // E-Mails werden nicht gesendet, sondern mit ihrem Link in der Konsole ausgegeben
  mailer: { senden: async (n) => console.log(`
--- E-Mail an ${n.an}: ${n.betreff}
${n.text}
---`) },
  url: `http://localhost:${PORT}`,
  // Verwaltungsbereich unter /wunderkammer mit dem Passwort "dev-admin-passwort" (nur für diese Entwicklungs-Nachbildung)
  env: { TESTINSTANZ: '1', MAIN_SITE_URL: process.env.MAIN_SITE_URL ?? '', ADMIN_PASSWORD_HASH: hashPasswort('dev-admin-passwort') },
  begrenzungen: { neu: new Begrenzung({ max: 1000 }), falsch: new Begrenzung({ max: 1000 }) }
});
app.listen(PORT, '127.0.0.1', () => console.log(`Garage ohne Datenbank auf http://localhost:${PORT} (Oberfläche: npm run dev:web)`));
