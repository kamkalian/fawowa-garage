# Rechenmodell des Reichweiten-Planers

Datei: `lib/rechenmodell.js` (reine Funktionen, läuft auf dem Server und im Browser). Tests: `tests/rechenmodell.test.js`.
Ausprobieren: `node scripts/rechenmodell-demo.js` (Tabellen für ein Beispiel-Gespann).

Das Modell rechnet den **Energieverbrauch aus dem Akku** für ein Wegstück aus (Länge, Steigung, Fahrtrichtung) und fährt damit
eine Route ab, bis der nutzbare Akku leer ist. Karte, Routing und Wetterabruf kommen in den nächsten Phasen; sie liefern
nur die Segmente und die Einstellungen.

## Ablauf

```js
const { modell, annahmen, fehler } = baueModell(fahrrad, anhaenger, gespann, einstellungen);
const r = berechneSegment(modell, { laenge_m: 250, steigung: 0.04, richtung_grad: 270 });   // ein Wegstück
const w = reichweiteEntlang(modell, segmente);                                                // eine Route
```

`fahrrad`, `anhaenger` und `gespann` sind die Einträge der Garage (Feldnamen wie in `lib/felder.js`); der Anhänger darf fehlen.

## Eingaben

**Aus der Garage:** Gewichte (Fahrrad, Anhänger, Fahrer, Zuladung, Zusatzakkus), Akku- und Zusatzakku-Kapazität, Motorart und
Nennleistung, Schaltung, Reifenbreite und Radgröße (Rollwiderstand), Breite und Höhe des Anhängers (Luftwiderstand), Solarleistung.

**Einstellungen** (`EINSTELLUNGEN_STANDARD`, geprüft mit `pruefeEinstellungen`):

| Einstellung | Standard | Bedeutung |
|---|---|---|
| `akku_rest_prozent` | 100 | Füllstand des Hauptakkus |
| `zusatz_rest_prozent` | wie Hauptakku | Füllstand der Zusatzakkus (am Fahrrad und im Anhänger) |
| `reserve_prozent` | 5 | Anteil der Gesamtkapazität, der nie verbraucht wird |
| `geschwindigkeit_kmh` | 18 | gewünschte Reisegeschwindigkeit, 5 bis 25 (darüber schaltet ein Pedelec den Motor ab) |
| `eigenleistung_w` | 60 | Tretleistung des Fahrers auf der Ebene |
| `eigenleistung_max_w` | 150 | so viel tritt er bergauf höchstens |
| `unterstuetzung` | `tour` | `aus`, `eco` (60 %), `tour` (140 %), `sport` (240 %), `turbo` (340 %), `max`: Motorleistung höchstens so viel Prozent der Tretleistung |
| `wind_ms`, `wind_richtung_grad` | 0, 0 | Windgeschwindigkeit und die Richtung, **aus der** der Wind weht (0 = Nord, 90 = Ost) |
| `temperatur_c`, `hoehe_m` | 15, 100 | für die Luftdichte |
| `einstrahlung_w_m2` | 0 | Sonneneinstrahlung auf die Module (0 bis 1200) |
| `oberflaeche` | 1 | Rollwiderstand relativ zu Asphalt (Pflaster 1,6, fester Schotter 2); ein Segment kann ihn überschreiben |

Fehlt eine Angabe, nimmt das Modell einen Standardwert und nennt das Feld in `annahmen` (die Oberfläche kann das anzeigen, z. B.
„Fahrergewicht fehlt, 75 kg angenommen“). Nicht gerechnet wird bei `fehler`: `fahrrad_fehlt`, `kein_motor` (Motorart „ohne“),
`akku_fehlt` (weder Haupt- noch Zusatzakku), `einstellungen_ungueltig`.

## Physik

Für ein Segment mit Steigung `s` (Winkel `θ = atan s`), Masse `m = m₁ + m₂` (Fahrrad mit Fahrer, Anhänger mit Zuladung):

- Rollwiderstand: `F_roll = g·cos θ·(c₁·m₁ + c₂·m₂)·Oberfläche` mit `c` nach Reifenbreite (unter 30 mm 0,005, bis 50 mm 0,006, darüber 0,0065)
  und +0,002 bei Rädern bis 20 Zoll.
- Hangabtrieb: `F_hang = m·g·sin θ` (bergab negativ).
- Luftwiderstand: `F_luft = ½·ρ·CdA·v_l·|v_l|` mit der Luftgeschwindigkeit `v_l = v + Gegenwindanteil`. Der Gegenwindanteil ist
  `Wind·cos(Fahrtrichtung − Windherkunft)`: positiv Gegenwind, negativ Rückenwind, bei Seitenwind null.
  `CdA = 0,55 m²` (Fahrer aufrecht) `+ 0,08 m²` (Räder, Deichsel) `+ 0,9·max(0, Stirnfläche − 0,45 m²)` für den Teil des Anhängers
  außerhalb des Windschattens. Die Luftdichte `ρ` kommt aus Temperatur und Höhe.
- Leistung am Hinterrad: `P = (F_roll + F_hang + F_luft)·v`.

**Geschwindigkeit:** Es gilt die gewünschte, solange Fahrer und Motor genug Leistung liefern. Der Fahrer tritt auf der Ebene die
Grundleistung und bergauf so viel mehr, wie nötig ist, bis zur Höchstleistung. Reicht auch das nicht, sinkt die Geschwindigkeit, bis
die Leistung gerade genügt. Unter 1,8 m/s gilt das Stück als nicht fahrbar (`schieben`): Schieben mit 5 km/h und Schiebehilfe.

**Antrieb:** Der Motor liefert, was nach der Tretleistung fehlt, höchstens `Faktor·Tretleistung` und höchstens das Doppelte der
Nennleistung. Ein Mittelmotor gibt seine Leistung über die Kette ab, ein Nabenmotor nicht. Wirkungsgrade: Schaltung Kette 0,95, Nabe 0,91,
Getriebe 0,90, stufenlos 0,85, ohne 0,96; Motor mit Steuerung Mittelmotor 0,80, Nabenmotor 0,75; Akku 0,95.
`Akkuleistung = Motorleistung / (Motor · Akku)`. Bergab und bei starkem Rückenwind verbraucht der Motor nichts; es gibt keine Rückgewinnung.

**Folge für die Stufen:** Der Fahrer tritt bergauf und bei Gegenwind so viel mehr, wie nötig ist (bis zur Höchstleistung); bei einer niedrigen
Stufe leistet er also einen größeren Teil selbst. Deshalb reicht der Akku in „Eco“ weiter als in „Turbo“, und „Turbo“ ist vor allem schneller
bergauf. Wer sich nicht anstrengen will, setzt die Höchstleistung herunter.

**Solar:** `Modulleistung · Einstrahlung/1000 · 0,8` lädt den Akku während der Fahrzeit des Segments. Der Akku wird nie über seine
Kapazität geladen.

**Reichweite:** `reichweiteEntlang` fährt die Segmente in Reihenfolge ab. Wird der Akku mitten in einem Segment leer
(Gesamtkapazität × Reserve erreicht), zählt dieses Segment anteilig.

## Was das Modell nicht abbildet

- Drehmomentgrenze des Motors und die Wahl der Übersetzung (sehr steile Stücke werden über die Leistung begrenzt, nicht über das Drehmoment).
- Stopps, Ampeln, Anfahren, Bremsen (die Geschwindigkeit ist die Reisegeschwindigkeit), Böen und Windschatten durch Hindernisse.
- Einfluss von Kälte und Alterung auf die nutzbare Akkukapazität, Verluste in Kabeln und Steckern.
- Reifendruck, Beladung der Anhängerachse und die Spurführung des Anhängers (nur pauschal im Rollwiderstand).

Die Werte sind Faustwerte aus der Literatur und der Praxis von Pedelecs mit Anhänger. Sie sind **Annahmen, keine Messungen**; wer
das Modell mit Fahrtdaten eines echten Gespanns vergleicht, kann Rollwiderstand, Luftwiderstand und Wirkungsgrade in den Konstanten am
Anfang der Datei nachziehen. Das Verhalten (Richtung der Einflüsse, Obergrenzen, Anteile) sichern die Tests ab.
