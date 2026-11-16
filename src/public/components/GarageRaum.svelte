<script>
  import { pick } from '../lib/i18n.js';

  // Hintergrund der Stellplätze: ein Foto einer Garage (public/garage.webp, KI-erzeugt). Der Lichtschalter im Foto ist ein
  // echter Knopf an derselben Stelle: Klick schaltet das Licht. Beim Einschalten flackert die Röhre, beim Ausschalten wird es dunkel.
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
  <div class="szene">
    <img src="/garage.webp" alt="" aria-hidden="true" width="2000" height="1125" />
    <!-- Leuchtstoffröhre oben in der Mitte: Glanz und Flackern -->
    <div class="glanz" aria-hidden="true"></div>
    <!-- Lichtschalter rechts neben der Steckdose -->
    <button type="button" class="schalter" onclick={schalten} aria-pressed={licht}
      aria-label={pick({ de: 'Licht ein- und ausschalten', en: 'Switch light on or off' }, lang)}
      title={pick({ de: 'Licht', en: 'Light' }, lang)}></button>
  </div>

  <div class="dunkel" aria-hidden="true"></div>
  <div class="inhalt">
    {@render children()}
  </div>
</div>

<style>
  .raum { position: relative; border-radius: var(--radius); overflow: hidden; margin-bottom: 1.5rem; background: #1b1d21; isolation: isolate; }
  .szene { position: relative; width: 100%; aspect-ratio: 2000 / 1125; }
  .szene img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: filter .3s; }
  /* Licht aus: das Foto wird deutlich dunkler */
  .aus .szene img { filter: brightness(.35) saturate(.7); }
  /* Glanz unter der Röhre (Position passend zum Foto) */
  .glanz {
    position: absolute; left: 30%; top: 2%; width: 40%; height: 22%; pointer-events: none;
    background: radial-gradient(ellipse at 50% 20%, rgba(255, 255, 240, .35), transparent 70%);
    transition: opacity .25s;
  }
  .aus .glanz { opacity: 0; }
  /* Schalter: unsichtbarer Knopf über dem Schalter im Foto, mit Fokus-Rahmen */
  .schalter {
    position: absolute; left: 78%; top: 51%; width: 2.6%; height: 6%; min-width: 1.6rem; min-height: 2.2rem;
    transform: translate(-50%, -50%); background: transparent; border: 0; border-radius: 4px; cursor: pointer; padding: 0;
  }
  .schalter:hover { background: rgba(255, 255, 255, .12); }
  .schalter:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  /* Rand dunkel auslaufen lassen */
  .dunkel {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(ellipse at 50% 40%, transparent 45%, rgba(0, 0, 0, .55) 100%);
  }
  .aus .dunkel { background: radial-gradient(ellipse at 50% 40%, transparent 25%, rgba(0, 0, 0, .8) 100%); }
  /* Flackern beim Einschalten */
  .flackern .glanz { animation: flackern .6s steps(1) 1; }
  .flackern .szene img { animation: flackern-bild .6s steps(1) 1; }
  @keyframes flackern {
    0% { opacity: .15; } 12% { opacity: 1; } 22% { opacity: .25; } 34% { opacity: 1; }
    48% { opacity: .4; } 60% { opacity: 1; } 74% { opacity: .7; } 100% { opacity: 1; }
  }
  @keyframes flackern-bild {
    0% { filter: brightness(.45); } 12% { filter: none; } 22% { filter: brightness(.6); } 34% { filter: none; }
    48% { filter: brightness(.7); } 60% { filter: none; } 74% { filter: brightness(.9); } 100% { filter: none; }
  }
  .inhalt { padding: 1rem; }
  @media (prefers-reduced-motion: reduce) { .flackern .glanz, .flackern .szene img { animation: none; } }
</style>
