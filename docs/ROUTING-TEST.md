# Routing-Test NRW (Phase 5)

Frage: Lässt sich ein **eigenes Routing** auf OpenStreetMap-Daten bauen, das Reichweiten nach Energie (Wh) berechnet, und passt es auf den
Server (Hetzner, 4 GB RAM, 25 GB frei)? Antwort nach dem Test mit ganz NRW: **ja, mit großem Abstand.** Offen sind Randlagen und die Wahl
der Wegarten (siehe „Probleme“).

Alles liegt unter `tools/routing/` und läuft auf dem Entwicklungsrechner; auf den Server kommen später nur die fertigen Netzdateien.
Rohdaten und Ergebnisse liegen außerhalb des Repos in `C:\Users\akurm\Documents\fawowa-garage-routingdaten`.

## Daten

| Daten | Quelle | Größe |
|---|---|---|
| OSM-Daten NRW (`nordrhein-westfalen-latest.osm.pbf`, Stand 15.11.2026) | Geofabrik | 875 MB |
| Höhen: SRTM, 1 Bogensekunde (30 m), 15 Kacheln N50E005 bis N52E009 | AWS Open Data (`elevation-tiles-prod/skadi`) | 91 MB |

## Werkzeuge

| Datei | Aufgabe |
|---|---|
| `pbf.js` | eigener Einleser für das PBF-Format (keine Abhängigkeiten) |
| `tags.js` | bewertet Wege: radbar?, Richtung, Wegart, Belag, Brücke/Tunnel, Hauptstraße |
| `hoehen.js` | SRTM-Höhen mit bilinearer Abfrage |
| `bauen.js` | baut das Netz: Kreuzungen als Knoten, Wege dazwischen als Kanten mit Teilstücken von höchstens ~120 m (Länge, Steigung, Richtung) |
| `netz.js` | lädt das Netz; Einrasten, Suche nach Energie (Dijkstra) und nach Länge |
| `suche.js`, `anzeige.js` | Reichweitensuche mit dem Rechenmodell aus Phase 4 und einfache Anzeige im Browser |
| `qualitaet.js`, `steigungen.js` | Plausibilitätsprüfungen |

```bash
node tools/routing/bauen.js <osm.pbf> <hgt-Ordner> <Netzordner>
node tools/routing/suche.js <Netzordner> muenster_hbf --modus alle [--set wind_ms=6 --set wind_richtung_grad=270]
node tools/routing/anzeige.js <Ergebnisordner>      # http://localhost:3499
```

## Messwerte (Entwicklungsrechner, ein Prozessorkern)

| | Wert |
|---|---|
| Einlesen von 875 MB PBF (86,5 Mio. Knoten, 14,3 Mio. Wege) | 15 s |
| Netz bauen insgesamt (mit Höhen und Glättung) | 27 s, Spitze 2,4 GB RAM |
| Befahrbare Wege / Kreuzungen / Kanten / Teilstücke | 1,62 Mio. / 2,20 Mio. / 2,76 Mio. / 3,53 Mio. |
| Wegenetz (km) | 133 000 Straße · 19 000 Radweg · 126 000 Wirtschaftsweg/Pfad |
| **Größe des Netzes auf der Platte** | **99 MB** |
| Laden | 0,07 s, **158 MB RAM** (ganzer Prozess) |
| Reichweitensuche, 594 Wh (Standard-Gespann, ebene Gegend) | 65 bis 240 ms, ~200 MB RAM |
| Größte gemessene Suche (1,7 Mio. erreichte Knoten, Eco) | 580 ms, 233 MB RAM |
| Kürzester Weg über 70 km | 50 bis 160 ms |

Auf dem Server sind die Zeiten wahrscheinlich 2- bis 4-mal so lang (kleine geteilte Prozessorkerne): rund 0,5 bis 2 Sekunden je Berechnung.
Das ist für „Berechnen“ per Knopfdruck in Ordnung, für Live-Neuberechnung bei jeder Eingabe mit Zwischenspeichern und Pausen gerade noch.

### Ergebnisse (Standard-Gespann: 210 kg, 625 Wh)

| Start | Modus / Änderung | Fläche | weitester Punkt | Zeit |
|---|---|---|---|---|
| Münster | alle Wege | 13 200 km² | 84 km | 240 ms |
| Münster | nur Straße | 12 300 km² | 80 km | 160 ms |
| Münster | Radwege und Nebenstraßen (ohne Hauptstraßen) | 10 900 km² | 76 km | 160 ms |
| Münster | nur Radweg | 0 km² | 0,2 km | 6 ms |
| Münster | Akku 50 % | 4 200 km² | 41 km | 65 ms |
| Münster | Wind 6 m/s aus West | 14 000 km² | 112 km (Osten), geringer im Westen | 270 ms |
| Münster | Eco / Turbo | 25 500 km² / 9 900 km² | 125 km / 67 km | 450 / 170 ms |
| Wuppertal (hügelig) | alle Wege / Straße / ruhig | 12 800 / 11 200 / 4 700 km² | 78 / 73 / 58 km | 360 / 220 / 140 ms |
| Wuppertal | Eco / Turbo | 26 700 / 7 200 km² | 121 / 61 km | 550 / 260 ms |

Die Flächen sind die Summe von 72 Winkelsektoren um den Start (sternförmiger Rand), keine genaue Umrandung des erreichbaren Gebiets.

## Qualität

- **Strecken:** Kürzeste Wege zwischen Großstädten sind das 1,09- bis 1,18-fache der Luftlinie (üblich 1,1 bis 1,3), z. B. Köln–Bonn 28,6 km,
  Essen–Dortmund 35,4 km, Aachen–Köln 72,5 km, Bielefeld–Paderborn 41,9 km. Der Rhein wird nur über Brücken gequert, Köln–Düsseldorf kommt
  auf 38 km. Die „Referenzstrecken“ in `qualitaet.js` sind empfohlene Radrouten, die länger als der kürzeste Weg sind; ein Messwert ist das
  nicht. Ein Auffälliger: Köln Dom → Köln-Deutz liegt mit 2,7 km deutlich über der Luftlinie von 1,1 km (nicht untersucht).
- **Höhen:** Hin und zurück stimmen mit dem Gelände überein: Wuppertal → Düsseldorf (bergab) kostet 205 Wh, zurück 266 Wh; Siegen → Winterberg
  (bergauf) 693 Wh, zurück 502 Wh; Köln ↔ Bonn (eben) 203 und 198 Wh. 51 % der Wegstrecke sind flacher als 2 %, 6 % steiler als 8 %.
- **Karte:** Die Heatmaps zeigen Hügel und das Rheintal plausibel (Wuppertal: das Bergische Land kostet mehr als die Rheinebene).

## Probleme und was daraus folgt

1. **„Nur Fahrradweg“ geht nicht als harter Filter.** Eigene Radwege und Wirtschaftswege hängen nur zu 16 % der Knoten in größeren Netzteilen
   zusammen; ab Münster Hbf erreicht man auf ihnen 0,2 km. Mit „nur Straße“ sind es 64 % (erreichbar, aber ohne Radwege und Brücken für
   Radfahrer lückenhaft), mit „Radwege und Nebenstraßen“ 82 %, mit allem 96 %.
   **Empfehlung:** Modi „Alle Wege“, „Nur Straße“ und „Radwege und ruhige Straßen“. „Radwege bevorzugen“ ließe sich später als Zuschlag auf die Kosten
   einbauen, ohne Wege zu sperren.
2. **Randlagen:** Der NRW-Auszug endet an der Landesgrenze. Von Aachen, Bocholt oder Winterberg aus wird die Fläche an der Grenze
   abgeschnitten (kürzeste Richtung 5 bis 12 km). Für ehrliche Ergebnisse braucht es einen Ausschnitt mit etwa 100 km Rand
   (Niedersachsen, Hessen, Rheinland-Pfalz, Niederlande, Belgien). Der Bauer kann eine Begrenzung einlesen; auf dem Server liegt dann ein Netz
   „NRW plus Rand“.
3. **Fahrerleistung ist die größte Stellschraube:** Eco gegen Turbo ändert die Fläche um den Faktor 2,6 bis 3,7, weil der Fahrer bis zur
   Höchstleistung mehr tritt. Die Oberfläche muss „Eigenleistung“ und „Höchstleistung“ sichtbar machen, sonst wirken die Ergebnisse beliebig.
4. **Solar fehlt in der Suche.** Ein Gutschrift-Zuschlag pro Fahrzeit würde negative Kosten erzeugen. Vorschlag: je Teilstück
   `max(0, Motorverbrauch − Solarertrag)`; das unterschätzt den Nutzen etwas, ist aber sicher.
5. **Anhänger-Tauglichkeit der Wege:** `path` gilt als befahrbar, auch Wanderpfade. Ein Gespann mit Anhänger passt nicht durch Drängelgitter, Poller
   oder schmale Pfade. Nötig sind: `width`, `maxwidth` und Schranken (Poller, Umlaufsperren) auswerten und mit der Anhängerbreite aus
   der Garage vergleichen; bis dahin „Pfade“ im Anhängerbetrieb ausschließen.
6. **Verbesserungen an der Genauigkeit:** Rand der Suche (Teilstücke bis zur leeren Batterie statt nur ganze Knoten), Radweg-Pflicht
   (`use_sidepath`, im Netz markiert, noch ohne Zuschlag), Ampeln, Steigungsrauschen im SRTM-Modell (geglättet auf ±60 m, 878 Teilstücke
   über 40 % begrenzt), neuere Höhendaten.

## Folgerungen für den Server

- **NRW:** 99 MB Netz, rund 160 bis 250 MB RAM. Kein Problem für den 4-GB-Server.
- **Deutschland:** Hochgerechnet etwa das 8- bis 10-fache, also rund 1 GB Netz und 1,5 GB RAM. Passt, wenn der Server nichts anderes Großes
  hält; Bauen nur auf dem Entwicklungsrechner (geschätzt: Spitze 20 bis 25 GB RAM, 5 bis 10 Minuten; nicht gemessen).
- **Europa:** nicht auf diesem Server (zig GB).
- Empfehlung: **NRW mit 100 km Rand** als Start (etwa 300 bis 400 MB Netz), später Deutschland, falls das Bedürfnis da ist. Valhalla als
  Rückweg ist nicht nötig.

## Nächste Schritte (Phase 6)

- Netz mit Rand bauen und auf den Server laden; Suche als Dienst in der Anwendung (Ablauf: Gespann und Einstellungen aus der Garage, Start, Modus →
  Rechenmodell → Suche → Umrandung und Raster).
- Umrandung der erreichbaren Fläche (Rasterkontur oder Hülle) mit Teilstücken am Rand, Kartenansicht mit selbst gehosteter Karte (MapLibre und eine
  Kartendatei für NRW), Heatmap nach Energie, Wetter (Wind, Sonne) über den Server abrufen.
- Anhänger-Tauglichkeit der Wege (Breite, Schranken) und Zuschlag für Radweg-Pflicht.
