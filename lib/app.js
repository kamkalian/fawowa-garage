// Die Express-Anwendung: Sicherheits-Header, öffentliche API und (im Betrieb) die gebaute Oberfläche.
// Der Datenzugriff (speicher) wird übergeben, damit die Tests eine Nachbildung einsetzen können.

import express from 'express';
import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { ARTEN, ART_NAMEN, GESPANN_FELDER, FAHRER_NAME_FELD, EMAIL_FELD, pruefeEingabe, anzahlRaederAbleiten, anzahlRaederAusBauart } from './felder.js';
import { mailText } from './mail.js';
import { MODUS_NAMEN, pruefeEinstellungen } from './reichweite.js';
import { bereinigePlaner } from './planer-einstellungen.js';
import { MOTOR_ARTEN } from './rechenmodell.js';
import { AKKU_CHEMIE_ARTEN } from './akku.js';
import { gespannFuerRechnung } from './gespann.js';
import { FOTO_MAX_BYTES, fotoTyp, fotoSpeichern, fotoLesen, fotoLoeschen, fotoMime } from './fotos.js';
import { ZOOM_MAX, PLANER_ZOOM_MIN } from './karte-daten.js';
import { registriereAdminRoutes } from './admin-routes.js';
import { adminPfad } from './pfade.js';
import { impressumSeite, datenschutzSeite, waehleSprache } from './rechtliches.js';
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
 * optionen: { env, produktion, oberflaeche (Ordner mit der gebauten Oberfläche, nur im Betrieb), begrenzungen,
 *   mailer ({ senden } oder null), url (öffentliche Adresse für Links in E-Mails oder null),
 *   planer ({ bbox, orte } aus lib/planer.js oder null: Reichweiten-Planer und Kartenbeschriftung),
 *   jobs (Jobs aus lib/jobs.js: Warteschlange für Reichweiten und Verwaltung) }
 * Der Webdienst rechnet nichts selbst: eine Reichweite wird als Auftrag an den Garage-Worker gegeben (lib/worker.js).
 */
export function erstelleApp(speicher, { env = process.env, produktion = false, oberflaeche = null, begrenzungen = {}, mailer = null, url = null, planer = null, jobs = null } = {}) {
  // Der Planer wird bei jeder Anfrage geprüft: ein neuer Netzbau gilt sofort, ohne Neustart. Übergeben wird eine Funktion oder ein festes Exemplar (Tests).
  const holePlaner = typeof planer === 'function' ? planer : () => planer;
  // Die E-Mail-Funktionen gibt es nur mit SMTP-Zugang und öffentlicher Adresse (siehe .env.example)
  const emailAktiv = !!(mailer && url);
  const testinstanz = ['1', 'true', 'ja'].includes(String(env.TESTINSTANZ ?? '').trim().toLowerCase());
  const maxGaragen = Number(env.MAX_GARAGEN) > 0 ? Number(env.MAX_GARAGEN) : 5000;

  // Neue Garagen je Adresse und Stunde; falsche Schlüssel je Adresse und Stunde (die Schlüssel sind 256 Bit lang, das hält nur Probierer auf)
  const neuLimit = begrenzungen.neu ?? new Begrenzung({ max: 5, fensterMs: 60 * 60 * 1000 });
  const falschLimit = begrenzungen.falsch ?? new Begrenzung({ max: 60, fensterMs: 60 * 60 * 1000 });
  // Mails je Adresse des Besuchers und je E-Mail-Adresse (so lässt sich niemand mit Nachrichten zumüllen)
  const mailIpLimit = begrenzungen.mailIp ?? new Begrenzung({ max: 6, fensterMs: 60 * 60 * 1000 });
  // Reichweiten-Berechnungen (rechenintensiv) und Karten-Anfragen je Besucher
  const reichweiteLimit = begrenzungen.reichweite ?? new Begrenzung({ max: 40, fensterMs: 10 * 60 * 1000 });
  const karteLimit = begrenzungen.karte ?? new Begrenzung({ max: 4000, fensterMs: 10 * 60 * 1000 });
  const mailAdressLimit = begrenzungen.mailAdresse ?? new Begrenzung({ max: 3, fensterMs: 60 * 60 * 1000 });

  const app = express();
  // Hinter Caddy: die Adresse des Besuchers kommt aus X-Forwarded-For (nur die erste Station wird vertraut).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.use(sicherheitsHeader({ testinstanz }));
  app.use(express.json({ limit: '20kb' }));


  const admin = registriereAdminRoutes(app, speicher, { env, produktion, oberflaeche, jobs });

  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(testinstanz ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: /api/\nDisallow: ${admin.pfad}\n`);
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
      emailAktiv,
      reichweite: holePlaner()
        ? { aktiv: true, bbox: holePlaner().bbox, zoom: [PLANER_ZOOM_MIN, ZOOM_MAX], modi: MODUS_NAMEN }
        : { aktiv: false },
      hauptseiteUrl: httpsAdresse(env.MAIN_SITE_URL),
      verwaltungPfad: adminPfad(env, () => {}),
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
    if (art === 'fahrraeder') return anzahlRaederAusBauart(werte);
    return art === 'anhaenger' ? anzahlRaederAbleiten(werte) : werte;
  };

  // --- E-Mail: freiwillig; die Adresse gilt erst, wenn der Link in der Bestätigungs-Mail geöffnet wurde ---
  const sprache = (body) => (body?.lang === 'en' ? 'en' : 'de');
  const emailAdresse = (body) => {
    const { werte, fehler } = pruefeEingabe([EMAIL_FELD], body);
    if (fehler) throw new FehlerEingabe('Bitte eine gültige E-Mail-Adresse angeben.', 400, { code: 'eingabe', felder: fehler });
    return werte.email;
  };
  const emailPflicht = () => {
    if (!emailAktiv) throw new FehlerEingabe('E-Mail ist nicht eingerichtet.', 503, { code: 'email_aus' });
  };
  // Der Schlüssel steht im Teil nach #, den der Browser nie an den Server sendet; erst die Seite löst ihn per Anfrage ein.
  // So verbrauchen Link-Prüfer in Mail-Programmen den einmaligen Link nicht.
  const link = (art, token) => `${url}/#${art === 'email' ? 'bestaetigen' : 'zugang'}=${token}`;
  const sendeMail = (an, art, token, lang) => mailer.senden({ an, ...mailText(lang, art, link(art, token)) });

  app.put('/api/v1/garage/email', garage, asynchron(async (req, res) => {
    emailPflicht();
    const email = emailAdresse(req.body);
    if (!mailIpLimit.erlaubt(req.ip) || !mailAdressLimit.erlaubt(email)) throw new FehlerEingabe('Zu viele E-Mails. Bitte später erneut versuchen.', 429, { code: 'zu_viele' });
    mailIpLimit.zaehle(req.ip);
    mailAdressLimit.zaehle(email);
    const token = await speicher.emailAnfordern(req.garageId, email);
    try {
      await sendeMail(email, 'email', token, sprache(req.body));
    } catch (e) {
      console.error('E-Mail konnte nicht gesendet werden:', e.message);
      throw new FehlerEingabe('Die E-Mail konnte nicht gesendet werden.', 503, { code: 'mail_fehler' });
    }
    res.status(202).json({ email_offen: email });
  }));

  app.delete('/api/v1/garage/email', garage, asynchron(async (req, res) => {
    await speicher.emailEntfernen(req.garageId);
    res.status(204).end();
  }));

  // Ohne Schlüssel: die Seite löst die Links aus den E-Mails ein
  app.post('/api/v1/email/bestaetigen', asynchron(async (req, res) => {
    emailPflicht();
    if (!falschLimit.erlaubt(req.ip)) throw new FehlerEingabe('Zu viele Versuche. Bitte später erneut versuchen.', 429, { code: 'zu_viele' });
    try {
      res.json(await speicher.emailBestaetigen(req.body?.token));
    } catch (e) {
      if (e.code === 'token_ungueltig') falschLimit.zaehle(req.ip);
      throw e;
    }
  }));

  // Zugangslink anfordern: antwortet immer gleich, damit sich nicht erkennen lässt, welche Adressen eine Garage haben
  app.post('/api/v1/zugang/anfordern', asynchron(async (req, res) => {
    emailPflicht();
    const email = emailAdresse(req.body);
    if (!mailIpLimit.erlaubt(req.ip)) throw new FehlerEingabe('Zu viele Anfragen. Bitte später erneut versuchen.', 429, { code: 'zu_viele' });
    mailIpLimit.zaehle(req.ip);
    if (mailAdressLimit.erlaubt(email)) {
      mailAdressLimit.zaehle(email);
      try {
        const token = await speicher.zugangAnfordern(email);
        if (token) await sendeMail(email, 'zugang', token, sprache(req.body));
      } catch (e) {
        console.error('Zugangslink konnte nicht gesendet werden:', e.message);
      }
    }
    res.status(202).json({});
  }));

  app.post('/api/v1/zugang/einloesen', asynchron(async (req, res) => {
    emailPflicht();
    if (!falschLimit.erlaubt(req.ip)) throw new FehlerEingabe('Zu viele Versuche. Bitte später erneut versuchen.', 429, { code: 'zu_viele' });
    try {
      res.json({ token: await speicher.zugangEinloesen(req.body?.token) });
    } catch (e) {
      if (e.code === 'token_ungueltig') falschLimit.zaehle(req.ip);
      throw e;
    }
  }));

  // Name der Fahrerin oder des Fahrers ändern
  app.put('/api/v1/garage/fahrer', garage, asynchron(async (req, res) => {
    res.json({ fahrer_name: await speicher.fahrerNameSetzen(req.garageId, fahrerName(req.body)) });
  }));

  // --- Reichweiten-Planer und Karte (siehe lib/planer.js und den Garage-Worker) ---
  const planerPflicht = () => {
    if (!holePlaner()) throw new FehlerEingabe('Der Reichweiten-Planer ist nicht eingerichtet.', 503, { code: 'routing_aus' });
  };

  // Ohne Schlüssel: Beschriftung der Karte (für alle gleich, deshalb zwischenspeicherbar)
  app.get('/api/v1/karte/orte', (req, res) => {
    planerPflicht();
    res.set('Cache-Control', 'public, max-age=86400').json(holePlaner().orte);
  });

  // Die Karte (PMTiles, eine Datei aus dem Daten-Werkzeug). Der Browser holt sich Teile per HTTP-Range; Express beantwortet
  // Range-Anfragen mit 206 selbst. Die Datei liegt im Karten-Ordner (KARTE_DIR): der Worker schreibt sie, der Webdienst liest nur.
  const karteDatei = env.KARTE_DIR ? resolve(env.KARTE_DIR, 'germany.pmtiles') : (env.NETZ_DIR ? resolve(dirname(env.NETZ_DIR), 'karte', 'germany.pmtiles') : null);
  app.get('/karte/germany.pmtiles', (req, res, next) => {
    if (!karteDatei) return res.status(404).json({ error: 'Not found' });
    if (!karteLimit.erlaubt(req.ip)) return res.status(429).json({ error: 'Zu viele Anfragen' });
    if (!existsSync(karteDatei)) return res.status(404).json({ error: 'Not found' });
    res.sendFile(karteDatei, { maxAge: 3600 * 1000, etag: true, lastModified: true, acceptRanges: true, cacheControl: true }, (fehler) => {
      if (fehler && !res.headersSent) next(fehler);
    });
  });

  // Reichweite: als Auftrag in die Warteschlange des Workers (eine je Garage, eine neue ersetzt die alte).
  // Antwort 202 mit dem Stand (wartet, davor = Anzahl der Aufträge vor dieser Berechnung).
  // Den Stand und das Ergebnis liefert GET /api/v1/garage/reichweite. body: { lat, lon, modus, einstellungen }
  app.post('/api/v1/garage/reichweite', garage, asynchron(async (req, res) => {
    planerPflicht();
    const koerper = req.body && typeof req.body === 'object' ? req.body : {};
    const lat = typeof koerper.lat === 'number' ? koerper.lat : NaN;
    const lon = typeof koerper.lon === 'number' ? koerper.lon : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new FehlerEingabe('Bitte einen Startpunkt wählen.', 400, { code: 'start_ungueltig' });
    const b = holePlaner().bbox;
    if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) throw new FehlerEingabe('Der Startpunkt liegt außerhalb des Kartengebiets.', 400, { code: 'ausserhalb' });
    const modus = koerper.modus ?? 'alle';
    if (!MODUS_NAMEN.includes(modus)) throw new FehlerEingabe('Ungültige Wegart.', 400, { code: 'modus_ungueltig' });
    const { werte: einstellungen, fehler } = pruefeEinstellungen(koerper.einstellungen);
    if (fehler) throw new FehlerEingabe('Bitte die Einstellungen prüfen.', 400, { code: 'eingabe', felder: fehler });

    const alles = await speicher.alles(req.garageId);
    const { fahrrad, anhaenger, gepaeck_kg } = gespannFuerRechnung(alles.fahrraeder, alles.anhaenger, alles.mitglieder, alles.gepaecke);
    if (!fahrrad) throw new FehlerEingabe('Das Gespann hat noch kein Zugfahrzeug.', 400, { code: 'fahrrad_fehlt' });
    // Fahrergewicht aus dem Gespann; die Zuladung kommt aus den Gepäck-Kacheln im Gespann
    const gespann = { fahrer_gewicht_kg: alles.gespann?.fahrer_gewicht_kg ?? null, gepaeck_kg };

    if (!reichweiteLimit.erlaubt(req.ip)) throw new FehlerEingabe('Zu viele Berechnungen. Bitte später erneut versuchen.', 429, { code: 'zu_viele' });
    reichweiteLimit.zaehle(req.ip);
    // Rasterabstand: 0,5, 1 oder 2 km (Standard 2 km)
    const schrittKm = [0.5, 1, 2].includes(Number(koerper.schritt_km)) ? Number(koerper.schritt_km) : 2;
    await jobs.reichweiteAnlegen(req.garageId, { fahrrad, anhaenger, gespann, einstellungen, start: { lat, lon }, modus, schrittM: schrittKm * 1000 });
    res.status(202).json(await jobs.reichweiteLesen(req.garageId));
  }));

  // Stand und Ergebnis der Reichweite der Garage: { status, davor, meldung, ergebnis }
  app.get('/api/v1/garage/reichweite', garage, asynchron(async (req, res) => {
    planerPflicht();
    res.set('Cache-Control', 'no-store').json(await jobs.reichweiteLesen(req.garageId));
  }));

  // Routen und 1-km-Punkte der letzten Berechnung (nur auf Abruf, sonst null)
  app.get('/api/v1/garage/reichweite/routen', garage, asynchron(async (req, res) => {
    planerPflicht();
    res.set('Cache-Control', 'no-store').json((await jobs.reichweiteRouten(req.garageId)) ?? { linien: null, schritte: null });
  }));

  // Foto eines Stellplatzes: hochladen (Bild im Körper, JPEG, PNG oder WebP), abrufen und löschen; nur mit dem Zugangsschlüssel der Garage
  const fotoEintrag = (art, id) => ['fahrraeder', 'anhaenger'].includes(art) && Number.isInteger(id) && id > 0;
  app.put('/api/v1/garage/foto/:art/:id', garage, express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: FOTO_MAX_BYTES }), asynchron(async (req, res) => {
    const { art } = req.params; const id = Number(req.params.id);
    if (!fotoEintrag(art, id)) throw new FehlerEingabe('Unbekannter Eintrag.', 404, { code: 'nicht_gefunden' });
    const typ = fotoTyp(req.body);
    if (!typ) throw new FehlerEingabe('Bitte ein Foto als JPEG, PNG oder WebP hochladen.', 400, { code: 'foto_ungueltig' });
    const datei = fotoSpeichern(req.body, typ);
    const alt = await speicher.fotoSetzen(req.garageId, art, id, datei);
    if (alt === undefined) { fotoLoeschen(datei); throw new FehlerEingabe('Unbekannter Eintrag.', 404, { code: 'nicht_gefunden' }); }
    if (alt) fotoLoeschen(alt);
    res.status(204).end();
  }));
  app.get('/api/v1/garage/foto/:art/:id', garage, asynchron(async (req, res) => {
    const { art } = req.params; const id = Number(req.params.id);
    if (!fotoEintrag(art, id)) throw new FehlerEingabe('Unbekannter Eintrag.', 404, { code: 'nicht_gefunden' });
    const datei = await speicher.fotoDatei(req.garageId, art, id);
    const buf = datei ? fotoLesen(datei) : null;
    if (!buf) throw new FehlerEingabe('Kein Foto.', 404, { code: 'nicht_gefunden' });
    res.set({ 'Content-Type': fotoMime(datei), 'Cache-Control': 'no-store' });
    res.send(buf);
  }));
  app.delete('/api/v1/garage/foto/:art/:id', garage, asynchron(async (req, res) => {
    const { art } = req.params; const id = Number(req.params.id);
    if (!fotoEintrag(art, id)) throw new FehlerEingabe('Unbekannter Eintrag.', 404, { code: 'nicht_gefunden' });
    const alt = await speicher.fotoSetzen(req.garageId, art, id, null);
    if (alt === undefined) throw new FehlerEingabe('Unbekannter Eintrag.', 404, { code: 'nicht_gefunden' });
    if (alt) fotoLoeschen(alt);
    res.status(204).end();
  }));

  // Ein Stellplatz gehört zum Gespann (im: true) oder nicht (im: false); Zugfahrzeuge und Anhänger beliebig viele
  app.put('/api/v1/garage/mitglied', garage, asynchron(async (req, res) => {
    const { art, id, im } = req.body ?? {};
    if (!['fahrraeder', 'anhaenger', 'gepaecke'].includes(art) || !Number.isInteger(id) || typeof im !== 'boolean') {
      throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe' });
    }
    res.json(await speicher.mitgliedSetzen(req.garageId, art, id, im));
  }));

  // Position eines Gespann-Mitglieds auf der Fläche (Pixel, Ursprung oben links)
  app.put('/api/v1/garage/mitglied/position', garage, asynchron(async (req, res) => {
    const { art, id, x, y } = req.body ?? {};
    const s = req.body?.s === undefined ? 1 : req.body.s;
    const ganz = (v) => Number.isInteger(v) && v >= 0 && v <= 5000;
    if (!['fahrraeder', 'anhaenger', 'gepaecke'].includes(art) || !Number.isInteger(id) || !ganz(x) || !ganz(y) || typeof s !== 'number' || !(s >= 0.5 && s <= 2)) {
      throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe' });
    }
    if (!(await speicher.mitgliedPositionSetzen(req.garageId, art, id, x, y, Math.round(s * 100) / 100))) {
      throw new FehlerEingabe('Dieser Eintrag ist nicht im Gespann.', 400, { code: 'eingabe' });
    }
    res.json({ ok: true });
  }));

  // Motoren und Akkus eines Fahrrads oder Anhängers ersetzen: { motoren: [{ motor_art, leistung_w }], akkus: [{ kapazitaet_wh }] }
  // Spannung in Volt: leer (null) oder ganze Zahl von 1 bis 1000; sonst false
  const spannungPruefen = (v) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : false;
  };
  const GETRIEBE_ARTEN = ['getriebe', 'direkt'];

  app.put('/api/v1/garage/antriebe/:art/:id', garage, asynchron(async (req, res) => {
    const art = req.params.art;
    const id = Number(req.params.id);
    const { motoren, akkus } = req.body ?? {};
    if (!['fahrraeder', 'anhaenger'].includes(art) || !Number.isInteger(id) || !Array.isArray(motoren) || !Array.isArray(akkus)
      || motoren.length > 10 || akkus.length > 10) {
      throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe' });
    }
    const motorenGeprueft = [];
    for (const m of motoren) {
      const motorArt = m?.motor_art;
      const leistung = m?.leistung_w === '' || m?.leistung_w == null ? null : Number(m.leistung_w);
      if (!MOTOR_ARTEN.includes(motorArt) || (leistung !== null && !(Number.isFinite(leistung) && leistung >= 0 && leistung <= 20000))) {
        throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe', felder: { motor: 'ungueltig' } });
      }
      const spannung = spannungPruefen(m?.spannung_v);
      const getriebe = m?.getriebe ?? null;
      if (spannung === false || (getriebe !== null && !GETRIEBE_ARTEN.includes(getriebe))) {
        throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe', felder: { motor: 'ungueltig' } });
      }
      motorenGeprueft.push({ motor_art: motorArt, leistung_w: leistung === null ? 0 : Math.round(leistung), spannung_v: spannung, getriebe });
    }
    const akkusGeprueft = [];
    for (const a of akkus) {
      const kap = Number(a?.kapazitaet_wh);
      const spannung = spannungPruefen(a?.spannung_v);
      if (!(Number.isFinite(kap) && kap > 0 && kap <= 10000) || spannung === false) {
        throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe', felder: { akku: 'ungueltig' } });
      }
      // Angaben zum Akku (alle optional): Chemie, Zellen, Ah, Entladeschluss je Zelle, Dauerstrom
      const chemie = a?.chemie ?? null;
      const zahlOptional = (v, [min, max], ganz) => {
        if (v === '' || v == null) return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < min || n > max || (ganz && !Number.isInteger(n))) throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe', felder: { akku: 'ungueltig' } });
        return n;
      };
      if (chemie !== null && !AKKU_CHEMIE_ARTEN.includes(chemie)) {
        throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe', felder: { akku: 'ungueltig' } });
      }
      akkusGeprueft.push({
        kapazitaet_wh: Math.round(kap), spannung_v: spannung, chemie,
        zellen_s: zahlOptional(a?.zellen_s, [1, 60], true), zellen_p: zahlOptional(a?.zellen_p, [1, 60], true),
        ah: zahlOptional(a?.ah, [0.1, 1000], false), schluss_v: zahlOptional(a?.schluss_v, [1, 4.5], false),
        max_strom_a: zahlOptional(a?.max_strom_a, [0, 2000], false)
      });
    }
    const ergebnis = await speicher.antriebSetzen(req.garageId, art, id, { motoren: motorenGeprueft, akkus: akkusGeprueft });
    if (!ergebnis) throw new FehlerEingabe('Dieser Eintrag gehört nicht zu dieser Garage.', 400, { code: 'eingabe' });
    res.json(ergebnis);
  }));

  // Gegenstände im Inventar eines Gepäckstücks. Jeder Gegenstand liegt auf einem Platz (Nummer); belegte Plätze tauschen beim Verschieben.
  const GEGENSTAND_NAME = (v) => {
    const name = typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim() : '';
    if (name.length < 1 || name.length > 80) throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe', felder: { name: 'ungueltig' } });
    return name;
  };
  const platzNummer = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 9999) throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe' });
    return n;
  };
  const nichtGefunden = () => new FehlerEingabe('Dieser Eintrag gehört nicht zu dieser Garage.', 400, { code: 'eingabe' });

  app.post('/api/v1/garage/gepaecke/:id/gegenstaende', garage, asynchron(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw nichtGefunden();
    const platz = req.body?.platz === undefined ? undefined : platzNummer(req.body.platz);
    const ergebnis = await speicher.gegenstandAnlegen(req.garageId, id, GEGENSTAND_NAME(req.body?.name), platz);
    if (!ergebnis) throw nichtGefunden();
    res.status(201).json(ergebnis);
  }));
  app.put('/api/v1/garage/gegenstaende/:id', garage, asynchron(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw nichtGefunden();
    const b = req.body ?? {};
    const werte = {};
    if (b.name !== undefined) werte.name = GEGENSTAND_NAME(b.name);
    if (b.gepackt !== undefined) {
      if (typeof b.gepackt !== 'boolean') throw new FehlerEingabe('Bitte die Eingaben prüfen.', 400, { code: 'eingabe' });
      werte.gepackt = b.gepackt;
    }
    if (b.platz !== undefined) werte.platz = platzNummer(b.platz);
    const ergebnis = await speicher.gegenstandAendern(req.garageId, id, werte);
    if (!ergebnis) throw nichtGefunden();
    res.json(ergebnis);
  }));
  app.delete('/api/v1/garage/gegenstaende/:id', garage, asynchron(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || !(await speicher.gegenstandLoeschen(req.garageId, id))) throw nichtGefunden();
    res.json({ ok: true });
  }));

  // Einstellungen des Planers im Profil der Garage: werden beim Öffnen wieder geladen
  app.get('/api/v1/garage/planer', garage, asynchron(async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await speicher.planerLesen(req.garageId));
  }));
  app.put('/api/v1/garage/planer', garage, asynchron(async (req, res) => {
    res.json(await speicher.planerSetzen(req.garageId, bereinigePlaner(req.body)));
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

  // Impressum und Datenschutz wie auf der Hauptseite; Angaben zum Betreiber aus der .env (OPERATOR, OPERATOR_PERSON)
  const betreiber = env.OPERATOR || null;
  const betreiberPerson = env.OPERATOR_PERSON || (betreiber ?? '').split('\n')[0] || null;
  app.get('/impressum', (req, res) => res.set('Cache-Control', 'no-cache').type('html')
    .send(impressumSeite({ betreiber, person: betreiberPerson, lang: waehleSprache(req.query.lang) })));
  app.get('/datenschutz', (req, res) => res.set('Cache-Control', 'no-cache').type('html')
    .send(datenschutzSeite({ betreiber, lang: waehleSprache(req.query.lang) })));

  // Gebaute Oberfläche (nur im Betrieb; in der Entwicklung liefert Vite sie aus)
  if (produktion && oberflaeche && existsSync(oberflaeche)) {
    // Die Oberfläche des Verwaltungsbereichs liegt nur unter ihrem Fantasiepfad; /admin und /admin.html gibt es nicht
    app.use((req, res, next) => {
      if (['/admin', '/admin/', '/admin.html'].includes(req.path)) return res.status(404).type('text/plain').send('Not found');
      next();
    });
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
