<script>
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.js';
  import * as api from '../lib/api.js';

  // Seite für die Links aus den E-Mails (#bestaetigen=… und #zugang=…): löst den Schlüssel ein und zeigt das Ergebnis.
  // Der Schlüssel steht im Teil nach #, den der Browser nie an den Server sendet; er wird sofort aus der Adresse entfernt.
  // onzugang(neuerSchluessel): öffnet die Garage mit dem neuen persönlichen Link; onstart: zurück zur Startseite
  let { lang, art, token, onzugang, onstart } = $props();

  let status = $state('laden'); // laden | ok | fehler
  let adresse = $state('');
  let fehlerCode = $state('');

  onMount(async () => {
    history.replaceState(null, '', location.pathname + location.search);
    try {
      if (art === 'bestaetigen') {
        adresse = (await api.emailBestaetigen(token)).email;
        status = 'ok';
      } else {
        onzugang((await api.zugangEinloesen(token)).token);
      }
    } catch (e) {
      fehlerCode = e.code ?? '';
      status = 'fehler';
    }
  });

  const fehlerText = $derived.by(() => {
    const text = t(lang, fehlerCode ? `e_${fehlerCode}` : 'e_allgemein');
    return text.startsWith('e_') ? t(lang, 'e_allgemein') : text;
  });
</script>

<section class="card start" aria-labelledby="mail-titel" aria-live="polite">
  <div class="card-body">
    <h2 id="mail-titel">{t(lang, art === 'bestaetigen' ? 'confirmTitle' : 'zugangTitle')}</h2>
    {#if status === 'laden'}
      <p class="text">{t(lang, 'loading')}</p>
    {:else if status === 'ok'}
      <p class="text">{t(lang, 'confirmOk', adresse)}</p>
      <p class="text">{t(lang, 'confirmHint')}</p>
      <div><button type="button" class="btn btn-primary" onclick={onstart}>{t(lang, 'toStart')}</button></div>
    {:else}
      <p class="fehler" role="alert">{fehlerText}</p>
      <div><button type="button" class="btn btn-primary" onclick={onstart}>{t(lang, 'toStart')}</button></div>
    {/if}
  </div>
</section>

<style>
  .start { max-width: 40rem; }
  .start .card-body { display: flex; flex-direction: column; gap: .75rem; }
</style>
