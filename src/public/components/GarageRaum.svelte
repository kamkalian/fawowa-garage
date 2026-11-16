<script>
  import { pick } from '../lib/i18n.js';

  // Hintergrund der Stellplätze: eine Garage mit weißen Ziegelwänden, Leuchtstoffröhre, Werkzeug an der Wand, Steckdose und Lichtschalter.
  // Der Schalter schaltet das Licht; beim Einschalten flackert die Röhre kurz. Zum Rand hin wird der Raum dunkel.
  let { lang, children } = $props();

  let licht = $state(true);
  let flackert = $state(false);

  function schalten() {
    licht = !licht;
    flackert = licht; // nur beim Einschalten flackern
  }

  // Die Animation endet; danach ist die Röhre wieder ruhig
  function ende(e) {
    if (e.animationName === 'flackern') flackert = false;
  }
</script>

<div class="raum" class:aus={!licht} class:flackern={flackert} onanimationend={ende}>
  <div class="wand" aria-hidden="true"></div>

  <div class="szene">
    <svg viewBox="0 0 1000 420" preserveAspectRatio="none" aria-hidden="true">
      <!-- Decke -->
      <rect x="0" y="0" width="1000" height="14" fill="#4b5059" />
      <!-- Leuchtstoffröhre und Halterung -->
      <rect x="290" y="30" width="420" height="30" rx="4" fill="#c4c9d0" />
      <g class="roehre-gruppe">
        <rect class="roehre" x="300" y="38" width="400" height="14" rx="7" />
      </g>
      <!-- Regal links -->
      <rect x="40" y="130" width="230" height="8" fill="#8b6b4a" />
      <rect x="60" y="92" width="50" height="38" fill="#c9a77c" stroke="#6f5234" stroke-width="2" />
      <rect x="120" y="104" width="40" height="26" fill="#b8956a" stroke="#6f5234" stroke-width="2" />
      <rect x="170" y="78" width="60" height="52" fill="#d4b48a" stroke="#6f5234" stroke-width="2" />
      <rect x="240" y="110" width="22" height="20" rx="3" fill="#7d8790" />
      <!-- Werkzeug an der Wand rechts -->
      <g fill="none" stroke="#5b626c" stroke-width="5" stroke-linecap="round">
        <!-- Hammer -->
        <path d="M720 120 V180" />
        <path d="M700 118 H740 V132 H700 Z" fill="#7b828c" stroke="#5b626c" stroke-width="3" />
        <!-- Schraubenschlüssel -->
        <path d="M780 110 V190" />
        <path d="M770 104 Q780 92 790 104 V116 H770 Z" fill="#7b828c" stroke-width="3" />
        <!-- Säge -->
        <path d="M830 110 L870 110 L880 150 L835 150 Z" fill="#9aa1ab" stroke="#5b626c" stroke-width="3" />
        <path d="M838 150 V168 M852 150 V168 M866 150 V168" stroke-width="3" />
      </g>
      <!-- Leitung von der Decke zur Steckdose -->
      <path d="M945 14 V226" fill="none" stroke="#2f3439" stroke-width="5" />
      <!-- Steckdose -->
      <rect x="918" y="226" width="30" height="34" rx="4" fill="#f5f6f8" stroke="#5c6470" stroke-width="2" />
      <circle cx="927" cy="238" r="2.5" fill="#5c6470" />
      <circle cx="939" cy="238" r="2.5" fill="#5c6470" />
      <circle cx="933" cy="251" r="3" fill="#5c6470" />
    </svg>
    <!-- Lichtschalter neben der Steckdose; ein echter Knopf, damit er per Tastatur und Maus geht -->
    <button type="button" class="schalter" class:an={licht} onclick={schalten} aria-pressed={licht}
      aria-label={pick({ de: 'Licht', en: 'Light' }, lang)}>
      <span class="hebel"></span>
    </button>
    <div class="glanz" aria-hidden="true"></div>
  </div>

  <div class="dunkel" aria-hidden="true"></div>
  <div class="inhalt">
    {@render children()}
  </div>
</div>

<style>
  .raum { position: relative; border-radius: var(--radius); overflow: hidden; margin-bottom: 1.5rem; background: #cfcac1; isolation: isolate; }
  /* Ziegelwand: weiße Steine mit hellen Fugen */
  .wand {
    position: absolute; inset: 0; z-index: -2;
    background-color: #ece8e0;
    background-image:
      linear-gradient(#c7c0b3 2px, transparent 2px),
      linear-gradient(90deg, #c7c0b3 2px, transparent 2px);
    background-size: 64px 30px;
    opacity: .85;
  }
  .szene { position: relative; width: 100%; aspect-ratio: 1000 / 420; }
  .szene svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .roehre { fill: #fffbe6; stroke: #d6d3c4; stroke-width: 1.5; }
  .aus .roehre { fill: #3d434c; stroke: #2b2f36; }
  .glanz {
    position: absolute; left: 25%; top: 4%; width: 50%; height: 40%; pointer-events: none;
    background: radial-gradient(ellipse at 50% 30%, rgba(255, 252, 230, .45), transparent 70%);
    transition: opacity .25s;
  }
  .aus .glanz { opacity: 0; }
  /* Schalter: rechts neben der Steckdose */
  .schalter {
    position: absolute; left: 89.5%; top: 53%; width: 2.2%; height: 7.5%; min-width: 1.6rem; min-height: 2.4rem;
    transform: translate(-50%, 0); border: 1px solid #5c6470; border-radius: 3px; background: #f5f6f8; cursor: pointer; padding: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .schalter:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .hebel { display: block; width: 45%; height: 40%; background: #9aa1ab; border-radius: 2px; transform: translateY(-30%); transition: transform .15s; }
  .schalter.an .hebel { transform: translateY(-30%); }
  .schalter:not(.an) .hebel { transform: translateY(30%); }
  /* Dunkel: Rand und Ecken, bei ausgeschaltetem Licht insgesamt */
  .dunkel {
    position: absolute; inset: 0; pointer-events: none; z-index: -1;
    background: radial-gradient(ellipse at 50% 35%, transparent 40%, rgba(0, 0, 0, .45) 100%);
    transition: background-color .25s;
  }
  .aus .dunkel {
    background:
      radial-gradient(ellipse at 50% 35%, transparent 25%, rgba(0, 0, 0, .7) 100%);
  }
  /* Flackern beim Einschalten */
  .flackern .roehre-gruppe, .flackern .glanz { animation: flackern .6s steps(1) 1; }
  @keyframes flackern {
    0% { opacity: .15; }
    12% { opacity: 1; }
    22% { opacity: .25; }
    34% { opacity: 1; }
    48% { opacity: .4; }
    60% { opacity: 1; }
    74% { opacity: .7; }
    100% { opacity: 1; }
  }
  .inhalt { padding: 1rem; }
  @media (prefers-reduced-motion: reduce) { .flackern .roehre-gruppe, .flackern .glanz { animation: none; } }
</style>
