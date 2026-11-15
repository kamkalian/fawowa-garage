// Die Express-Anwendung: Sicherheits-Header, öffentliche API und (im Betrieb) die gebaute Oberfläche.
// Der Datenzugriff (speicher) wird übergeben, damit die Tests eine Nachbildung einsetzen können.

import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ARTEN, ART_NAMEN, GESPANN_FELDER, FAHRER_NAME_FELD, pruefeEingabe } from './felder.js';
import { FehlerEingabe } from './fehler.js';
import { Begrenzung } from './begrenzung.js';
import { sicherheitsHeader, fehlerAntwort } from './sicherheit.js';

const httpsAdresse = (v) => {
  const s = String(v ?? '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) && s.length <= 300 ? s : null;
};

const asynchron = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ID = /^[1-9]\d{0,9}$/;

/**
 * speicher: siehe lib/speicher.js
 * optionen: { env, produktion, oberflaeche (Ordner mit der gebauten Oberfläche, nur im Betrieb), begrenzungen }
 */
export function erstelleApp(speicher, { env = process.env, produktion = false, oberflaeche = null, begrenzungen = {} } = {}) {
  const testinstanz = ['1', 'true', 'ja'].includes(String(env.TESTINSTANZ ?? '').trim().toLowerCase());
  const maxGaragen = Number(env.MAX_GARAGEN) > 0 ? Number(env.MAX_GARAGEN) : 5000;

  // Neue Garagen je Adresse und Stunde; falsche Schlüssel je Adresse und Stunde (die Schlüssel sind 256 Bit lang, das hält nur Probierer auf)
  const neuLimit = begrenzungen.neu ?? new Begrenzung({ max: 5, fensterMs: 60 * 60 * 1000 });
  const falschLimit = begrenzungen.falsch ?? new Begrenzung({ max: 60, fensterMs: 60 * 60 * 1000 });

  const app = express();
  // Hinter Caddy: die Adresse des Besuchers kommt aus X-Forwarded-For (nur die erste Station wird vertraut).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(sicherheitsHeader({ testinstanz }));
  app.use(express.json({ limit: '20kb' }));

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(testinstanz ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nDisallow: /api/\n');
  });

  // Gesundheitsprüfung für die Hauptseite und den Docker-Healthcheck: nur gesund, wenn auch die Datenbank antwortet
  app.get('/api/health', asynchron(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await speicher.ping();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  }));

  app.get('/api/v1/einstellungen', (req, res) => {
    const powered = String(env.POWERED_BY ?? '').trim().slice(0, 80);
    res.json({
      testinstanz,
      hauptseiteUrl: httpsAdresse(env.MAIN_SITE_URL),
      poweredBy: powered ? { name: powered, url: httpsAdresse(env.POWERED_BY_URL) } : null,
      grenzen: Object.fromEntries(ART_NAMEN.map(a => [a, ARTEN[a].max]))
    });
  });

  // --- Garage anlegen (ohne Schlüssel) ---
  const fahrerName = (body) => {
    const { werte, fehler } = pruefeEingabe([FAHRER_NAME_FELD], body);
    if (fehler) throw new FehlerEingabe('Bitte den Namen angeben.', 400, { code: 'eingabe', felder: fehler });
    return werte.fahrer_name;
  };

  app.post('/api/v1/garagen', asynchron(async (req, res) => {
    const name = fahrerName(req.body);
    if (!neuLimit.erlaubt(req.ip)) throw new FehlerEingabe('Zu viele neue Garagen von dieser Adresse. Bitte später erneut versuchen.', 429, { code: 'zu_viele' });
    if (await speicher.anzahlGaragen() >= maxGaragen) throw new FehlerEingabe('Es können gerade keine neuen Garagen angelegt werden.', 503, { code: 'voll' });
    neuLimit.zaehle(req.ip);
    const { token } = await speicher.garageAnlegen(name);
    res.status(201).json({ token });
  }));

  // --- Alles Weitere gehört zu einer Garage: Schlüssel im Header "Authorization: Bearer <schlüssel>" ---
  // (nicht in der Adresse, damit er in keinem Protokoll landet)
  const garage = asynchron(async (req, res, next) => {
    if (!falschLimit.erlaubt(req.ip)) throw new FehlerEingabe('Zu viele Versuche. Bitte später erneut versuchen.', 429, { code: 'zu_viele' });
    const m = /^Bearer (\S+)$/.exec(req.get('authorization') ?? '');
    const g = m ? await speicher.garageFinden(m[1]) : null;
    if (!g) {
      falschLimit.zaehle(req.ip);
      throw new FehlerEingabe('Der Link ist ungültig.', 401, { code: 'link_ungueltig' });
    }
    req.garageId = g.id;
    next();
  });

  const artPruefen = (req, res, next) => (ART_NAMEN.includes(req.params.art) ? next() : res.status(404).json({ error: 'Not found' }));
  const idPruefen = (req, res, next) => (ID.test(req.params.id) ? next() : res.status(404).json({ error: 'Not found' }));

  app.get('/api/v1/garage', garage, asynchron(async (req, res) => {
    res.json(await speicher.alles(req.garageId));
  }));

  app.delete('/api/v1/garage', garage, asynchron(async (req, res) => {
    await speicher.garageLoeschen(req.garageId);
    res.status(204).end();
  }));

  const eingabe = (art, body) => {
    const { werte, fehler } = pruefeEingabe(ARTEN[art].felder, body);
    if (fehler) throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe', felder: fehler });
    return werte;
  };

  // Name der Fahrerin oder des Fahrers ändern
  app.put('/api/v1/garage/fahrer', garage, asynchron(async (req, res) => {
    res.json({ fahrer_name: await speicher.fahrerNameSetzen(req.garageId, fahrerName(req.body)) });
  }));

  // Das aktuelle Gespann (eines je Garage): Fahrrad, Anhänger und Gewichte; leere Plätze sind erlaubt
  app.put('/api/v1/garage/gespann', garage, asynchron(async (req, res) => {
    const { werte, fehler } = pruefeEingabe(GESPANN_FELDER, req.body);
    if (fehler) throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe', felder: fehler });
    res.json(await speicher.gespannSetzen(req.garageId, werte));
  }));

  // Reihenfolge der Fahrzeuge: [{ art, id }, ...]; Fahrräder und Anhänger stehen in einer gemeinsamen Liste
  app.put('/api/v1/garage/reihenfolge', garage, asynchron(async (req, res) => {
    const liste = req.body?.reihenfolge;
    const gueltig = Array.isArray(liste) && liste.length <= 2 * Math.max(...ART_NAMEN.map(a => ARTEN[a].max))
      && liste.every(x => x && ART_NAMEN.includes(x.art) && Number.isInteger(x.id) && x.id >= 1 && x.id <= 4294967295);
    if (!gueltig) throw new FehlerEingabe('Ungültige Reihenfolge.', 400, { code: 'eingabe' });
    await speicher.reihenfolgeSetzen(req.garageId, liste.map(x => ({ art: x.art, id: x.id })));
    res.status(204).end();
  }));

  app.post('/api/v1/garage/:art', garage, artPruefen, asynchron(async (req, res) => {
    const eintrag = await speicher.anlegen(req.garageId, req.params.art, eingabe(req.params.art, req.body));
    res.status(201).json(eintrag);
  }));

  app.put('/api/v1/garage/:art/:id', garage, artPruefen, idPruefen, asynchron(async (req, res) => {
    const eintrag = await speicher.aendern(req.garageId, req.params.art, Number(req.params.id), eingabe(req.params.art, req.body));
    if (!eintrag) return res.status(404).json({ error: 'Not found' });
    res.json(eintrag);
  }));

  app.delete('/api/v1/garage/:art/:id', garage, artPruefen, idPruefen, asynchron(async (req, res) => {
    const geloescht = await speicher.loeschen(req.garageId, req.params.art, Number(req.params.id));
    if (!geloescht) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  }));

  // Unbekannte Adressen unter /api sind ein Fehler, keine Seite
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Gebaute Oberfläche (nur im Betrieb; in der Entwicklung liefert Vite sie aus)
  if (produktion && oberflaeche && existsSync(oberflaeche)) {
    app.use(express.static(oberflaeche));
    let startseite = null;
    app.get('*', (req, res) => {
      if (startseite === null) {
        startseite = readFileSync(join(oberflaeche, 'index.html'), 'utf8');
        if (testinstanz) startseite = startseite.replace('<head>', '<head>\n  <meta name="robots" content="noindex, nofollow">');
      }
      res.type('html').send(startseite);
    });
  } else {
    app.get('*', (req, res) => res.json({ message: 'Use Vite dev server at http://localhost:5175' }));
  }

  app.use(fehlerAntwort);
  return app;
}
