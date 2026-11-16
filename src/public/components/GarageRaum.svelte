<script>
  import { pick } from '../lib/i18n.js';

  // Die Stellplätze liegen vor einem Garagenfoto (public/garage.webp, KI-erzeugt). Das Foto ist der Hintergrund; die Kacheln liegen davor.
  // Der Lichtschalter im Foto ist ein echter Knopf: Klick schaltet das Licht. Beim Einschalten flackert das Licht kurz.
  // Ausgeschaltet wird das Bild sehr dunkel, und der Schalter leuchtet schwach, damit man ihn findet.
  let { lang, children } = $props();

  let licht = $state(true);
  let flackert = $state(false);

  function schalten() {
    licht = !licht;
    flackert = licht; // nur beim Einschalten flackern
  }

  function ende(e) {
    if (e.animationName === 'flackern') flackert = false;
  }
</script>

<div class="raum" class:aus={!licht} class:flackern={flackert} onanimationend={ende}>
  <div class="bild" aria-hidden="true">
    <img src="/garage.webp" alt="" width="2000" height="1125" />
    <!-- Glanz unter der Leuchtstoffröhre (oben in der Mitte des Fotos) -->
    <div class="glanz"></div>
    <!-- Lichtschalter neben der Steckdose; ein Knopf über dem Foto -->
    <button type="button" class="schalter" class:leuchtet={!licht} onclick={schalten} aria-pressed={licht}
      aria-label={pick({ de: 'Licht ein- und ausschalten', en: 'Switch light on or off' }, lang)}
      title={pick({ de: 'Licht', en: 'Light' }, lang)}></button>
  </div>

  <div class="dunkel" aria-hidden="true"></div>
  <div class="inhalt">
    <!-- Freier Streifen unter dem Lichtschalter: hier beginnen die Stellplätze, damit nie eine Kachel über dem Schalter liegt -->
    <div class="platz" aria-hidden="true"></div>
    {@render children()}
  </div>
</div>

<style>
  .raum { position: relative; isolation: isolate; border-radius: var(--radius); overflow: hidden; margin-bottom: 1.5rem; background: #15171b; }
  /* Das Foto liegt hinter allem: oben im Bereich, nach unten in den dunklen Hintergrund übergehend */
  .bild { position: absolute; top: 0; left: 0; right: 0; aspect-ratio: 2000 / 1125; z-index: 0; }
  .bild img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: filter .4s; }
  /* Licht aus: das Foto wird sehr dunkel */
  .aus .bild img { filter: brightness(.15) saturate(.5); }
  /* Glanz unter der Röhre (Position passend zum Foto) */
  .glanz {
    position: absolute; left: 30%; top: 2%; width: 40%; height: 22%; pointer-events: none;
    background: radial-gradient(ellipse at 50% 20%, rgba(255, 255, 240, .35), transparent 70%);
    transition: opacity .25s;
  }
  .aus .glanz { opacity: 0; }
  /* Schalter: Knopf über dem Schalter im Foto; leuchtet schwach, wenn das Licht aus ist */
  .schalter {
    position: absolute; z-index: 1; left: 78%; top: 51%; width: 2.6%; height: 6%; min-width: 1.6rem; min-height: 2.2rem;
    transform: translate(-50%, -50%); background: transparent; border: 0; border-radius: 4px; cursor: pointer; padding: 0;
    transition: box-shadow .3s, background-color .3s;
  }
  .schalter:hover { background: rgba(255, 255, 255, .12); }
  .schalter:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .schalter.leuchtet { background: rgba(255, 236, 170, .25); box-shadow: 0 0 10px 3px rgba(255, 228, 150, .55); }
  /* Rand und unterer Bereich dunkel auslaufen lassen */
  .dunkel {
    position: absolute; inset: 0; z-index: 1; pointer-events: none;
    background:
      linear-gradient(to bottom, transparent 35%, rgba(21, 23, 27, .95) 100%),
      radial-gradient(ellipse at 50% 35%, transparent 45%, rgba(0, 0, 0, .55) 100%);
    transition: background-color .4s;
  }
  .aus .dunkel { background: linear-gradient(to bottom, rgba(0, 0, 0, .7), rgba(0, 0, 0, .95)); }
  /* Flackern beim Einschalten */
  .flackern .glanz { animation: flackern .6s steps(1) 1; }
  .flackern .bild img { animation: flackern-bild .6s steps(1) 1; }
  @keyframes flackern {
    0% { opacity: .15; } 12% { opacity: 1; } 22% { opacity: .25; } 34% { opacity: 1; }
    48% { opacity: .4; } 60% { opacity: 1; } 74% { opacity: .7; } 100% { opacity: 1; }
  }
  @keyframes flackern-bild {
    0% { filter: brightness(.45); } 12% { filter: none; } 22% { filter: brightness(.6); } 34% { filter: none; }
    48% { filter: brightness(.7); } 60% { filter: none; } 74% { filter: brightness(.9); } 100% { filter: none; }
  }
  .inhalt { position: relative; z-index: 2; padding: 1rem; }
  /* Prozent-Abstand bezieht sich auf die Breite; das Schalterband liegt bei etwa 33 % der Breite */
  .platz { padding-top: 34%; }
  @media (prefers-reduced-motion: reduce) { .flackern .glanz, .flackern .bild img { animation: none; } }
</style>
