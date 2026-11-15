<script>
  import { onMount } from 'svelte';
  import Icon from '../shared/Icon.svelte';
  import { t, LANGS } from './lib/i18n.js';
  import * as api from './lib/api.js';
  import Garage from './components/Garage.svelte';

  let lang = $state('de');
  let einst = $state({});
  let token = $state(null);        // Schlüssel der Garage aus dem Teil der Adresse nach #
  let ungueltig = $state(false);   // Adresse hat einen Schlüssel, zu dem es keine Garage gibt
  let legeAn = $state(false);
  let toast = $state(null);        // { text, art }
  let toastTimer;

  // Der Schlüssel steht im Fragment (#g=...), das der Browser nie an den Server sendet: er landet in keinem Protokoll.
  function leseHash() {
    const h = location.hash;
    if (!h || h === '#') { token = null; ungueltig = false; return; }
    const m = /^#g=([A-Za-z0-9_-]{43})$/.exec(h);
    token = m ? m[1] : null;
    ungueltig = !m;
  }

  function melde(text, art = 'success') {
    toast = { text, art };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 4000);
  }

  async function anlegen() {
    legeAn = true;
    try {
      const { token: neu } = await api.garageAnlegen();
      history.pushState(null, '', `#g=${neu}`);
      leseHash();
    } catch (e) {
      const text = t(lang, e.code ? `e_${e.code}` : 'e_allgemein');
      melde(text.startsWith('e_') ? t(lang, 'e_allgemein') : text, 'error');
    } finally {
      legeAn = false;
    }
  }

  function zurStartseite() {
    history.pushState(null, '', location.pathname);
    leseHash();
  }

  function setLang(l) {
    lang = l;
    history.replaceState(null, '', location.pathname + (l === 'en' ? '?lang=en' : '') + location.hash);
    try { localStorage.setItem('lang', l); } catch { /* Speicher nicht verfügbar */ }
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* ignorieren */ }
  }

  onMount(() => {
    // Sprache: Adresse hat Vorrang, dann der Browser-Speicher, sonst Deutsch
    let gespeichert = null;
    try { gespeichert = localStorage.getItem('lang'); } catch { /* ignorieren */ }
    const ausUrl = new URLSearchParams(location.search).get('lang');
    lang = LANGS.includes(ausUrl) ? ausUrl : LANGS.includes(gespeichert) ? gespeichert : 'de';
    try {
      const theme = localStorage.getItem('theme');
      if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    } catch { /* ignorieren */ }

    leseHash();
    window.addEventListener('hashchange', leseHash);
    api.einstellungen().then(e => (einst = e)).catch(() => {});
    return () => window.removeEventListener('hashchange', leseHash);
  });

  $effect(() => {
    document.documentElement.lang = lang;
    document.title = t(lang, 'title');
  });
</script>

{#if einst.testinstanz}<div class="test-banner" role="note">{t(lang, 'testBanner')}</div>{/if}

<header class="header">
  <div class="header-inner">
    <div>
      <h1 class="glow-text">{t(lang, 'title')}</h1>
      <p class="header-sub">{t(lang, 'sub')}</p>
    </div>
    <div class="header-tools">
      {#if einst.hauptseiteUrl}
        <a class="btn btn-ghost btn-sm" href={einst.hauptseiteUrl}>{t(lang, 'backToMain')}</a>
      {/if}
      <div class="lang-switch" role="group" aria-label={t(lang, 'langSwitch')}>
        <button class="btn btn-sm {lang === 'de' ? 'btn-primary' : 'btn-ghost'}" aria-pressed={lang === 'de'} onclick={() => setLang('de')}>DE</button>
        <button class="btn btn-sm {lang === 'en' ? 'btn-primary' : 'btn-ghost'}" aria-pressed={lang === 'en'} onclick={() => setLang('en')}>EN</button>
      </div>
      <button class="btn btn-ghost btn-icon" title={t(lang, 'themeToggle')} aria-label={t(lang, 'themeToggle')} onclick={toggleTheme}>
        <Icon name="ui-moon" size={16} />
      </button>
    </div>
  </div>
</header>

<main class="container seite">
  {#if token && !ungueltig}
    {#key token}
      <Garage {lang} {token} {melde} onungueltig={() => (ungueltig = true)}
        ongeloescht={() => { zurStartseite(); melde(t(lang, 'garageDeleted')); }} />
    {/key}
  {:else if ungueltig}
    <section class="card start" aria-labelledby="ung-titel">
      <div class="card-body">
        <h2 id="ung-titel">{t(lang, 'linkInvalidTitle')}</h2>
        <p class="text">{t(lang, 'linkInvalid')}</p>
        <div><button class="btn btn-primary" onclick={zurStartseite}>{t(lang, 'newGarage')}</button></div>
      </div>
    </section>
  {:else}
    <section class="card start" aria-labelledby="intro-titel">
      <div class="card-body">
        <h2 id="intro-titel">{t(lang, 'introTitle')}</h2>
        <p class="text">{t(lang, 'intro')}</p>
        <p class="text">{t(lang, 'introPrivate')}</p>
        <div><button class="btn btn-primary" disabled={legeAn} onclick={anlegen}>{legeAn ? t(lang, 'creating') : t(lang, 'create')}</button></div>
        <p class="notiz">{t(lang, 'haveLink')}</p>
      </div>
    </section>
  {/if}
</main>

{#if toast}
  <div class="toast toast-{toast.art}" role="status">{toast.text}</div>
{/if}

<style>
  .seite { padding-top: 1.5rem; padding-bottom: 2rem; }
  .start { max-width: 40rem; }
  .start .card-body { display: flex; flex-direction: column; gap: .75rem; }
</style>
