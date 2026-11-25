<script>
  import { pick } from '../lib/i18n.js';
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import Fenster from './Fenster.svelte';

  // Gespann: eine kleine Vorschau der Anordnung (ohne Rahmen, ohne Überschrift). Ein Klick darauf öffnet die Fläche im modalen Fenster.
  // Dort lassen sich die Icons verschieben und skalieren; der Name bleibt dabei gleich groß.
  // Positionen sind in einem festen Koordinatensystem (FLAECHE_B × FLAECHE_H). Fläche und Vorschau zeigen es im gleichen Seitenverhältnis (4:3).
  let { lang, mitglieder = [], positionen = {}, ondrop, onentfernen, onposition } = $props();

  const FLAECHE_B = 640;          // logische Breite der Fläche in Pixeln
  const FLAECHE_H = 480;          // logische Höhe (Seitenverhältnis 4:3)
  const VORSCHAU_B = 132;         // feste Größe der Vorschau
  const VORSCHAU_H = 99;
  const VORSCHAU = VORSCHAU_B / FLAECHE_B;   // Maßstab der Vorschau gegenüber der Fläche
  const KACHEL = 96;              // Breite eines Elements bei Größe 1
  const S_MIN = 0.5;
  const S_MAX = 5;

  let offen = $state(false);
  let ueber = $state(false);      // eine Kachel wird von außen darübergezogen
  let breite = $state(FLAECHE_B); // gemessene Breite der Fläche am Bildschirm
  let live = $state({});          // Lage während des Ziehens: { x, y, s } in logischen Pixeln
  let zieht = $state(null);       // { schluessel, f, modus, px, py, ox, oy, os }

  const schluessel = (f) => f.art + '-' + f.e.id;
  const sWert = (v) => (typeof v === 'number' && v >= S_MIN && v <= S_MAX ? v : 1);

  // Lage eines Mitglieds: während des Ziehens, sonst gespeichert, sonst im Raster (vier pro Zeile)
  const lage = (f, i) => {
    const s = schluessel(f);
    if (live[s]) return live[s];
    if (positionen[s]) return { x: positionen[s].x, y: positionen[s].y, s: sWert(positionen[s].s) };
    return { x: 16 + (i % 4) * (KACHEL + 16), y: 16 + Math.floor(i / 4) * (KACHEL + 16), s: 1 };
  };

  const liste = $derived(mitglieder.map((f, i) => ({ f, p: lage(f, i) })));

  // Bildschirmpixel → logische Pixel
  const umrechnen = () => FLAECHE_B / breite;

  function zeigerStart(e, f, modus, i) {
    const { x, y, s } = lage(f, i);
    zieht = { schluessel: schluessel(f), f, modus, px: e.clientX, py: e.clientY, ox: x, oy: y, os: s };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function zeigerBewegen(e) {
    if (!zieht) return;
    const k = umrechnen();
    const dx = (e.clientX - zieht.px) * k;
    const dy = (e.clientY - zieht.py) * k;
    if (zieht.modus === 'bewegen') {
      live = { ...live, [zieht.schluessel]: { x: Math.min(FLAECHE_B - 16, Math.max(0, zieht.ox + dx)), y: Math.min(FLAECHE_H - 16, Math.max(0, zieht.oy + dy)), s: zieht.os } };
    } else {
      const s = Math.min(S_MAX, Math.max(S_MIN, zieht.os + (dx + dy) / 200));
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

  // Hängt das Fenster an den Seitenkörper, damit es über der Kopfleiste liegt
  function insBodyHaengen(node) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<button type="button" class="vorschau" class:ueber aria-haspopup="dialog"
  aria-label={pick({ de: 'Gespann öffnen', en: 'Open convoy' }, lang)}
  style="width: {VORSCHAU_B}px; height: {VORSCHAU_H}px;"
  onclick={() => (offen = true)}
  ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ueber = true; }}
  ondragleave={() => (ueber = false)}
  ondrop={(e) => { e.preventDefault(); ueber = false; ondrop?.(e); }}>
  {#each liste as { f, p } (schluessel(f))}
    <span class="mini" style="left: {p.x * VORSCHAU}px; top: {p.y * VORSCHAU}px; --s: {p.s * VORSCHAU};">
      <Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} alt="" groesse="64px" />
    </span>
  {/each}
</button>

{#if offen}
  <div use:insBodyHaengen>
    <Fenster {lang} breit titel={pick({ de: 'Gespann', en: 'Convoy' }, lang)} onclose={() => (offen = false)}>
      <div class="gespann">
        <div class="flaeche" class:ablegen={zieht !== null || ueber} role="region" aria-label={pick({ de: 'Fläche für das Gespann', en: 'Area for the convoy' }, lang)}
          bind:clientWidth={breite}
          ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ueber = true; }}
          ondragleave={() => (ueber = false)}
          ondrop={(e) => { e.preventDefault(); ueber = false; ondrop?.(e); }}
          ondragstart={(e) => e.preventDefault()}
          onpointermove={zeigerBewegen} onpointerup={zeigerEnde} onpointercancel={zeigerEnde}>
          {#each liste as { f, p }, i (schluessel(f))}
            <div class="element" class:zieht={zieht?.schluessel === schluessel(f)}
              style="left: {(p.x / FLAECHE_B) * 100}%; top: {(p.y / FLAECHE_H) * 100}%; --s: {p.s};"
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
  </div>
{/if}

<style>
  /* Vorschau: klein, ohne Hintergrund und Rahmen; die Icons stehen an ihrer Stelle */
  .vorschau {
    position: relative;
    flex: none;
    padding: 0;
    margin: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
    overflow: hidden;
    border-radius: var(--radius-sm);
  }
  .vorschau.ueber { box-shadow: 0 0 0 2px #22c55e; }
  .vorschau:focus-visible { outline: 2px solid var(--accent, #3b82f6); outline-offset: 2px; }
  .mini { position: absolute; transform-origin: top left; transform: scale(var(--s)); display: block; }
  .mini :global(img), .mini :global(svg), .element :global(img), .element :global(svg) { pointer-events: none; -webkit-user-drag: none; user-select: none; }

  /* Im Fenster: die Fläche im gleichen Seitenverhältnis (4:3) */
  .gespann { width: 100%; }
  .flaeche {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
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
    /* Breite wächst mit dem Icon, mindestens 96 px; der Name bleibt immer gleich groß */
    width: max(96px, calc(64px * var(--s)));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .25rem;
    cursor: grab;
    user-select: none;
  }
  .element.zieht { cursor: grabbing; }
  .icon { display: flex; align-items: center; justify-content: center; }
  .beschriftung { font-size: .7rem; color: var(--fg-muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
  .entfernen { position: absolute; top: -6px; right: 0; opacity: 0; transition: opacity .15s; background: var(--bg); border: 1px solid var(--border); border-radius: 999px; width: 18px; height: 18px; color: var(--fg-muted); cursor: pointer; font: inherit; font-size: .6rem; line-height: 1; padding: 0; }
  .element:hover .entfernen { opacity: 1; }
  /* Griff zum Skalieren unten rechts */
  .griff { position: absolute; right: -4px; bottom: 18px; width: 12px; height: 12px; border-radius: 3px; background: var(--accent, #3b82f6); cursor: nwse-resize; opacity: 0; transition: opacity .15s; }
  .element:hover .griff, .element.zieht .griff { opacity: 1; }
  .hinweis { position: absolute; left: 16px; bottom: 12px; font-size: .875rem; color: var(--fg-muted); margin: 0; }
</style>
