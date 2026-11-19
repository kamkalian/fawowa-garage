<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from './api.js';

  // Verwaltung „Daten laden“: welche Daten auf dem Server liegen und wann zuletzt; was noch gebaut werden muss, hat einen Knopf.
  // Der Stand wird alle 3 Sekunden neu geladen, damit ein laufender Auftrag sichtbar bleibt.
  let stand = $state(null);
  let fehler = $state('');
  let beschaeftigt = $state(false);
  let timer = null;

  const ARTEN = { entpacken: 'Wegenetz einspielen', paket_einspielen: 'Paket einspielen' };

  async function laden() {
    try {
      stand = await api('GET', '/jobs');
      fehler = '';
    } catch (e) {
      fehler = e.message;
    }
  }

  /** Eine Aktion ausführen, danach den Stand neu laden; Fehlermeldungen des Servers anzeigen */
  async function tun(aktion) {
    beschaeftigt = true;
    fehler = '';
    try {
      await aktion();
    } catch (e) {
      fehler = e.message;
    } finally {
      beschaeftigt = false;
      await laden();
    }
  }

  const einspielen = (p) => tun(() => api('POST', '/jobs/paket', { ordner: p.ordner }));
  // Ein Paket ist eingespielt, wenn Art und Version dem Stand entsprechen
  const eingespielt = (p) => stand?.stand?.[p.art]?.version === p.version;
  // Laufende und wartende Aufträge für die Anzeige oben
  const laufend = $derived((stand?.jobs ?? []).filter(j => j.status === 'laeuft' || j.status === 'wartet'));

  const zeit = (s) => (s ? new Date(s).toLocaleString('de-DE') : '–');
  const mb = (n) => `${Math.round((n ?? 0) / 1048576).toLocaleString('de-DE')} MB`;

  onMount(() => { laden(); timer = setInterval(laden, 3000); });
  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<section class="daten" aria-label="Daten laden">
  <h2>Daten laden</h2>

  {#if stand}
    {#if laufend.length}
      <p class="laeuft" role="status">
        {#each laufend as j (j.id)}
          <span>{ARTEN[j.art] ?? j.art}: {j.status === 'wartet' ? 'wartet' : `läuft, ${j.fortschritt} %`}</span>
        {/each}
      </p>
    {/if}

    <h3>Daten</h3>
    <table>
      <thead><tr><th>Daten</th><th>Zuletzt</th></tr></thead>
      <tbody>
        {#each stand.datenstand as o (o.schluessel)}
          <tr>
            <td><strong>{o.name}</strong><br><small>{o.quelle}</small></td>
            <td>
              {#if o.geladen_am}{zeit(o.geladen_am)}{:else if o.vorhanden}Stand unbekannt{:else}Noch nicht vorhanden{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    <h3>Hochgeladene Pakete</h3>
    {#if stand.paketStand}
      <p class="muted {stand.paketStand.ok === false ? 'warn' : ''}">
        Zuletzt eingespielt: {stand.paketStand.ok === false ? 'fehlgeschlagen' : 'ja'}{stand.paketStand.version ? ' (' + stand.paketStand.version + ')' : ''} am {zeit(stand.paketStand.zeit)}{#if stand.paketStand.ok === false}: {stand.paketStand.meldung}{/if}
      </p>
    {/if}
    {#if stand.pakete?.length}
      <div class="tabelle-rahmen">
        <table>
          <thead>
            <tr><th>Paket</th><th>Hochgeladen am</th><th>Größe</th><th>Stand</th><th><span class="sr">Aktion</span></th></tr>
          </thead>
          <tbody>
            {#each stand.pakete as p (p.ordner)}
              <tr>
                <td>{p.art ?? '?'} {p.version ?? ''}{#if p.fehler}<br><small>{p.fehler}</small>{/if}</td>
                <td>{zeit(p.angekommen)}</td>
                <td>{mb(p.bytes)}</td>
                <td>{eingespielt(p) ? 'eingespielt' : 'noch nicht eingespielt'}</td>
                <td>
                  {#if !eingespielt(p)}
                    <button class="btn btn-outline klein" disabled={beschaeftigt || aktiv('paket_einspielen') || !!p.fehler} onclick={() => einspielen(p)}>
                      {aktiv('paket_einspielen') ? 'läuft oder wartet' : 'Einspielen'}
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="muted">Noch keine Pakete hochgeladen. Das Daten-Werkzeug lädt sie hier hoch.</p>
    {/if}
  {:else if !fehler}
    <p class="muted">Lade ...</p>
  {/if}
  {#if fehler}<p class="fehler" role="alert">{fehler}</p>{/if}
</section>

<style>
  .daten { margin: 1rem 0 1.5rem; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-card); }
  h2 { font-size: 1rem; margin: 0 0 .5rem; }
  h3 { font-size: .9375rem; margin: 1.25rem 0 .5rem; }
  .muted { font-size: .875rem; color: var(--fg-muted); margin: .5rem 0; }
  .muted.warn { color: var(--danger, #dc2626); }
  .laeuft { font-size: .875rem; color: #2563eb; display: flex; flex-wrap: wrap; gap: .25rem 1rem; margin: 0 0 .5rem; }
  small { font-size: .8125rem; color: var(--fg-muted); }
  .tabelle-rahmen { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-weight: 600; color: var(--fg-muted); }
  .klein { padding: .2rem .5rem; font-size: .8125rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .fehler { color: var(--danger, #dc2626); font-size: .875rem; }
</style>
