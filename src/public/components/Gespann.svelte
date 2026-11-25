<script>
  import { pick } from '../lib/i18n.js';

  // Gespann-Fläche: vorerst nur ein Raster als Hintergrund. Die Platzierung von Zugfahrzeug, Anhängern und Gepäck kommt später.
  let { lang } = $props();
</script>

<section class="gespann" aria-label={pick({ de: 'Gespann', en: 'Convoy' }, lang)}>
  <h2>{pick({ de: 'Gespann', en: 'Convoy' }, lang)}</h2>
  <div class="flaeche" role="img" aria-label={pick({ de: 'Fläche für das Gespann', en: 'Area for the convoy' }, lang)}></div>
</section>

<style>
  .gespann { margin: 1rem 0; }
  h2 { font-size: 1rem; margin: 0 0 .5rem; }
  .flaeche {
    height: 26rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background-color: var(--bg-card);
    background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px);
    background-size: 24px 24px;
  }
</style>
