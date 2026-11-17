<script>
  import { feldWert, datum } from './anzeige.js';
  import { MOTOR_ARTEN } from '../shared/antrieb.js';

  // Ein Eintrag (Fahrrad, Anhänger, Gepäck oder Gespann) mit allen Angaben, Prüfstatus und Notiz des Betreibers.
  // onaendern(aenderung) und onloeschen() werfen bei Fehlern; Meldungen zeigt der Aufrufer.
  // foto: Adresse des Fotos für die Verwaltung oder null
  let { eintrag, felder, nachId, foto = null, onaendern, onloeschen } = $props();

  const motorArt = (wert) => MOTOR_ARTEN.find(m => m.wert === wert)?.de ?? wert;
  const antriebe = $derived([
    ...(eintrag.motoren ?? []).map(m => `Motor: ${motorArt(m.motor_art)}${m.leistung_w ? `, ${m.leistung_w} W` : ''}${m.spannung_v ? `, ${m.spannung_v} V` : ''}${m.getriebe ? `, Getriebe ${m.getriebe}` : ''}`),
    ...(eintrag.akkus ?? []).map(a => `Akku: ${a.kapazitaet_wh ?? '?'} Wh${a.spannung_v ? `, ${a.spannung_v} V` : ''}`)
  ]);

  // svelte-ignore state_referenced_locally
  let notiz = $state(eintrag.pruefnotiz ?? '');
  let laeuft = $state(false);
  let fehler = $state('');

  const zeilen = $derived(felder.filter(f => f.key !== 'name' && f.key !== 'notiz').map(f => ({ f, w: feldWert(f, eintrag, nachId) })).filter(z => z.w !== null));
  const geprueft = $derived(eintrag.status === 'geprueft');
  const notizGeaendert = $derived((notiz.trim() || null) !== (eintrag.pruefnotiz ?? null));

  async function aendern(aenderung) {
    laeuft = true;
    fehler = '';
    try { await onaendern(aenderung); } catch (e) { fehler = e.message; } finally { laeuft = false; }
  }
</script>

<article class="card eintrag-karte">
  <div class="card-body">
    <div class="kopf">
      <h3>{eintrag.name ?? 'Gespann'}</h3>
      <span class="badge {geprueft ? 'badge-active' : 'badge-check'}">{geprueft ? 'geprüft' : 'ungeprüft'}</span>
    </div>

    {#if foto}
      <img class="foto" src={foto} alt="Foto von {eintrag.name ?? 'diesem Eintrag'}" loading="lazy" />
    {/if}

    {#if zeilen.length}
      <dl>
        {#each zeilen as z (z.f.key)}
          <dt>{z.f.label.de}</dt>
          <dd>{z.w}</dd>
        {/each}
      </dl>
    {:else}
      <p class="notiz">Keine Angaben.</p>
    {/if}
    {#if antriebe.length}
      <ul class="antriebe">
        {#each antriebe as a (a)}<li>{a}</li>{/each}
      </ul>
    {/if}
    {#if eintrag.notiz}<p class="vonnutzer"><span class="notiz">Notiz der Nutzerin oder des Nutzers:</span> {eintrag.notiz}</p>{/if}

    <p class="notiz daten">
      Angelegt {datum(eintrag.erstellt_am, true)} · zuletzt geändert {datum(eintrag.geaendert_am, true)}
      {#if geprueft} · geprüft {datum(eintrag.geprueft_am, true)}{/if}
    </p>

    <label class="notizfeld">
      <span>Eigene Notiz zur Prüfung (nur für dich sichtbar)</span>
      <textarea class="input" rows="2" maxlength="500" bind:value={notiz}></textarea>
    </label>

    {#if fehler}<p class="meldung-fehler" role="alert">{fehler}</p>{/if}

    <div class="aktionen">
      {#if geprueft}
        <button type="button" class="btn btn-outline btn-sm" disabled={laeuft} onclick={() => aendern({ status: 'ungeprueft' })}>Zurücksetzen</button>
      {:else}
        <button type="button" class="btn btn-primary btn-sm" disabled={laeuft} onclick={() => aendern({ status: 'geprueft', ...(notizGeaendert ? { pruefnotiz: notiz } : {}) })}>Als geprüft markieren</button>
      {/if}
      <button type="button" class="btn btn-outline btn-sm" disabled={laeuft || !notizGeaendert} onclick={() => aendern({ pruefnotiz: notiz })}>Notiz speichern</button>
      <span class="abstand"></span>
      <button type="button" class="btn btn-ghost btn-sm gefahr" disabled={laeuft} onclick={onloeschen}>Löschen</button>
    </div>
  </div>
</article>

<style>
  .card-body { display: flex; flex-direction: column; gap: .5rem; }
  .kopf { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  h3 { font-size: 1rem; overflow-wrap: anywhere; }
  dl { display: grid; grid-template-columns: minmax(7rem, 40%) 1fr; gap: .15rem .75rem; font-size: .8125rem; }
  dt { color: var(--fg-muted); }
  dd { overflow-wrap: anywhere; }
  .vonnutzer { font-size: .8125rem; white-space: pre-line; }
  .daten { margin-top: .25rem; }
  .notizfeld { margin: .25rem 0 0; }
  .aktionen { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
  .abstand { flex: 1; }
  .gefahr { color: var(--danger); }
  .foto { width: 100%; max-height: 12rem; object-fit: cover; border-radius: var(--radius); }
  .antriebe { margin: 0; padding-left: 1.1rem; font-size: .8125rem; }
</style>
