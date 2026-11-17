<script>
  import { onMount } from 'svelte';
  import { api } from './api.js';
  import Login from './Login.svelte';
  import Garagen from './Garagen.svelte';
  import Kacheln from './Kacheln.svelte';
  import GarageDetail from './GarageDetail.svelte';

  let angemeldet = $state(null);   // null = prüfe noch
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
    {#if uebersicht}
      <dl class="zahlen" aria-label="Übersicht">
        <div><dt>Garagen</dt><dd>{uebersicht.garagen}</dd></div>
        <div class:warn={uebersicht.garagen_mit_ungeprueften > 0}><dt>Garagen mit ungeprüften Einträgen</dt><dd>{uebersicht.garagen_mit_ungeprueften}</dd></div>
        <div class:warn={uebersicht.ungeprueft > 0}><dt>Ungeprüfte Einträge</dt><dd>{uebersicht.ungeprueft}</dd></div>
        <div><dt>Fahrräder / Anhänger</dt><dd>{uebersicht.fahrraeder} / {uebersicht.anhaenger}</dd></div>
        <div><dt>Mit bestätigter E-Mail</dt><dd>{uebersicht.mit_email}</dd></div>
      </dl>
    {/if}

    <Kacheln />

    <!-- Die Liste bleibt geladen (nur ausgeblendet), damit Suche und Seite beim Zurückkehren erhalten bleiben -->
    <div hidden={auswahl !== null}>
      <Garagen {stand} onoeffnen={(id) => (auswahl = id)} />
    </div>
    {#if auswahl !== null}
      {#key auswahl}
        <GarageDetail id={auswahl} onzurueck={() => (auswahl = null)} onaenderung={geaendert} />
      {/key}
    {/if}
  {/if}
</main>

<style>
  .seite { padding-top: 1.5rem; padding-bottom: 2rem; }
  .zahlen { display: grid; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); gap: .75rem; margin-bottom: 1.5rem; }
  .zahlen > div { padding: .75rem 1rem; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius); }
  .zahlen dt { font-size: .75rem; color: var(--fg-muted); }
  .zahlen dd { font-size: 1.5rem; font-weight: 600; line-height: 1.3; }
  .zahlen .warn { border-color: var(--amber); }
  .zahlen .warn dd { color: var(--amber); }
</style>
