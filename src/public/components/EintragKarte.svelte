<script>
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import { MOTOR_ARTEN } from '../../shared/antrieb.js';
  import { ARTEN } from '../../../lib/felder.js';
  import Icon from '../../shared/Icon.svelte';
  import { t, pick, zahlText } from '../lib/i18n.js';

  // Karte eines Fahrrads oder Anhängers: Bild, Name und die ausgefüllten Angaben.
  // Oben rechts: Gespann-Markierung. Unten rechts: Ausrufezeichen, wenn der Eintrag ungeprüft ist (Hinweis beim Darüberfahren).
  // Knöpfe in der Kachel: Bearbeiten und Ins Gespann; alles Weitere (Foto, Motor & Akku, Entfernen) steht im Bearbeiten-Fenster.
  // kompakt: nur Name, keine Angaben (für den Platz im Gespann); flach: ohne eigenen Rahmen (liegt schon in einer Karte)
  let { lang, art, eintrag, kompakt = false, flach = false, imGespann = false, onedit, onGespann, foto = null } = $props();

  const cfg = $derived(ARTEN[art]);
  // Motoren und Akkus stehen in eigenen Listen (mehrere je Fahrzeug)
  const motoren = $derived(eintrag.motoren ?? []);
  const akkus = $derived(eintrag.akkus ?? []);
  const motorName = (wert) => pick(MOTOR_ARTEN.find(o => o.wert === wert), lang) || wert;
  const getriebeName = (wert) => (wert === 'getriebe' ? pick({ de: 'Getriebe', en: 'Geared' }, lang) : wert === 'direkt' ? pick({ de: 'Direktläufer', en: 'Direct drive' }, lang) : null);

  function wert(f) {
    const v = eintrag[f.key];
    if (v === null || v === undefined || v === '') return null;
    if (f.typ === 'zahl' || f.typ === 'ganzzahl') return `${zahlText(lang, v)}${f.einheit ? ' ' + f.einheit : ''}`;
    if (f.typ === 'auswahl') return pick(f.optionen.find(o => o.wert === v), lang) || v;
    return v;
  }

  // name und notiz stehen oben bzw. unten, der Rest in der Liste
  let zeilen = $derived(cfg.felder.filter(f => f.key !== 'name' && f.key !== 'notiz').map(f => ({ f, w: wert(f) })).filter(z => z.w !== null)
    .slice(0, kompakt ? 0 : undefined));
  const ungeprueft = $derived(eintrag.status !== 'geprueft');
</script>

<article class:card={!flach}>
  <div class:card-body={!flach}>
    <div class="zeile">
      <Fahrzeugbild art={art} bauart={eintrag.bauart} aufbau={eintrag.aufbau} motor={art === 'fahrraeder' && motoren.length > 0} akku={akkus.length > 0} foto={foto} alt={eintrag.name} />
      <div class="inhalt">
        <div class="kopf" class:kompakt>
          <h3>{eintrag.name}</h3>
          {#if imGespann}
            <div class="marken"><span class="badge badge-active">{t(lang, 'inGespann')}</span></div>
          {/if}
        </div>

        {#if zeilen.length || (!kompakt && (motoren.length || akkus.length))}
          <dl>
            {#each zeilen as z (z.f.key)}
              <dt>{pick(z.f.label, lang)}</dt>
              <dd>{z.w}</dd>
            {/each}
            {#if !kompakt && motoren.length}
              <dt>{pick({ de: 'Motoren', en: 'Motors' }, lang)}</dt>
              <dd>{motoren.map(m => [motorName(m.motor_art), m.leistung_w ? `${zahlText(lang, m.leistung_w)} W` : null, m.spannung_v ? `${m.spannung_v} V` : null, getriebeName(m.getriebe)].filter(Boolean).join(' · ')).join(', ')}</dd>
            {/if}
            {#if !kompakt && akkus.length}
              <dt>{pick({ de: 'Akkus', en: 'Batteries' }, lang)}</dt>
              <dd>{akkus.map(a => [`${zahlText(lang, a.kapazitaet_wh)} Wh`, a.spannung_v ? `${a.spannung_v} V` : null].filter(Boolean).join(' · ')).join(', ')}</dd>
            {/if}
          </dl>
        {/if}
        {#if eintrag.notiz && !kompakt}<p class="notiz notizzeile">{eintrag.notiz}</p>{/if}

        <div class="aktionen">
          {#if onGespann}
            <button type="button" class="btn btn-outline btn-sm" onclick={onGespann}>{t(lang, imGespann ? 'removeGespann' : 'toGespann')}</button>
          {/if}
          {#if onedit}
            <button type="button" class="btn btn-outline btn-sm" onclick={onedit}><Icon name="ui-edit" size={14} /> {t(lang, 'edit')}</button>
          {/if}
        </div>
      </div>
    </div>

    {#if ungeprueft}
      <span class="warn" role="img" tabindex="0" aria-label={t(lang, 'uncheckedHint')}>!<span class="tipp" role="tooltip">{t(lang, 'uncheckedHint')}</span></span>
    {/if}
  </div>
</article>

<style>
  .zeile { display: flex; gap: .75rem; align-items: stretch; }
  .inhalt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .kopf { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; margin-bottom: .5rem; }
  .kopf.kompakt { margin-bottom: 0; align-items: center; }
  .marken { display: flex; flex-wrap: wrap; gap: .25rem; justify-content: flex-end; flex-shrink: 0; }
  h3 { font-size: 1rem; overflow-wrap: anywhere; min-width: 0; }
  dl { display: grid; grid-template-columns: minmax(6rem, 42%) 1fr; gap: .15rem .75rem; font-size: .8125rem; }
  dt { color: var(--fg-muted); }
  dd { overflow-wrap: anywhere; }
  .notizzeile { margin-top: .5rem; white-space: pre-line; }
  .aktionen { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: auto; padding-top: .75rem; }
  article { flex: 1; display: flex; min-width: 0; }
  .card-body { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
  .kopf.kompakt + .aktionen { margin-top: .5rem; }
  /* Ausrufezeichen unten rechts; der Hinweis erscheint beim Darüberfahren und Fokussieren */
  .warn { position: absolute; right: .6rem; bottom: .6rem; width: 1.5rem; height: 1.5rem; border-radius: 999px; background: #f59e0b; color: #fff; font-weight: 700; font-size: .875rem; display: flex; align-items: center; justify-content: center; cursor: help; }
  .warn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .tipp { display: none; position: absolute; right: 0; bottom: 130%; width: max-content; max-width: 16rem; background: var(--bg-card); color: var(--fg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .4rem .6rem; font-size: .75rem; font-weight: 400; line-height: 1.35; box-shadow: 0 4px 12px rgba(0, 0, 0, .15); z-index: 5; }
  .warn:hover .tipp, .warn:focus .tipp { display: block; }
</style>
