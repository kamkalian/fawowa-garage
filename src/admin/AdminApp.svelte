<script>
  import { onMount } from 'svelte';
  import { api } from './api.js';
  import Login from './Login.svelte';
  import Garagen from './Garagen.svelte';
  import Jobs from './Jobs.svelte';
  import GarageDetail from './GarageDetail.svelte';

  let angemeldet = $state(null);   // null = prüfe noch
  let reiter = $state('kartendaten'); // Reiter der Verwaltung: kartendaten | garagen
  let auswahl = $state(null);      // Nummer der geöffneten Garage
  let uebersicht = $state(null);
  let stand = $state(0);           // zählt hoch, wenn sich Daten geändert haben: Liste und Zahlen laden neu

  async function ladeUebersicht() {
    try { uebersicht = await api('GET', '/uebersicht'); } catch { /* Anmeldung wird über das Ereignis behandelt */ }
  }
  const geaendert = () => { stand += 1; };

  onMount(() => {
    const abgemeldet = () => (angemeldet = false);
    window.addEventListener('admin-abgemeldet', abgemeldet);
    api('GET', '/sitzung').then(d => (angemeldet = d.angemeldet)).catch(() => (angemeldet = false));
    return () => window.removeEventListener('admin-abgemeldet', abgemeldet);
  });

  $effect(() => {
    stand; // eslint-disable-line no-unused-expressions
    if (angemeldet) ladeUebersicht();
  });

  async function abmelden() {
    try { await api('POST', '/logout', {}); } catch { /* Sitzung ist ohnehin weg */ }
    angemeldet = false;
    auswahl = null;
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* ignorieren */ }
  }
</script>

<header class="header">
  <div class="header-inner">
    <div>
      <h1 class="glow-text">Admin · FaWoWa-Garage</h1>
      <p class="header-sub"><a href="/">Zur öffentlichen Seite</a></p>
    </div>
    <div class="header-tools">
      <button class="btn btn-ghost btn-sm" onclick={toggleTheme}>Hell/Dunkel</button>
      {#if angemeldet}<button class="btn btn-outline btn-sm" onclick={abmelden}>Abmelden</button>{/if}
    </div>
  </div>
</header>

<main class="container seite">
  {#if angemeldet === null}
    <p class="muted">Lade ...</p>
  {:else if !angemeldet}
    <Login onerfolg={() => (angemeldet = true)} />
  {:else}
    <nav class="reiter" role="tablist" aria-label="Verwaltung">
      <button type="button" role="tab" id="reiter-kartendaten" aria-selected={reiter === 'kartendaten'} aria-controls="feld-kartendaten" class:aktiv={reiter === 'kartendaten'} onclick={() => (reiter = 'kartendaten')}>Daten laden</button>
      <button type="button" role="tab" id="reiter-garagen" aria-selected={reiter === 'garagen'} aria-controls="feld-garagen" class:aktiv={reiter === 'garagen'} onclick={() => (reiter = 'garagen')}>Garagen</button>
    </nav>

    {#if reiter === 'kartendaten'}
      <div role="tabpanel" id="feld-kartendaten" aria-labelledby="reiter-kartendaten">
        <Jobs />
      </div>
    {:else}
      <div role="tabpanel" id="feld-garagen" aria-labelledby="reiter-garagen">
      {#if uebersicht}
        <dl class="zahlen" aria-label="Übersicht">
          <div><dt>Garagen</dt><dd>{uebersicht.garagen}</dd></div>
          <div class:warn={uebersicht.garagen_mit_ungeprueften > 0}><dt>Garagen mit ungeprüften Einträgen</dt><dd>{uebersicht.garagen_mit_ungeprueften}</dd></div>
          <div class:warn={uebersicht.ungeprueft > 0}><dt>Ungeprüfte Einträge</dt><dd>{uebersicht.ungeprueft}</dd></div>
          <div><dt>Fahrräder / Anhänger</dt><dd>{uebersicht.fahrraeder} / {uebersicht.anhaenger}</dd></div>
          <div><dt>Mit bestätigter E-Mail</dt><dd>{uebersicht.mit_email}</dd></div>
        </dl>
      {/if}

        <!-- Die Liste bleibt geladen (nur ausgeblendet), damit Suche und Seite beim Zurückkehren erhalten bleiben -->
        <div hidden={auswahl !== null}>
          <Garagen {stand} onoeffnen={(id) => (auswahl = id)} />
        </div>
        {#if auswahl !== null}
          {#key auswahl}
            <GarageDetail id={auswahl} onzurueck={() => (auswahl = null)} onaenderung={geaendert} />
          {/key}
        {/if}
      </div>
    {/if}
  {/if}
</main>

<style>
  .seite { padding-top: 1.5rem; padding-bottom: 2rem; }
  .reiter { display: flex; gap: .25rem; border-bottom: 1px solid var(--border); margin: 1rem 0; }
  .reiter button { background: none; border: 0; border-bottom: 2px solid transparent; padding: .5rem .9rem; font: inherit; color: var(--fg-muted); cursor: pointer; }
  .reiter button.aktiv { color: var(--fg); border-bottom-color: var(--primary); font-weight: 600; }
  .zahlen { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: .75rem; margin-bottom: 1.5rem; }
  .zahlen > div { padding: .75rem 1rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); }
  .zahlen dt { font-size: .75rem; color: var(--fg-muted); }
  .zahlen dd { font-size: 1.5rem; font-weight: 600; line-height: 1.3; }
  .zahlen .warn { border-color: var(--amber); }
  .zahlen .warn dd { color: var(--amber); }
</style>
