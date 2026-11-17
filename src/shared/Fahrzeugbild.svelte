<script>
  // Bild eines Stellplatzes: Foto, wenn eines hochgeladen ist, sonst ein Icon für die Bauart.
  // Mit Motor erscheint in der Ecke ein Blitz (außerhalb des Icons).
  // akku: mit mindestens einem Akku leuchtet der Blitz grün
  // groesse: Kantenlänge des Bildes (Standard 6 rem); in kleinen Kacheln kleiner
  let { art, bauart = null, aufbau = null, motor = false, akku = false, foto = null, alt = '', groesse = '6rem' } = $props();

  // Strichzeichnungen im Raster 48 × 48 (Strichstärke 2,2), Farbe über currentColor. Seitenansicht, Anhänger mit Deichsel nach rechts.
  const ICONS = {
    fahrrad: '<circle cx="11" cy="32" r="8.5"/><circle cx="37" cy="32" r="8.5"/><path d="M11 32 L22 32 L19 18 H31 L37 32 M22 32 L31 18 M19 18 L11 32 M31 18 L33 12 M29 12 H37 M14 15 H23"/>',
    fahrrad_dach: '<circle cx="11" cy="32" r="8.5"/><circle cx="37" cy="32" r="8.5"/><path d="M11 32 L22 32 L19 18 H31 L37 32 M22 32 L31 18 M19 18 L11 32 M31 18 L33 12 M29 12 H37 M14 15 H23"/><path d="M12 15 Q13 5 24 5 Q35 5 36 15"/>',
    fahrrad_kabine: '<circle cx="11" cy="32" r="8.5"/><circle cx="37" cy="32" r="8.5"/><path d="M11 32 L22 32 L19 18 H31 L37 32 M22 32 L31 18 M19 18 L11 32 M31 18 L33 12 M29 12 H37 M14 15 H23"/><rect x="11" y="3" width="26" height="12" rx="3"/>',
    trike: '<circle cx="9" cy="35" r="6"/><circle cx="23" cy="35" r="6"/><circle cx="40" cy="34" r="6"/><path d="M15 35 L19 18 H30 L40 34 M19 18 L15 35 M30 18 L33 12 H39 M13 15 H22"/>',
    trike_dach: '<circle cx="9" cy="35" r="6"/><circle cx="23" cy="35" r="6"/><circle cx="40" cy="34" r="6"/><path d="M15 35 L19 18 H30 L40 34 M19 18 L15 35 M30 18 L33 12 H39 M13 15 H22"/><path d="M12 15 Q13 5 22 5 Q31 5 32 14"/>',
    quad: '<circle cx="11" cy="34" r="8.5"/><circle cx="37" cy="34" r="8.5"/><rect x="14" y="24" width="20" height="8" rx="3"/><rect x="18" y="18" width="10" height="5" rx="2"/><path d="M31 24 L34 16 H39"/>',
    quad_dach: '<circle cx="11" cy="34" r="8.5"/><circle cx="37" cy="34" r="8.5"/><rect x="14" y="24" width="20" height="8" rx="3"/><rect x="18" y="18" width="10" height="5" rx="2"/><path d="M31 24 L34 16 H39"/><path d="M13 15 Q14 5 24 5 Q33 5 34 14"/>',
    lastenrad: '<circle cx="12" cy="34" r="6"/><circle cx="36" cy="34" r="6"/><rect x="4" y="12" width="16" height="16" rx="2"/><path d="M12 34 L24 24 H30 L36 34 M24 24 L27 14 H32"/>',
    lastenrad_kabine: '<circle cx="12" cy="34" r="6"/><circle cx="36" cy="34" r="6"/><rect x="4" y="6" width="20" height="22" rx="3"/><path d="M8 12 H20 V20 H8 Z"/><path d="M12 34 L24 26 H30 L36 34 M24 26 L27 16 H32"/>',
    einachser: '<rect x="5" y="13" width="31" height="16" rx="2"/><circle cx="20" cy="35" r="6"/><path d="M36 21 H44"/><circle cx="45.5" cy="21" r="1.8"/>',
    doppelachser: '<rect x="3" y="13" width="34" height="16" rx="2"/><circle cx="13" cy="35" r="5.5"/><circle cx="26" cy="35" r="5.5"/><path d="M37 21 H45"/><circle cx="46" cy="21" r="1.8"/>',
    drehschemel: '<rect x="4" y="13" width="26" height="16" rx="2"/><circle cx="18" cy="35" r="6"/><rect x="30" y="17" width="5" height="8" rx="1"/><path d="M35 21 H45"/><circle cx="46" cy="21" r="1.8"/>',
    lastenanhaenger: '<rect x="6" y="8" width="30" height="22" rx="2"/><path d="M6 16 H36"/><circle cx="21" cy="35" r="5.5"/><path d="M36 22 H45"/><circle cx="46" cy="22" r="1.8"/>',
    wohnkabine: '<path d="M4 30 V16 Q4 12 8 12 H36 Q40 12 40 16 V30 Z"/><rect x="9" y="17" width="8" height="6" rx="1"/><rect x="23" y="17" width="8" height="6" rx="1"/><circle cx="12" cy="35" r="5"/><circle cx="32" cy="35" r="5"/><path d="M40 22 H46"/>',
    sonstiges: '<rect x="6" y="16" width="32" height="14" rx="2"/><circle cx="22" cy="35" r="5.5"/><path d="M38 22 H45"/>',
    gepaeck: '<rect x="8" y="14" width="32" height="24" rx="3"/><path d="M8 22 H40 M19 14 V10 H29 V14"/>'
  };

  const schluessel = $derived(art === 'fahrraeder' ? (bauart ?? 'fahrrad') : art === 'gepaecke' ? 'gepaeck' : (aufbau ?? 'sonstiges'));
  const svg = $derived(ICONS[schluessel] ?? ICONS.sonstiges);
</script>

<div class="bild" style="--groesse: {groesse}">
  {#if foto}
    <img src={foto} alt={alt} loading="lazy" />
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
  .bild { position: relative; width: var(--groesse, 6rem); height: var(--groesse, 6rem); flex-shrink: 0; border-radius: var(--radius-sm); background: var(--bg-input); color: var(--primary); display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .bild svg { width: 58%; height: 58%; }
  .bild img { width: 100%; height: 100%; object-fit: cover; }
  /* Blitz ohne Hintergrund: kräftiges Gelb mit dunkler Kontur, damit er auf hell und dunkel gut sichtbar ist */
  .blitz { position: absolute; bottom: .15rem; right: .15rem; width: 1.4rem; height: 1.4rem; pointer-events: none; }
  .blitz svg { width: 100%; height: 100%; fill: #facc15; stroke: #713f12; stroke-width: 2; stroke-linejoin: round; opacity: 1; }
  /* Mit Akku: grünes Leuchten um den Blitz */
  .blitz.gruen svg { filter: drop-shadow(0 0 2px #22c55e) drop-shadow(0 0 4px #22c55e); }
</style>
