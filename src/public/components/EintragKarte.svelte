<script>
  import { ARTEN } from '../../../lib/felder.js';
  import Icon from '../../shared/Icon.svelte';
  import { t, pick, zahlText } from '../lib/i18n.js';

  // Karte eines Fahrrads oder Anhängers: Name, Prüfstatus und die ausgefüllten Angaben.
  // kompakt: nur Name und Prüfstatus, keine Angaben (für den Platz im Gespann); flach: ohne eigenen Rahmen und ohne Symbol (liegt schon in einer Karte mit Überschrift und Symbol);
  // aktionen: eigene Knöpfe statt Bearbeiten/Löschen
  let { lang, art, eintrag, kompakt = false, flach = false, imGespann = false, onedit, onremove, aktionen } = $props();

  const cfg = $derived(ARTEN[art]);

  function wert(f) {
    const v = eintrag[f.key];
    if (v === null || v === undefined || v === '') return null;
    if (f.typ === 'zahl' || f.typ === 'ganzzahl') return `${zahlText(lang, v)}${f.einheit ? ' ' + f.einheit : ''}`;
    if (f.typ === 'auswahl') return pick(f.optionen.find(o => o.wert === v), lang) || v;
    return v;
  }

  // name und notiz stehen oben bzw. unten, der Rest in der Liste
  let zeilen = $derived(cfg.felder.filter(f => f.key !== 'name' && f.key !== 'notiz').map(f => ({ f, w: wert(f) })).filter(z => z.w !== null)
    .slice(0, kompakt ? 0 : undefined));
</script>

<article class:card={!flach}>
  <div class:card-body={!flach}>
    <div class="kopf" class:kompakt>
      <h3>{#if !flach}<span class="symbol"><Icon name={art === 'fahrraeder' ? 'veh-bike' : 'veh-trailer'} size={24} /></span>{/if}{eintrag.name}</h3>
      <div class="marken">
        {#if imGespann}<span class="badge badge-active">{t(lang, 'inGespann')}</span>{/if}
        <span class="badge {eintrag.status === 'geprueft' ? 'badge-active' : 'badge-check'}" title={t(lang, eintrag.status === 'geprueft' ? 'checkedHint' : 'uncheckedHint')}>
          {t(lang, eintrag.status === 'geprueft' ? 'checked' : 'unchecked')}
        </span>
      </div>
    </div>

    {#if zeilen.length}
      <dl>
        {#each zeilen as z (z.f.key)}
          <dt>{pick(z.f.label, lang)}</dt>
          <dd>{z.w}</dd>
        {/each}
      </dl>
    {/if}
    {#if eintrag.notiz && !kompakt}<p class="notiz notizzeile">{eintrag.notiz}</p>{/if}

    <div class="aktionen">
      {#if aktionen}
        {@render aktionen()}
      {:else}
        <button type="button" class="btn btn-outline btn-sm" onclick={onedit}><Icon name="ui-edit" size={14} /> {t(lang, 'edit')}</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick={onremove}><Icon name="ui-trash" size={14} /> {t(lang, 'remove')}</button>
      {/if}
    </div>
  </div>
</article>

<style>
  .kopf { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }
  .kopf.kompakt { margin-bottom: 0; align-items: center; }
  .marken { display: flex; flex-wrap: wrap; gap: .25rem; justify-content: flex-end; }
  h3 { display: flex; align-items: center; gap: .5rem; font-size: 1rem; overflow-wrap: anywhere; min-width: 0; }
  .symbol { display: inline-flex; flex-shrink: 0; color: var(--primary); }
  dl { display: grid; grid-template-columns: minmax(6rem, 42%) 1fr; gap: .15rem .75rem; font-size: .8125rem; }
  dt { color: var(--fg-muted); }
  dd { overflow-wrap: anywhere; }
  .notizzeile { margin-top: .5rem; white-space: pre-line; }
  .aktionen { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .75rem; }
  .kopf.kompakt + .aktionen { margin-top: .5rem; }
</style>
