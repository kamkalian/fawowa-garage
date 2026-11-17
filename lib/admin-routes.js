// Verwaltungsbereich: Anmeldung mit Passwort aus der .env (ADMIN_PASSWORD_HASH), Sitzung über ein Cookie, API unter /api/admin.
// Die Oberfläche liegt unter einem Fantasiepfad (ADMIN_PATH, Standard /wunderkammer), siehe lib/pfade.js.

import express from 'express';
import { join } from 'path';
import { anmelden, abmelden, sitzungGueltig, tokenAusCookie, cookieHeader } from './auth.js';
import { FehlerEingabe } from './fehler.js';
import { FAHRER_NAME_FELD, pruefeEingabe } from './felder.js';
import { adminPfad } from './pfade.js';
import { ZOOM_MIN, ZOOM_MAX } from './karte-daten.js';
import { systemStand, netzStand } from './system.js';

const asynchron = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ID = /^[1-9]\d{0,9}$/;

// Arten, die der Verwaltungsbereich bearbeiten kann (Gespann einschließlich)
export const ADMIN_ARTEN = ['fahrraeder', 'anhaenger', 'gespanne'];

function status(wert) {
  if (wert !== 'geprueft' && wert !== 'ungeprueft') throw new FehlerEingabe('Ungültiger Status.', 400, { code: 'eingabe' });
  return wert;
}

/** Prüfnotiz: Text bis 500 Zeichen, leer = keine Notiz, undefined = unverändert */
function notiz(wert) {
  if (wert === undefined) return undefined;
  if (wert === null) return null;
  if (typeof wert !== 'string' || wert.length > 500) throw new FehlerEingabe('Die Notiz ist ungültig oder zu lang.', 400, { code: 'eingabe' });
  const text = wert.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim();
  return text === '' ? null : text;
}

/** Fehler im Format { error } für die Oberfläche des Verwaltungsbereichs (sie zeigt den Text an) */
// eslint-disable-next-line no-unused-vars
function adminFehler(err, req, res, next) {
  if (err instanceof FehlerEingabe) return res.status(err.status).json({ error: err.message, code: err.code });
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Ungültige Anfrage' });
  console.error(err);
  res.status(500).json({ error: 'Interner Fehler' });
}

export function registriereAdminRoutes(app, speicher, { env = process.env, produktion = false, oberflaeche = null, jobs = null } = {}) {
  const pfad = adminPfad(env);
  const secure = produktion;
  const api = express.Router();

  // Schutz vor fremden Seiten, die Anfragen im Namen des angemeldeten Betreibers auslösen wollen: das Cookie ist SameSite=Strict,
  // zusätzlich muss bei ändernden Anfragen der Absender (Origin), falls der Browser ihn sendet, zu dieser Adresse gehören.
  api.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.get('origin');
      if (origin) {
        let host = null;
        try { host = new URL(origin).host; } catch { /* ungültig */ }
        if (host !== req.get('host')) return res.status(403).json({ error: 'Anfrage von einer fremden Adresse.' });
      }
      // Anfragen mit Inhalt müssen JSON sein (ein Formular einer fremden Seite kann das nicht senden); DELETE hat keinen Inhalt
      const hatInhalt = Number(req.get('content-length')) > 0 || req.get('transfer-encoding');
      if (hatInhalt && !req.is('application/json')) return res.status(415).json({ error: 'Nur JSON erlaubt.' });
    }
    next();
  });

  api.post('/login', (req, res) => {
    const ergebnis = anmelden(req.body?.passwort, req.ip, env.ADMIN_PASSWORD_HASH);
    if (ergebnis.ok) {
      res.setHeader('Set-Cookie', cookieHeader(ergebnis.token, { secure }));
      return res.json({ ok: true });
    }
    if (ergebnis.grund === 'nicht_eingerichtet') {
      return res.status(503).json({ error: 'Der Admin-Zugang ist noch nicht eingerichtet (ADMIN_PASSWORD_HASH fehlt).' });
    }
    if (ergebnis.grund === 'gesperrt') {
      return res.status(429).json({ error: `Zu viele Fehlversuche. Bitte in ${ergebnis.minuten} Minuten erneut versuchen.` });
    }
    return res.status(401).json({ error: 'Passwort falsch.' });
  });

  api.post('/logout', (req, res) => {
    abmelden(tokenAusCookie(req.headers.cookie));
    res.setHeader('Set-Cookie', cookieHeader('', { ablauf: true, secure }));
    res.json({ ok: true });
  });

  api.get('/sitzung', (req, res) => {
    res.json({ angemeldet: sitzungGueltig(tokenAusCookie(req.headers.cookie)) });
  });

  // Ab hier: nur mit Sitzung
  api.use((req, res, next) => {
    if (!sitzungGueltig(tokenAusCookie(req.headers.cookie))) return res.status(401).json({ error: 'Nicht angemeldet' });
    next();
  });

  const id = (req) => {
    if (!ID.test(req.params.id)) throw new FehlerEingabe('Nicht gefunden.', 404, { code: 'nicht_gefunden' });
    return Number(req.params.id);
  };
  const art = (req) => {
    if (!ADMIN_ARTEN.includes(req.params.art)) throw new FehlerEingabe('Nicht gefunden.', 404, { code: 'nicht_gefunden' });
    return req.params.art;
  };
  const gefunden = (wert) => {
    if (!wert) throw new FehlerEingabe('Nicht gefunden.', 404, { code: 'nicht_gefunden' });
    return wert;
  };

  api.get('/uebersicht', asynchron(async (req, res) => res.json(await speicher.adminUebersicht())));

  // Hintergrundaufträge (Download, Kartenbau, Netzbau, Kacheln): Warteschlange, Reihenfolge, Löschen und Stand des Servers
  const alleZooms = Array.from({ length: ZOOM_MAX - ZOOM_MIN + 1 }, (_, i) => ZOOM_MIN + i);
  const ohneJobs = (res) => res.status(503).json({ error: 'Die Warteschlange ist nicht eingerichtet.' });
  // Diese Aufträge gibt es je einmal in der Warteschlange (ein zweiter Download würde dieselbe Datei neu laden)
  const einmalig = { download: 'Der Download läuft schon oder wartet.', karte: 'Der Kartenbau läuft schon oder wartet.', netz: 'Der Netzbau läuft schon oder wartet.' };
  const anhaengen = async (res, art, parameter) => {
    if (einmalig[art] && await jobs.artAktiv(art)) return res.status(409).json({ error: einmalig[art] });
    const id = await jobs.anlegen(art, { parameter });
    res.status(201).json({ id });
  };

  api.get('/jobs', asynchron(async (req, res) => {
    if (!jobs) return res.json({ jobs: [], system: systemStand(), netz: null, zoom: [ZOOM_MIN, ZOOM_MAX], aktiv: false });
    res.json({ jobs: await jobs.liste(), system: systemStand(), netz: netzStand(env), zoom: [ZOOM_MIN, ZOOM_MAX], aktiv: true });
  }));
  api.post('/jobs/download', asynchron(async (req, res) => { if (!jobs) return ohneJobs(res); await anhaengen(res, 'download', {}); }));
  api.post('/jobs/karte', asynchron(async (req, res) => { if (!jobs) return ohneJobs(res); await anhaengen(res, 'karte', {}); }));
  api.post('/jobs/netz', asynchron(async (req, res) => { if (!jobs) return ohneJobs(res); await anhaengen(res, 'netz', {}); }));
  api.post('/jobs/kacheln', asynchron(async (req, res) => {
    if (!jobs) return ohneJobs(res);
    const eingabe = Array.isArray(req.body?.zooms) ? req.body.zooms : alleZooms;
    const zooms = [...new Set(eingabe.map(Number))].filter(z => Number.isInteger(z) && z >= ZOOM_MIN && z <= ZOOM_MAX).sort((a, b) => a - b);
    if (!zooms.length) return res.status(400).json({ error: 'Keine gültige Zoomstufe.' });
    await anhaengen(res, 'kacheln', { zooms });
  }));
  api.delete('/jobs/:id', asynchron(async (req, res) => {
    if (!jobs) return ohneJobs(res);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new FehlerEingabe('Unbekannter Auftrag.', 404, { code: 'nicht_gefunden' });
    if (!await jobs.loeschen(id)) return res.status(409).json({ error: 'Nur wartende Aufträge lassen sich löschen.' });
    res.status(204).end();
  }));
  api.post('/jobs/:id/verschieben', asynchron(async (req, res) => {
    if (!jobs) return ohneJobs(res);
    const id = Number(req.params.id);
    const richtung = Number(req.body?.richtung);
    if (!Number.isInteger(id) || id < 1 || (richtung !== -1 && richtung !== 1)) throw new FehlerEingabe('Ungültige Angabe.', 400, { code: 'eingabe' });
    if (!await jobs.verschieben(id, richtung)) return res.status(409).json({ error: 'Der Auftrag lässt sich hier nicht verschieben.' });
    res.status(204).end();
  }));

  api.get('/garagen', asynchron(async (req, res) => {
    const seite = Number(req.query.seite);
    res.json(await speicher.adminGaragen({
      suche: String(req.query.suche ?? '').trim().slice(0, 100),
      nurUngeprueft: req.query.ungeprueft === '1',
      seite: Number.isInteger(seite) && seite >= 1 ? seite : 1
    }));
  }));

  api.get('/garagen/:id', asynchron(async (req, res) => res.json(gefunden(await speicher.adminGarage(id(req))))));

  api.patch('/garagen/:id', asynchron(async (req, res) => {
    const { werte, fehler } = pruefeEingabe([FAHRER_NAME_FELD], req.body);
    if (fehler) throw new FehlerEingabe('Bitte den Namen prüfen.', 400, { code: 'eingabe' });
    gefunden(await speicher.adminFahrerName(id(req), werte.fahrer_name));
    res.json({ fahrer_name: werte.fahrer_name });
  }));

  // Alle Einträge einer Garage auf einmal als geprüft markieren (oder zurücksetzen)
  api.post('/garagen/:id/pruefen', asynchron(async (req, res) => {
    const neu = status(req.body?.status);
    gefunden(await speicher.adminGaragePruefen(id(req), neu));
    res.json({ ok: true });
  }));

  api.delete('/garagen/:id', asynchron(async (req, res) => {
    gefunden(await speicher.adminGarageLoeschen(id(req)));
    res.status(204).end();
  }));

  api.patch('/eintraege/:art/:id', asynchron(async (req, res) => {
    const aenderung = {};
    if (req.body?.status !== undefined) aenderung.status = status(req.body.status);
    const n = notiz(req.body?.pruefnotiz);
    if (n !== undefined) aenderung.pruefnotiz = n;
    if (!Object.keys(aenderung).length) throw new FehlerEingabe('Nichts zu ändern.', 400, { code: 'eingabe' });
    res.json(gefunden(await speicher.adminEintragAendern(art(req), id(req), aenderung)));
  }));

  api.delete('/eintraege/:art/:id', asynchron(async (req, res) => {
    gefunden(await speicher.adminEintragLoeschen(art(req), id(req)));
    res.status(204).end();
  }));

  api.use(adminFehler);
  app.use('/api/admin', express.json({ limit: '20kb' }), api);

  // Die Oberfläche (nur im Betrieb; in der Entwicklung liefert Vite sie unter demselben Pfad aus)
  app.get(pfad, (req, res, next) => {
    if (!produktion || !oberflaeche) return next();
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow').sendFile(join(oberflaeche, 'admin.html'));
  });

  return { pfad };
}
