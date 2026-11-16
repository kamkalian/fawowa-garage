<script>
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import { MOTOR_ARTEN } from '../../shared/antrieb.js';
  import { ARTEN } from '../../../lib/felder.js';
  import Icon from '../../shared/Icon.svelte';
  import { t, pick, zahlText } from '../lib/i18n.js';

  // Karte eines Fahrrads oder Anhängers: Name, Prüfstatus und die ausgefüllten Angaben.
  // kompakt: nur Name und Prüfstatus, keine Angaben (für den Platz im Gespann); flach: ohne eigenen Rahmen und ohne Symbol (liegt schon in einer Karte mit Überschrift und Symbol);
  // aktionen: eigene Knöpfe statt Bearbeiten/Löschen
  let { lang, art, eintrag, kompakt = false, flach = false, imGespann = false, onedit, onremove, onGespann, aktionen, foto = null, onfoto, onfotoloeschen, onantrieb } = $props();

  const cfg = $derived(ARTEN[art]);
  // Motoren und Akkus stehen in eigenen Listen (mehrere je Fahrzeug)
  const motoren = $derived(eintrag.motoren ?? []);
  const akkus = $derived(eintrag.akkus ?? []);
  const motorName = (wert) => pick(MOTOR_ARTEN.find(o => o.wert === wert), lang) || wert;

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
    <div class="zeile">
      <Fahrzeugbild art={art} bauart={eintrag.bauart} aufbau={eintrag.aufbau} motor={art === 'fahrraeder' && motoren.length > 0} foto={foto} alt={eintrag.name} />
      <div class="inhalt">
    <div class="kopf" class:kompakt>
      <h3>{#if !flach}<span class="symbol"><Icon name={art === 'fahrraeder' ? 'veh-bike' : 'veh-trailer'} size={24} /></span>{/if}{eintrag.name}</h3>
      <div class="marken">
        {#if imGespann}<span class="badge badge-active">{t(lang, 'inGespann')}</span>{/if}
        <span class="badge {eintrag.status === 'geprueft' ? 'badge-active' : 'badge-check'}" title={t(lang, eintrag.status === 'geprueft' ? 'checkedHint' : 'uncheckedHint')}>
          {t(lang, eintrag.status === 'geprueft' ? 'checked' : 'unchecked')}
        </span>
      </div>
    </div>

    {#if zeilen.length || (!kompakt && (motoren.length || akkus.length))}
      <dl>
        {#each zeilen as z (z.f.key)}
          <dt>{pick(z.f.label, lang)}</dt>
          <dd>{z.w}</dd>
        {/each}
        {#if !kompakt && motoren.length}
          <dt>{pick({ de: 'Motoren', en: 'Motors' }, lang)}</dt>
          <dd>{motoren.map(m => `${motorName(m.motor_art)}${m.leistung_w ? ` · ${zahlText(lang, m.leistung_w)} W` : ''}`).join(', ')}</dd>
        {/if}
        {#if !kompakt && akkus.length}
          <dt>{pick({ de: 'Akkus', en: 'Batteries' }, lang)}</dt>
          <dd>{akkus.map(a => `${zahlText(lang, a.kapazitaet_wh)} Wh`).join(', ')}</dd>
        {/if}
      </dl>
    {/if}
    {#if eintrag.notiz && !kompakt}<p class="notiz notizzeile">{eintrag.notiz}</p>{/if}

    <div class="aktionen">
      {#if aktionen}
        {@render aktionen()}
      {:else}
        {#if onfoto}
          <button type="button" class="btn btn-outline btn-sm" onclick={onfoto}><Icon name="ui-plus" size={14} /> {t(lang, foto ? 'photoChange' : 'photoAdd')}</button>
        {/if}
        {#if foto && onfotoloeschen}
          <button type="button" class="btn btn-ghost btn-sm" onclick={onfotoloeschen}>{t(lang, 'photoRemove')}</button>
        {/if}
        {#if onGespann}
          <button type="button" class="btn btn-outline btn-sm" onclick={onGespann}>{t(lang, imGespann ? 'removeGespann' : 'toGespann')}</button>
        {/if}
        {#if onantrieb}
          <button type="button" class="btn btn-outline btn-sm" onclick={onantrieb}>{pick({ de: 'Motor & Akku', en: 'Motor & battery' }, lang)}</button>
        {/if}
        <button type="button" class="btn btn-outline btn-sm" onclick={onedit}><Icon name="ui-edit" size={14} /> {t(lang, 'edit')}</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick={onremove}><Icon name="ui-trash" size={14} /> {t(lang, 'remove')}</button>
      {/if}
    </div>
      </div>
    </div>
  </div>
</article>

<style>
  .zeile { display: flex; gap: .75rem; align-items: stretch; }
  .inhalt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .kopf { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }
  .kopf.kompakt { margin-bottom: 0; align-items: center; }
  .marken { display: flex; flex-wrap: wrap; gap: .25rem; justify-content: flex-end; }
  h3 { display: flex; align-items: center; gap: .5rem; font-size: 1rem; overflow-wrap: anywhere; min-width: 0; }
  .symbol { display: inline-flex; flex-shrink: 0; color: var(--primary); }
  dl { display: grid; grid-template-columns: minmax(6rem, 42%) 1fr; gap: .15rem .75rem; font-size: .8125rem; }
  dt { color: var(--fg-muted); }
  dd { overflow-wrap: anywhere; }
  .notizzeile { margin-top: .5rem; white-space: pre-line; }
  .aktionen { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: auto; padding-top: .75rem; }
  article { flex: 1; display: flex; min-width: 0; }
  .card-body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .kopf.kompakt + .aktionen { margin-top: .5rem; }
</style>
