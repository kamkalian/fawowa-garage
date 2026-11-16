<script>
  import { pick } from '../lib/i18n.js';
  import { MOTOR_ARTEN } from '../../shared/antrieb.js';

  // Motoren und Akkus eines Fahrrads oder Anhängers als Listen; beliebig viele. Die Werte gehören dem umgebenden Formular.
  let { lang, motoren = $bindable([]), akkus = $bindable([]) } = $props();
</script>

<div class="antrieb">
  <p class="hinweis">{pick({ de: 'Leistung in Watt, Kapazität in Wh. Ohne Motor erscheint kein Blitz-Symbol.', en: 'Power in watts, capacity in Wh. Without a motor no lightning symbol is shown.' }, lang)}</p>

  <h4 class="abschnitt">{pick({ de: 'Motoren', en: 'Motors' }, lang)}</h4>
  {#each motoren as m, i (i)}
    <div class="reihe mit-motor">
      <select class="input" aria-label={pick({ de: 'Motorart', en: 'Motor type' }, lang)} bind:value={m.motor_art}>
        {#each MOTOR_ARTEN as o (o.wert)}<option value={o.wert}>{pick(o, lang)}</option>{/each}
      </select>
      <input class="input" type="number" min="0" max="20000" step="1" inputmode="numeric"
        aria-label={pick({ de: 'Leistung in Watt', en: 'Power in watts' }, lang)} placeholder="W" bind:value={m.leistung_w} />
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => (motoren = motoren.filter((_, k) => k !== i))}>
        {pick({ de: 'Entfernen', en: 'Remove' }, lang)}
      </button>
    </div>
  {/each}
  <button type="button" class="btn btn-outline btn-sm" onclick={() => (motoren = [...motoren, { motor_art: 'mittelmotor', leistung_w: null }])}>
    {pick({ de: '+ Motor', en: '+ Motor' }, lang)}
  </button>

  <h4 class="abschnitt">{pick({ de: 'Akkus', en: 'Batteries' }, lang)}</h4>
  {#each akkus as a, i (i)}
    <div class="reihe">
      <input class="input" type="number" min="1" max="10000" step="1" inputmode="numeric"
        aria-label={pick({ de: 'Kapazität in Wh', en: 'Capacity in Wh' }, lang)} placeholder="Wh" bind:value={a.kapazitaet_wh} />
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => (akkus = akkus.filter((_, k) => k !== i))}>
        {pick({ de: 'Entfernen', en: 'Remove' }, lang)}
      </button>
    </div>
  {/each}
  <button type="button" class="btn btn-outline btn-sm" onclick={() => (akkus = [...akkus, { kapazitaet_wh: null }])}>
    {pick({ de: '+ Akku', en: '+ Battery' }, lang)}
  </button>
</div>

<style>
  .hinweis { font-size: .8125rem; color: var(--fg-muted); margin-bottom: .5rem; }
  .abschnitt { font-size: .875rem; font-weight: 600; margin: .75rem 0 .375rem; }
  .reihe { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .5rem; align-items: center; margin-bottom: .5rem; }
  .reihe.mit-motor { grid-template-columns: minmax(0, 1fr) 6rem auto; }
</style>
