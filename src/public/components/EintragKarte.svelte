<script>
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import { t, pick, zahlText } from '../lib/i18n.js';
  import Icon from '../../shared/Icon.svelte';

  // Stellplatz-Kachel (quadratisch, leicht transparent): Name oben links, Gespann-Marke oben rechts; in der Mitte Bild oder Icon;
  // unten die Knöpfe Gespann und Bearbeiten und, bei ungeprüften Einträgen, das Ausrufezeichen mit Hinweis.
  // Keine Angaben in der Kachel: die stehen im Bearbeiten-Fenster.
  let { lang, art, eintrag, flach = false, imGespann = false, onedit, onGespann, onremove, foto = null } = $props();

  const motoren = $derived(eintrag.motoren ?? []);
  const akkus = $derived(eintrag.akkus ?? []);
  const ungeprueft = $derived(eintrag.status !== 'geprueft');
</script>

<article class:card={!flach}>
  <div class:card-body={!flach}>
    <div class="kopf">
      <h3>{eintrag.name}</h3>
      {#if imGespann}<span class="badge badge-active gespann">{t(lang, 'inGespann')}</span>{/if}
    </div>

    <div class="bild" class:mit-foto={!!foto}>
      <Fahrzeugbild art={art} bauart={eintrag.bauart} aufbau={eintrag.aufbau} motor={art === 'fahrraeder' && motoren.length > 0} akku={akkus.length > 0} foto={foto} alt={eintrag.name} groesse="8rem" />
      {#if art === 'gepaecke' && eintrag.gewicht_kg != null}
        <span class="kg">{zahlText(lang, eintrag.gewicht_kg)} kg</span>
      {/if}
    </div>

    <div class="fuss">
      {#if onremove}
        <button type="button" class="btn btn-ghost btn-sm" onclick={onremove} aria-label={t(lang, 'remove')} title={t(lang, 'remove')}><Icon name="ui-trash" size={14} /></button>
      {/if}
      {#if onGespann}
        <button type="button" class="btn btn-outline btn-sm" onclick={onGespann} aria-label={imGespann ? pick({ de: 'Aus dem Gespann nehmen', en: 'Remove from convoy' }, lang) : pick({ de: 'Ins Gespann', en: 'Add to convoy' }, lang)}><Icon name={imGespann ? 'ui-minus' : 'ui-plus'} size={14} /> Gespann</button>
      {/if}
      {#if onedit}
        <button type="button" class="btn btn-outline btn-sm" onclick={onedit} aria-label={t(lang, 'edit')} title={t(lang, 'edit')}><Icon name="ui-edit" size={14} /></button>
      {/if}
      {#if ungeprueft}
        <span class="warn" role="note" aria-label={t(lang, 'uncheckedHint')}>!<span class="tipp" role="tooltip">{t(lang, 'uncheckedHint')}</span></span>
      {/if}
    </div>
  </div>
</article>

<style>
  article { flex: 1; display: flex; min-width: 0; height: 100%; }
  /* Leicht transparent, damit das Garagenbild durchscheint */
  article.card { background: color-mix(in srgb, var(--bg-card) 78%, transparent); backdrop-filter: blur(3px); }
  .card-body { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; padding: .5rem; gap: .2rem; overflow: hidden; }
  /* Die Kopfzeile hat immer dieselbe Höhe; die Gespann-Marke liegt darüber, damit sich das Bild nie verschiebt */
  .kopf { height: 1.25rem; min-width: 0; }
  h3 { font-size: .9375rem; overflow-wrap: anywhere; min-width: 0; line-height: 1.25; padding-right: 5rem; }
  .gespann { position: absolute; top: .625rem; right: .625rem; font-size: .7rem; }
  /* Bild oder Icon genau mittig in der Kachel (horizontal und vertikal) */
  .bild { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .15rem; }
  /* Mit Foto: das Bild reicht bis an den linken und rechten Rand der Kachel */
  .bild.mit-foto { margin: 0 -.5rem; }
  .kg { font-size: .75rem; color: var(--fg-muted); }
  .fuss { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem; margin-top: auto; }
  /* Ausrufezeichen unten rechts; der Hinweis erscheint beim Darüberfahren */
  .warn { position: relative; margin-left: auto; width: 1.5rem; height: 1.5rem; border-radius: 999px; background: #f59e0b; color: #fff; font-weight: 700; font-size: .875rem; display: flex; align-items: center; justify-content: center; cursor: help; flex-shrink: 0; }
  .tipp { display: none; position: absolute; right: 0; bottom: 130%; width: max-content; max-width: 16rem; background: var(--bg-card); color: var(--fg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .4rem .6rem; font-size: .75rem; font-weight: 400; line-height: 1.35; box-shadow: 0 4px 12px rgba(0, 0, 0, .15); z-index: 5; }
  .warn:hover .tipp { display: block; }
</style>
