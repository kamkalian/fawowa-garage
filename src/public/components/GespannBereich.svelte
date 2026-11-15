<script>
  import { ARTEN, GESPANN_FELDER } from '../../../lib/felder.js';
  import { gesamtgewicht } from '../../../lib/gewicht.js';
  import Icon from '../../shared/Icon.svelte';
  import { t, pick, zahlText } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import EintragKarte from './EintragKarte.svelte';
  import Fenster from './Fenster.svelte';

  // Das aktuelle Gespann: links der Anhänger, rechts das Fahrrad (immer sichtbar, leer als Platzhalter), darunter die Gewichte.
  let { lang, token, daten, melde } = $props();

  const feld = (k) => GESPANN_FELDER.find(f => f.key === k);
  // Die Gewichte werden einmal aus dem gespeicherten Gespann übernommen und danach im Formular bearbeitet
  // svelte-ignore state_referenced_locally
  let fahrer = $state(daten.gespann?.fahrer_gewicht_kg ?? null);
  // svelte-ignore state_referenced_locally
  let gepaeck = $state(daten.gespann?.gepaeck_kg ?? null);
  let fehler = $state({});
  let waehlen = $state(null);   // 'anhaenger' | 'fahrraeder' | null: welches Auswahlfenster offen ist
  let laeuft = $state(false);

  const nachId = (liste, id) => liste.find(x => x.id === id) ?? null;
  const rad = $derived(nachId(daten.fahrraeder, daten.gespann?.fahrrad_id));
  const wagen = $derived(nachId(daten.anhaenger, daten.gespann?.anhaenger_id));
  const gewicht = $derived(gesamtgewicht({ fahrer_gewicht_kg: fahrer, gepaeck_kg: gepaeck }, rad, wagen));

  // Plätze: links Anhänger, rechts Fahrrad
  const plaetze = $derived([
    { art: 'anhaenger', feld: 'anhaenger_id', eintrag: wagen, liste: daten.anhaenger },
    { art: 'fahrraeder', feld: 'fahrrad_id', eintrag: rad, liste: daten.fahrraeder }
  ]);

  const fehlerText = (e) => {
    const text = t(lang, e?.code ? `e_${e.code}` : 'e_allgemein');
    return text.startsWith('e_') ? t(lang, 'e_allgemein') : text;
  };

  /** Speichert das Gespann. Plätze und Gewichte, die nicht geändert werden, bleiben wie gespeichert. */
  async function setze(patch) {
    const g = daten.gespann;
    daten.gespann = await api.gespannSetzen(token, {
      fahrrad_id: g?.fahrrad_id ?? null, anhaenger_id: g?.anhaenger_id ?? null,
      fahrer_gewicht_kg: g?.fahrer_gewicht_kg ?? null, gepaeck_kg: g?.gepaeck_kg ?? null, ...patch
    });
  }

  async function belegen(platz, id) {
    waehlen = null;
    try {
      await setze({ [platz.feld]: id });
    } catch (e) {
      melde(fehlerText(e), 'error');
    }
  }

  async function speichereGewichte(e) {
    e.preventDefault();
    laeuft = true;
    fehler = {};
    try {
      await setze({ fahrer_gewicht_kg: fahrer, gepaeck_kg: gepaeck });
      melde(t(lang, 'saved'));
    } catch (err) {
      if (err.felder) fehler = err.felder;
      melde(fehlerText(err), 'error');
    } finally {
      laeuft = false;
    }
  }

  const grenze = (f, code) => (code === 'zu_lang' || code === 'zu_gross' ? f.max : f.min);
  const meldung = (f) => (fehler[f.key] ? t(lang, `v_${fehler[f.key]}`, grenze(f, fehler[f.key])) : '');

  // Kurzinfo für die Auswahlliste: die ersten zwei ausgefüllten Angaben
  const EINHEIT = { akku_kapazitaet_wh: 'Wh', gewicht_kg: 'kg', leergewicht_kg: 'kg', solar_wp: 'Wp' };
  function kurz(art, e) {
    const keys = art === 'fahrraeder' ? ['motor_system', 'akku_kapazitaet_wh', 'gewicht_kg'] : ['aufbau', 'leergewicht_kg', 'solar_wp'];
    return keys.filter(k => e[k] !== null && e[k] !== '').slice(0, 2).map(k => {
      if (k === 'aufbau') return pick(ARTEN.anhaenger.felder.find(f => f.key === k).optionen.find(o => o.wert === e[k]), lang);
      return typeof e[k] === 'number' ? `${zahlText(lang, e[k])} ${EINHEIT[k]}` : e[k];
    }).join(' · ');
  }
</script>

<section class="gespann" aria-labelledby="gespann-titel">
  <h2 id="gespann-titel">{t(lang, 'gespannTitle')}</h2>

  <div class="plaetze">
    {#each plaetze as p (p.art)}
      <div class="platz" aria-label={t(lang, `slot_${p.art}`)}>
        <h3 class="platzname">{t(lang, `slot_${p.art}`)}</h3>
        {#if p.eintrag}
          <EintragKarte {lang} art={p.art} eintrag={p.eintrag} kompakt>
            {#snippet aktionen()}
              <button type="button" class="btn btn-outline btn-sm" onclick={() => (waehlen = p.art)}>{t(lang, 'change')}</button>
              <button type="button" class="btn btn-ghost btn-sm" onclick={() => belegen(p, null)}>{t(lang, 'leave')}</button>
            {/snippet}
          </EintragKarte>
        {:else}
          <div class="leer">
            <button type="button" class="btn btn-outline plus" disabled={!p.liste.length}
              aria-label={t(lang, `pick_${p.art}`)} title={t(lang, `pick_${p.art}`)} onclick={() => (waehlen = p.art)}>
              <Icon name="ui-plus" size={28} />
            </button>
            <p class="notiz">{p.liste.length ? t(lang, `pick_${p.art}`) : t(lang, `none_${p.art}`)}</p>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <form class="gewichte card" onsubmit={speichereGewichte} novalidate>
    <div class="card-body">
      <div class="raster">
        {#each [feld('fahrer_gewicht_kg'), feld('gepaeck_kg')] as f (f.key)}
          <div>
            <label for="g-{f.key}">{pick(f.label, lang)} ({f.einheit})</label>
            {#if f.key === 'fahrer_gewicht_kg'}
              <input id="g-{f.key}" class="input" type="number" inputmode="decimal" min={f.min} max={f.max} step="any" aria-invalid={!!fehler[f.key]} aria-describedby="g-h-{f.key}" bind:value={fahrer} />
            {:else}
              <input id="g-{f.key}" class="input" type="number" inputmode="decimal" min={f.min} max={f.max} step="any" aria-invalid={!!fehler[f.key]} aria-describedby="g-h-{f.key}" bind:value={gepaeck} />
            {/if}
            <p id="g-h-{f.key}" class="notiz" class:fehler={!!fehler[f.key]}>{fehler[f.key] ? meldung(f) : f.hinweis ? pick(f.hinweis, lang) : ''}</p>
          </div>
        {/each}
      </div>
      <div class="fuss">
        <p class="summe">
          <span class="muted">{t(lang, 'totalWeight')}:</span> <strong>{zahlText(lang, gewicht.summe)}&nbsp;kg</strong>
          {#if gewicht.fehlt.length}<span class="notiz"> · {t(lang, 'weightIncomplete')}</span>{/if}
        </p>
        <button type="submit" class="btn btn-primary btn-sm" disabled={laeuft}>{laeuft ? t(lang, 'saving') : t(lang, 'save')}</button>
      </div>
    </div>
  </form>
</section>

{#if waehlen}
  {@const platz = plaetze.find(p => p.art === waehlen)}
  <Fenster {lang} titel={t(lang, `pick_${waehlen}`)} onclose={() => (waehlen = null)}>
    <ul class="auswahl">
      {#each platz.liste as e (e.id)}
        <li>
          <button type="button" class="wahl" aria-current={platz.eintrag?.id === e.id} onclick={() => belegen(platz, e.id)}>
            <span class="name">{e.name}</span>
            <span class="notiz">{kurz(platz.art, e)}</span>
          </button>
        </li>
      {/each}
    </ul>
    <div class="aktionen">
      <button type="button" class="btn btn-ghost" onclick={() => (waehlen = null)}>{t(lang, 'cancel')}</button>
    </div>
  </Fenster>
{/if}

<style>
  .gespann { margin-bottom: 2rem; }
  h2 { margin-bottom: .75rem; }
  .plaetze { display: grid; grid-template-columns: 1fr; gap: 1rem; margin-bottom: 1rem; }
  .platz { display: flex; flex-direction: column; gap: .375rem; }
  .platzname { color: var(--fg-muted); font-weight: 500; }
  .leer {
    flex: 1; min-height: 9rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5rem;
    border: 1px dashed var(--border); border-radius: var(--radius); padding: 1rem; text-align: center;
  }
  .plus { width: 3.5rem; height: 3.5rem; justify-content: center; border-radius: 999px; padding: 0; }
  .raster { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem .75rem; }
  .notiz { min-height: 1.1rem; margin-top: .125rem; }
  .fuss { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-top: .5rem; }
  .summe { font-size: .875rem; }
  .auswahl { list-style: none; display: flex; flex-direction: column; gap: .5rem; }
  .wahl {
    width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: .125rem; text-align: left;
    padding: .625rem .75rem; background: var(--bg-input); color: var(--fg); border: 1px solid var(--border);
    border-radius: var(--radius-sm); cursor: pointer; font-family: inherit; font-size: .875rem; transition: all .15s;
  }
  .wahl:hover { border-color: var(--primary); }
  .wahl:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .wahl[aria-current="true"] { border-color: var(--primary); background: var(--primary-bg); }
  .name { font-weight: 600; overflow-wrap: anywhere; }
  .aktionen { display: flex; justify-content: flex-end; margin-top: 1rem; }
  @media (min-width: 640px) { .plaetze { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 520px) { .raster { grid-template-columns: 1fr; } }
</style>
