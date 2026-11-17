<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from './api.js';

  // Öffnet die Garage in der Verwaltung (Details), wenn ein Auftrag einer Garage gehört
  let { onoeffnen = null } = $props();

  // Verwaltung der Daten: Stand von Kartendaten, Höhendaten, Karte, Wegenetz und Kacheln, Neuladen, die Warteschlange und Speicher des Servers.
  // Der Stand wird alle 3 Sekunden neu geladen, damit der Fortschritt sichtbar bleibt.
  let stand = $state(null);
  let fehler = $state('');  let meldung = $state('');
  let beschaeftigt = $state(false);
  let timer = null;

  const ARTEN = { entpacken: 'Wegenetz einspielen', download: 'Kartendaten NRW laden', karte: 'Karte bauen', reichweite: 'Reichweite', kacheln: 'Kacheln' };
  const STATUS = { laeuft: 'läuft', wartet: 'wartet', fertig: 'fertig', fehler: 'Fehler' };

  // ZIP-Datei in Teilen hochladen. Jedes Teil wird einzeln gesendet und bei Fehlern wiederholt; bricht die Verbindung ab,
  // lässt sich der Rest mit „Fortsetzen“ hochladen. Die Datei muss nicht von Hand geteilt werden.
  const TEIL_BYTES = 64 * 1024 * 1024;
  let offen = $state(null);   // { id, datei, anzahl } einer unterbrochenen Hochladung

  const kennung = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  async function teilSenden(id, nr, teil) {
    for (let versuch = 1; versuch <= 3; versuch++) {
      try {
        const antwort = await fetch('/api/admin/import/teil?id=' + id + '&nr=' + nr, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: teil });
        if (antwort.ok) return;
        if (antwort.status < 500) throw new Error((await antwort.json().catch(() => ({}))).error || 'Hochladen fehlgeschlagen');
      } catch (e) {
        if (versuch === 3) throw e;
      }
      await new Promise((r) => setTimeout(r, 2000 * versuch));
    }
  }

  async function teileHochladen(id, datei, anzahl, nurFehlende) {
    const schon = new Set(nurFehlende ? (await api('GET', '/import/stand?id=' + id)).stuecke : []);
    for (let nr = 0; nr < anzahl; nr++) {
      if (schon.has(nr)) continue;
      hochladen = { prozent: Math.round(nr / anzahl * 100), text: 'Teil ' + (nr + 1) + ' von ' + anzahl };
      await teilSenden(id, nr, datei.slice(nr * TEIL_BYTES, Math.min(datei.size, (nr + 1) * TEIL_BYTES)));
    }
    hochladen = { prozent: 100, text: 'Wird zusammengesetzt ...' };
    await api('POST', '/import/fertig', { id, anzahl, groesse: datei.size });
    offen = null;
    hochladen = null;
    await laden();
  }

  async function zipHochladen(ev) {
    const datei = ev.currentTarget.files?.[0];
    ev.currentTarget.value = '';
    if (!datei) return;
    fehler = '';
    const frei = stand?.platz?.frei;
    if (frei && datei.size * 2 > frei) {
      fehler = 'Auf dem Server ist zu wenig Platz für diese Datei (frei: ' + mb(frei) + ').';
      return;
    }
    const id = kennung();
    const anzahl = Math.max(1, Math.ceil(datei.size / TEIL_BYTES));
    offen = { id, datei, anzahl };
    hochladen = { prozent: 0, text: '' };
    try {
      await teileHochladen(id, datei, anzahl, false);
    } catch (e) {
      hochladen = null;
      fehler = 'Hochladen unterbrochen: ' + e.message + '. Mit „Fortsetzen“ geht es weiter.';
    }
  }

  async function hochladenFortsetzen() {
    if (!offen) return;
    fehler = '';
    const { id, datei, anzahl } = offen;
    try {
      await teileHochladen(id, datei, anzahl, true);
    } catch (e) {
      hochladen = null;
      fehler = 'Hochladen unterbrochen: ' + e.message + '. Mit „Fortsetzen“ geht es weiter.';
    }
  }

  async function leeren(ziel, name) {
    if (!window.confirm(name + ' wirklich leeren? Die Dateien werden endgültig gelöscht.')) return;
    fehler = '';
    try {
      const r = await api('POST', '/platz/aufraeumen', { ziel });
      meldung = name + ' geleert, ' + mb(r.geloescht) + ' frei.';
    } catch (e) {
      fehler = e.message;
    }
    await laden();
  }

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
  const karteBauen = (gebiet) => tun(() => api('POST', '/jobs/karte', { gebiet }));
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
    if (o.schluessel === 'netz') return 'Neue Fassung: einfach die aktuelle ZIP-Datei hochladen.';
    if (o.neu === null) return 'Ob neuere Daten vorhanden sind, lässt sich gerade nicht prüfen.';
    if (o.neu) return 'Neuer als dieser Stand: bitte neu erstellen.';
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
      {#if sys.cpu}
        <div class="cpu">
          <span class="etikett">Prozessor: {sys.cpu.kerne} Kerne</span>
          {#if sys.cpu.auslastung}
            <div class="kerne">
              {#each sys.cpu.auslastung as p, i (i)}
                <div class="kern" title="Kern {i + 1}: {p} %"><div class="kern-balken" style="height: {p}%"></div></div>
              {/each}
            </div>
            <small>Durchschnitt {Math.round(sys.cpu.auslastung.reduce((a, b) => a + b, 0) / sys.cpu.auslastung.length)} % je Kern</small>
          {:else}
            <small>Auslastung wird ermittelt ...</small>
          {/if}
        </div>
      {/if}
    {/if}

    {#if stand.platz}
      <div class="platz">
        <span class="etikett">Speicherplatz auf dem Server</span>
        {#if stand.platz.frei !== null}
          <div class="balken-aussen" role="meter" aria-label="Speicherplatz" aria-valuemin="0" aria-valuemax={stand.platz.gesamt} aria-valuenow={stand.platz.gesamt - stand.platz.frei}>
            <div class="balken" style="width: {prozent(stand.platz.gesamt - stand.platz.frei, stand.platz.gesamt)}%"></div>
          </div>
          <small>{mb(stand.platz.frei)} frei von {mb(stand.platz.gesamt)}</small>
        {/if}
        <ul class="ordner">
          {#each stand.platz.ordner as o (o.name)}
            <li><span>{o.name}</span> <small>{mb(o.bytes)}</small>
              {#if o.name === 'roh' || o.name === 'hoehen' || o.name === 'import'}
                <button class="btn btn-ghost btn-sm" disabled={beschaeftigt || o.bytes === 0} onclick={() => leeren(o.name, o.name)}>Leeren</button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if meldung}<p class="meldung-ok" role="status">{meldung}</p>{/if}
      </div>
    {/if}

    <h3>Stand der Daten</h3>
    <p class="muted">Wegenetz und Karte baust du auf deinem Rechner (<code>npm run daten</code>) und lädst die ZIP-Datei hier hoch. Der Server packt sie aus und verwendet sie.</p>
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
          {#if o.auftrag === 'entpacken'}
            {#if hochladen}
              <div class="fortschritt" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={hochladen.prozent} aria-label="Hochladen">
                <div class="balken" style="width: {hochladen.prozent}%"></div>
              </div>
              <small>Hochladen: {hochladen.prozent} %</small>
            {:else}
              <label class="btn btn-outline datei" class:aus={beschaeftigt || aktiv(o.auftrag)}>
                {aktiv(o.auftrag) ? 'Einspielen läuft oder wartet' : o.knopf}
                <input type="file" accept=".zip,application/zip" hidden disabled={beschaeftigt || aktiv(o.auftrag)} onchange={zipHochladen} />
              </label>
            {/if}
          {:else}
            <button class="btn btn-outline" disabled={beschaeftigt || aktiv(o.auftrag)} onclick={() => starten(o.auftrag)}>
              {aktiv(o.auftrag) ? 'läuft oder wartet' : o.knopf}
            </button>
          {/if}
        </article>
      {/each}
    </div>

    <h3>Karte aus den Kartendaten bauen</h3>
    <p class="muted">Zuerst die Kartendaten (Nordrhein-Westfalen) laden, dann die Karte bauen. Das läuft auf dem Server und kann mehrere Minuten dauern.</p>
    <div class="knoepfe">
      <button class="btn btn-outline" disabled={beschaeftigt || aktiv("download") || aktiv("karte")} onclick={() => starten("download")}>Kartendaten NRW laden</button>
      <button class="btn btn-primary" disabled={beschaeftigt || aktiv("karte") || aktiv("download")} onclick={() => karteBauen("nrw")}>Karte NRW bauen</button>
      <button class="btn btn-primary" disabled={beschaeftigt || aktiv("karte") || aktiv("download")} onclick={() => karteBauen("deutschland")}>Karte Deutschland bauen</button>
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
                <td>{#if job.garage_id && onoeffnen}<button type="button" class="verweis" onclick={() => onoeffnen(job.garage_id)}>Garage {job.garage_id}</button>{:else}{job.garage_id ?? '–'}{/if}</td>
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
  .platz { margin: .5rem 0 1rem; }
  .ordner { list-style: none; padding: 0; margin: .5rem 0; display: flex; flex-direction: column; gap: .25rem; font-size: .875rem; }
  .ordner li { display: flex; gap: .5rem; align-items: center; }
  .ordner li span { min-width: 6rem; }
  .kerne { display: flex; align-items: flex-end; gap: .2rem; height: 3rem; margin: .25rem 0; }
  .kern { flex: 1; max-width: 1.2rem; height: 100%; background: var(--bg-input); border-radius: 3px; overflow: hidden; display: flex; align-items: flex-end; }
  .kern-balken { width: 100%; background: var(--primary); transition: height .4s; }
  small { font-size: .8125rem; color: var(--fg-muted); }
  .datenkacheln { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: .75rem; }
  .datenkachel { border: 1px solid var(--border); border-radius: var(--radius); padding: .75rem; display: flex; flex-direction: column; gap: .4rem; background: var(--bg); }
  .datenkachel.neu { border-color: #d97706; }
  .datenkachel header { display: flex; flex-direction: column; }
  .zeit, .info { margin: 0; font-size: .875rem; }
  .info { color: var(--fg-muted); }
  .datenkachel.neu .info { color: #b45309; font-weight: 600; }
  .datenkachel .btn { align-self: flex-start; margin-top: auto; }
  .datei { cursor: pointer; }
  .knoepfe { display: flex; flex-wrap: wrap; gap: .5rem; margin: .5rem 0 1rem; }
  .datei.aus { opacity: .5; pointer-events: none; }
  .fortschritt { height: .5rem; border-radius: 999px; background: var(--bg-input); overflow: hidden; margin-top: auto; }
  .fortschritt .balken { height: 100%; background: var(--primary); transition: width .3s; }
  code { font-size: .8125rem; }
  .tabelle-rahmen { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: .875rem; }
  th, td { text-align: left; padding: .4rem .5rem; border-bottom: 1px solid var(--border); vertical-align: top; white-space: nowrap; }
  th { font-weight: 600; color: var(--fg-muted); }
  .meldung { max-width: 22rem; white-space: normal; word-break: break-word; color: var(--fg-muted); }
  tr.fehler td:nth-child(3) { color: var(--danger, #dc2626); }
  /* Status als farbiger Text: blau läuft, gelb wartet, rot Fehler, grün fertig */
  .status { font-weight: 600; }
  .status.laeuft { color: #2563eb; }
  .status.wartet { color: #ca8a04; }
  .status.fehler { color: #dc2626; }
  .status.fertig { color: #16a34a; }
  .verweis { background: none; border: 0; padding: 0; color: var(--primary); text-decoration: underline; cursor: pointer; font: inherit; }
  .platz { display: inline-block; margin-left: .4rem; font-size: .8125rem; color: var(--fg-muted); }
  .aktionen { white-space: nowrap; }
  .klein { padding: .2rem .5rem; font-size: .8125rem; margin-right: .2rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .fehler { color: var(--danger, #dc2626); font-size: .875rem; }
</style>
