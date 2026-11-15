<script>
  import { ARTEN, GESPANN_FELDER, FAHRER_NAME_FELD } from '../../../lib/felder.js';
  import { gesamtgewicht } from '../../../lib/gewicht.js';
  import Icon from '../../shared/Icon.svelte';
  import { t, pick, zahlText } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import EintragKarte from './EintragKarte.svelte';
  import Fenster from './Fenster.svelte';

  // Das aktuelle Gespann: links der Anhänger, rechts das Fahrrad (immer sichtbar, leer als Platzhalter), darunter die Gewichte.
  // ziehend: { art, id } der Kachel, die gerade aus der Fahrzeugliste gezogen wird (Drag and Drop)
  let { lang, token, daten, melde, ziehend = null } = $props();

  const feld = (k) => GESPANN_FELDER.find(f => f.key === k);
  // Die Gewichte werden einmal aus dem gespeicherten Gespann übernommen und danach im Formular bearbeitet
  // svelte-ignore state_referenced_locally
  let fahrer = $state(daten.gespann?.fahrer_gewicht_kg ?? null);
  // svelte-ignore state_referenced_locally
  let gepaeck = $state(daten.gespann?.gepaeck_kg ?? null);
  let fehler = $state({});
  let waehlen = $state(null);   // 'anhaenger' | 'fahrraeder' | null: welches Auswahlfenster offen ist
  let laeuft = $state(false);
  let nameFenster = $state(false);   // Fenster zum Ändern des Namens
  let nameEingabe = $state('');
  let nameFehler = $state('');
  let ueber = $state(null);     // Platz (art), über dem gerade gezogen wird

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

  // Eine Kachel lässt sich nur auf den passenden Platz ziehen: Fahrrad auf Fahrrad, Anhänger auf Anhänger
  const darfAblegen = (p) => ziehend?.art === p.art;
  function ablageUeber(e, p) {
    if (!darfAblegen(p)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    ueber = p.art;
  }
  function ablageVerlassen(e, p) {
    if (ueber === p.art && !e.currentTarget.contains(e.relatedTarget)) ueber = null;
  }
  async function ablegen(e, p) {
    e.preventDefault();
    ueber = null;
    if (darfAblegen(p)) await belegen(p, ziehend.id);
  }

  function namenAendern() {
    nameEingabe = daten.fahrer_name ?? '';
    nameFehler = '';
    nameFenster = true;
  }

  async function speichereName(e) {
    e.preventDefault();
    nameFehler = '';
    try {
      daten.fahrer_name = (await api.fahrerNameSetzen(token, nameEingabe)).fahrer_name;
      nameFenster = false;
      melde(t(lang, 'saved'));
    } catch (err) {
      const code = err.felder?.fahrer_name;
      if (code) nameFehler = t(lang, `v_${code}`, FAHRER_NAME_FELD.max);
      else melde(fehlerText(err), 'error');
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

<section class="abschnitt gespann" aria-labelledby="gespann-titel">
  <div class="abschnitt-kopf"><h2 id="gespann-titel">{t(lang, 'gespannTitle')}</h2></div>

  <form onsubmit={speichereGewichte} novalidate>
    <div class="raster">
      <!-- Links der Anhänger (über beide Zeilen), rechts oben der Fahrer, rechts unten das Fahrrad -->
      <div class="platz card p-anhaenger" class:ablage={darfAblegen(plaetze[0])} class:ueber={ueber === 'anhaenger'} role="group" aria-label={t(lang, 'slot_anhaenger')}
        ondragover={(e) => ablageUeber(e, plaetze[0])} ondragleave={(e) => ablageVerlassen(e, plaetze[0])} ondrop={(e) => ablegen(e, plaetze[0])}>
        <div class="card-body">
          {@render fahrzeugPlatz(plaetze[0])}
          <div class="gewicht">
            {@render zahlFeld(feld('gepaeck_kg'), 'gepaeck')}
          </div>
        </div>
      </div>

      <div class="platz card p-fahrer" role="group" aria-label={daten.fahrer_name || t(lang, 'slot_fahrer')}>
        <div class="card-body">
          <h3 class="platzname">
            <span class="symbol"><Icon name="veh-person" size={24} /></span>
            <span class="fahrername">{daten.fahrer_name || t(lang, 'slot_fahrer')}</span>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" title={t(lang, 'editName')} aria-label={t(lang, 'editName')} onclick={namenAendern}>
              <Icon name="ui-edit" size={14} />
            </button>
          </h3>
          <div class="fahrer">
            <span class="gross" aria-hidden="true"><Icon name="veh-person" size={72} /></span>
            <div class="feldspalte">
              {@render zahlFeld(feld('fahrer_gewicht_kg'), 'fahrer')}
            </div>
          </div>
        </div>
      </div>

      <div class="platz card p-fahrrad" class:ablage={darfAblegen(plaetze[1])} class:ueber={ueber === 'fahrraeder'} role="group" aria-label={t(lang, 'slot_fahrraeder')}
        ondragover={(e) => ablageUeber(e, plaetze[1])} ondragleave={(e) => ablageVerlassen(e, plaetze[1])} ondrop={(e) => ablegen(e, plaetze[1])}>
        <div class="card-body">
          {@render fahrzeugPlatz(plaetze[1])}
        </div>
      </div>
    </div>

    <div class="fuss">
      <p class="summe">
        <span class="muted">{t(lang, 'totalWeight')}:</span> <strong>{zahlText(lang, gewicht.summe)}&nbsp;kg</strong>
        {#if gewicht.fehlt.length}<span class="notiz"> · {t(lang, 'weightIncomplete')}</span>{/if}
      </p>
      <button type="submit" class="btn btn-primary btn-sm" disabled={laeuft}>{laeuft ? t(lang, 'saving') : t(lang, 'save')}</button>
    </div>
  </form>
</section>

<!-- Ein Platz für Anhänger oder Fahrrad: Überschrift mit Symbol, dann Platzhalter mit Plus-Knopf oder das gewählte Fahrzeug -->
{#snippet fahrzeugPlatz(p)}
  <h3 class="platzname"><span class="symbol"><Icon name={p.art === 'fahrraeder' ? 'veh-bike' : 'veh-trailer'} size={24} /></span>{t(lang, `slot_${p.art}`)}</h3>
  {#if p.eintrag}
    <EintragKarte {lang} art={p.art} eintrag={p.eintrag} kompakt flach>
      {#snippet aktionen()}
        <button type="button" class="btn btn-outline btn-sm" onclick={() => (waehlen = p.art)}>{t(lang, 'change')}</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => belegen(p, null)}>{t(lang, 'leave')}</button>
      {/snippet}
    </EintragKarte>
  {:else}
    <div class="leer">
      <span class="gross" aria-hidden="true"><Icon name={p.art === 'fahrraeder' ? 'veh-bike' : 'veh-trailer'} size={72} /></span>
      <button type="button" class="btn btn-outline plus" disabled={!p.liste.length}
        aria-label={t(lang, `pick_${p.art}`)} title={t(lang, `pick_${p.art}`)} onclick={() => (waehlen = p.art)}>
        <Icon name="ui-plus" size={24} />
      </button>
      <p class="notiz">{p.liste.length ? t(lang, `pick_${p.art}`) : t(lang, `none_${p.art}`)}</p>
    </div>
  {/if}
{/snippet}

{#snippet zahlFeld(f, name)}
  <label for="g-{f.key}">{pick(f.label, lang)} ({f.einheit})</label>
  {#if name === 'fahrer'}
    <input id="g-{f.key}" class="input" type="number" inputmode="decimal" min={f.min} max={f.max} step="any" aria-invalid={!!fehler[f.key]} aria-describedby="g-h-{f.key}" bind:value={fahrer} />
  {:else}
    <input id="g-{f.key}" class="input" type="number" inputmode="decimal" min={f.min} max={f.max} step="any" aria-invalid={!!fehler[f.key]} aria-describedby="g-h-{f.key}" bind:value={gepaeck} />
  {/if}
  <p id="g-h-{f.key}" class="notiz" class:fehler={!!fehler[f.key]}>{fehler[f.key] ? meldung(f) : f.hinweis ? pick(f.hinweis, lang) : ''}</p>
{/snippet}

{#if nameFenster}
  <Fenster {lang} titel={t(lang, 'editNameTitle')} onclose={() => (nameFenster = false)}>
    <form onsubmit={speichereName} novalidate>
      <label for="name-aendern">{pick(FAHRER_NAME_FELD.label, lang)} *</label>
      <input id="name-aendern" class="input" type="text" maxlength={FAHRER_NAME_FELD.max} autocomplete="off" aria-invalid={!!nameFehler}
        aria-describedby="name-aendern-hinweis" bind:value={nameEingabe} />
      <p id="name-aendern-hinweis" class="notiz" class:fehler={!!nameFehler}>{nameFehler || pick(FAHRER_NAME_FELD.hinweis, lang)}</p>
      <div class="aktionen">
        <button type="button" class="btn btn-ghost" onclick={() => (nameFenster = false)}>{t(lang, 'cancel')}</button>
        <button type="submit" class="btn btn-primary">{t(lang, 'save')}</button>
      </div>
    </form>
  </Fenster>
{/if}

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
  /* Schmal: Anhänger, Fahrer, Fahrrad untereinander. Ab 640 px: links der Anhänger über zwei Zeilen, rechts oben Fahrer, rechts unten Fahrrad */
  .gespann :global(h2) { font-size: 1.5rem; }
  .raster { display: grid; grid-template-columns: 1fr; gap: 1.25rem; }
  .ablage { outline: 2px dashed var(--primary); outline-offset: 3px; }
  .platz.ueber { border-color: var(--primary); background: var(--primary-bg); }
  .platz .card-body { display: flex; flex-direction: column; gap: .75rem; height: 100%; padding: 1.25rem; }
  .platzname { display: flex; align-items: center; gap: .5rem; color: var(--fg); font-size: 1rem; font-weight: 600; }
  .symbol { display: inline-flex; color: var(--primary); }
  .fahrername { overflow-wrap: anywhere; }
  .leer { flex: 1; min-height: 13rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .5rem; border: 1px dashed var(--border); border-radius: var(--radius); padding: 1rem; text-align: center; }
  .gross { display: inline-flex; color: var(--fg-muted); }
  .plus { width: 3.5rem; height: 3.5rem; justify-content: center; border-radius: 999px; padding: 0; }
  .fahrer { display: flex; align-items: center; gap: 1rem; }
  .feldspalte { flex: 1; min-width: 0; }
  .gewicht { margin-top: auto; }
  .notiz { min-height: 1.1rem; margin-top: .125rem; }
  .fuss { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-top: 1rem; }
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
  .aktionen { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
  @media (min-width: 640px) {
    .raster { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-template-areas: "anhaenger fahrer" "anhaenger fahrrad"; }
    .p-anhaenger { grid-area: anhaenger; }
    .p-fahrer { grid-area: fahrer; }
    .p-fahrrad { grid-area: fahrrad; }
  }
</style>
