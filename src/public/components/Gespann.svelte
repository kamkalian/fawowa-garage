<script>
  import { pick } from '../lib/i18n.js';

  // Gespann-Bereich: zunächst ausgeblendet. Aufgeklappt zeigt er die Mitglieder des Gespanns; Kacheln lassen sich
  // per Drag and Drop hineinziehen. Die Platzierung auf dem Raster kommt später.
  let { lang, mitglieder = [], ondrop, onentfernen } = $props();

  let offen = $state(false);
  let ueber = $state(false);
  const ART = {
    fahrraeder: { de: 'Fahrrad', en: 'Bicycle' },
    anhaenger: { de: 'Anhänger', en: 'Trailer' },
    gepaecke: { de: 'Gepäck', en: 'Luggage' }
  };
</script>

<div class="gespann-kopf">
  <button type="button" class="btn btn-outline btn-sm" aria-expanded={offen} onclick={() => (offen = !offen)}>
    {offen ? pick({ de: 'Gespann ausblenden', en: 'Hide convoy' }, lang) : pick({ de: 'Gespann anzeigen', en: 'Show convoy' }, lang)}
  </button>
</div>

{#if offen}
  <section class="gespann" aria-label={pick({ de: 'Gespann', en: 'Convoy' }, lang)}>
    <h2>{pick({ de: 'Gespann', en: 'Convoy' }, lang)}</h2>
    <div class="flaeche" class:ueber role="region" aria-label={pick({ de: 'Fläche für das Gespann', en: 'Area for the convoy' }, lang)}
      ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ueber = true; }}
      ondragleave={() => (ueber = false)}
      ondrop={(e) => { e.preventDefault(); ueber = false; ondrop?.(e); }}>
      <ul class="mitglieder">
        {#each mitglieder as f (f.art + '-' + f.e.id)}
          <li class="mitglied">
            <span class="name">{f.e.name}</span>
            <span class="art">{pick(ART[f.art], lang)}</span>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => onentfernen?.(f)}>{pick({ de: 'Entfernen', en: 'Remove' }, lang)}</button>
          </li>
        {:else}
          <li class="hinweis">{pick({ de: 'Kachel hierher ziehen, um sie ins Gespann zu legen.', en: 'Drag a card here to add it to the convoy.' }, lang)}</li>
        {/each}
      </ul>
    </div>
  </section>
{/if}

<style>
  .gespann-kopf { margin: .75rem 0 0; }
  .gespann { margin: .75rem 0 1rem; }
  h2 { font-size: 1rem; margin: 0 0 .5rem; }
  .flaeche {
    min-height: 16rem;
    padding: .6rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background-color: var(--bg-card);
    background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .flaeche.ueber { border-color: var(--accent, #3b82f6); box-shadow: 0 0 0 2px var(--accent, #3b82f6); }
  .mitglieder { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .4rem; }
  .mitglied { display: flex; align-items: center; gap: .5rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .4rem .6rem; }
  .mitglied .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .mitglied .art { font-size: .8125rem; color: var(--fg-muted); }
  .hinweis { font-size: .875rem; color: var(--fg-muted); }
</style>
