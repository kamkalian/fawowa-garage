<script>
  import { ARTEN } from '../../../lib/felder.js';
  import { gesamtgewicht } from '../../../lib/gewicht.js';
  import Icon from '../../shared/Icon.svelte';
  import { t, pick, zahlText } from '../lib/i18n.js';

  // Karte eines Eintrags: Name, Prüfstatus und alle ausgefüllten Angaben
  let { lang, art, eintrag, daten, onedit, onremove } = $props();

  const cfg = $derived(ARTEN[art]);
  const nachId = (liste, id) => liste.find(x => x.id === id) ?? null;

  function wert(f) {
    const v = eintrag[f.key];
    if (v === null || v === undefined || v === '') return null;
    if (f.typ === 'zahl' || f.typ === 'ganzzahl') return `${zahlText(lang, v)}${f.einheit ? ' ' + f.einheit : ''}`;
    if (f.typ === 'auswahl') return pick(f.optionen.find(o => o.wert === v), lang) || v;
    if (f.typ === 'verweis') return nachId(daten[f.verweis], v)?.name ?? '–';
    return v;
  }

  // name und notiz stehen oben bzw. unten, der Rest in der Liste
  let zeilen = $derived(cfg.felder.filter(f => f.key !== 'name' && f.key !== 'notiz').map(f => ({ f, w: wert(f) })).filter(z => z.w !== null));
  let gewicht = $derived(art === 'gespanne'
    ? gesamtgewicht(eintrag, nachId(daten.fahrraeder, eintrag.fahrrad_id), nachId(daten.anhaenger, eintrag.anhaenger_id))
    : null);
</script>

<article class="card">
  <div class="card-body">
    <div class="kopf">
      <h3>{eintrag.name}</h3>
      <span class="badge {eintrag.status === 'geprueft' ? 'badge-active' : 'badge-check'}" title={t(lang, eintrag.status === 'geprueft' ? 'checkedHint' : 'uncheckedHint')}>
        {t(lang, eintrag.status === 'geprueft' ? 'checked' : 'unchecked')}
      </span>
    </div>

    {#if gewicht}
      <p class="gewicht">
        <span class="muted">{t(lang, 'totalWeight')}:</span> <strong>{zahlText(lang, gewicht.summe)}&nbsp;kg</strong>
        {#if gewicht.fehlt.length}<span class="notiz"> · {t(lang, 'weightIncomplete')}</span>{/if}
      </p>
    {/if}

    {#if zeilen.length}
      <dl>
        {#each zeilen as z (z.f.key)}
          <dt>{pick(z.f.label, lang)}</dt>
          <dd>{z.w}</dd>
        {/each}
      </dl>
    {/if}
    {#if eintrag.notiz}<p class="notiz notizzeile">{eintrag.notiz}</p>{/if}

    <div class="aktionen">
      <button type="button" class="btn btn-outline btn-sm" onclick={onedit}><Icon name="ui-edit" size={14} /> {t(lang, 'edit')}</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick={onremove}><Icon name="ui-trash" size={14} /> {t(lang, 'remove')}</button>
    </div>
  </div>
</article>

<style>
  .kopf { display: flex; align-items: center; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }
  h3 { font-size: 1rem; overflow-wrap: anywhere; }
  .gewicht { font-size: .875rem; margin-bottom: .5rem; }
  dl { display: grid; grid-template-columns: minmax(6rem, 42%) 1fr; gap: .15rem .75rem; font-size: .8125rem; }
  dt { color: var(--fg-muted); }
  dd { overflow-wrap: anywhere; }
  .notizzeile { margin-top: .5rem; white-space: pre-line; }
  .aktionen { display: flex; gap: .5rem; margin-top: .75rem; }
</style>
