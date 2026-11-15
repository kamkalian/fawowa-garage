<script>
  import { api } from './api.js';
  import { datum } from './anzeige.js';

  // Liste aller Garagen mit Suche (Name, E-Mail-Adresse oder Nummer) und Filter „nur mit ungeprüften Einträgen“
  let { stand, onoeffnen } = $props();

  let suche = $state('');
  let ungeprueft = $state(false);
  let seite = $state(1);
  let daten = $state(null);
  let fehler = $state('');
  let timer;

  async function laden() {
    try {
      const p = new URLSearchParams({ seite: String(seite) });
      if (suche.trim()) p.set('suche', suche.trim());
      if (ungeprueft) p.set('ungeprueft', '1');
      daten = await api('GET', `/garagen?${p}`);
      fehler = '';
    } catch (e) {
      fehler = e.message;
    }
  }

  // Suche und Filter laden nach kurzer Pause neu, Änderungen an Daten (stand) sofort
  $effect(() => {
    suche; ungeprueft; seite; stand; // eslint-disable-line no-unused-expressions
    clearTimeout(timer);
    timer = setTimeout(laden, 250);
    return () => clearTimeout(timer);
  });

  const seiten = $derived(daten ? Math.max(1, Math.ceil(daten.gesamt / daten.proSeite)) : 1);
  const neuSuchen = () => { seite = 1; };
</script>

<div class="kopf">
  <input class="input suche" type="search" placeholder="Name, E-Mail oder Nummer" aria-label="Suche" bind:value={suche} oninput={neuSuchen} />
  <label class="haken"><input type="checkbox" bind:checked={ungeprueft} onchange={neuSuchen} /> nur mit ungeprüften Einträgen</label>
  {#if daten}<span class="zaehler">{daten.gesamt} Garagen</span>{/if}
</div>

{#if fehler}<p class="meldung-fehler" role="alert">{fehler}</p>{/if}

{#if daten && !daten.garagen.length}
  <p class="leer">Keine Garagen gefunden.</p>
{:else if daten}
  <ul class="liste">
    {#each daten.garagen as g (g.id)}
      <li>
        <button type="button" class="eintrag" onclick={() => onoeffnen(g.id)}>
          <span class="haupt">
            <span class="titel">{g.fahrer_name ?? 'Ohne Namen'}</span>
            <span class="unter">
              Nr. {g.id}
              {#if g.email} · {g.email}{#if g.email_bestaetigt_am} (bestätigt){/if}{/if}
              · angelegt {datum(g.erstellt_am)} · zuletzt genutzt {datum(g.zuletzt_genutzt_am)}
            </span>
          </span>
          <span class="rechts">
            <span>{g.fahrraeder} {g.fahrraeder === 1 ? 'Fahrrad' : 'Fahrräder'} · {g.anhaenger} Anhänger</span>
            {#if g.ungeprueft > 0}
              <span class="badge badge-check">{g.ungeprueft} ungeprüft</span>
            {:else}
              <span class="badge badge-active">alles geprüft</span>
            {/if}
          </span>
        </button>
      </li>
    {/each}
  </ul>

  {#if seiten > 1}
    <nav class="seiten" aria-label="Seiten">
      <button type="button" class="btn btn-outline btn-sm" disabled={seite <= 1} onclick={() => (seite -= 1)}>Zurück</button>
      <span class="zaehler">Seite {seite} von {seiten}</span>
      <button type="button" class="btn btn-outline btn-sm" disabled={seite >= seiten} onclick={() => (seite += 1)}>Weiter</button>
    </nav>
  {/if}
{:else}
  <p class="muted">Lade ...</p>
{/if}

<style>
  .kopf { display: flex; flex-wrap: wrap; gap: .75rem 1rem; align-items: center; margin-bottom: 1rem; }
  .suche { flex: 1 1 14rem; max-width: 22rem; }
  .haken { display: flex; align-items: center; gap: .5rem; margin: 0; cursor: pointer; }
  .zaehler { color: var(--fg-muted); font-size: .8125rem; }
  .kopf .zaehler { margin-left: auto; }
  .seiten { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 1rem; }
</style>
