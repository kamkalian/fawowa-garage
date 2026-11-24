<script>
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import { t, pick, zahlText } from '../lib/i18n.js';
  import Icon from '../../shared/Icon.svelte';

  // Stellplatz-Kachel (quadratisch, leicht transparent): Titel oben links, Gespann-Marke oben rechts; in der Mitte Foto oder Icon,
  // quadratisch und mittig; unten Knöpfe (Löschen, Gespann, Bearbeiten) und bei ungeprüften Einträgen das Ausrufezeichen.
  // Alle Abstände sind gleich groß (K): oben bis zum Titel, zwischen Titel und Bild, zwischen Bild und Knöpfen, unten.
  // Die Größe des Bildes ergibt sich aus der Kachelbreite (cqw), damit alles in die Kachel passt.
  let { lang, art, eintrag, flach = false, imGespann = false, onedit, onGespann, onremove, onoeffnen, foto = null } = $props();

  const motoren = $derived(eintrag.motoren ?? []);
  const akkus = $derived(eintrag.akkus ?? []);
  const ungeprueft = $derived(eintrag.status !== 'geprueft');
  const gepaeck = $derived(art === 'gepaecke' && eintrag.gewicht_kg != null);

  // Gepäck: Übersicht über Taschen und Gegenstände
  const taschen = $derived(eintrag.taschen ?? []);
  const gegenstaende = $derived(taschen.reduce((n, x) => n + x.gegenstaende.length, 0));
  const gepacktAnzahl = $derived(taschen.reduce((n, x) => n + x.gegenstaende.filter((g) => g.gepackt).length, 0));
</script>

<article class:card={!flach}>
  <div class:card-body={!flach}>
    <div class="kopf">
      <h3>{eintrag.name}{gepaeck ? ` · ${zahlText(lang, eintrag.gewicht_kg)} kg` : ''}</h3>
      {#if imGespann}<span class="badge badge-active gespann">{t(lang, 'inGespann')}</span>{/if}
    </div>

    {#if art === 'gepaecke'}
      <div class="gepaeck-info">
        <p class="pack-kopf">{taschen.length} {pick({ de: taschen.length === 1 ? 'Tasche' : 'Taschen', en: taschen.length === 1 ? 'bag' : 'bags' }, lang)} · {gegenstaende} {pick({ de: 'Gegenstände', en: 'items' }, lang)}</p>
        <p class="pack-kopf">{gepacktAnzahl} / {gegenstaende} {pick({ de: 'gepackt', en: 'packed' }, lang)}</p>
        {#if onoeffnen}
          <button type="button" class="btn btn-primary btn-sm inventar-knopf" onclick={onoeffnen}>{pick({ de: 'Inventar öffnen', en: 'Open inventory' }, lang)}</button>
        {/if}
      </div>
    {:else}
    <div class="bild">
      <!-- Fläche für Foto oder Icon: quadratisch, so groß wie der Platz zwischen Titel und Knöpfen erlaubt -->
      <Fahrzeugbild art={art} bauart={eintrag.bauart} aufbau={eintrag.aufbau} motor={art === 'fahrraeder' && motoren.length > 0} akku={akkus.length > 0} foto={foto} alt={eintrag.name} groesse="calc(100cqw - 5.75rem)" />
    </div>
    {/if}

    <div class="fuss">
      {#if onGespann}
        <button type="button" class="btn btn-outline btn-sm" onclick={onGespann}
          aria-label={imGespann ? pick({ de: 'Aus dem Gespann nehmen', en: 'Remove from convoy' }, lang) : pick({ de: 'Ins Gespann', en: 'Add to convoy' }, lang)}
          title={imGespann ? pick({ de: 'Aus dem Gespann nehmen', en: 'Remove from convoy' }, lang) : pick({ de: 'Ins Gespann', en: 'Add to convoy' }, lang)}><Icon name={imGespann ? 'ui-minus' : 'ui-plus'} size={14} /></button>
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
  /* Die Kachel ist ein Größenbezug für das Bild (cqw) */
  article { flex: 1; display: flex; min-width: 0; height: 100%; container-type: inline-size; }
  /* Leicht transparent, damit das Garagenbild durchscheint */
  article.card { background: color-mix(in srgb, var(--bg-card) 78%, transparent); backdrop-filter: blur(3px); }
  /* K: ein Abstand für alle Seiten und zwischen den Bereichen (1.25 rem = 2 × 0.625 rem Innenabstand) */
  .card-body { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; padding: .625rem; gap: .625rem; overflow: hidden; box-sizing: border-box; }
  .kopf { height: 1.25rem; min-width: 0; }
  h3 { font-size: .9375rem; overflow-wrap: anywhere; min-width: 0; line-height: 1.25; padding-right: 5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gespann { position: absolute; top: .625rem; right: .625rem; font-size: .7rem; }
  /* Bild oder Icon mittig, horizontal und vertikal */
  .bild { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; }
  /* Knopfzeile mit fester Höhe (2 rem); das Bild passt sich dem Rest an */
  .fuss { height: 2rem; display: flex; flex-wrap: nowrap; align-items: center; gap: .3rem; }
  /* Ausrufezeichen unten rechts; der Hinweis erscheint beim Darüberfahren */
  .warn { position: relative; margin-left: auto; width: 1.5rem; height: 1.5rem; border-radius: 999px; background: #f59e0b; color: #fff; font-weight: 700; font-size: .875rem; display: flex; align-items: center; justify-content: center; cursor: help; flex-shrink: 0; }
  .tipp { display: none; position: absolute; right: 0; bottom: 130%; width: max-content; max-width: 16rem; background: var(--bg-card); color: var(--fg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .4rem .6rem; font-size: .75rem; font-weight: 400; line-height: 1.35; box-shadow: 0 4px 12px rgba(0, 0, 0, .15); z-index: 5; }
  .warn:hover .tipp { display: block; }
  .gepaeck-info { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: .4rem; align-items: flex-start; justify-content: center; }
  .inventar-knopf { margin-top: .4rem; }
  .packliste-rahmen { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: .3rem; }
  .pack-kopf { font-size: .75rem; color: var(--fg-muted); margin: 0; }
  .packliste { list-style: none; margin: 0; padding: 0; display: grid; gap: .2rem; font-size: .85rem; }
  .packliste label { display: flex; gap: .4rem; align-items: center; cursor: pointer; }
  .erledigt { text-decoration: line-through; color: var(--fg-muted); }
</style>
