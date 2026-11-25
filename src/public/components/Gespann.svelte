<script>
  import { pick } from '../lib/i18n.js';
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import Fenster from './Fenster.svelte';

  // Gespann: eine feste Kachel mit der Überschrift „Gespann“ und einer Vorschau der Anordnung.
  // Ein Klick auf die Kachel öffnet die Fläche im modalen Fenster. Dort lassen sich die Icons verschieben und skalieren.
  let { lang, mitglieder = [], positionen = {}, ondrop, onentfernen, onposition } = $props();

  let offen = $state(false);
  let ueber = $state(false);      // eine Kachel wird von außen darübergezogen
  let live = $state({});          // Lage während des Ziehens: { x, y, s }
  let zieht = $state(null);       // { schluessel, f, modus: 'bewegen' | 'skalieren', px, py, ox, oy, os }
  const KACHEL = 96;              // Breite eines Elements bei Größe 1
  const VORSCHAU = 0.4;           // Maßstab der Vorschau gegenüber der Fläche

  const schluessel = (f) => f.art + '-' + f.e.id;
  const sWert = (v) => (typeof v === 'number' && v >= 0.5 && v <= 2 ? v : 1);

  // Lage eines Mitglieds: während des Ziehens, sonst gespeichert, sonst im Raster (vier pro Zeile)
  const lage = (f, i) => {
    const s = schluessel(f);
    if (live[s]) return live[s];
    if (positionen[s]) return { x: positionen[s].x, y: positionen[s].y, s: sWert(positionen[s].s) };
    return { x: 16 + (i % 4) * (KACHEL + 16), y: 16 + Math.floor(i / 4) * (KACHEL + 16), s: 1 };
  };

  // Rahmen um alle Icons (Lage in Pixeln der Fläche): Grundlage der Vorschau
  const rahmen = $derived.by(() => {
    if (mitglieder.length === 0) return null;
    const liste = mitglieder.map((f, i) => ({ f, p: lage(f, i) }));
    const x0 = Math.min(...liste.map(({ p }) => p.x));
    const y0 = Math.min(...liste.map(({ p }) => p.y));
    const x1 = Math.max(...liste.map(({ p }) => p.x + KACHEL * p.s));
    const y1 = Math.max(...liste.map(({ p }) => p.y + KACHEL * p.s));
    return { liste, x0, y0, w: x1 - x0, h: y1 - y0 };
  });

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

<button type="button" class="kachel" class:ueber aria-haspopup="dialog" onclick={() => (offen = true)}
  ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ueber = true; }}
  ondragleave={() => (ueber = false)}
  ondrop={(e) => { e.preventDefault(); ueber = false; ondrop?.(e); }}>
  <span class="kachel-titel">{pick({ de: 'Gespann', en: 'Convoy' }, lang)}</span>
  <span class="kachel-vorschau">
    {#if rahmen}
      <span class="vorschau" style="width: {rahmen.w * VORSCHAU + 8}px; height: {rahmen.h * VORSCHAU + 8}px;">
        {#each rahmen.liste as { f, p } (schluessel(f))}
          <span class="mini" style="left: {(p.x - rahmen.x0) * VORSCHAU + 4}px; top: {(p.y - rahmen.y0) * VORSCHAU + 4}px; --s: {p.s * VORSCHAU};">
            <Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} alt="" groesse="64px" />
          </span>
        {/each}
      </span>
    {:else}
      <span class="leer">{pick({ de: 'noch leer', en: 'empty' }, lang)}</span>
    {/if}
  </span>
</button>

{#if offen}
  <Fenster {lang} breit titel={pick({ de: 'Gespann', en: 'Convoy' }, lang)} onclose={() => (offen = false)}>
    <div class="gespann">
      <div class="flaeche" class:ablegen={zieht !== null || ueber} role="region" aria-label={pick({ de: 'Fläche für das Gespann', en: 'Area for the convoy' }, lang)}
        ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ueber = true; }}
        ondragleave={() => (ueber = false)}
        ondrop={(e) => { e.preventDefault(); ueber = false; ondrop?.(e); }}
        ondragstart={(e) => e.preventDefault()}
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
    </div>
  </Fenster>
{/if}

<style>
  /* Feste Kachel: Überschrift oben, Vorschau darunter */
  .kachel {
    width: 14rem;
    height: 11rem;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: .5rem;
    padding: .75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color .15s, box-shadow .15s;
  }
  .kachel:hover { border-color: var(--accent, #3b82f6); }
  .kachel.ueber { border: 2px solid #22c55e; box-shadow: 0 0 0 2px rgba(34, 197, 94, .35); }
  .kachel-titel { font-weight: 600; font-size: .9375rem; }
  .kachel-vorschau { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; overflow: hidden; }
  /* Vorschau: nur ein Rahmen in der Größe der Anordnung, darin verkleinerte Icons */
  .vorschau { position: relative; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); overflow: hidden; display: block; max-width: 100%; max-height: 100%; }
  .leer { font-size: .8125rem; color: var(--fg-muted); }
  .mini { position: absolute; transform-origin: top left; transform: scale(var(--s)); display: block; }
  .mini :global(img), .mini :global(svg), .element :global(img), .element :global(svg) { pointer-events: none; -webkit-user-drag: none; user-select: none; }

  /* Im Fenster: die Fläche mit Raster */
  .gespann { width: 100%; }
  .flaeche {
    position: relative;
    height: 30rem;
    max-width: 100%;
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
