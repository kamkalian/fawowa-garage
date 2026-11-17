<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from './api.js';

  // Hintergrundaufträge: Download, Kartenbau, Netzbau und Kacheln anstoßen, die Warteschlange ordnen und Speicher und Swap des Servers zeigen.
  // Die Liste wird alle 3 Sekunden neu geladen, damit der Fortschritt sichtbar bleibt.
  let stand = $state(null);
  let fehler = $state('');
  let beschaeftigt = $state(false);
  let timer = null;

  const ARTEN = { download: 'Kartendaten laden', karte: 'Kartenbau', netz: 'Netzbau', reichweite: 'Reichweite', kacheln: 'Kacheln' };
  const STATUS = { laeuft: 'läuft', wartet: 'wartet', fertig: 'fertig', fehler: 'Fehler' };

  async function laden() {
    try {
      stand = await api('GET', '/jobs');
      fehler = '';
    } catch (e) {
      fehler = e.message;
    }
  }

  /** Eine Aktion ausführen, danach die Liste neu laden; Fehlermeldungen des Servers anzeigen */
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

  const starten = (art) => tun(() => api('POST', `/jobs/${art}`, {}));
  const kachelnErzeugen = () => tun(() => api('POST', '/jobs/kacheln', {}));
  const loeschen = (job) => tun(() => api('DELETE', `/jobs/${job.id}`));
  const verschieben = (job, richtung) => tun(() => api('POST', `/jobs/${job.id}/verschieben`, { richtung }));

  const zahl = (n) => (n ?? 0).toLocaleString('de-DE');
  const zeit = (s) => (s ? new Date(s).toLocaleString('de-DE') : '–');
  const prozent = (genutzt, gesamt) => (gesamt ? Math.round((genutzt / gesamt) * 100) : 0);

  // Ob ein Auftrag (Download, Kartenbau, Netzbau) schon wartet oder läuft; dann ist der Knopf gesperrt
  const aktiv = (art) => stand?.jobs?.some(j => j.art === art && (j.status === 'wartet' || j.status === 'laeuft'));
  const wartende = $derived(stand?.jobs?.filter(j => j.status === 'wartet') ?? []);

  onMount(() => { laden(); timer = setInterval(laden, 3000); });
  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<section class="jobs" aria-label="Hintergrundaufträge">
  <h2>Hintergrundaufträge</h2>
  <p class="hinweis">
    Alle Aufträge stehen in einer Liste und werden nacheinander abgearbeitet. Eine Reichweite einer Garage wird als Auftrag ans Ende gehängt;
    eine neue Berechnung ersetzt die alte derselben Garage.
  </p>

  {#if stand}
    {#if stand.system}
      {@const sys = stand.system}
      <div class="speicher">
        <div>
          <span class="etikett">Arbeitsspeicher</span>
          <div class="balken-aussen" role="meter" aria-label="Arbeitsspeicher" aria-valuemin="0" aria-valuemax={sys.ramGesamtMB} aria-valuenow={sys.ramGenutztMB}>
            <div class="balken" style="width: {prozent(sys.ramGenutztMB, sys.ramGesamtMB)}%"></div>
          </div>
          <small>{zahl(sys.ramGenutztMB)} von {zahl(sys.ramGesamtMB)} MB genutzt</small>
        </div>
        <div>
          <span class="etikett">Swap</span>
          {#if sys.swap}
            <div class="balken-aussen" role="meter" aria-label="Swap" aria-valuemin="0" aria-valuemax={sys.swap.gesamtMB} aria-valuenow={sys.swap.genutztMB}>
              <div class="balken swap" style="width: {prozent(sys.swap.genutztMB, sys.swap.gesamtMB)}%"></div>
            </div>
            <small>{zahl(sys.swap.genutztMB)} von {zahl(sys.swap.gesamtMB)} MB genutzt</small>
          {:else}
            <small>nicht erkennbar</small>
          {/if}
        </div>
      </div>
    {/if}

    {#if stand.netz}
      <ul class="stand-kartendaten">
        <li class:ok={stand.netz.pbf}>Kartendaten Deutschland {stand.netz.pbf ? 'vorhanden' : 'fehlen'}</li>
        <li class:ok={stand.netz.hoehen}>Höhendaten {stand.netz.hoehen ? 'vorhanden' : 'fehlen'}</li>
        <li class:ok={stand.netz.netz}>Wegenetz {stand.netz.netz ? 'vorhanden' : 'fehlt'}</li>
        <li class:ok={stand.netz.karte}>Karte {stand.netz.karte ? 'gebaut' : 'fehlt'}</li>
        <li class:ok={stand.netz.kachelVersionen > 0}>Kacheln: {stand.netz.kachelVersionen > 0 ? 'vorhanden' : 'keine'}</li>
      </ul>
    {/if}

    <div class="knoepfe">
      <button class="btn btn-outline" disabled={beschaeftigt || aktiv('download')} onclick={() => starten('download')}>Kartendaten Deutschland laden</button>
      <button class="btn btn-outline" disabled={beschaeftigt || aktiv('karte') || !stand.netz?.pbf} onclick={() => starten('karte')}>Kartenbau starten</button>
      <button class="btn btn-outline" disabled={beschaeftigt || aktiv('netz') || !stand.netz?.pbf} onclick={() => starten('netz')}>Netzbau starten</button>
      <button class="btn btn-primary" disabled={beschaeftigt || !stand.netz?.karte} onclick={kachelnErzeugen}>Kacheln erzeugen</button>
    </div>

    {#if stand.jobs.length}
      <div class="tabelle-rahmen">
        <table>
          <thead>
            <tr><th>Nr.</th><th>Auftrag</th><th>Status</th><th>Garage</th><th>Meldung</th><th>Zeit</th><th><span class="sr">Aktionen</span></th></tr>
          </thead>
          <tbody>
            {#each stand.jobs as job (job.id)}
              <tr class={job.status}>
                <td>{job.id}</td>
                <td>{ARTEN[job.art] ?? job.art}</td>
                <td>
                  {STATUS[job.status] ?? job.status}
                  {#if job.status === 'laeuft'}<span class="prozent">{job.fortschritt} %</span>{/if}
                  {#if job.status === 'wartet'}<span class="platz">Platz {wartende.indexOf(job) + 1}</span>{/if}
                </td>
                <td>{job.garage_id ?? '–'}</td>
                <td class="meldung">{job.meldung ?? ''}</td>
                <td>{zeit(job.beendet_am ?? job.begonnen_am ?? job.erstellt_am)}</td>
                <td class="aktionen">
                  {#if job.status === 'wartet'}
                    <button class="btn btn-outline klein" aria-label="Nach oben" title="Nach oben" disabled={beschaeftigt || wartende.indexOf(job) === 0} onclick={() => verschieben(job, -1)}>↑</button>
                    <button class="btn btn-outline klein" aria-label="Nach unten" title="Nach unten" disabled={beschaeftigt || wartende.indexOf(job) === wartende.length - 1} onclick={() => verschieben(job, 1)}>↓</button>
                    <button class="btn btn-outline klein" disabled={beschaeftigt} onclick={() => loeschen(job)}>Löschen</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="muted">Keine Aufträge.</p>
    {/if}
  {:else if !fehler}
    <p class="muted">Lade ...</p>
  {/if}
  {#if fehler}<p class="fehler" role="alert">{fehler}</p>{/if}
</section>

<style>
  .jobs { margin: 1rem 0 1.5rem; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-card); }
  h2 { font-size: 1rem; margin: 0 0 .5rem; }
  .hinweis, .muted { font-size: .875rem; color: var(--fg-muted); margin: .5rem 0; }
  .speicher { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem; margin: .75rem 0; }
  .etikett { display: block; font-size: .8125rem; font-weight: 600; }
  .balken-aussen { height: .6rem; border-radius: 999px; background: var(--bg-input); overflow: hidden; margin: .25rem 0; }
  .balken { height: 100%; background: var(--primary); transition: width .4s; }
  .balken.swap { background: #d97706; }
  small { font-size: .8125rem; color: var(--fg-muted); }
  .stand-kartendaten { list-style: none; padding: 0; margin: .5rem 0; display: flex; flex-wrap: wrap; gap: .25rem 1rem; font-size: .875rem; color: var(--fg-muted); }
  .stand-kartendaten li.ok { color: var(--fg); }
  .knoepfe { display: flex; flex-wrap: wrap; gap: .5rem; margin: .75rem 0; }
  .tabelle-rahmen { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-weight: 600; color: var(--fg-muted); }
  .meldung { max-width: 24rem; word-break: break-word; color: var(--fg-muted); }
  tr.fehler td:nth-child(3) { color: var(--danger, #dc2626); }
  .prozent, .platz { display: inline-block; margin-left: .4rem; font-size: .8125rem; color: var(--fg-muted); }
  .aktionen { white-space: nowrap; }
  .klein { padding: .2rem .5rem; font-size: .8125rem; margin-right: .2rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .fehler { color: var(--danger, #dc2626); font-size: .875rem; }
</style>
