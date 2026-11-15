<script>
  import { onMount } from 'svelte';
  import { ARTEN } from '../../../lib/felder.js';
  import Icon from '../../shared/Icon.svelte';
  import { t } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import EintragForm from './EintragForm.svelte';
  import EintragKarte from './EintragKarte.svelte';
  import Fenster from './Fenster.svelte';
  import GespannBereich from './GespannBereich.svelte';

  // Die Garage eines Nutzers auf einer Seite: Gespann, darunter die Fahrräder, darunter die Anhänger
  let { lang, token, melde, onungueltig, ongeloescht } = $props();

  const ARTEN_LISTE = ['fahrraeder', 'anhaenger'];
  let status = $state('laden'); // laden | bereit | fehler
  let daten = $state({ fahrraeder: [], anhaenger: [], gespann: null });
  let form = $state(null);        // { art, eintrag } oder null
  let loeschen = $state(null);    // { art, eintrag } oder null
  let garageLoeschen = $state(false);
  let kopiert = $state(false);
  let laeuft = $state(false);

  const link = $derived(`${location.origin}/#g=${token}`);
  const imGespann = (art, e) => daten.gespann?.[art === 'fahrraeder' ? 'fahrrad_id' : 'anhaenger_id'] === e.id;

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
    form = null;
    melde(t(lang, 'saved'));
  }

  async function entferne() {
    const { art, eintrag } = loeschen;
    laeuft = true;
    try {
      await api.eintragLoeschen(token, art, eintrag.id);
      // Ein Platz im Gespann, der den Eintrag benutzte, ist jetzt leer: alles neu laden, damit die Anzeige stimmt
      daten = await api.garageLaden(token);
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

  <GespannBereich {lang} {token} {daten} {melde} />

  {#each ARTEN_LISTE as art (art)}
    <section class="bereich" aria-labelledby="titel-{art}">
      <div class="kopf">
        <h2 id="titel-{art}">{t(lang, art)} <span class="anzahl">{daten[art].length} / {ARTEN[art].max}</span></h2>
        <button type="button" class="btn btn-primary" disabled={daten[art].length >= ARTEN[art].max} onclick={() => (form = { art, eintrag: null })}>
          <Icon name="ui-plus" size={14} /> {t(lang, `add_${art}`)}
        </button>
      </div>

      {#if !daten[art].length}
        <p class="muted">{t(lang, `empty_${art}`)}</p>
      {:else}
        <div class="liste">
          {#each daten[art] as e (e.id)}
            <EintragKarte {lang} {art} eintrag={e} imGespann={imGespann(art, e)}
              onedit={() => (form = { art, eintrag: e })} onremove={() => (loeschen = { art, eintrag: e })} />
          {/each}
        </div>
      {/if}
    </section>
  {/each}

  <p class="unten"><button type="button" class="btn btn-ghost btn-sm" onclick={() => (garageLoeschen = true)}><Icon name="ui-trash" size={14} /> {t(lang, 'deleteGarage')}</button></p>
{/if}

{#if form}
  <EintragForm {lang} art={form.art} eintrag={form.eintrag} onsave={speichere} onclose={() => (form = null)} />
{/if}

{#if loeschen}
  <Fenster {lang} titel={t(lang, 'remove')} onclose={() => (loeschen = null)}>
    <p class="text">{t(lang, 'confirmDelete', loeschen.eintrag.name)}</p>
    {#if imGespann(loeschen.art, loeschen.eintrag)}<p class="text">{t(lang, 'confirmDeleteGespann')}</p>{/if}
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
  .linkkarte { margin-bottom: 2rem; }
  .linkkarte .card-body { display: flex; flex-direction: column; gap: .5rem; }
  .linkzeile { display: flex; gap: .5rem; flex-wrap: wrap; }
  .linkzeile .input { flex: 1; min-width: 12rem; font-family: ui-monospace, monospace; }
  .bereich { margin-bottom: 2rem; }
  .kopf { display: flex; align-items: center; justify-content: space-between; gap: .75rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .anzahl { font-size: .8125rem; font-weight: 400; color: var(--fg-muted); margin-left: .5rem; }
  .liste { display: grid; grid-template-columns: 1fr; gap: 1rem; }
  .unten { margin-top: 2rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
  .aktionen { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
  @media (min-width: 640px) { .liste { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 1000px) { .liste { grid-template-columns: repeat(3, 1fr); } }
</style>
