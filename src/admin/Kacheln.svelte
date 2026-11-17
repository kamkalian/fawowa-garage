<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from './api.js';

  // Kacheln vorab erzeugen: Stand des Hintergrundjobs, Start und Stopp. Während der Job läuft, wird der Stand alle 2 Sekunden neu geladen.
  let stand = $state(null);
  let fehler = $state('');
  let beschaeftigt = $state(false);
  let timer = null;

  async function laden() {
    try {
      stand = await api('GET', '/kacheln');
      fehler = '';
      if (stand.job?.laeuft && !timer) timer = setInterval(laden, 2000);
      if (!stand.job?.laeuft && timer) { clearInterval(timer); timer = null; }
    } catch (e) {
      fehler = e.message;
    }
  }

  async function starten() {
    beschaeftigt = true;
    try {
      await api('POST', '/kacheln/start', {});
      await laden();
    } catch (e) {
      fehler = e.message;
    } finally {
      beschaeftigt = false;
    }
  }

  async function anhalten() {
    beschaeftigt = true;
    try {
      await api('POST', '/kacheln/stop', {});
      await laden();
    } catch (e) {
      fehler = e.message;
    } finally {
      beschaeftigt = false;
    }
  }

  const zahl = (n) => (n ?? 0).toLocaleString('de-DE');
  const zeit = (s) => (s ? new Date(s).toLocaleString('de-DE') : '–');

  onMount(laden);
  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<section class="kacheln" aria-label="Kacheln">
  <h2>Kacheln der Karte</h2>
  {#if stand}
    {@const job = stand.job}
    <p class="hinweis">
      Die Kacheln werden im Hintergrund erzeugt und gespeichert. Vorhandene Kacheln werden übersprungen. Zoomstufen {stand.zoom[0]} bis {stand.zoom[1]}.
      {#if stand.schaetzung}Insgesamt etwa {zahl(stand.schaetzung.gesamt)} Kacheln.{/if}
    </p>

    {#if job}
      <div class="fortschritt" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={job.prozent} aria-label="Fortschritt der Kacheln">
        <div class="balken" style="width: {job.prozent}%"></div>
      </div>
      <p class="zahlen-zeile">
        <strong>{job.prozent} %</strong> · {zahl(job.fertig)} von {zahl(job.gesamt)} · Fehler: {zahl(job.fehler)}
        {#if job.laeuft}· läuft{:else if job.beendet}· zuletzt beendet {zeit(job.beendet)}{/if}
      </p>
      {#if job.letzterFehler}<p class="fehler">Letzter Fehler: {job.letzterFehler}</p>{/if}
      {#if job.laeuft && job.abbruch}<p class="hinweis">Wird nach der laufenden Charge angehalten.</p>{/if}
    {/if}

    <div class="knoepfe">
      {#if job?.laeuft}
        <button class="btn btn-outline" disabled={beschaeftigt || job.abbruch} onclick={anhalten}>Anhalten</button>
      {:else}
        <button class="btn btn-primary" disabled={beschaeftigt || !stand.schaetzung} onclick={starten}>Kacheln erzeugen</button>
      {/if}
    </div>
  {:else if !fehler}
    <p class="muted">Lade ...</p>
  {/if}
  {#if fehler}<p class="fehler" role="alert">{fehler}</p>{/if}
</section>

<style>
  .kacheln { margin: 1rem 0 1.5rem; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-card); }
  h2 { font-size: 1rem; margin: 0 0 .5rem; }
  .hinweis, .zahlen-zeile { font-size: .875rem; color: var(--fg-muted); margin: .5rem 0; }
  .fortschritt { height: .75rem; border-radius: 999px; background: var(--bg-input); overflow: hidden; }
  .balken { height: 100%; background: var(--primary); transition: width .4s; }
  .knoepfe { display: flex; gap: .5rem; margin-top: .75rem; }
  .fehler { color: var(--danger, #dc2626); font-size: .875rem; }
</style>
