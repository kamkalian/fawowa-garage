# FaWoWa-Garage

Nutzer legen ihre Fahrräder und Fahrradanhänger mit vielen technischen Daten an (Motorsystem, Akku, Spannung, Schaltung,
Radgrößen, Gewichte, Solar, Zusatzakku ...) und stellen daraus Gespanne zusammen. Eine Funktion davon wird der
**Reichweiten-Planer** (Karte mit Reichweite, Steigung und Wind), später vielleicht ein Quartett-Spiel aus den Daten.

Teil von fawowa-tools.de. Aufbau, Design und Betrieb folgen der [Materialdatenbank](https://github.com/kamkalian/fawowa-material-table)
und den Design-Regeln der Hauptseite (`design_rules.md`).

**Stand: Phase 1** (Garage mit Fahrrädern, Anhängern und Gespannen). Noch nicht enthalten: E-Mail-Bestätigung, Verwaltungsbereich,
Rechenmodell, Karte (siehe unten).

## Wichtige Regeln

- **Kein Login.** Beim Anlegen entsteht eine Garage mit einem zufälligen Schlüssel (256 Bit). Der Link `https://…/#g=<schlüssel>`
  ist der Zugang. Der Schlüssel steht im Teil nach `#`, den der Browser nie an den Server sendet (kein Eintrag in Protokollen);
  die Anfragen tragen ihn im Header `Authorization: Bearer …`. In der Datenbank steht nur der SHA-256-Hash.
- **Alles ist privat.** Jede Garage sieht nur ihre eigenen Einträge. `status` (`ungeprueft`/`geprueft`) ist eine reine Markierung des
  Betreibers; jede Änderung durch den Nutzer setzt einen Eintrag zurück auf `ungeprueft`. Die Prüfnotiz geht nie an den Nutzer.
- **Felder stehen an einer Stelle:** `lib/felder.js` beschreibt alle Felder (Typ, Grenzen, Einheit, Texte de/en). Daraus prüft der
  Server die Eingaben und baut die Oberfläche die Formulare und Anzeigen. Ein neues Feld braucht zusätzlich eine neue Migration
  (`lib/migrationen.js`); `tests/felder.test.js` merkt, wenn eine Spalte fehlt.
- **Migrationen werden nie geändert**, nur ergänzt. Sie laufen beim Start der Anwendung.
- Grenzen: höchstens 20 Einträge je Art und Garage, 5 neue Garagen je Adresse und Stunde, insgesamt `MAX_GARAGEN`.

## Entwicklung

```bash
npm install
npm run dev:fake    # API mit Nachbildung der Datenbank im Arbeitsspeicher (kein MySQL nötig), Port 3470
npm run dev:web     # Oberfläche auf http://localhost:5175
npm test
```

Mit echter Datenbank: MySQL 8 starten, `.env` aus `.env.example` anlegen (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`), dann `npm run dev`.

### Tests

`npm test` prüft Felder, Gewichtsberechnung und die komplette API gegen eine Nachbildung des Datenzugriffs (`tests/hilfen.js`).
Der echte SQL-Teil (`lib/speicher.js`, Migrationen) wird von `tests/speicher.integration.test.js` gegen eine **echte** Datenbank
geprüft; dieser Test läuft nur mit `TEST_DB_HOST` und **leert** die Datenbank `TEST_DB_NAME` (Standard `garage_test`):

```bash
TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD=... npm test
```

## Betrieb (Docker)

`docker-compose.yml` startet die Anwendung (`fawowa-garage`, Port 3470 im Netz `caddy-net`) und MySQL 8.4 (`fawowa-garage-db`,
nur im internen Netz, Daten in `data/mysql`). Es wird kein Port nach außen veröffentlicht. Einrichtung auf dem Server:

1. `/srv/apps/garage/.env` anlegen (Vorlage `.env.example`, mindestens `DB_PASSWORD`; `TESTINSTANZ=1` lassen).
2. Mit `deploy\deploy.ps1` ausliefern (wie bei den anderen Anwendungen).
3. `deploy/caddy/sites/garage.caddy.example` nach `/srv/caddy/sites/garage.caddy` kopieren, Adresse eintragen, Caddy neu laden.
   Der DNS-Eintrag der Subdomain muss auf den Server zeigen.
4. Den SQL-Test ohne lokales MySQL ausführen: `sh scripts/sql-test.sh` (braucht nur Docker, startet eine Wegwerf-MySQL und räumt auf;
   die echte Datenbank bleibt unberührt).

## Noch offen bis zum öffentlichen Start

- Pflichtbausteine der Design-Regeln: „Projekt unterstützen“, Fußzeile, Impressum, Datenschutz (Hinweis auf gespeicherte Daten und Link-Schlüssel), Eintrag in `config/tools.json` der Hauptseite
- E-Mail-Bestätigung und Link-Versand (SMTP aus `.env`), Verwaltungsbereich mit Prüfstatus
- Reichweiten-Planer: Rechenmodell, eigenes Routing (NRW), Karte, Wind
