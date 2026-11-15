<script>
  import { EMAIL_FELD } from '../../../lib/felder.js';
  import { t, pick } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import Fenster from './Fenster.svelte';

  // E-Mail-Adresse der Garage: freiwillig, gilt erst nach dem Klick auf den Link in der Bestätigungs-Mail.
  let { lang, token, daten, melde, onclose } = $props();

  // svelte-ignore state_referenced_locally
  let eingabe = $state(daten.email_offen ?? '');
  let fehler = $state('');
  let laeuft = $state(false);

  const meldung = (e) => {
    const text = t(lang, e?.code ? `e_${e.code}` : 'e_allgemein');
    return text.startsWith('e_') ? t(lang, 'e_allgemein') : text;
  };

  async function senden(e) {
    e.preventDefault();
    laeuft = true;
    fehler = '';
    try {
      daten.email_offen = (await api.emailSetzen(token, eingabe, lang)).email_offen;
    } catch (err) {
      const code = err.felder?.email;
      fehler = code ? t(lang, `v_${code}`, EMAIL_FELD.max) : meldung(err);
    } finally {
      laeuft = false;
    }
  }

  async function entfernen() {
    laeuft = true;
    try {
      await api.emailEntfernen(token);
      daten.email = null;
      daten.email_offen = null;
      melde(t(lang, 'emailRemoved'));
      onclose();
    } catch (err) {
      fehler = meldung(err);
    } finally {
      laeuft = false;
    }
  }
</script>

<Fenster {lang} titel={t(lang, 'emailTitle')} onclose={onclose}>
  <p class="text">{t(lang, 'emailIntro')}</p>

  {#if daten.email}<p class="status ok" role="status">{t(lang, 'emailConfirmed', daten.email)}</p>{/if}
  {#if daten.email_offen}<p class="status offen" role="status">{t(lang, 'emailSent', daten.email_offen)}</p>{/if}

  <form onsubmit={senden} novalidate>
    <label for="email-eingabe">{pick(EMAIL_FELD.label, lang)}</label>
    <input id="email-eingabe" class="input" type="email" autocomplete="email" maxlength={EMAIL_FELD.max}
      aria-invalid={!!fehler} aria-describedby="email-hinweis" bind:value={eingabe} />
    <p id="email-hinweis" class="notiz" class:fehler={!!fehler}>{fehler}</p>
    <div class="aktionen">
      {#if daten.email || daten.email_offen}
        <button type="button" class="btn btn-ghost" disabled={laeuft} onclick={entfernen}>{t(lang, 'emailRemove')}</button>
      {/if}
      <button type="submit" class="btn btn-primary" disabled={laeuft}>
        {laeuft ? t(lang, 'emailSending') : t(lang, daten.email_offen ? 'emailResend' : 'emailSend')}
      </button>
    </div>
  </form>
</Fenster>

<style>
  .status { font-size: .8125rem; margin: .75rem 0; padding: .5rem .75rem; border-radius: var(--radius-sm); border: 1px solid; }
  .status.ok { color: var(--primary); background: var(--primary-bg); border-color: var(--primary); }
  .status.offen { color: var(--amber); background: var(--amber-bg); border-color: var(--amber); }
  form { margin-top: .75rem; }
  .notiz { min-height: 1.1rem; margin-top: .125rem; }
  .aktionen { display: flex; gap: .5rem; justify-content: flex-end; margin-top: .5rem; }
</style>
