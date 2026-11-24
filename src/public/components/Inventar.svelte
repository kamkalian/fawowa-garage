<script>
  import { pick } from '../lib/i18n.js';
  import * as api from '../lib/api.js';
  import Fenster from './Fenster.svelte';
  import { TASCHE_FELDER } from '../../../lib/felder.js';

  // Inventar eines Gepäcks: Taschen als Kacheln, Gegenstände per Drag and Drop zwischen ihnen, Suche mit Aufleuchten
  let { lang, token, gepaeck, onaktualisiert, onschliessen, melde, onungueltig } = $props();

  const TYPEN = TASCHE_FELDER.find((f) => f.key === 'typ').optionen;
  let taschen = $state((gepaeck.taschen ?? []).map((t) => ({ ...t, gegenstaende: t.gegenstaende.map((g) => ({ ...g })) })));
  let suche = $state('');
  let neueTasche = $state({ name: '', typ: 'tasche' });
  let neuerGegenstand = $state({});
  let zielId = $state(null);

  const suchtext = $derived(suche.trim().toLowerCase());
  const passt = (name) => suchtext !== '' && name.toLowerCase().includes(suchtext);
  const leuchtet = (t) => suchtext !== '' && t.gegenstaende.some((g) => passt(g.name));
  const treffer = $derived(suchtext === '' ? [] : taschen.flatMap((t) => t.gegenstaende.filter((g) => passt(g.name)).map((g) => ({ g, t }))));
  const gepacktAnzahl = $derived(taschen.reduce((n, t) => n + t.gegenstaende.filter((g) => g.gepackt).length, 0));

  const sag = (e) => melde(e?.status === 401 ? '' : pick({ de: 'Das hat nicht geklappt.', en: 'That did not work.' }, lang));
  function aendern(f) {
    try { return f(); } catch (e) { if (e.status === 401) onungueltig(); else sag(e); return null; }
  }
  const gesendet = (liste) => { taschen = liste; onaktualisiert?.(liste); };

  async function tascheNeu(e) {
    e?.preventDefault();
    const name = neueTasche.name.trim();
    if (!name) return;
    const t = await aendern(() => api.taschenAnlegen(token, gepaeck.id, { name, typ: neueTasche.typ }));
    if (!t) return;
    gesendet([...taschen, { ...t, gegenstaende: t.gegenstaende ?? [] }]);
    neueTasche = { name: '', typ: 'tasche' };
  }

  async function tascheSpeichern(t, feld, wert) {
    const neu = { ...t, [feld]: wert };
    const ok = await aendern(() => api.taschenAendern(token, t.id, { name: neu.name, typ: neu.typ }));
    if (!ok) return;
    gesendet(taschen.map((x) => (x.id === t.id ? { ...x, name: neu.name, typ: neu.typ } : x)));
  }

  async function tascheLoeschen(t) {
    if (!confirm(pick({ de: `„${t.name}“ mit allen Gegenständen löschen?`, en: `Delete “${t.name}” with all items?` }, lang))) return;
    const ok = await aendern(() => api.taschenLoeschen(token, t.id));
    if (ok) gesendet(taschen.filter((x) => x.id !== t.id));
  }

  async function gegenstandNeu(t) {
    const name = (neuerGegenstand[t.id] ?? '').trim();
    if (!name) return;
    const g = await aendern(() => api.gegenstandAnlegen(token, t.id, name));
    if (!g) return;
    neuerGegenstand = { ...neuerGegenstand, [t.id]: '' };
    gesendet(taschen.map((x) => (x.id === t.id ? { ...x, gegenstaende: [...x.gegenstaende, g] } : x)));
  }

  async function gepacktUmschalten(t, g) {
    const neu = !g.gepackt;
    const ok = await aendern(() => api.gegenstandAendern(token, g.id, { gepackt: neu }));
    if (!ok) return;
    gesendet(taschen.map((x) => (x.id !== t.id ? x : { ...x, gegenstaende: x.gegenstaende.map((y) => (y.id === g.id ? { ...y, gepackt: neu } : y)) })));
  }

  async function gegenstandLoeschen(t, g) {
    const ok = await aendern(() => api.gegenstandLoeschen(token, g.id));
    if (ok) gesendet(taschen.map((x) => (x.id !== t.id ? x : { ...x, gegenstaende: x.gegenstaende.filter((y) => y.id !== g.id) })));
  }

  async function verschieben(gId, ziel) {
    zielId = null;
    const quelle = taschen.find((t) => t.gegenstaende.some((g) => g.id === gId));
    if (!quelle || quelle.id === ziel) return;
    const ok = await aendern(() => api.gegenstandAendern(token, gId, { taschenId: ziel }));
    if (!ok) return;
    const g = quelle.gegenstaende.find((y) => y.id === gId);
    gesendet(taschen.map((t) => {
      if (t.id === quelle.id) return { ...t, gegenstaende: t.gegenstaende.filter((y) => y.id !== gId) };
      if (t.id === ziel) return { ...t, gegenstaende: [...t.gegenstaende, g] };
      return t;
    }));
  }

  function zuTasche(id) {
    document.getElementById('tasche-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
</script>

<Fenster {lang} breit titel={gepaeck.name} onclose={onschliessen}>
  <div class="inventar">
    <div class="werkzeug">
      <input type="search" class="input" bind:value={suche} aria-label={pick({ de: 'Gegenstand suchen', en: 'Search for an item' }, lang)}
        placeholder={pick({ de: 'Gegenstand suchen …', en: 'Search for an item …' }, lang)} />
      <span class="zaehler">{gepacktAnzahl} / {taschen.reduce((n, t) => n + t.gegenstaende.length, 0)} {pick({ de: 'gepackt', en: 'packed' }, lang)}</span>
    </div>

    {#if suchtext !== ''}
      <div class="treffer-liste" role="status">
        {#if treffer.length === 0}
          <p class="notiz">{pick({ de: 'Nichts gefunden.', en: 'Nothing found.' }, lang)}</p>
        {:else}
          {#each treffer as x (x.g.id)}
            <button type="button" class="treffer-knopf" onclick={() => zuTasche(x.t.id)}>{x.g.name} <span class="notiz">· {x.t.name}</span></button>
          {/each}
        {/if}
      </div>
    {/if}

    <form class="neue-tasche" onsubmit={tascheNeu}>
      <input class="input" type="text" maxlength="80" bind:value={neueTasche.name} placeholder={pick({ de: 'Neue Tasche, z. B. „Vorne links“', en: 'New bag, e.g. “front left”' }, lang)} />
      <select class="input" bind:value={neueTasche.typ} aria-label={pick({ de: 'Art der Tasche', en: 'Type of bag' }, lang)}>
        {#each TYPEN as o (o.wert)}<option value={o.wert}>{pick(o, lang)}</option>{/each}
      </select>
      <button type="submit" class="btn btn-outline btn-sm">{pick({ de: '+ Tasche', en: '+ Bag' }, lang)}</button>
    </form>

    <div class="raster">
      {#each taschen as t (t.id)}
        <section id={'tasche-' + t.id} class="tasche" class:leuchtet={leuchtet(t)} class:ziel={zielId === t.id}
          ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; zielId = t.id; }}
          ondragleave={() => { if (zielId === t.id) zielId = null; }}
          ondrop={(e) => { e.preventDefault(); verschieben(Number(e.dataTransfer.getData('text/plain')), t.id); }}>
          <header class="tasche-kopf">
            <input class="input name" type="text" maxlength="80" value={t.name} aria-label={pick({ de: 'Name der Tasche', en: 'Name of the bag' }, lang)}
              onchange={(e) => tascheSpeichern(t, 'name', e.currentTarget.value.trim() || t.name)} />
            <select class="input" value={t.typ ?? 'sonstiges'} aria-label={pick({ de: 'Art der Tasche', en: 'Type of bag' }, lang)}
              onchange={(e) => tascheSpeichern(t, 'typ', e.currentTarget.value)}>
              {#each TYPEN as o (o.wert)}<option value={o.wert}>{pick(o, lang)}</option>{/each}
            </select>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => tascheLoeschen(t)} aria-label={pick({ de: 'Tasche löschen', en: 'Delete bag' }, lang)}>✕</button>
          </header>
          <ul class="gegenstaende">
            {#each t.gegenstaende as g (g.id)}
              <li class="gegenstand" class:treffer={passt(g.name)} class:gepackt={g.gepackt} draggable="true"
                ondragstart={(e) => { e.dataTransfer.setData('text/plain', String(g.id)); e.dataTransfer.effectAllowed = 'move'; }}>
                <button type="button" class="haken" aria-pressed={g.gepackt} aria-label={pick({ de: 'gepackt', en: 'packed' }, lang)} onclick={() => gepacktUmschalten(t, g)}>{g.gepackt ? '☑' : '☐'}</button>
                <span class="name-gegenstand">{g.name}</span>
                <button type="button" class="weg" onclick={() => gegenstandLoeschen(t, g)} aria-label={pick({ de: 'Gegenstand löschen', en: 'Delete item' }, lang)}>✕</button>
              </li>
            {/each}
          </ul>
          <form class="gegenstand-neu" onsubmit={(e) => { e.preventDefault(); gegenstandNeu(t); }}>
            <input class="input" type="text" maxlength="80" value={neuerGegenstand[t.id] ?? ''} oninput={(e) => (neuerGegenstand = { ...neuerGegenstand, [t.id]: e.currentTarget.value })}
              placeholder={pick({ de: 'Gegenstand hinzufügen …', en: 'Add item …' }, lang)} />
          </form>
        </section>
      {:else}
        <p class="notiz">{pick({ de: 'Noch keine Tasche. Lege oben die erste an.', en: 'No bag yet. Add the first one above.' }, lang)}</p>
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
  .neue-tasche { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: .5rem; }
  .raster { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: .75rem; }
  .tasche { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .6rem; display: flex; flex-direction: column; gap: .5rem; background: var(--bg-card); min-width: 0; transition: box-shadow .2s, border-color .2s; }
  .tasche.leuchtet { border-color: var(--accent, #3b82f6); box-shadow: 0 0 0 2px var(--accent, #3b82f6), 0 0 18px var(--accent, #3b82f6); }
  .tasche.ziel { border-style: dashed; border-color: var(--accent, #3b82f6); }
  .tasche-kopf { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: .35rem; align-items: center; }
  .gegenstaende { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .3rem; min-height: 2.5rem; }
  .gegenstand { display: flex; align-items: center; gap: .35rem; border: 1px solid var(--border); border-radius: 6px; padding: .25rem .4rem; cursor: grab; background: var(--bg); min-width: 0; }
  .gegenstand.treffer { border-color: var(--accent, #3b82f6); font-weight: 600; }
  .gegenstand.gepackt .name-gegenstand { text-decoration: line-through; color: var(--fg-muted); }
  .name-gegenstand { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: .875rem; }
  .haken, .weg { background: none; border: 0; color: inherit; cursor: pointer; padding: 0 .15rem; font: inherit; }
  .notiz { font-size: .8125rem; color: var(--fg-muted); margin: 0; }
</style>
