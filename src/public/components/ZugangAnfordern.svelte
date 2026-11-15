<script>
  import { EMAIL_FELD } from '../../../lib/felder.js';
  import { t, pick } from '../lib/i18n.js';
  import * as api from '../lib/api.js';

  // Startseite: Zugangslink per E-Mail anfordern (nur sinnvoll mit bestätigter Adresse). Die Antwort ist immer gleich.
  let { lang } = $props();

  let email = $state('');
  let fehler = $state('');
  let laeuft = $state(false);
  let gesendet = $state(false);

  async function senden(e) {
    e.preventDefault();
    laeuft = true;
    fehler = '';
    gesendet = false;
    try {
      await api.zugangAnfordern(email, lang);
      gesendet = true;
    } catch (err) {
      const code = err.felder?.email;
      if (code) fehler = t(lang, `v_${code}`, EMAIL_FELD.max);
      else {
        const text = t(lang, err.code ? `e_${err.code}` : 'e_allgemein');
        fehler = text.startsWith('e_') ? t(lang, 'e_allgemein') : text;
      }
    } finally {
      laeuft = false;
    }
  }
</script>

<form class="verloren" onsubmit={senden} novalidate>
  <h3>{t(lang, 'lostTitle')}</h3>
  <p class="notiz">{t(lang, 'lostText')}</p>
  <label for="verloren-email">{pick(EMAIL_FELD.label, lang)}</label>
  <div class="zeile">
    <input id="verloren-email" class="input" type="email" autocomplete="email" maxlength={EMAIL_FELD.max}
      aria-invalid={!!fehler} aria-describedby="verloren-hinweis" bind:value={email} />
    <button type="submit" class="btn btn-outline" disabled={laeuft}>{laeuft ? t(lang, 'emailSending') : t(lang, 'lostSend')}</button>
  </div>
  <p id="verloren-hinweis" class="notiz" class:fehler={!!fehler} role={gesendet || fehler ? 'status' : undefined}>
    {#if fehler}{fehler}{:else if gesendet}{t(lang, 'lostDone')}{/if}
  </p>
</form>

<style>
  .verloren { display: flex; flex-direction: column; gap: .25rem; padding-top: 1rem; border-top: 1px solid var(--border); max-width: 28rem; }
  .zeile { display: flex; gap: .5rem; flex-wrap: wrap; }
  .zeile .input { flex: 1; min-width: 12rem; }
  .notiz { min-height: 1.1rem; }
</style>
