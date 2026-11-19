<script>
  import { pick } from '../lib/i18n.js';
  // Erklärung, was der Planer rechnet und welche Angaben er dabei berücksichtigt (Stand: Rechenmodell in lib/rechenmodell.js)
  let { lang } = $props();
  const p = (de, en) => pick({ de, en }, lang);
</script>

<div class="info">
  <h3>{p('Was berechnet wird', 'What is calculated')}</h3>
  <p>{p(
    'Vom Startpunkt aus wird berechnet, wie weit das Gespann mit dem gewählten Budget kommt. Das Budget ist entweder der nutzbare Akku (Füllstand minus Reserve) oder eine feste Fahrtzeit. Die Suche läuft über das Wegenetz (Straßen, Radwege, Feld- und Waldwege): Jeder Knoten bekommt die kleinste Energie bzw. Zeit, die man bis dorthin braucht.',
    'From the start point the planner works out how far the combination gets with the chosen budget. The budget is either the usable battery (charge level minus reserve) or a fixed riding time. The search runs over the road network (roads, cycle paths, farm and forest tracks): every junction gets the smallest energy or time needed to reach it.'
  )}</p>

  <h3>{p('Punkte, Routen, Heatmap, Grenze', 'Points, routes, heatmap, boundary')}</h3>
  <ul>
    <li><strong>{p('Punkte', 'Points')}</strong>: {p(
      'Rund um den Start liegen Gitterpunkte im Abstand von 0,5, 1 oder 2 km (Schieber in den weiteren Einstellungen). Jeder Punkt wird auf den günstigsten Knoten des Netzes in der Nähe gesetzt. Grün: im Budget erreichbar. Rot: knapp außerhalb.',
      'Grid points lie around the start at 0.5, 1 or 2 km spacing (slider in the further settings). Each point is placed on the cheapest network node nearby. Green: reachable within the budget. Red: just outside.'
    )}</li>
    <li><strong>{p('Routen', 'Routes')}</strong>: {p(
      'Für jeden erreichbaren Punkt wird der Weg vom Start zurückverfolgt. Die Abschnitte teilen sich die Routen, sodass jede Strecke nur einmal gezeichnet wird. Die Farbe zeigt die Steigung.',
      'For each reachable point the way back to the start is traced. Routes share their sections, so each stretch is drawn once. The colour shows the gradient.'
    )}</li>
    <li><strong>{p('Heatmap', 'Heatmap')}</strong>: {p(
      'Zeigt, wie viel vom Budget bis zu einer Stelle verbraucht ist: grün nah am Start, rot am Ende der Reichweite.',
      'Shows how much of the budget is used up at each place: green near the start, red at the edge of the range.'
    )}</li>
    <li><strong>{p('Grenze', 'Boundary')}</strong>: {p(
      'Die rote Linie verbindet je Richtung (72 Richtungen) den weitesten erreichbaren Punkt.',
      'The red line joins the furthest reachable point in each direction (72 directions).'
    )}</li>
  </ul>

  <h3>{p('Berücksichtigte Angaben', 'Factors taken into account')}</h3>
  <ul>
    <li><strong>{p('Steigungen', 'Gradients')}</strong>: {p(
      'Jedes Wegstück hat seine Steigung aus dem Höhenmodell. Bergauf braucht der Fahrer und der Motor Energie, bergab wird nichts zurückgewonnen. Ist eine Steigung mit der gewählten Unterstützung nicht mehr fahrbar, wird geschoben (5 km/h).',
      'Every stretch has its gradient from the height model. Going uphill costs energy from rider and motor; going downhill recovers nothing. If a gradient is no longer rideable with the chosen assistance, the bike is pushed at 5 km/h.'
    )}</li>
    <li><strong>{p('Ampeln, Kreuzungen, Halte', 'Traffic lights, junctions, stops')}</strong>: {p(
      'Wo der Weg einen Knoten mit Regel erreicht, wird je nach Art angehalten (Anteil der Fälle) und wieder angefahren. Das kostet Zeit und die Energie, um die Geschwindigkeit wieder aufzubauen. Ampel: 60 % der Fälle, 25 s Wartezeit. Haltestelle: 90 %, 5 s. Vorfahrt achten: 50 %, 4 s. Überweg: 30 %, 4 s. Kreuzung ohne Regel: 15 %, 4 s.',
      'Where the route reaches a junction with a rule, the rider stops in a share of cases and pulls away again. This costs time and the energy to regain speed. Traffic light: 60 % of cases, 25 s waiting. Stop: 90 %, 5 s. Give way: 50 %, 4 s. Pedestrian crossing: 30 %, 4 s. Unregulated junction: 15 %, 4 s.'
    )}</li>
    <li><strong>{p('Belag', 'Surface')}</strong>: {p(
      'Glatter Asphalt bis fester Schotter. Je rauer der Belag, desto größer der Rollwiderstand und der Verbrauch (Faktor 1 bis 2).',
      'Smooth asphalt to firm gravel. The rougher the surface, the higher the rolling resistance and the consumption (factor 1 to 2).'
    )}</li>
    <li><strong>{p('Wind', 'Wind')}</strong>: {p(
      'Stärke und Richtung. Gegenwind erhöht den Luftwiderstand, Rückenwind senkt ihn. Die Richtung wird in 16 Sektoren berechnet.',
      'Strength and direction. Headwind increases air resistance, tailwind reduces it. Direction is calculated in 16 sectors.'
    )}</li>
    <li><strong>{p('Temperatur und Höhe', 'Temperature and altitude')}</strong>: {p(
      'Beide bestimmen die Luftdichte: warme und hoch gelegene Luft ist dünner und bremst weniger.',
      'Both set the air density: warm and high air is thinner and slows you down less.'
    )}</li>
    <li><strong>{p('Gewichte', 'Weights')}</strong>: {p(
      'Fahrer (Standard 75 kg), Fahrrad, Anhänger mit Leergewicht und Gepäck. Fehlt eine Angabe, wird ein Standardwert genommen und im Ergebnis genannt.',
      'Rider (default 75 kg), bike, trailer with empty weight and luggage. If a value is missing, a default is used and named in the result.'
    )}</li>
    <li><strong>{p('Fahrweise', 'Riding style')}</strong>: {p(
      'Gemütlich oder sportlich. Dazu die Reisegeschwindigkeit, die eigene Tretleistung (höchstens so viel, wie der Fahrer schafft) und die Unterstützung: das Verhältnis von Motor- zu Eigenleistung (Eco 1,0, Tour 1,5, Sport 2,0). Am Berg tritt der Fahrer mit seiner Kraft (je nach Modus Entspannt oder Volle Power) und der Motor deckt den Rest bis zu seiner Grenze. Der Motor unterstützt nur bis 25 km/h.',
      'Relaxed or sporty. Plus the cruising speed, the own pedalling power (at most what the rider manages) and the assistance: the ratio of motor to own power on the flat (Eco 1.0, Tour 1.5, Sport 2.0). On climbs the rider pedals with his strength (Relaxed or Full power) and the motor covers the rest up to its limit. The motor assists only up to 25 km/h.'
    )}</li>
    <li><strong>{p('Eigenleistung bei Steigungen', 'Own power on climbs')}</strong>: {p(
      'Entspannt: der Motor trägt am Berg mehr, der Fahrer tritt höchstens 60 % seiner Höchstleistung, der Motor bleibt bei seiner Nennleistung (250 W). Volle Power: der Fahrer tritt wie eingestellt, der Motor darf kurzzeitig bis zu seiner Spitze (450 W) helfen. Das gilt nur auf Steigungen.',
      'Relaxed: the motor carries more on climbs, the rider pedals at most 60 % of their maximum, the motor stays at its rated 250 W. Full power: the rider pedals as set, the motor may briefly help up to its peak (450 W). This applies only on climbs.'
    )}</li>
    <li><strong>{p('Motor, Schaltung, Akku', 'Motor, gears, battery')}</strong>: {p(
      'Wirkungsgrade: Mittelmotor 80 %, Nabenmotor 75 %, Kette 95 %, Akkuentladung 95 %. Die Akkus des Gespanns werden addiert. Die Reserve bleibt unangetastet. Ein Ersatzakku wird nur gerechnet, wenn er im Gespann eingetragen ist.',
      'Efficiencies: mid-drive motor 80 %, hub motor 75 %, chain 95 %, battery discharge 95 %. The batteries of the combination are added together. The reserve stays untouched. A spare battery is counted only if it is entered in the combination.'
    )}</li>
    <li><strong>{p('Solar', 'Solar')}</strong>: {p(
      'Solarmodule am Anhänger laden mit 80 % ihrer Nennleistung, je nach Sonneneinstrahlung.',
      'Solar panels on the trailer charge at 80 % of their rated power, depending on sunlight.'
    )}</li>
    <li><strong>{p('Wege', 'Ways')}</strong>: {p(
      'Alle Wege, nur Straßen, oder Radwege und ruhige Straßen (ohne Haupt- und Landstraßen).',
      'All ways, roads only, or cycle paths and quiet roads (without main and country roads).'
    )}</li>
    <li><strong>{p('Budget', 'Budget')}</strong>: {p(
      'Nach Akku: der nutzbare Akku wird verbraucht, bis er an der Reserve ist. Nach Fahrtzeit: es zählt nur die Zeit, der Akkustand spielt keine Rolle.',
      'By battery: the usable battery is used until it reaches the reserve. By riding time: only the time counts, the battery level does not matter.'
    )}</li>
  </ul>

  <h3>{p('Genauigkeit', 'Accuracy')}</h3>
  <p>{p(
    'Das Rechenmodell nutzt Erfahrungswerte, keine Messungen. Wind, Steigungen, Belag und Ampeln verändern die Reichweite stark. Plane eine Reserve ein.',
    'The model uses rules of thumb, not measurements. Wind, gradients, surface and traffic lights change the range a lot. Plan a reserve.'
  )}</p>
</div>

<style>
  .info { display: flex; flex-direction: column; gap: .5rem; font-size: .875rem; line-height: 1.45; }
  .info h3 { font-size: .9375rem; margin: .5rem 0 0; }
  .info p, .info li { margin: 0; }
  .info ul { margin: 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: .35rem; }
</style>
