<script>
  // Bild eines Stellplatzes: Foto, wenn eines hochgeladen ist, sonst ein Icon für die Bauart.
  // Mit Motor erscheint in der Ecke ein Blitz (außerhalb des Icons).
  // akku: mit mindestens einem Akku leuchtet der Blitz grün
  // groesse: Kantenlänge des Bildes (Standard 6 rem); in kleinen Kacheln kleiner
  import { ICONS, BILD_SYMBOLE } from './icons.js';

  let { art, bauart = null, aufbau = null, motor = false, akku = false, foto = null, alt = '', groesse = '6rem' } = $props();

  const schluessel = $derived(art === 'fahrraeder' ? (bauart ?? 'fahrrad') : art === 'gepaecke' ? 'gepaeck' : (aufbau ?? 'sonstiges'));
  const svg = $derived(ICONS[schluessel] ?? ICONS.sonstiges);
  // Trike mit Motor und Akku: eigene Zeichnung trike_e
  const bild = $derived(schluessel === 'trike' && motor && akku ? BILD_SYMBOLE.trike_e : (BILD_SYMBOLE[schluessel] ?? null));
</script>

<div class="bild" class:ohne-hintergrund={!foto} style="--groesse: {groesse}">
  {#if foto}
    <img src={foto} alt={alt} loading="lazy" />
  {:else if bild}
    <img class="symbolbild" src={bild} alt={alt} />
  {:else}
    <svg viewBox="0 0 48 48" role="img" aria-label={alt} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      {@html svg}
    </svg>
  {/if}
  {#if motor}
    <span class="blitz" class:gruen={akku} aria-label="Motor"><svg viewBox="0 0 48 48"><path d="M30 2 L12 27 H23 L18 46 L37 19 H26 Z"/></svg></span>
  {/if}
</div>

<style>
  .bild { --deck: var(--bg-input); position: relative; width: var(--groesse, 6rem); height: var(--groesse, 6rem); flex-shrink: 0; border-radius: var(--radius-sm); background: var(--bg-input); color: var(--primary); display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .bild svg { width: 58%; height: 58%; }
  .bild img { width: 100%; height: 100%; object-fit: cover; }
  /* Symbole ohne Flächenhintergrund (kein heller Kasten, weder im hellen noch im dunklen Modus) */
  .bild.ohne-hintergrund { background: transparent; }
  /* Fertige Symbol-Datei: ganz zu sehen, nicht beschnitten */
  .bild img.symbolbild { width: 100%; height: 100%; object-fit: contain; padding: 6%; box-sizing: border-box; }
  /* Blitz ohne Hintergrund: kräftiges Gelb mit dunkler Kontur, damit er auf hell und dunkel gut sichtbar ist */
  .blitz { position: absolute; bottom: .15rem; right: .15rem; width: 1.4rem; height: 1.4rem; pointer-events: none; }
  .blitz svg { width: 100%; height: 100%; fill: #facc15; stroke: #713f12; stroke-width: 2; stroke-linejoin: round; opacity: 1; }
  /* Mit Akku: grünes Leuchten um den Blitz */
  .blitz.gruen svg { filter: drop-shadow(0 0 2px #22c55e) drop-shadow(0 0 4px #22c55e); }
</style>
