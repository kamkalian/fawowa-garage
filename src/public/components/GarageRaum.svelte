<script>
  import { pick } from '../lib/i18n.js';

  // Die Stellplätze liegen vor einem Garagenfoto (public/garage.webp, KI-erzeugt) in voller Größe.
  // Zu Beginn ist es immer dunkel. Der Lichtschalter ist ein unsichtbarer Knopf an der Stelle des Schalters im Foto:
  // Klick schaltet das Licht, beim Einschalten flackert es kurz. Der Status wird im Cookie „garage_licht“ gespeichert.
  // Die Kacheln liegen im Bereich links und scrollen innerhalb des Bildes. kopf: Inhalt oben rechts (z. B. das Profil-Icon).
  let { lang, children, kopf = null } = $props();

  const COOKIE = 'garage_licht';
  let licht = $state(false);
  let flackert = $state(false);

  // Cookie schreiben; ohne Cookie-Unterstützung gilt der Status nur für diesen Besuch
  function speichereStatus(an) {
    try {
      document.cookie = `${COOKIE}=${an ? '1' : '0'}; max-age=31536000; path=/; SameSite=Lax`;
    } catch { /* kein Cookie möglich */ }
  }

  function schalten() {
    licht = !licht;
    flackert = licht; // nur beim Einschalten flackern
    speichereStatus(licht);
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
  </div>

  <!-- Schalterebene: liegt über den Kacheln; der Schalter ist der einzige klickbare Teil an dieser Stelle -->
  <div class="schalterebene">
    <button type="button" class="schalter" onclick={schalten} aria-pressed={licht}
      aria-label={pick({ de: 'Licht ein- und ausschalten', en: 'Switch light on or off' }, lang)}
      title={pick({ de: 'Licht', en: 'Light' }, lang)}></button>
  </div>

  <div class="dunkel" aria-hidden="true"></div>

  {#if kopf}
    <div class="kopf">{@render kopf()}</div>
  {/if}

  <div class="inhalt">
    {@render children()}
  </div>
</div>

<style>
  /* Das Bild ist genau so groß wie der Bereich: in voller Größe sichtbar, nichts wird abgeschnitten */
  .raum {
    position: relative; isolation: isolate; container-type: inline-size; aspect-ratio: 2000 / 1125;
    border-radius: var(--radius); overflow: hidden; margin-bottom: 1.5rem; background: #15171b;
  }
  .bild { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
  .bild img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: filter .4s; }
  /* Zu Beginn und bei ausgeschaltetem Licht: sehr dunkel, aber nicht schwarz */
  .aus .bild img { filter: brightness(.25) saturate(.6); }
  .glanz {
    position: absolute; left: 30%; top: 2%; width: 40%; height: 22%; pointer-events: none;
    background: radial-gradient(ellipse at 50% 20%, rgba(255, 255, 240, .35), transparent 70%);
    transition: opacity .25s;
  }
  .aus .glanz { opacity: 0; }
  /* Schalter: nur ein klickbares Element ohne Rahmen; Größe in Prozent der Garagenbreite, Mitte an der Stelle im Foto */
  .schalterebene { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
  .schalter {
    pointer-events: auto; position: absolute; left: calc(78cqw - .5cqw + 7px); top: calc(28.6875cqw + .6cqw - 7px);
    width: max(2.6cqw, 1.8rem); height: max(3.4cqw, 2.4rem); transform: translate(-50%, -50%);
    background: transparent; border: 0; border-radius: 4px; padding: 0; cursor: pointer;
  }
  /* Tastaturfokus sichtbar machen, ohne dass ein Rahmen zu sehen ist, wenn nur geklickt wird */
  .schalter:focus:not(:focus-visible) { outline: none; }
  .schalter:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .dunkel {
    position: absolute; inset: 0; z-index: 1; pointer-events: none;
    background: radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(0, 0, 0, .45) 100%);
  }
  .aus .dunkel { background: linear-gradient(to bottom, rgba(10, 11, 13, .35), rgba(10, 11, 13, .6)); }
  /* Profil-Icon oben rechts, außerhalb des scrollenden Bereichs */
  .kopf { position: absolute; top: .6rem; right: .6rem; z-index: 4; }
  /* Die Kacheln scrollen innerhalb des Bildbereichs */
  .inhalt { position: absolute; inset: 0; z-index: 2; overflow-y: auto; padding: .75rem 1rem 1rem; }
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
  @media (prefers-reduced-motion: reduce) { .flackern .glanz, .flackern .bild img { animation: none; } }
</style>
