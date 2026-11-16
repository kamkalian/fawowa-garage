<script>
  // Bild eines Stellplatzes: Foto, wenn eines hochgeladen ist, sonst ein großes Icon für die Bauart.
  // Mit Motor erscheint in der Ecke ein Blitz (außerhalb des Icons).
  // akku: mit mindestens einem Akku leuchtet der Blitz grün
  let { art, bauart = null, aufbau = null, motor = false, akku = false, foto = null, alt = '' } = $props();

  // Strichzeichnungen im Raster 48 × 48, Farbe über currentColor
  const ICONS = {
    fahrrad: '<circle cx="11" cy="32" r="8.5"/><circle cx="37" cy="32" r="8.5"/><path d="M11 32 L20 18 H32 L37 32 M20 18 L26 32 H11 M32 18 L28 11 H24"/><path d="M15 15 H23"/>',
    fahrrad_dach: '<circle cx="12" cy="34" r="7"/><circle cx="36" cy="34" r="7"/><path d="M12 34 L20 22 H31 L36 34 M20 22 L25 34 H12 M31 22 L28 14 H24"/><path d="M12 18 L17 8 H30 L32 14"/>',
    fahrrad_kabine: '<circle cx="12" cy="34" r="7"/><circle cx="36" cy="34" r="7"/><path d="M12 34 L20 22 H31 L36 34 M20 22 L25 34 H12 M31 22 L28 14 H24"/><rect x="12" y="4" width="24" height="13" rx="3"/><path d="M18 10 H30"/>',
    trike: '<circle cx="9" cy="35" r="5"/><circle cx="25" cy="35" r="5"/><circle cx="39" cy="35" r="6"/><path d="M9 35 L17 22 H30 L39 35 M17 22 L24 30 M30 22 L27 14 H24"/>',
    trike_dach: '<circle cx="9" cy="35" r="5"/><circle cx="25" cy="35" r="5"/><circle cx="39" cy="35" r="6"/><path d="M9 35 L17 22 H30 L39 35 M17 22 L24 30"/><path d="M14 22 L20 10 H32 L36 22"/>',
    quad: '<rect x="14" y="20" width="20" height="14" rx="3"/><circle cx="12" cy="16" r="5"/><circle cx="36" cy="16" r="5"/><circle cx="12" cy="38" r="5"/><circle cx="36" cy="38" r="5"/><path d="M14 27 H34"/>',
    quad_dach: '<rect x="14" y="20" width="20" height="14" rx="3"/><circle cx="12" cy="16" r="5"/><circle cx="36" cy="16" r="5"/><circle cx="12" cy="38" r="5"/><circle cx="36" cy="38" r="5"/><path d="M14 20 L17 9 H31 L34 20"/>',
    lastenrad: '<circle cx="12" cy="34" r="6"/><circle cx="36" cy="34" r="6"/><rect x="4" y="12" width="16" height="16" rx="2"/><path d="M12 34 L24 24 H30 L36 34 M24 24 L27 14 H32"/>',
    lastenrad_kabine: '<circle cx="12" cy="34" r="6"/><circle cx="36" cy="34" r="6"/><rect x="4" y="6" width="20" height="22" rx="3"/><path d="M8 12 H20 V20 H8 Z"/><path d="M12 34 L24 26 H30 L36 34 M24 26 L27 16 H32"/>',
    einachser: '<rect x="6" y="14" width="36" height="16" rx="2"/><circle cx="24" cy="36" r="5"/><path d="M42 22 L46 20"/>',
    doppelachser: '<rect x="4" y="14" width="40" height="16" rx="2"/><circle cx="16" cy="36" r="5"/><circle cx="32" cy="36" r="5"/><path d="M44 22 L46 20"/>',
    drehschemel: '<rect x="6" y="14" width="30" height="16" rx="2"/><circle cx="14" cy="36" r="5"/><circle cx="26" cy="36" r="5"/><circle cx="40" cy="22" r="4"/><path d="M36 22 H38"/>',
    lastenanhaenger: '<rect x="8" y="8" width="32" height="22" rx="2"/><path d="M8 14 H40 M8 20 H40"/><circle cx="18" cy="36" r="5"/><circle cx="30" cy="36" r="5"/>',
    wohnkabine: '<rect x="8" y="18" width="32" height="18" rx="2"/><path d="M6 18 L24 6 L42 18"/><rect x="14" y="23" width="8" height="6"/><circle cx="16" cy="39" r="4"/><circle cx="32" cy="39" r="4"/>',
    sonstiges: '<rect x="8" y="16" width="32" height="16" rx="2"/><circle cx="24" cy="36" r="5"/>'
  };

  const schluessel = $derived(art === 'fahrraeder' ? (bauart ?? 'fahrrad') : (aufbau ?? 'sonstiges'));
  const svg = $derived(ICONS[schluessel] ?? ICONS.sonstiges);
</script>

<div class="bild">
  {#if foto}
    <img src={foto} alt={alt} loading="lazy" />
  {:else}
    <svg viewBox="0 0 48 48" role="img" aria-label={alt} fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      {@html svg}
    </svg>
  {/if}
  {#if motor}
    <span class="blitz" class:gruen={akku} aria-label="Motor"><svg viewBox="0 0 48 48"><path d="M30 2 L12 27 H23 L18 46 L37 19 H26 Z"/></svg></span>
  {/if}
</div>

<style>
  .bild { position: relative; width: 6rem; height: 6rem; flex-shrink: 0; border-radius: var(--radius-sm); background: var(--bg-input); color: var(--primary); display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .bild svg { width: 3.5rem; height: 3.5rem; }
  .bild img { width: 100%; height: 100%; object-fit: cover; }
  /* Blitz ohne Hintergrund: kräftiges Gelb mit dunkler Kontur, damit er auf hell und dunkel gut sichtbar ist */
  .blitz { position: absolute; bottom: .15rem; right: .15rem; width: 1.4rem; height: 1.4rem; pointer-events: none; }
  .blitz svg { width: 100%; height: 100%; fill: #facc15; stroke: #713f12; stroke-width: 2; stroke-linejoin: round; opacity: 1; }
  /* Mit Akku: grünes Leuchten um den Blitz */
  .blitz.gruen svg { filter: drop-shadow(0 0 2px #22c55e) drop-shadow(0 0 4px #22c55e); }
</style>
