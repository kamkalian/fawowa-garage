<script>
  // Selbst gezeichnete Icons im gemeinsamen Linienstil ("Feinstrich": 24 × 24, Strichstärke 1,5, runde Enden, currentColor).
  const ICONS = {
    'ui-moon': `<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>`,
    'ui-plus': `<path d="M12 5v14M5 12h14"/>`,
    'ui-minus': `<path d="M5 12h14"/>`,
    'ui-user': `<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>`,
    'ui-box': `<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>`,
    'ui-edit': `<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>`,
    'ui-trash': `<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 13h9l1-13"/>`,
    // Fahrzeuge und Person (Anzeige 24 bis 56 px); Anhänger: Deichsel rechts (am Fahrrad dahinter), Aufbau links
    'veh-person': `<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2"/>`,
    'veh-bike': `<circle cx="6" cy="16.5" r="3.5"/><circle cx="18" cy="16.5" r="3.5"/><path d="M6 16.5h5l4.5-8h-6L11 16.5"/><path d="M15.5 8.5l2.5 8"/><path d="M14 6.5h3"/><path d="M8 7h3"/><path d="M9.5 8.5V7"/>`,
    'veh-trailer': `<g transform="matrix(-1 0 0 1 24 0)"><path d="M11 14H8a1.5 1.5 0 0 1-1.5-1.5V8.5A2.5 2.5 0 0 1 9 6h10a2.5 2.5 0 0 1 2.5 2.5v4A1.5 1.5 0 0 1 20 14h-3"/><circle cx="14" cy="14.5" r="3"/><path d="M6.5 11H2.5"/></g>`,
    'ui-info': `<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.5v.01"/>`,
    'ui-mail': `<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7.5l8.5 6 8.5-6"/>`,
    'ui-copy': `<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>`
  };

  let { name = 'ui-plus', size = 16 } = $props();
  let zeichnung = $derived(ICONS[name] ?? ICONS['ui-plus']);
</script>

<svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{@html zeichnung}</svg>
