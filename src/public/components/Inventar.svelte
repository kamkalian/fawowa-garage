<script>
  import { pick } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import Fenster from './Fenster.svelte';

  // Inventar eines Gepäckstücks: ein Raster quadratischer Plätze mit drei Plätzen je Reihe. Immer gibt es eine Reihe mehr als die letzte belegte:
  // ist ein Platz der letzten Reihe belegt, kommt eine weitere Reihe mit freien Plätzen darunter.
  // Ein Klick auf einen Platz öffnet ein Fenster mit dem Feld Name (Gegenstand anlegen, ändern oder löschen).
  let { lang, token, gepaeck, onaktualisiert, onschliessen, melde, onungueltig } = $props();

  let gegenstaende = $state((gepaeck.inhalt ?? []).map((g) => ({ ...g })));
  let suche = $state('');
  let ziehend = $state(null);   // Id des gerade gezogenen Gegenstands
  let ziel = $state(null);      // Platz, über dem gerade gezogen wird
  let bearbeitet = $state(null); // { platz, g } – g ist null, wenn der Platz frei ist
  let eingabe = $state('');     // Name im Fenster

  const belegt = $derived(new Map(gegenstaende.map((g) => [g.platz, g])));
  const hoechster = $derived(gegenstaende.reduce((m, g) => Math.max(m, g.platz + 1), 0));
  // Drei Plätze je Reihe: Reihen = (Reihe des letzten belegten Platzes) + 2, mindestens eine Reihe
  const reihen = $derived(hoechster === 0 ? 1 : Math.floor((hoechster - 1) / 3) + 2);
  const plaetze = $derived(reihen * 3);
  const suchtext = $derived(suche.trim().toLowerCase());
  const passt = (g) => suchtext !== '' && g.name.toLowerCase().includes(suchtext);
  const trefferPlaetze = $derived(new Set(gegenstaende.filter(passt).map((g) => g.platz)));

  // Hängt das Fenster an den Seitenkörper, damit es über der Kopfleiste der Garage liegt
  function insBodyHaengen(node) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

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

  function oeffnen(platz, g) {
    bearbeitet = { platz, g };
    eingabe = g?.name ?? '';
  }

  // Name speichern: ändern, wenn der Platz belegt ist, sonst neu anlegen
  async function speichern(e) {
    e.preventDefault();
    const name = eingabe.trim();
    if (!name || !bearbeitet) return;
    const { platz, g } = bearbeitet;
    if (g) {
      const res = await aendern(() => api.gegenstandAendern(token, g.id, { name }));
      if (!res) return;
      gespeichert(gegenstaende.map((x) => (x.id === g.id ? { ...x, name: res.gegenstand.name } : x)));
    } else {
      const neu = await aendern(() => api.gegenstandAnlegen(token, gepaeck.id, name, platz));
      if (!neu) return;
      gespeichert([...gegenstaende, neu]);
    }
    bearbeitet = null;
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

  async function loeschen(g) {
    const ok = await aendern(() => api.gegenstandLoeschen(token, g.id));
    if (ok === null) return false;
    gespeichert(gegenstaende.filter((x) => x.id !== g.id));
    return true;
  }

  async function loeschenImFenster() {
    if (bearbeitet?.g && await loeschen(bearbeitet.g)) bearbeitet = null;
  }

  function zuPlatz(platz) {
    document.getElementById('platz-' + platz)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
</script>

<div use:insBodyHaengen>
<Fenster {lang} breit titel={gepaeck.name} onclose={onschliessen}>
  <div class="inventar">
    <div class="werkzeug">
      <input type="search" class="input" bind:value={suche} aria-label={pick({ de: 'Gegenstand suchen', en: 'Search for an item' }, lang)}
        placeholder={pick({ de: 'Gegenstand suchen …', en: 'Search for an item …' }, lang)} />
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

    <div class="raster">
      {#each Array.from({ length: plaetze }, (_, i) => i) as platz (platz)}
        {@const g = belegt.get(platz)}
        <div id={'platz-' + platz} class="platz" class:frei={!g} class:leuchtet={trefferPlaetze.has(platz)} class:ziel={ziel === platz}
          ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ziel = platz; }}
          ondragleave={() => { if (ziel === platz) ziel = null; }}
          ondrop={(e) => { e.preventDefault(); verschieben(Number(e.dataTransfer.getData('text/plain')), platz); }}>
          {#if g}
            <div class="gegenstand" class:ziehend={ziehend === g.id} draggable="true" role="button" tabindex="0"
              aria-label={g.name}
              onclick={() => oeffnen(platz, g)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); oeffnen(platz, g); } }}
              ondragstart={(e) => { ziehend = g.id; e.dataTransfer.setData('text/plain', String(g.id)); e.dataTransfer.effectAllowed = 'move'; }}
              ondragend={() => { ziehend = null; ziel = null; }}>
              <span class="name">{g.name}</span>
            </div>
          {:else}
            <div class="leer" role="button" tabindex="0" aria-label={pick({ de: 'Gegenstand auf diesen Platz legen', en: 'Put an item on this place' }, lang)}
              onclick={() => oeffnen(platz, null)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); oeffnen(platz, null); } }}>+</div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</Fenster>
</div>

{#if bearbeitet}
  <div use:insBodyHaengen>
    <Fenster {lang} titel={pick({ de: 'Gegenstand', en: 'Item' }, lang)} onclose={() => (bearbeitet = null)}>
      <form class="formular" onsubmit={speichern}>
        <label for="inventar-name">{pick({ de: 'Name', en: 'Name' }, lang)}</label>
        <input id="inventar-name" class="input" type="text" maxlength="80" bind:value={eingabe} />
        <div class="aktionen">
          {#if bearbeitet.g}
            <button type="button" class="btn btn-ghost" onclick={loeschenImFenster}>{pick({ de: 'Löschen', en: 'Delete' }, lang)}</button>
          {/if}
          <span class="rechts">
            <button type="button" class="btn btn-ghost" onclick={() => (bearbeitet = null)}>{pick({ de: 'Abbrechen', en: 'Cancel' }, lang)}</button>
            <button type="submit" class="btn btn-primary" disabled={!eingabe.trim()}>{pick({ de: 'Speichern', en: 'Save' }, lang)}</button>
          </span>
        </div>
      </form>
    </Fenster>
  </div>
{/if}

<style>
  .inventar { display: flex; flex-direction: column; gap: .75rem; }
  .werkzeug { display: flex; gap: .5rem; align-items: center; }
  .werkzeug input { flex: 1; }
  .treffer-liste { display: flex; flex-wrap: wrap; gap: .3rem; }
  .treffer-knopf { border: 1px solid var(--border); border-radius: 999px; background: var(--bg); color: inherit; padding: .2rem .6rem; font: inherit; font-size: .8125rem; cursor: pointer; }
  .raster { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; }
  /* Quadratische Plätze */
  .platz { aspect-ratio: 1 / 1; border: 1px dashed var(--border); border-radius: var(--radius-sm); padding: .4rem; display: flex; align-items: center; justify-content: center; min-width: 0; transition: box-shadow .2s, border-color .2s; }
  .platz:not(.frei) { border-style: solid; background: var(--bg); }
  .platz.leuchtet { border-color: var(--accent, #3b82f6); box-shadow: 0 0 0 2px var(--accent, #3b82f6), 0 0 16px var(--accent, #3b82f6); }
  .platz.ziel { border-color: var(--accent, #3b82f6); border-style: solid; }
  .leer { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: var(--fg-muted); font-size: 1.5rem; cursor: pointer; border-radius: var(--radius-sm); }
  .leer:hover, .leer:focus-visible { color: var(--fg); outline: none; background: var(--bg-input, transparent); }
  .gegenstand { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; text-align: center; cursor: pointer; border-radius: var(--radius-sm); }
  .gegenstand:hover, .gegenstand:focus-visible { outline: none; background: var(--bg-input, transparent); }
  .gegenstand.ziehend { opacity: .5; }
  .name { min-width: 0; overflow-wrap: anywhere; font-size: .875rem; }
  .notiz { font-size: .8125rem; color: var(--fg-muted); margin: 0; }
  .formular { display: flex; flex-direction: column; gap: .5rem; }
  .aktionen { display: flex; gap: .5rem; justify-content: space-between; align-items: center; flex-wrap: wrap; margin-top: .75rem; }
  .rechts { display: inline-flex; gap: .5rem; margin-left: auto; }
</style>
