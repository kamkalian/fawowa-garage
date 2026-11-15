<script>
  import { onMount } from 'svelte';
  import { ARTEN } from '../../../lib/felder.js';
  import Icon from '../../shared/Icon.svelte';
  import { t, pick } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import EintragForm from './EintragForm.svelte';
  import EintragKarte from './EintragKarte.svelte';
  import Fenster from './Fenster.svelte';

  // Die Garage eines Nutzers: Fahrräder, Anhänger und Gespanne
  let { lang, token, melde, onungueltig, ongeloescht } = $props();

  const TABS = ['fahrraeder', 'anhaenger', 'gespanne'];
  let status = $state('laden'); // laden | bereit | fehler
  let daten = $state({ fahrraeder: [], anhaenger: [], gespanne: [] });
  let tab = $state('fahrraeder');
  let form = $state(null);        // { art, eintrag } oder null
  let loeschen = $state(null);    // { art, eintrag } oder null
  let garageLoeschen = $state(false);
  let kopiert = $state(false);
  let laeuft = $state(false);

  const link = $derived(`${location.origin}/#g=${token}`);
  const kannGespann = $derived(daten.fahrraeder.length > 0 && daten.anhaenger.length > 0);

  onMount(async () => {
    try {
      daten = await api.garageLaden(token);
      status = 'bereit';
    } catch (e) {
      if (e.status === 401) onungueltig();
      else status = 'fehler';
    }
  });

  const fehlerMeldung = (e) => {
    const text = t(lang, e?.code ? `e_${e.code}` : 'e_allgemein');
    return text.startsWith('e_') ? t(lang, 'e_allgemein') : text;
  };

  async function speichere(werte) {
    const { art, eintrag } = form;
    const neu = eintrag
      ? await api.eintragAendern(token, art, eintrag.id, werte)
      : await api.eintragAnlegen(token, art, werte);
    daten[art] = eintrag ? daten[art].map(x => (x.id === neu.id ? neu : x)) : [...daten[art], neu];
    // Ein geänderter Name oder Gewichte wirken sich nicht auf andere Listen aus; Gespanne lesen ihre Daten live aus den Listen
    form = null;
    melde(t(lang, 'saved'));
  }

  async function entferne() {
    const { art, eintrag } = loeschen;
    laeuft = true;
    try {
      await api.eintragLoeschen(token, art, eintrag.id);
      daten[art] = daten[art].filter(x => x.id !== eintrag.id);
      melde(t(lang, 'deleted'));
    } catch (e) {
      melde(fehlerMeldung(e), 'error');
    } finally {
      laeuft = false;
      loeschen = null;
    }
  }

  async function entferneGarage() {
    laeuft = true;
    try {
      await api.garageLoeschen(token);
      ongeloescht();
    } catch (e) {
      melde(fehlerMeldung(e), 'error');
      garageLoeschen = false;
    } finally {
      laeuft = false;
    }
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(link);
      kopiert = true;
      setTimeout(() => (kopiert = false), 2000);
    } catch {
      document.getElementById('garage-link')?.select();
    }
  }
</script>

{#if status === 'laden'}
  <p class="muted">{t(lang, 'loading')}</p>
{:else if status === 'fehler'}
  <p class="fehler" role="alert">{t(lang, 'loadError')}</p>
{:else}
  <section class="card linkkarte" aria-labelledby="link-titel">
    <div class="card-body">
      <h2 id="link-titel">{t(lang, 'linkTitle')}</h2>
      <p class="text">{t(lang, 'linkText')}</p>
      <div class="linkzeile">
        <input id="garage-link" class="input" type="text" readonly value={link} aria-label={t(lang, 'linkTitle')} onfocus={(e) => e.currentTarget.select()} />
        <button type="button" class="btn btn-outline" onclick={kopieren}><Icon name="ui-copy" size={14} /> {kopiert ? t(lang, 'copied') : t(lang, 'copy')}</button>
      </div>
    </div>
  </section>

  <div class="tabs" role="tablist" aria-label={t(lang, 'tabs')}>
    {#each TABS as a (a)}
      <button type="button" role="tab" class="tab" class:aktiv={tab === a} aria-selected={tab === a} id="tab-{a}" aria-controls="bereich" onclick={() => (tab = a)}>
        {t(lang, a)} <span class="anzahl">{daten[a].length}</span>
      </button>
    {/each}
  </div>

  <div id="bereich" role="tabpanel" aria-labelledby="tab-{tab}">
    <div class="werkzeug">
      <button type="button" class="btn btn-primary" disabled={(tab === 'gespanne' && !kannGespann) || daten[tab].length >= ARTEN[tab].max}
        onclick={() => (form = { art: tab, eintrag: null })}>
        <Icon name="ui-plus" size={14} /> {t(lang, `add${tab[0].toUpperCase()}${tab.slice(1)}`)}
      </button>
      <span class="notiz">{daten[tab].length} / {ARTEN[tab].max}</span>
    </div>

    {#if tab === 'gespanne' && !kannGespann}<p class="text">{t(lang, 'needBoth')}</p>{/if}
    {#if !daten[tab].length}
      <p class="muted">{t(lang, `empty${tab[0].toUpperCase()}${tab.slice(1)}`)}</p>
    {:else}
      <div class="liste">
        {#each daten[tab] as e (e.id)}
          <EintragKarte {lang} art={tab} eintrag={e} {daten}
            onedit={() => (form = { art: tab, eintrag: e })} onremove={() => (loeschen = { art: tab, eintrag: e })} />
        {/each}
      </div>
    {/if}
  </div>

  <p class="unten"><button type="button" class="btn btn-ghost btn-sm" onclick={() => (garageLoeschen = true)}><Icon name="ui-trash" size={14} /> {t(lang, 'deleteGarage')}</button></p>
{/if}

{#if form}
  <EintragForm {lang} art={form.art} eintrag={form.eintrag} {daten} onsave={speichere} onclose={() => (form = null)} />
{/if}

{#if loeschen}
  <Fenster {lang} titel={t(lang, 'remove')} onclose={() => (loeschen = null)}>
    <p class="text">{t(lang, 'confirmDelete', loeschen.eintrag.name)}</p>
    <div class="aktionen">
      <button type="button" class="btn btn-ghost" onclick={() => (loeschen = null)}>{t(lang, 'cancel')}</button>
      <button type="button" class="btn btn-danger" disabled={laeuft} onclick={entferne}>{t(lang, 'remove')}</button>
    </div>
  </Fenster>
{/if}

{#if garageLoeschen}
  <Fenster {lang} titel={t(lang, 'deleteGarageTitle')} onclose={() => (garageLoeschen = false)}>
    <p class="text">{t(lang, 'deleteGarageText')}</p>
    <div class="aktionen">
      <button type="button" class="btn btn-ghost" onclick={() => (garageLoeschen = false)}>{t(lang, 'cancel')}</button>
      <button type="button" class="btn btn-danger" disabled={laeuft} onclick={entferneGarage}>{t(lang, 'deleteGarageAll')}</button>
    </div>
  </Fenster>
{/if}

<style>
  .linkkarte { margin-bottom: 1.5rem; }
  .linkkarte .card-body { display: flex; flex-direction: column; gap: .5rem; }
  .linkzeile { display: flex; gap: .5rem; flex-wrap: wrap; }
  .linkzeile .input { flex: 1; min-width: 12rem; font-family: ui-monospace, monospace; }
  .tabs { display: flex; gap: .25rem; margin-bottom: 1rem; flex-wrap: wrap; }
  .tab {
    padding: .5rem 1rem; border-radius: var(--radius-sm); font-size: .8125rem; font-family: inherit;
    background: transparent; color: var(--fg-muted); border: none; cursor: pointer; transition: all .15s;
  }
  .tab:hover { background: var(--bg-hover); color: var(--fg); }
  .tab.aktiv { background: var(--primary); color: var(--on-primary); }
  .anzahl { margin-left: .25rem; opacity: .8; }
  .werkzeug { display: flex; align-items: center; gap: .75rem; margin-bottom: 1rem; }
  .liste { display: grid; grid-template-columns: 1fr; gap: 1rem; }
  .unten { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
  .aktionen { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
  @media (min-width: 640px) { .liste { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1000px) { .liste { grid-template-columns: repeat(3, 1fr); } }
</style>
