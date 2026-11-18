# Plan: Daten-Werkzeug mit Oberfläche für Karte und Wegenetz (FaWoWa-Garage)

> Dieser Plan ist für Claude Code geschrieben. Arbeite ihn Phase für Phase ab. Nach jeder Phase: Tests laufen lassen,
> kurz berichten, auf Freigabe warten. Kläre zuerst die Fragen in Abschnitt 0.

## Ziel in einem Satz

Ein Programm für den eigenen Windows-PC mit grafischer Oberfläche lädt die OpenStreetMap-Daten für Deutschland, baut daraus
**das Fahrrad-Wegenetz** (für den Reichweiten-Planer) und **die Kartenkacheln** (eine PMTiles-Datei), zerlegt beides in
**ZIP-Pakete von höchstens 200 MB** und lädt sie **per SCP** auf den Server. Der Server rechnet danach nichts Schweres mehr: Er setzt
die Pakete zusammen, prüft sie, spielt sie ein und liefert die Karte nur noch aus.

## Hintergrund (Ist-Zustand im Repo)

- Repo: `C:\Users\akurm\Documents\fawowa-garage` (Node/Express + Svelte/Vite, MySQL, Docker Compose, Caddy davor).
- `daten-bauen/` (Go, eigener PBF-Leser, keine Abhängigkeiten): lädt `germany-latest.osm.pbf` (~4,9 GB) und SRTM-Höhen,
  baut das Wegenetz (`netz.go`, ~840 MB in `daten/netz`) und eine eigene Grundkarte (`karte.go`, ~530 MB in `netz/karte`) und packt
  alles in **eine** ZIP (~1,15 GB). Der Unterbefehl `daten-bauen karte <pbf> <netz>` wird im Docker-Image auch auf dem Server benutzt.
- Server: Hetzner, **2 CPU, 4 GB RAM, 4 GB Swap**, ca. 25 GB frei. Daneben laufen MySQL, Webdienst, Worker, Caddy und andere Anwendungen.
- Upload heute: Verwaltung → Reiter „Kartendaten“, Upload in 128-MB-Stücken (`lib/upload.js`), dann Job `entpacken` im
  Worker (`lib/worker.js`). Danach erzeugt der Job `kacheln` (`lib/kachel-job.js`, `lib/karte-daten.js`) auf dem Server alle
  Kacheln für Zoom 8–15.
- **Problem:** Für Deutschland sind das ~1,3 Mio. Kacheln. `KarteBasis.fuerKachel` geht pro Kachel alle ~5,5 Mio. Merkmale linear
  durch. Auf dem Server dauert das Tage bis Wochen, und Netz plus Grundkarte im RAM machen den 4-GB-Server eng.
- Bestehende Deploy-Skripte (`deploy/deploy.ps1`, `deploy/netz-hochladen.ps1`) nutzen `scp`/`ssh` mit dem Schlüssel
  `%USERPROFILE%\.ssh\id_ed25519_fawowa`; Zielordner auf dem Server: `/srv/apps/garage`.

## 0. Vorab mit Andreas klären (nicht raten)

1. **Kartenart:** Geplant ist **Variante B**: Standard-Vektorkacheln (Planetiler → `germany.pmtiles`, OpenMapTiles-Schema), Anzeige
   mit MapLibre GL. Die eigene Grundkarte (`karte.go`, `karte-basis.js`, `kachel-job.js`) entfällt dann.
   Variante A wäre: eigene Kachelform behalten und den Kachelbau lokal in Go nachbauen. Nur umsetzen, wenn Andreas A ausdrücklich will.
2. **RAM des PCs** (für `-Xmx` von Planetiler und den Netzbau). Unter 16 GB: Planetiler mit `--storage=mmap`.
3. Wie die Pakete auf dem Server eingespielt werden sollen: **automatisch**, sobald alles da ist (Standard in diesem Plan),
   oder erst auf Knopfdruck in der Verwaltung.

---

## Phase 1: Paketformat (Grundlage für Tool und Server)

Gemeinsames Format, das Go-Tool und Node-Worker beide verstehen. Beschreibung in `docs/PAKETFORMAT.md`.

- Ein **Paket** hat eine Art (`netz` oder `karte`), eine Version (Zeitstempel, z. B. `2026-11-18T0815`) und eine Liste von Dateien.
- Jede Datei wird in **Stücke** zerlegt; Stücke werden auf **ZIP-Dateien ≤ 200 MB** verteilt (Grenze einstellbar, Standard
  200 000 000 Bytes, 1 MB Reserve für ZIP-Köpfe und Manifest). Mehrere kleine Dateien oder Stücke dürfen sich eine ZIP teilen.
- Einträge in den ZIPs **unkomprimiert** (`Store`): PMTiles ist schon komprimiert, die Netzdateien lohnen das Komprimieren kaum,
  und so bleibt die Größe planbar. Optional: Deflate für Netzdateien, wenn eine Messung mehr als 20 % Ersparnis zeigt.
- Dateinamen: `<art>-<version>.teil-001-von-012.zip`.
- **`manifest.json` liegt in jeder ZIP** (identisch) und zusätzlich als `<art>-<version>.manifest.json`:
  ```json
  {
    "format": "fawowa-paket-1",
    "art": "karte",
    "version": "2026-11-18T0815",
    "erzeugt": "2026-11-18T08:15:00Z",
    "quelle": { "osm": "germany-latest.osm.pbf", "osmStand": "2026-11-17T21:21:02Z" },
    "zips": [ { "name": "karte-2026-11-18T0815.teil-001-von-012.zip", "bytes": 199800000, "sha256": "…" } ],
    "dateien": [
      { "pfad": "germany.pmtiles", "bytes": 2875000000, "sha256": "…",
        "stuecke": [ { "zip": "…teil-001…zip", "eintrag": "germany.pmtiles.001", "offset": 0, "bytes": 198000000, "sha256": "…" } ] }
    ]
  }
  ```
- Pfade im Paket: nur relative, nur `a-z0-9._-/`, kein `..`, kein absoluter Pfad. Das wird beim Packen **und** beim Einspielen geprüft.
- **Tests (Go):** Packen → Auspacken ergibt identische Dateien; keine ZIP über der Grenze; Datei genau so groß wie ein Stück;
  leere Datei; fehlende oder veränderte ZIP wird erkannt; Pfad mit `..` wird abgelehnt.
- **Tests (Node):** dasselbe Manifest wird gelesen und geprüft (gemeinsame Testdaten unter `tests/daten/paket/`).

## Phase 2: Das Werkzeug (Go, im Ordner `daten-bauen/`)

Bestehendes `daten-bauen` erweitern, nicht neu anfangen: `pbf.go`, `netz.go`, `tags.go`, `hoehen.go`, `download.go` bleiben.
Ergebnis ist **eine einzige `daten-bauen.exe`** ohne Installation.

### 2.1 Oberfläche

- **Technik:** lokale Weboberfläche. Die exe startet einen HTTP-Server **nur auf `127.0.0.1`** mit zufälligem Port und öffnet den
  Browser. HTML/CSS/JS werden per `embed` eingebaut. Kein CGO, kein Fyne, kein Wails: so lässt sich die exe auf Windows ohne
  C-Compiler bauen.
- **Sicherheit der Oberfläche:** zufälliges Sitzungs-Token in der URL bzw. im Cookie; jede API-Anfrage prüft Token und `Origin`.
  Damit kann keine fremde Webseite das Tool fernsteuern. Beim Schließen des letzten Browser-Tabs läuft das Programm weiter, bis
  „Beenden“ gedrückt wird (Arbeit soll nicht abbrechen).
- **Fortschritt live** per Server-Sent Events: Schritt, Prozent, Bytes, Restzeit, Logzeilen.
- **CLI bleibt:** `daten-bauen.exe --ohne-oberflaeche --alles` für einen Lauf ohne Oberfläche. Der Unterbefehl `karte` wird erst
  entfernt, wenn der Server ihn nicht mehr braucht (Phase 4).
- Design wie die Garage (dunkel, Farben/Schriften aus `src/style.css` übernehmen). Texte auf Deutsch.

### 2.2 Seiten der Oberfläche

1. **Übersicht / Ablauf:** die Schritte als Liste mit Status (offen, läuft, fertig, Fehler, übersprungen), Fortschrittsbalken,
   Dauer und Größe der Ergebnisse. Knöpfe: „Alles ausführen“, einzelner Schritt „Ausführen“, „Abbrechen“. Häkchen pro Schritt,
   ob er laufen soll (z. B. nur Netz neu, Karte nicht).
2. **Einstellungen:**
   - Arbeitsordner (Standard: `daten` neben der exe), maximale ZIP-Größe (Standard 200 MB)
   - Planetiler: Speicher (`-Xmx`, Vorschlag aus dem PC-RAM), höchste Zoomstufe (Standard 14), `--storage=mmap` an/aus
   - **Server (SCP):** Rechner, Port (22), Benutzer, Anmeldung per **Schlüsseldatei** (Pfad, Standard
     `%USERPROFILE%\.ssh\id_ed25519_fawowa`, optional Passphrase) **oder Passwort**, Zielordner (Standard
     `/srv/apps/garage/data/import`), Haken „nach dem Hochladen automatisch einspielen“
   - Knopf **„Verbindung testen“**: anmelden, Zielordner prüfen bzw. anlegen, Schreibrecht testen, freien Platz anzeigen
     (`df -B1 <ziel>`); Warnung, wenn der Platz für Paket + Entpacken nicht reicht
3. **Protokoll:** alle Logzeilen, zusätzlich in `daten/protokoll/<datum>.log`.

### 2.3 Speichern der Einstellungen

- `%APPDATA%\fawowa-daten\einstellungen.json`.
- **Passwort und Passphrase nie im Klartext:** mit Windows-DPAPI verschlüsseln (`golang.org/x/sys/windows`, `CryptProtectData`,
  nur für den angemeldeten Benutzer). Haken „Passwort merken“; ohne Haken wird bei jedem Upload gefragt.
- Zugangsdaten tauchen nie im Protokoll, in Fehlermeldungen oder in der API-Antwort auf (Antwort nur `"passwortGesetzt": true`).

### 2.4 Die Schritte

| Nr. | Schritt | Was passiert | Ergebnis |
|---|---|---|---|
| 1 | OSM laden | `germany-latest.osm.pbf` von Geofabrik; fortsetzbar (Range + ETag/If-Range), MD5 prüfen; nur neu laden, wenn neuer (vorhandenes `download.go` nutzen) | `daten/roh/germany-latest.osm.pbf` |
| 2 | Höhen laden | SRTM-Kacheln wie bisher (`hoehen.go`) | `daten/hoehen/*.hgt.gz` |
| 3 | Wegenetz bauen | `netzBauen` wie bisher. **Ohne** Grundkarte (`karte.go` wird nicht mehr aufgerufen). Prüfen: Autobahnen und nicht radtaugliche Wege sind nicht im Netz (Test mit kleinem PBF) | `daten/netz/` (~840 MB) |
| 4 | Werkzeuge für Karte | Java 21 suchen; fehlt es: Temurin-JRE 21 (Windows x64, ZIP) von Adoptium nach `daten/werkzeuge/jre` laden. `planetiler.jar` in **fester Version** von GitHub-Releases laden, SHA-256 prüfen | `daten/werkzeuge/` |
| 5 | Kacheln bauen | `java -Xmx… -jar planetiler.jar --osm-path=…pbf --output=daten/karte/germany.pmtiles --download --download-dir=daten/werkzeuge/quellen --maxzoom=14 --force` (+ `--storage=mmap` je nach Einstellung). Ausgabe zeilenweise lesen, Fortschritt aus den Planetiler-Logzeilen ableiten, Abbruch beendet den Prozess | `daten/karte/germany.pmtiles` (geschätzt 2–4 GB) |
| 6 | Schriften und Symbole | Glyphen (z. B. Noto Sans Regular/Bold als PBF-Glyph-Bereiche) und ein kleines Sprite laden bzw. erzeugen, damit MapLibre ohne fremde Server Beschriftungen zeigt | `daten/karte/glyphs/…`, `daten/karte/sprite*` |
| 7 | Pakete packen | Paket `netz` (aus Schritt 3) und Paket `karte` (aus Schritt 5 + 6) nach Phase 1 | `daten/pakete/<art>-<version>/*.zip` |
| 8 | Hochladen (SCP) | siehe 2.5 | Pakete auf dem Server |
| 9 | Stand prüfen | per SSH den Stand des Einspielens abfragen (siehe Phase 3, `status.json`) und anzeigen | Meldung „eingespielt“ |

- Jeder Schritt schreibt nach Erfolg `daten/stand/<schritt>.json` (Eingaben mit Datum und Größe, Ergebnis, Dauer). Ist die
  Eingabe unverändert, wird der Schritt als „aktuell“ angezeigt und bei „Alles ausführen“ übersprungen (abschaltbar mit „neu bauen“).
- Nur **ein** schwerer Schritt gleichzeitig (Netzbau und Planetiler brauchen beide viel RAM).
- Abbruch jederzeit; halbe Ergebnisse immer erst unter `*.tmp` schreiben und dann umbenennen.

### 2.5 Hochladen per SCP

- **Bibliothek:** `golang.org/x/crypto/ssh` und SCP-Protokoll selbst umgesetzt (Gegenstelle `scp -t <ziel>`; ist klein und gut
  testbar). Kein Aufruf von `scp.exe`: Passwort-Anmeldung und Fortschritt lassen sich damit nicht sauber steuern. Für Befehle
  (`mkdir`, `mv`, `sha256sum`, `df`) eine SSH-Sitzung im selben Client.
- **Host-Schlüssel:** gegen `%USERPROFILE%\.ssh\known_hosts` prüfen (`golang.org/x/crypto/ssh/knownhosts`). Unbekannt: Fingerabdruck
  in der Oberfläche zeigen und erst nach Bestätigung speichern. Geändert: Abbruch mit deutlicher Warnung.
- **Ablauf je Paket:**
  1. `mkdir -p <ziel>/<art>-<version>.hochladen`
  2. Je ZIP: schon vorhanden mit gleicher Größe und gleichem `sha256sum`? Dann überspringen (Fortsetzen nach Abbruch). Sonst als
     `<name>.tmp` übertragen, danach `sha256sum` auf dem Server vergleichen, dann `mv` auf den endgültigen Namen. Bis zu 3 Versuche je ZIP.
  3. Zum Schluss `manifest.json` übertragen und dann den Ordner atomar umbenennen: `mv <art>-<version>.hochladen <art>-<version>`.
     **Erst dieser fertige Ordner ist für den Server sichtbar.**
- Anzeige: aktuelle ZIP, Gesamtfortschritt, MB/s, Restzeit. Bandbreitenbegrenzung optional (MB/s), damit die Leitung nutzbar bleibt.
- Vor dem Upload: freien Platz prüfen (Paketgröße × 2,2 für Teile + Entpacken + alte Version). Reicht er nicht, abbrechen und sagen,
  wie viel fehlt.

### 2.6 Tests für das Werkzeug

- Paketformat (Phase 1).
- SCP: Test mit eingebautem SSH-Testserver (`x/crypto/ssh` als Server im Test), der `scp -t` und die nötigen Befehle simuliert:
  Upload, Fortsetzen nach Abbruch in der Mitte, falsche Prüfsumme → erneuter Versuch, unbekannter Host-Schlüssel → Abbruch ohne Bestätigung.
- Einstellungen: DPAPI rundum (nur unter Windows), Passwort erscheint nicht in JSON-Antwort und Log.
- Oberfläche: API ohne Token → 403; falscher `Origin` → 403.
- Netzbau mit kleinem Test-PBF: keine `motorway`/`motorway_link`, keine `bicycle=no`.

## Phase 3: Server – Pakete annehmen und einspielen (Repo, Node)

- **Neuer Ordner** `data/import` ist schon in Worker und Webdienst eingebunden. Der Worker bekommt neue Ordner:
  - `./data/karte:/app/karte` (Worker schreibbar, Webdienst nur lesend)
  - `./data/netz` wie bisher
- **Paket-Wächter im Worker** (`lib/paket-waechter.js`): alle 30 s `IMPORT_DIR` nach fertigen Ordnern `<art>-<version>/` durchsuchen
  (Ordner mit `.hochladen` am Ende ignorieren). Gefunden → Job `paket_einspielen` mit `{ ordner }` anlegen, wenn es dafür noch keinen
  gibt.
- **Job `paket_einspielen`** (`lib/paket.js`):
  1. Manifest lesen, Format und Pfade prüfen; alle ZIPs vorhanden, Größen und SHA-256 prüfen.
  2. Stücke der Reihe nach in `<ziel>/.neu/` zusammensetzen (Streams, wenig RAM), jede Datei gegen SHA-256 prüfen.
  3. Prüfungen je Art: `netz` braucht `info.json` mit `bbox`; `karte` braucht `germany.pmtiles` mit gültigem PMTiles-Kopf (Magic `PMTiles`, Version 3).
  4. Tauschen: alte Version nach `.alt`, `.neu` an ihren Platz, `.alt` löschen. Bei `netz` danach `netzVergessen()`, damit das neue Netz geladen wird.
  5. Paketordner im Import löschen. Ergebnis in `IMPORT_DIR/status.json` schreiben (für Schritt 9 des Tools) und wie bisher in der Jobtabelle.
- **Speicher:** Nur der Worker hält das Wegenetz im RAM, **ein Exemplar**. Prüfen, ob Webdienst oder `routing-dienst` noch eine eigene
  Kopie laden; wenn ja, auf den Worker umstellen. `mem_limit` des Workers neu festlegen (Vorschlag 2 GB, mit Swap) und den
  veralteten Kommentar „ohne Swap“ korrigieren. Ziel: Deutschland-Netz geladen, Server insgesamt unter ~3 GB RAM.
- **Wegfallen:** Jobs `kacheln`, `karte`, `download` (NRW), `lib/kachel-job.js`, `lib/karte-basis.js`, Kachelteil von `lib/karte-daten.js`,
  Volume `kacheln`, Go-Stufe `karte` im `Dockerfile`, `daten-bauen` im Deploy-Archiv. Erst entfernen, wenn Phase 4 läuft.
- **Verwaltung (Reiter „Kartendaten“):** zeigt Netz- und Kartenstand (Version, Datum, Größe, OSM-Stand) und die letzten Paket-Jobs. Der
  bisherige Browser-Upload bleibt als Notweg erhalten, nimmt aber künftig dieselben Pakete an.
- **Tests:** Einspielen eines kleinen Testpakets; fehlende ZIP → Fehler, alte Daten bleiben; manipulierte ZIP → Fehler;
  Pfad mit `..` → Fehler; halbfertiger `.hochladen`-Ordner wird ignoriert; zweimal dasselbe Paket → nur ein Job.

## Phase 4: Karte im Browser auf MapLibre umstellen (Repo, Svelte)

- `maplibre-gl` und `pmtiles` als npm-Pakete (keine CDN-Einbindung, keine fremden Server).
- **Auslieferung der PMTiles-Datei:** Route `/karte/germany.pmtiles` im Express-Server aus `/app/karte`, mit HTTP-Range
  (`express.static` kann das), `Cache-Control` mit ETag. Glyphen und Sprite ebenso unter `/karte/…`. Rate-Limit wie bisher bei Kacheln.
- **Kartenstil** als JSON im Repo (`src/public/karte/stil.json`), passend zum dunklen Design. Ebenen aus dem OpenMapTiles-Schema:
  Wasser, Wald/Grün, Wohngebiete, Gebäude (ab Zoom 13), Bahn, Grenzen, Straßen nach Klasse. **Autobahnen deutlich sichtbar.**
  Radwege und Pfade eigens hervorgehoben. Ortsnamen und Straßennamen.
- `src/public/lib/karte.js` ersetzen: Wärmekarte (Raster), Umrandung und Startpunkt des Reichweiten-Planers als MapLibre-Quellen
  und -Ebenen über der Grundkarte. Ortssuche nutzt weiter `orte.json` aus dem Netz.
- Quellenangabe „© OpenStreetMap-Mitwirkende“ und Hinweis in den Datenschutztext (README nennt das als offen).
- `Content-Security-Policy` prüfen: MapLibre braucht `worker-src blob:`.
- **Tests:** Route liefert `206` bei Range-Anfrage; Stil-JSON gültig (alle Quellen und Ebenen vorhanden); bestehende Routing-Tests laufen weiter.

## Phase 5: Aufräumen und Doku

- README und `docs/ROUTING-TEST.md` auf den neuen Ablauf aktualisieren; `docs/DATEN-WERKZEUG.md` mit Bedienung und Screenshots.
- `deploy/netz-hochladen.ps1` und `scripts/daten-bauen.mjs` entfernen oder als veraltet markieren.
- `.gitignore`: `daten-bauen/daten/`, `daten-bauen/*.exe`.

## Abnahme (wann es fertig ist)

1. Doppelklick auf `daten-bauen.exe` öffnet die Oberfläche; Einstellungen samt Server-Zugang lassen sich eintragen, speichern und testen.
2. „Alles ausführen“ läuft auf dem PC ohne Eingriff von OSM-Download bis Upload durch. Ein Abbruch an beliebiger Stelle lässt sich fortsetzen,
   ohne fertige Schritte zu wiederholen.
3. Keine ZIP ist größer als 200 MB. Alle Prüfsummen stimmen.
4. Der Server spielt beide Pakete selbst ein; die Verwaltung zeigt den neuen Stand. Während des Einspielens bleibt die alte Version nutzbar.
5. Die Deutschlandkarte lässt sich im Browser von Zoom 5 bis 18 flüssig zoomen; Autobahnen sind sichtbar.
6. Der Reichweiten-Planer rechnet auf dem Deutschland-Netz; Autobahnen und nicht radtaugliche Wege werden nie benutzt.
7. Der Server bleibt dabei unter ~3 GB RAM-Belegung und nutzt nach dem Einspielen keine CPU mehr für die Karte.
8. Kein Passwort steht im Klartext auf der Platte, im Log oder in einer API-Antwort.

## Größen und Zeiten (gemessen bzw. geschätzt)

| Was | Größe | Wo |
|---|---|---|
| OSM Deutschland (PBF) | 4,9 GB (gemessen) | nur PC |
| SRTM-Höhen | ~0,5 GB (gemessen) | nur PC |
| Wegenetz | ~840 MB (gemessen) | PC → Server, ca. 5 ZIPs |
| Kartenkacheln (PMTiles, Zoom 0–14) | 2–4 GB (geschätzt, nach erstem Lauf eintragen) | PC → Server, ca. 10–20 ZIPs |
| Planetiler-Quellen (Küsten, Natural Earth) | ~1 GB | nur PC |
| Platz auf dem Server während des Einspielens | etwa 2,2 × Paketgröße | danach ~1 × |

## Nicht Teil dieses Plans

- Anhänger-Tauglichkeit der Wege, automatisches Wetter, Rand um Deutschland (offene Punkte aus der README).
- Automatischer, zeitgesteuerter Neubau (später: Aufgabenplanung von Windows mit `--ohne-oberflaeche --alles`).
