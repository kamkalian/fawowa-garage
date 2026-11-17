<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from './api.js';

  // Verwaltung der Daten: Stand von Kartendaten, Höhendaten, Karte, Wegenetz und Kacheln, Neuladen, die Warteschlange und Speicher des Servers.
  // Der Stand wird alle 3 Sekunden neu geladen, damit der Fortschritt sichtbar bleibt.
  let stand = $state(null);
  let fehler = $state('');
  let beschaeftigt = $state(false);
  let timer = null;

  const ARTEN = { download: 'Kartendaten laden', hoehen: 'Höhendaten laden', karte: 'Kartenbau', netz: 'Netzbau', reichweite: 'Reichweite', kacheln: 'Kacheln' };
  const STATUS = { laeuft: 'läuft', wartet: 'wartet', fertig: 'fertig', fehler: 'Fehler' };

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

  const starten = (art) => tun(() => api('POST', `/jobs/${art}`, {}));
  const loeschen = (job) => tun(() => api('DELETE', `/jobs/${job.id}`));
  const verschieben = (job, richtung) => tun(() => api('POST', `/jobs/${job.id}/verschieben`, { richtung }));

  const zahl = (n) => (n ?? 0).toLocaleString('de-DE');
  const zeit = (s) => (s ? new Date(s).toLocaleString('de-DE') : '–');
  const prozent = (genutzt, gesamt) => (gesamt ? Math.round((genutzt / gesamt) * 100) : 0);
  const mb = (n) => `${zahl(Math.round((n ?? 0) / 1048576))} MB`;

  // Zähler je Auftrag: Megabyte beim Download, sonst Anzahl (z. B. Kacheln)
  const zaehlerText = (job) => {
    if (job.gesamt === null || job.gesamt === undefined) return '';
    if (job.art === 'download') return `${mb(job.erledigt)} von ${mb(job.gesamt)}`;
    return `${zahl(job.erledigt)} von ${zahl(job.gesamt)}`;
  };

  // Ob ein Auftrag dieser Art schon wartet oder läuft; dann ist der Knopf gesperrt
  const aktiv = (art) => stand?.jobs?.some(j => j.art === art && (j.status === 'wartet' || j.status === 'laeuft'));
  // Wartende Aufträge in Reihenfolge der Warteschlange (vorne zuerst)
  const wartende = $derived((stand?.jobs ?? []).filter(j => j.status === 'wartet').sort((a, b) => a.position - b.position || a.id - b.id));

  // Hinweis je Datenobjekt: neue Daten, aktuell oder nicht prüfbar
  const neuText = (o) => {
    if (o.neu === null) return 'Ob neuere Daten vorhanden sind, lässt sich gerade nicht prüfen.';
    if (o.neu) return o.schluessel === 'download' || o.schluessel === 'hoehen' ? 'Neue Daten beim Anbieter vorhanden.' : 'Neuer als dieser Stand: bitte neu erstellen.';
    return 'Aktuell.';
  };

  onMount(() => { laden(); timer = setInterval(laden, 3000); });
  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<section class="jobs" aria-label="Daten und Aufträge">
  <h2>Daten und Aufträge</h2>

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
          {#if sys.swap && sys.swap.gesamtMB > 0}
            <div class="balken-aussen" role="meter" aria-label="Swap" aria-valuemin="0" aria-valuemax={sys.swap.gesamtMB} aria-valuenow={sys.swap.genutztMB}>
              <div class="balken swap" style="width: {prozent(sys.swap.genutztMB, sys.swap.gesamtMB)}%"></div>
            </div>
            <small>{zahl(sys.swap.genutztMB)} von {zahl(sys.swap.gesamtMB)} MB genutzt</small>
          {:else}
            <small>kein Swap eingerichtet</small>
          {/if}
        </div>
      </div>
    {/if}

    <h3>Stand der Daten</h3>
    <div class="datenkacheln">
      {#each stand.datenstand as o (o.schluessel)}
        <article class="datenkachel" class:neu={o.neu === true}>
          <header>
            <strong>{o.name}</strong>
            <small>{o.quelle}</small>
          </header>
          <p class="zeit">
            {#if o.geladen_am}Zuletzt: {zeit(o.geladen_am)}{:else if o.vorhanden}Stand unbekannt (vor der Verwaltung entstanden).{:else}Noch nicht vorhanden.{/if}
          </p>
          <p class="info">{neuText(o)}</p>
          <button class="btn btn-outline" disabled={beschaeftigt || aktiv(o.auftrag)} onclick={() => starten(o.auftrag)}>
            {aktiv(o.auftrag) ? 'läuft oder wartet' : o.knopf}
          </button>
        </article>
      {/each}
    </div>

    <h3>Warteschlange</h3>
    {#if stand.jobs.length}
      <div class="tabelle-rahmen">
        <table>
          <thead>
            <tr><th>Nr.</th><th>Auftrag</th><th>Status</th><th>Fortschritt</th><th>Zähler</th><th>Garage</th><th>Meldung</th><th>Zeit</th><th><span class="sr">Aktionen</span></th></tr>
          </thead>
          <tbody>
            {#each stand.jobs as job (job.id)}
              <tr class={job.status}>
                <td>{job.id}</td>
                <td>{ARTEN[job.art] ?? job.art}</td>
                <td>
                  <span class="status {job.status}">{STATUS[job.status] ?? job.status}</span>
                  {#if job.status === 'wartet'}<span class="platz">Platz {wartende.indexOf(job) + 1}</span>{/if}
                </td>
                <td>{job.status === 'wartet' ? '–' : `${job.fortschritt} %`}</td>
                <td>{zaehlerText(job)}</td>
                <td>{job.garage_id ?? '–'}</td>
                <td class="meldung">{job.meldung ?? ''}</td>
                <td>{zeit(job.beendet_am ?? job.begonnen_am ?? job.erstellt_am)}</td>
                <td class="aktionen">
                  {#if job.status === 'wartet'}
                    <button class="btn btn-outline klein" aria-label="Früher in der Warteschlange" title="Früher drankommen" disabled={beschaeftigt || wartende.indexOf(job) === 0} onclick={() => verschieben(job, -1)}>↑</button>
                    <button class="btn btn-outline klein" aria-label="Später in der Warteschlange" title="Später drankommen" disabled={beschaeftigt || wartende.indexOf(job) === wartende.length - 1} onclick={() => verschieben(job, 1)}>↓</button>
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
  h3 { font-size: .9375rem; margin: 1.25rem 0 .5rem; }
  .muted { font-size: .875rem; color: var(--fg-muted); margin: .5rem 0; }
  .speicher { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 1rem; margin: .75rem 0; }
  .etikett { display: block; font-size: .8125rem; font-weight: 600; }
  .balken-aussen { height: .6rem; border-radius: 999px; background: var(--bg-input); overflow: hidden; margin: .25rem 0; }
  .balken { height: 100%; background: var(--primary); transition: width .4s; }
  .balken.swap { background: #d97706; }
  small { font-size: .8125rem; color: var(--fg-muted); }
  .datenkacheln { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: .75rem; }
  .datenkachel { border: 1px solid var(--border); border-radius: var(--radius); padding: .75rem; display: flex; flex-direction: column; gap: .4rem; background: var(--bg); }
  .datenkachel.neu { border-color: #d97706; }
  .datenkachel header { display: flex; flex-direction: column; }
  .zeit, .info { margin: 0; font-size: .875rem; }
  .info { color: var(--fg-muted); }
  .datenkachel.neu .info { color: #b45309; font-weight: 600; }
  .datenkachel .btn { align-self: flex-start; margin-top: auto; }
  .tabelle-rahmen { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--border); vertical-align: top; white-space: nowrap; }
  th { font-weight: 600; color: var(--fg-muted); }
  .meldung { max-width: 22rem; white-space: normal; word-break: break-word; color: var(--fg-muted); }
  tr.fehler td:nth-child(3) { color: var(--danger, #dc2626); }
  /* Status farblich: blau läuft, gelb wartet, rot Fehler, grün fertig */
  .status { display: inline-block; padding: .1rem .5rem; border-radius: 999px; font-weight: 600; font-size: .8125rem; }
  .status.laeuft { background: #2563eb; color: #fff; }
  .status.wartet { background: #facc15; color: #422006; }
  .status.fehler { background: #dc2626; color: #fff; }
  .status.fertig { background: #16a34a; color: #fff; }
  .platz { display: inline-block; margin-left: .4rem; font-size: .8125rem; color: var(--fg-muted); }
  .aktionen { white-space: nowrap; }
  .klein { padding: .2rem .5rem; font-size: .8125rem; margin-right: .2rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .fehler { color: var(--danger, #dc2626); font-size: .875rem; }
</style>
