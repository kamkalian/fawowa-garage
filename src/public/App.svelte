<script>
  import { onMount } from 'svelte';
  import Icon from '../shared/Icon.svelte';
  import { FAHRER_NAME_FELD } from '../../lib/felder.js';
  import { t, pick, LANGS } from './lib/i18n.js';
  import * as api from './lib/api.js';
  import Garage from './components/Garage.svelte';
  import EmailSeite from './components/EmailSeite.svelte';
  import ZugangAnfordern from './components/ZugangAnfordern.svelte';

  let lang = $state('de');
  let einst = $state({});
  let token = $state(null);        // Schlüssel der Garage aus dem Teil der Adresse nach #
  let ungueltig = $state(false);   // Adresse hat einen Schlüssel, zu dem es keine Garage gibt
  let aktion = $state(null);       // { art: 'bestaetigen' | 'zugang', token } aus einem Link in einer E-Mail
  let legeAn = $state(false);
  let fahrerName = $state('');     // Eingabe beim Anlegen der Garage
  let nameFehler = $state('');
  let toast = $state(null);        // { text, art }
  let toastTimer;

  // Der Schlüssel steht im Fragment (#g=...), das der Browser nie an den Server sendet: er landet in keinem Protokoll.
  function leseHash() {
    const h = location.hash;
    const mail = /^#(bestaetigen|zugang)=([A-Za-z0-9_-]{43})$/.exec(h);
    if (mail) { aktion = { art: mail[1], token: mail[2] }; token = null; ungueltig = false; return; }
    aktion = null;
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

  async function anlegen(e) {
    e.preventDefault();
    legeAn = true;
    nameFehler = '';
    try {
      const { token: neu } = await api.garageAnlegen(fahrerName);
      history.pushState(null, '', `#g=${neu}`);
      leseHash();
    } catch (err) {
      const code = err.felder?.fahrer_name;
      if (code) {
        nameFehler = t(lang, `v_${code}`, FAHRER_NAME_FELD.max);
      } else {
        const text = t(lang, err.code ? `e_${err.code}` : 'e_allgemein');
        melde(text.startsWith('e_') ? t(lang, 'e_allgemein') : text, 'error');
      }
    } finally {
      legeAn = false;
    }
  }

  /** Ein Zugangslink aus der E-Mail wurde eingelöst: die Garage öffnet sich mit dem neuen persönlichen Link */
  function zugangOffen(neu) {
    aktion = null;
    history.replaceState(null, '', `#g=${neu}`);
    leseHash();
    melde(t(lang, 'zugangOk'));
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
      <!-- Platz für Knöpfe der Garage (Fahrer und Gewicht), direkt links neben dem Hell-Dunkel-Schalter -->
      <div id="kopf-aktionen" class="kopf-aktionen"></div>
      <button class="btn btn-ghost btn-icon" title={t(lang, 'themeToggle')} aria-label={t(lang, 'themeToggle')} onclick={toggleTheme}>
        <Icon name="ui-moon" size={16} />
      </button>
    </div>
  </div>
</header>

<main class="container seite">
  {#if aktion}
    {#key aktion.token}
      <EmailSeite {lang} art={aktion.art} token={aktion.token} onzugang={zugangOffen} onstart={zurStartseite} />
    {/key}
  {:else if token && !ungueltig}
    {#key token}
      <Garage {lang} {token} {melde} emailAktiv={!!einst.emailAktiv} {einst} onungueltig={() => (ungueltig = true)}
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
        <form class="anlegen" onsubmit={anlegen} novalidate>
          <label for="fahrer-name">{pick(FAHRER_NAME_FELD.label, lang)} *</label>
          <input id="fahrer-name" class="input" type="text" maxlength={FAHRER_NAME_FELD.max} autocomplete="off"
            aria-invalid={!!nameFehler} aria-describedby="fahrer-name-hinweis" bind:value={fahrerName} />
          <p id="fahrer-name-hinweis" class="notiz" class:fehler={!!nameFehler}>{nameFehler || pick(FAHRER_NAME_FELD.hinweis, lang)}</p>
          <div><button type="submit" class="btn btn-primary" disabled={legeAn}>{legeAn ? t(lang, 'creating') : t(lang, 'create')}</button></div>
        </form>
        <p class="notiz">{t(lang, 'haveLink')}</p>
        {#if einst.emailAktiv}<ZugangAnfordern {lang} />{/if}
      </div>
    </section>
  {/if}
</main>

<footer class="fussleiste">
  <nav aria-label={pick({ de: 'Fußleiste', en: 'Footer' }, lang)}>
    <a href={'/impressum' + (lang === 'en' ? '?lang=en' : '')}>{pick({ de: 'Impressum', en: 'Legal notice' }, lang)}</a>
    <a href={'/datenschutz' + (lang === 'en' ? '?lang=en' : '')}>{pick({ de: 'Datenschutz', en: 'Privacy' }, lang)}</a>
    {#if einst.verwaltungPfad}
      <a class="verwaltung" href={'/' + einst.verwaltungPfad.replace(/^\//, '')}>{pick({ de: 'Verwaltung', en: 'Admin' }, lang)}</a>
    {/if}
  </nav>
</footer>

{#if toast}
  <div class="toast toast-{toast.art}" role="status">{toast.text}</div>
{/if}

<style>
  .seite { padding-top: 1.5rem; padding-bottom: 2rem; }
  .start { max-width: 40rem; }
  .start .card-body { display: flex; flex-direction: column; gap: .75rem; }
  .anlegen { display: flex; flex-direction: column; gap: .25rem; max-width: 22rem; }
  .anlegen .notiz { min-height: 1.1rem; margin-bottom: .5rem; }
  /* Fußleiste: dezent, wie auf der Materialseite */
  .fussleiste { border-top: 1px solid var(--border); padding: .75rem 1rem; font-size: .8125rem; color: var(--fg-muted); }
  .fussleiste nav { display: flex; flex-wrap: wrap; gap: .25rem 1rem; justify-content: center; max-width: 60rem; margin: 0 auto; }
  .fussleiste a { color: inherit; text-decoration: none; }
  .fussleiste a:hover, .fussleiste a:focus-visible { color: var(--fg); text-decoration: underline; }
  .fussleiste .verwaltung { opacity: .6; }
</style>
