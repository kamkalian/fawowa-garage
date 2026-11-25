<script>
  import { pick } from '../lib/i18n.js';
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';

  // Gespann-Bereich: zunächst ausgeblendet; der Knopf zeigt eine Vorschau der Anordnung.
  // Aufgeklappt: Mitglieder als Icons auf einer Fläche mit Raster. Sie lassen sich verschieben und über den Griff unten rechts
  // skalieren. Gezogen wird die Fläche grün umrandet. Kacheln lassen sich hineinziehen.
  let { lang, mitglieder = [], positionen = {}, ondrop, onentfernen, onposition } = $props();

  let offen = $state(false);
  let ueber = $state(false);      // eine Kachel wird von außen darübergezogen
  let live = $state({});          // Lage während des Ziehens: { x, y, s }
  let zieht = $state(null);       // { schluessel, f, modus: 'bewegen' | 'skalieren', px, py, ox, oy, os }
  const KACHEL = 96;              // Breite eines Elements bei Größe 1
  const VORSCHAU = 0.2;           // Maßstab der Vorschau gegenüber der Fläche

  const schluessel = (f) => f.art + '-' + f.e.id;
  const sWert = (v) => (typeof v === 'number' && v >= 0.5 && v <= 2 ? v : 1);

  // Lage eines Mitglieds: während des Ziehens, sonst gespeichert, sonst im Raster (vier pro Zeile)
  const lage = (f, i) => {
    const s = schluessel(f);
    if (live[s]) return live[s];
    if (positionen[s]) return { x: positionen[s].x, y: positionen[s].y, s: sWert(positionen[s].s) };
    return { x: 16 + (i % 4) * (KACHEL + 16), y: 16 + Math.floor(i / 4) * (KACHEL + 16), s: 1 };
  };

  function zeigerStart(e, f, modus, i) {
    const { x, y, s } = lage(f, i);
    zieht = { schluessel: schluessel(f), f, modus, px: e.clientX, py: e.clientY, ox: x, oy: y, os: s };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function zeigerBewegen(e) {
    if (!zieht) return;
    const dx = e.clientX - zieht.px;
    const dy = e.clientY - zieht.py;
    if (zieht.modus === 'bewegen') {
      live = { ...live, [zieht.schluessel]: { x: Math.max(0, zieht.ox + dx), y: Math.max(0, zieht.oy + dy), s: zieht.os } };
    } else {
      const s = Math.min(2, Math.max(0.5, zieht.os + (dx + dy) / 200));
      live = { ...live, [zieht.schluessel]: { x: zieht.ox, y: zieht.oy, s: Math.round(s * 20) / 20 } };
    }
  }
  function zeigerEnde() {
    if (!zieht) return;
    const { schluessel: s, f } = zieht;
    const p = live[s];
    zieht = null;
    if (p) {
      // Erst im Stand merken (onposition), dann die Vorschau loslassen: so springt nichts zurück
      onposition?.(f.art, f.e.id, Math.round(p.x), Math.round(p.y), p.s);
      const { [s]: _, ...rest } = live;
      live = rest;
    }
  }
</script>

<div class="gespann-kopf">
  <button type="button" class="knopf" aria-expanded={offen} onclick={() => (offen = !offen)}>
    {offen ? pick({ de: 'Gespann ausblenden', en: 'Hide convoy' }, lang) : pick({ de: 'Gespann anzeigen', en: 'Show convoy' }, lang)}
  </button>
  <div class="vorschau" aria-label={pick({ de: 'Vorschau des Gespanns', en: 'Preview of the convoy' }, lang)} role="img">
    {#each mitglieder as f, i (schluessel(f))}
      {@const p = lage(f, i)}
      <div class="mini" style="left: {p.x * VORSCHAU}px; top: {p.y * VORSCHAU}px; --s: {p.s * VORSCHAU};">
        <Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} alt="" groesse="64px" />
      </div>
    {:else}
      <span class="leer">{pick({ de: 'noch leer', en: 'empty' }, lang)}</span>
    {/each}
  </div>
</div>

{#if offen}
  <section class="gespann" aria-label={pick({ de: 'Gespann', en: 'Convoy' }, lang)}>
    <h2>{pick({ de: 'Gespann', en: 'Convoy' }, lang)}</h2>
    <div class="flaeche" class:ueber class:ablegen={zieht !== null || ueber} role="region" aria-label={pick({ de: 'Fläche für das Gespann', en: 'Area for the convoy' }, lang)}
      ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ueber = true; }}
      ondragleave={() => (ueber = false)}
      ondrop={(e) => { e.preventDefault(); ueber = false; ondrop?.(e); }}
      onpointermove={zeigerBewegen} onpointerup={zeigerEnde} onpointercancel={zeigerEnde}>
      {#each mitglieder as f, i (schluessel(f))}
        {@const p = lage(f, i)}
        <div class="element" class:zieht={zieht?.schluessel === schluessel(f)} style="left: {p.x}px; top: {p.y}px; --s: {p.s};"
          onpointerdown={(e) => zeigerStart(e, f, 'bewegen', i)} role="group" aria-label={f.e.name}>
          <div class="icon">
            <Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} motor={f.art === 'fahrraeder' && (f.e.motoren ?? []).length > 0} akku={(f.e.akkus ?? []).length > 0} alt={f.e.name} groesse="calc(64px * var(--s))" />
          </div>
          <div class="beschriftung">{f.e.name}</div>
          <button type="button" class="entfernen" aria-label={pick({ de: 'Aus dem Gespann nehmen', en: 'Remove from convoy' }, lang)}
            onpointerdown={(e) => e.stopPropagation()} onclick={() => onentfernen?.(f)}>✕</button>
          <span class="griff" aria-hidden="true" onpointerdown={(e) => { e.stopPropagation(); zeigerStart(e, f, 'skalieren', i); }}></span>
        </div>
      {:else}
        <p class="hinweis">{pick({ de: 'Kachel hierher ziehen, um sie ins Gespann zu legen.', en: 'Drag a card here to add it to the convoy.' }, lang)}</p>
      {/each}
    </div>
  </section>
{/if}

<style>
  .gespann-kopf { display: flex; align-items: center; gap: .75rem; margin: .75rem 0 0; flex-wrap: wrap; }
  .knopf { background: transparent; border: 1px solid var(--border); border-radius: var(--radius-sm); color: inherit; padding: .4rem .7rem; font: inherit; font-size: .875rem; cursor: pointer; }
  /* Vorschau: die Anordnung verkleinert, neben dem Knopf */
  .vorschau { position: relative; width: 180px; height: 96px; border: 1px solid var(--border); border-radius: var(--radius-sm); background-color: var(--bg-card); background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px); background-size: 12px 12px; overflow: hidden; }
  .mini { position: absolute; transform-origin: top left; transform: scale(var(--s)); }
  .leer { position: absolute; left: 8px; top: 8px; font-size: .75rem; color: var(--fg-muted); }
  h2 { font-size: 1rem; margin: 0 0 .5rem; }
  .gespann { margin: .75rem 0 1rem; }
  .flaeche {
    position: relative;
    height: 30rem;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background-color: var(--bg-card);
    background-image: linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px);
    background-size: 24px 24px;
    touch-action: none;
    transition: box-shadow .15s, border-color .15s;
  }
  /* Grüner Rahmen: hier lässt sich etwas ablegen */
  .flaeche.ablegen { border: 2px solid #22c55e; box-shadow: 0 0 0 2px rgba(34, 197, 94, .35); }
  .element {
    position: absolute;
    width: calc(96px * var(--s));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .25rem;
    cursor: grab;
    user-select: none;
  }
  .element.zieht { cursor: grabbing; }
  .icon { display: flex; align-items: center; justify-content: center; }
  .beschriftung { font-size: calc(.7rem * var(--s)); color: var(--fg-muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
  .entfernen { position: absolute; top: -6px; right: 0; opacity: 0; transition: opacity .15s; background: var(--bg); border: 1px solid var(--border); border-radius: 999px; width: 18px; height: 18px; color: var(--fg-muted); cursor: pointer; font: inherit; font-size: .6rem; line-height: 1; padding: 0; }
  .element:hover .entfernen { opacity: 1; }
  /* Griff zum Skalieren unten rechts */
  .griff { position: absolute; right: -4px; bottom: 18px; width: 12px; height: 12px; border-radius: 3px; background: var(--accent, #3b82f6); cursor: nwse-resize; opacity: 0; transition: opacity .15s; }
  .element:hover .griff, .element.zieht .griff { opacity: 1; }
  .hinweis { position: absolute; left: 16px; bottom: 12px; font-size: .875rem; color: var(--fg-muted); margin: 0; }
</style>
