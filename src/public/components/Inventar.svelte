<script>
  import { pick } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import Fenster from './Fenster.svelte';

  // Inventar eines Gepäckstücks: ein Raster aus Plätzen. Belegt ein Gegenstand den letzten Platz, kommt rechts ein freier Platz dazu,
  // und wenn die Zeile voll ist, eine neue Zeile darunter. Immer gibt es genau einen freien Platz mehr als belegte Plätze.
  let { lang, token, gepaeck, onaktualisiert, onschliessen, melde, onungueltig } = $props();

  let gegenstaende = $state((gepaeck.inhalt ?? []).map((g) => ({ ...g })));
  let suche = $state('');
  let ziehend = $state(null);   // Id des gerade gezogenen Gegenstands
  let ziel = $state(null);      // Platz, über dem gerade gezogen wird
  let neuerName = $state({});   // Eingabe je freiem Platz

  const belegt = $derived(new Map(gegenstaende.map((g) => [g.platz, g])));
  const hoechster = $derived(gegenstaende.reduce((m, g) => Math.max(m, g.platz + 1), 0));
  const plaetze = $derived(Math.max(gegenstaende.length, hoechster) + 1);
  const spalten = $derived(Math.ceil(Math.sqrt(plaetze)));
  const suchtext = $derived(suche.trim().toLowerCase());
  const passt = (g) => suchtext !== '' && g.name.toLowerCase().includes(suchtext);
  const trefferPlaetze = $derived(new Set(gegenstaende.filter(passt).map((g) => g.platz)));
  const gepackt = $derived(gegenstaende.filter((g) => g.gepackt).length);

  const fehler = () => {
    melde(pick({ de: 'Das hat nicht geklappt.', en: 'That did not work.' }, lang));
  };
  async function aendern(f) {
    try {
      return await f();
    } catch (e) {
      if (e.status === 401) onungueltig();
      else fehler();
      return null;
    }
  }
  const gespeichert = (liste) => { gegenstaende = liste; onaktualisiert?.(liste); };

  async function anlegen(platz) {
    const name = (neuerName[platz] ?? '').trim();
    if (!name) return;
    const g = await aendern(() => api.gegenstandAnlegen(token, gepaeck.id, name, platz));
    if (!g) return;
    neuerName = { ...neuerName, [platz]: '' };
    gespeichert([...gegenstaende, g]);
  }

  async function verschieben(id, zielPlatz) {
    ziel = null;
    const g = gegenstaende.find((x) => x.id === id);
    if (!g || g.platz === zielPlatz) return;
    const res = await aendern(() => api.gegenstandAendern(token, id, { platz: zielPlatz }));
    if (!res) return;
    gespeichert(gegenstaende.map((x) => {
      if (x.id === id) return { ...x, platz: res.gegenstand.platz };
      if (res.tausch && x.id === res.tausch.id) return { ...x, platz: res.tausch.platz };
      return x;
    }));
  }

  async function umschalten(g) {
    const res = await aendern(() => api.gegenstandAendern(token, g.id, { gepackt: !g.gepackt }));
    if (res) gespeichert(gegenstaende.map((x) => (x.id === g.id ? { ...x, gepackt: !g.gepackt } : x)));
  }

  async function loeschen(g) {
    const ok = await aendern(() => api.gegenstandLoeschen(token, g.id));
    if (ok !== null) gespeichert(gegenstaende.filter((x) => x.id !== g.id));
  }

  function zuPlatz(platz) {
    document.getElementById('platz-' + platz)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
</script>

<Fenster {lang} breit titel={gepaeck.name} onclose={onschliessen}>
  <div class="inventar">
    <div class="werkzeug">
      <input type="search" class="input" bind:value={suche} aria-label={pick({ de: 'Gegenstand suchen', en: 'Search for an item' }, lang)}
        placeholder={pick({ de: 'Gegenstand suchen …', en: 'Search for an item …' }, lang)} />
      <span class="zaehler">{gepackt} / {gegenstaende.length} {pick({ de: 'gepackt', en: 'packed' }, lang)}</span>
    </div>

    {#if suchtext !== ''}
      <div class="treffer-liste" role="status">
        {#each gegenstaende.filter(passt) as g (g.id)}
          <button type="button" class="treffer-knopf" onclick={() => zuPlatz(g.platz)}>{g.name}</button>
        {:else}
          <p class="notiz">{pick({ de: 'Nichts gefunden.', en: 'Nothing found.' }, lang)}</p>
        {/each}
      </div>
    {/if}

    <div class="raster" style="grid-template-columns: repeat({spalten}, minmax(7.5rem, 1fr));">
      {#each Array.from({ length: plaetze }, (_, i) => i) as platz (platz)}
        {@const g = belegt.get(platz)}
        <div id={'platz-' + platz} class="platz" class:frei={!g} class:leuchtet={trefferPlaetze.has(platz)} class:ziel={ziel === platz}
          ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ziel = platz; }}
          ondragleave={() => { if (ziel === platz) ziel = null; }}
          ondrop={(e) => { e.preventDefault(); verschieben(Number(e.dataTransfer.getData('text/plain')), platz); }}>
          {#if g}
            <div class="gegenstand" class:gepackt={g.gepackt} class:ziehend={ziehend === g.id} draggable="true"
              ondragstart={(e) => { ziehend = g.id; e.dataTransfer.setData('text/plain', String(g.id)); e.dataTransfer.effectAllowed = 'move'; }}
              ondragend={() => { ziehend = null; ziel = null; }}>
              <button type="button" class="haken" aria-pressed={g.gepackt} aria-label={pick({ de: 'gepackt', en: 'packed' }, lang)} onclick={() => umschalten(g)}>{g.gepackt ? '☑' : '☐'}</button>
              <span class="name">{g.name}</span>
              <button type="button" class="weg" aria-label={pick({ de: 'Gegenstand löschen', en: 'Delete item' }, lang)} onclick={() => loeschen(g)}>✕</button>
            </div>
          {:else}
            <form class="neu" onsubmit={(e) => { e.preventDefault(); anlegen(platz); }}>
              <input class="input" type="text" maxlength="80" value={neuerName[platz] ?? ''} aria-label={pick({ de: 'Gegenstand auf diesen Platz legen', en: 'Put an item on this place' }, lang)}
                placeholder="+" oninput={(e) => (neuerName = { ...neuerName, [platz]: e.currentTarget.value })} />
            </form>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</Fenster>

<style>
  .inventar { display: flex; flex-direction: column; gap: .75rem; }
  .werkzeug { display: flex; gap: .5rem; align-items: center; }
  .werkzeug input { flex: 1; }
  .zaehler { font-size: .8125rem; color: var(--fg-muted); white-space: nowrap; }
  .treffer-liste { display: flex; flex-wrap: wrap; gap: .3rem; }
  .treffer-knopf { border: 1px solid var(--border); border-radius: 999px; background: var(--bg); color: inherit; padding: .2rem .6rem; font: inherit; font-size: .8125rem; cursor: pointer; }
  .raster { display: grid; gap: .5rem; }
  .platz { border: 1px dashed var(--border); border-radius: var(--radius-sm); min-height: 3.25rem; padding: .3rem; display: flex; align-items: stretch; min-width: 0; transition: box-shadow .2s, border-color .2s; }
  .platz:not(.frei) { border-style: solid; background: var(--bg); }
  .platz.leuchtet { border-color: var(--accent, #3b82f6); box-shadow: 0 0 0 2px var(--accent, #3b82f6), 0 0 16px var(--accent, #3b82f6); }
  .platz.ziel { border-color: var(--accent, #3b82f6); border-style: solid; }
  .gegenstand { flex: 1; display: flex; align-items: center; gap: .3rem; cursor: grab; min-width: 0; }
  .gegenstand.ziehend { opacity: .5; }
  .gegenstand.gepackt .name { text-decoration: line-through; color: var(--fg-muted); }
  .name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: .875rem; }
  .haken, .weg { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 .15rem; font: inherit; }
  .neu { flex: 1; display: flex; }
  .neu input { width: 100%; font-size: .875rem; }
  .notiz { font-size: .8125rem; color: var(--fg-muted); margin: 0; }
</style>
