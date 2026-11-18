# Paketformat „fawowa-paket-1“

Gemeinsames Format für das Daten-Werkzeug auf dem PC (Go, `daten-bauen/paket.go`) und den Server (Node, `lib/paket.js`).

## Aufbau

- Ein **Paket** hat eine **Art** (`netz` oder `karte`), eine **Version** (Zeitstempel, z. B. `2026-11-18T0815`) und eine Liste
  von **Dateien**.
- Jede Datei wird in **Stücke** zerlegt. Die Stücke werden auf **ZIP-Dateien** verteilt. Eine ZIP ist höchstens **200 000 000 Bytes**
  groß. Davon bleibt eine Reserve von 1 000 000 Bytes für ZIP-Köpfe und das Manifest.
- Einträge sind **unkomprimiert** (`Store`).
- Dateinamen der ZIPs: `<art>-<version>.teil-NNN-von-MMM.zip` (NNN ab 001).
- Einträge in einer ZIP: je Stück `<pfad>.NNN` (z. B. `karte/pts.i32.000`) und `manifest.json`.
- Außerdem liegt das **externe Manifest** `<art>-<version>.manifest.json` im Paketordner.

## Manifest

```json
{
  "format": "fawowa-paket-1",
  "art": "netz",
  "version": "2026-11-18T0815",
  "erzeugt": "2026-11-18T08:15:00Z",
  "quelle": { "osm": "germany-latest.osm.pbf" },
  "zips": [ { "name": "netz-2026-11-18T0815.teil-001-von-002.zip", "bytes": 199800000, "sha256": "…" } ],
  "dateien": [
    { "pfad": "info.json", "bytes": 240, "sha256": "…",
      "stuecke": [ { "zip": "…teil-001…zip", "eintrag": "info.json.000", "offset": 0, "bytes": 240, "sha256": "…" } ] }
  ]
}
```

**Abweichung vom ersten Entwurf**: Das Manifest steckt in jeder ZIP, enthält aber **nicht** die Prüfsummen der ZIPs. Die Prüfsumme
einer ZIP steht erst fest, wenn sie fertig ist, und das Manifest liegt in dieser ZIP. Die Prüfsummen der ZIPs stehen daher nur
im externen Manifest. Die Prüfsummen der Dateien und Stücke stehen in beiden.

## Regeln

- **Pfade** im Paket: nur `a-z0-9._-` und `/`, kein `..`, kein absoluter Pfad. Das wird beim Packen **und** beim Einspielen geprüft.
- **Stücke** einer Datei liegen lückenlos hintereinander (`offset` beginnt bei 0), ihre Größen ergeben die Größe der Datei.
- **Leere Datei**: ein Stück mit 0 Bytes.
- **Prüfung beim Einspielen**: Format, Art und Version; jede ZIP vorhanden, mit der richtigen Größe und Prüfsumme; jedes Stück
  mit Größe und Prüfsumme; jede Datei mit Größe und Prüfsumme.

## Gemeinsame Testdaten

`tests/daten/paket/` enthält ein kleines Beispielpaket. Die Go-Tests (`daten-bauen/paket_test.go`) und die Node-Tests
(`tests/paket.test.js`) prüfen beide dasselbe Manifest.
