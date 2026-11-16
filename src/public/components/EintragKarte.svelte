<script>
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import { MOTOR_ARTEN } from '../../shared/antrieb.js';
  import { ARTEN } from '../../../lib/felder.js';
  import Icon from '../../shared/Icon.svelte';
  import { t, pick, zahlText } from '../lib/i18n.js';

  // Stellplatz-Kachel (quadratisch): Name oben links, Gespann-Marke oben rechts; darunter links Bild oder Icon, rechts die wichtigsten Daten;
  // unten die Knöpfe Gespann und Bearbeiten und, bei ungeprüften Einträgen, das Ausrufezeichen mit Hinweis.
  // kompakt: nur Name (für den Platz im Gespann); flach: ohne eigenen Rahmen
  let { lang, art, eintrag, kompakt = false, flach = false, imGespann = false, onedit, onGespann, foto = null } = $props();

  const cfg = $derived(ARTEN[art]);
  // Motoren und Akkus stehen in eigenen Listen (mehrere je Fahrzeug)
  const motoren = $derived(eintrag.motoren ?? []);
  const akkus = $derived(eintrag.akkus ?? []);
  const ungeprueft = $derived(eintrag.status !== 'geprueft');
  const motorName = (wert) => pick(MOTOR_ARTEN.find(o => o.wert === wert), lang) || wert;
  const getriebeName = (wert) => (wert === 'getriebe' ? pick({ de: 'Getriebe', en: 'Geared' }, lang) : wert === 'direkt' ? pick({ de: 'Direktläufer', en: 'Direct drive' }, lang) : null);

  function wert(f) {
    const v = eintrag[f.key];
    if (v === null || v === undefined || v === '') return null;
    if (f.typ === 'zahl' || f.typ === 'ganzzahl') return `${zahlText(lang, v)}${f.einheit ? ' ' + f.einheit : ''}`;
    if (f.typ === 'auswahl') return pick(f.optionen.find(o => o.wert === v), lang) || v;
    return v;
  }

  // Die wichtigsten Angaben, begrenzt, damit die quadratische Kachel nicht überläuft
  const DATEN_MAX = 4;
  let daten = $derived.by(() => {
    if (kompakt) return [];
    const liste = cfg.felder.filter(f => f.key !== 'name' && f.key !== 'notiz').map(f => ({ k: pick(f.label, lang), v: wert(f) })).filter(z => z.v !== null);
    if (motoren.length) liste.push({ k: pick({ de: 'Motor', en: 'Motor' }, lang), v: motoren.map(m => [motorName(m.motor_art), m.leistung_w ? `${zahlText(lang, m.leistung_w)} W` : null, m.spannung_v ? `${m.spannung_v} V` : null, getriebeName(m.getriebe)].filter(Boolean).join(' · ')).join(', ') });
    if (akkus.length) liste.push({ k: pick({ de: 'Akku', en: 'Battery' }, lang), v: akkus.map(a => [`${zahlText(lang, a.kapazitaet_wh)} Wh`, a.spannung_v ? `${a.spannung_v} V` : null].filter(Boolean).join(' · ')).join(', ') });
    return liste.slice(0, DATEN_MAX);
  });
</script>

<article class:card={!flach}>
  <div class:card-body={!flach}>
    <div class="kopf">
      <h3>{eintrag.name}</h3>
      {#if imGespann}<span class="badge badge-active gespann">{t(lang, 'inGespann')}</span>{/if}
    </div>

    <div class="mitte">
      <div class="bild">
        <Fahrzeugbild art={art} bauart={eintrag.bauart} aufbau={eintrag.aufbau} motor={art === 'fahrraeder' && motoren.length > 0} akku={akkus.length > 0} foto={foto} alt={eintrag.name} />
      </div>
      {#if daten.length}
        <dl class="daten">
          {#each daten as z (z.k)}
            <dt>{z.k}</dt>
            <dd>{z.v}</dd>
          {/each}
        </dl>
      {/if}
    </div>

    <div class="fuss">
      {#if onGespann}
        <button type="button" class="btn btn-outline btn-sm" onclick={onGespann}>{t(lang, imGespann ? 'removeGespann' : 'toGespann')}</button>
      {/if}
      {#if onedit}
        <button type="button" class="btn btn-outline btn-sm" onclick={onedit}><Icon name="ui-edit" size={14} /> {t(lang, 'edit')}</button>
      {/if}
      {#if ungeprueft}
        <span class="warn" role="note" aria-label={t(lang, 'uncheckedHint')}>!<span class="tipp" role="tooltip">{t(lang, 'uncheckedHint')}</span></span>
      {/if}
    </div>
  </div>
</article>

<style>
  article { flex: 1; display: flex; min-width: 0; height: 100%; }
  .card-body { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; padding: .875rem; gap: .625rem; overflow: hidden; }
  .kopf { display: flex; align-items: flex-start; justify-content: space-between; gap: .5rem; min-width: 0; }
  h3 { font-size: 1rem; overflow-wrap: anywhere; min-width: 0; line-height: 1.25; }
  .gespann { flex-shrink: 0; }
  .mitte { display: grid; grid-template-columns: 6rem minmax(0, 1fr); gap: .75rem; align-items: start; min-height: 0; flex: 1; }
  .bild { width: 6rem; }
  .daten { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; font-size: .8125rem; min-width: 0; }
  .daten dt { color: var(--fg-muted); font-size: .72rem; line-height: 1.2; }
  .daten dd { overflow-wrap: anywhere; margin: 0 0 .3rem; line-height: 1.3; }
  .fuss { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-top: auto; }
  /* Ausrufezeichen unten rechts; der Hinweis erscheint beim Darüberfahren */
  .warn { position: relative; margin-left: auto; width: 1.6rem; height: 1.6rem; border-radius: 999px; background: #f59e0b; color: #fff; font-weight: 700; font-size: .9rem; display: flex; align-items: center; justify-content: center; cursor: help; flex-shrink: 0; }
  .tipp { display: none; position: absolute; right: 0; bottom: 130%; width: max-content; max-width: 16rem; background: var(--bg-card); color: var(--fg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .4rem .6rem; font-size: .75rem; font-weight: 400; line-height: 1.35; box-shadow: 0 4px 12px rgba(0, 0, 0, .15); z-index: 5; }
  .warn:hover .tipp { display: block; }
</style>
