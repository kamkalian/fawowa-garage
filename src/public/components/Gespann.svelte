<script>
  import { pick } from '../lib/i18n.js';

  // Gespann-Bereich: zunächst ausgeblendet. Aufgeklappt zeigt er die Mitglieder als Grafik auf einer Fläche mit Raster.
  // Jedes Element lässt sich frei verschieben; die Position wird gespeichert. Kacheln lassen sich hineinziehen.
  let { lang, mitglieder = [], positionen = {}, ondrop, onentfernen, onposition } = $props();

  let offen = $state(false);
  let ueber = $state(false);
  let live = $state({});          // Position während des Ziehens (Schlüssel „art-id“)
  let zieht = $state(null);       // { schluessel, px, py, ox, oy }
  const KACHEL = 112;

  const ART = {
    fahrraeder: { de: 'Fahrrad', en: 'Bicycle' },
    anhaenger: { de: 'Anhänger', en: 'Trailer' },
    gepaecke: { de: 'Gepäck', en: 'Luggage' }
  };
  const schluessel = (f) => f.art + '-' + f.e.id;

  // Startposition für Mitglieder ohne gespeicherte Position: ein Raster, vier pro Zeile
  const lage = (f, i) => {
    const s = schluessel(f);
    if (live[s]) return live[s];
    if (positionen[s]) return positionen[s];
    return { x: 16 + (i % 4) * (KACHEL + 16), y: 16 + Math.floor(i / 4) * (KACHEL + 16) };
  };

  function zieheStart(e, f) {
    const s = schluessel(f);
    const { x, y } = lage(f, mitglieder.indexOf(f));
    zieht = { schluessel: s, f, px: e.clientX, py: e.clientY, ox: x, oy: y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function zieheBewegen(e) {
    if (!zieht) return;
    const x = Math.max(0, zieht.ox + e.clientX - zieht.px);
    const y = Math.max(0, zieht.oy + e.clientY - zieht.py);
    live = { ...live, [zieht.schluessel]: { x, y } };
  }
  function zieheEnde() {
    if (!zieht) return;
    const { schluessel: s, f } = zieht;
    const p = live[s];
    zieht = null;
    if (p) {
      const { [s]: _, ...rest } = live;
      live = rest;
      onposition?.(f.art, f.e.id, Math.round(p.x), Math.round(p.y));
    }
  }
</script>

<div class="gespann-kopf">
  <button type="button" class="btn btn-outline btn-sm" aria-expanded={offen} onclick={() => (offen = !offen)}>
    {offen ? pick({ de: 'Gespann ausblenden', en: 'Hide convoy' }, lang) : pick({ de: 'Gespann anzeigen', en: 'Show convoy' }, lang)}
  </button>
</div>

{#if offen}
  <section class="gespann" aria-label={pick({ de: 'Gespann', en: 'Convoy' }, lang)}>
    <h2>{pick({ de: 'Gespann', en: 'Convoy' }, lang)}</h2>
    <div class="flaeche" class:ueber role="region" aria-label={pick({ de: 'Fläche für das Gespann', en: 'Area for the convoy' }, lang)}
      ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ueber = true; }}
      ondragleave={() => (ueber = false)}
      ondrop={(e) => { e.preventDefault(); ueber = false; ondrop?.(e); }}
      onpointermove={zieheBewegen} onpointerup={zieheEnde} onpointercancel={zieheEnde}>
      {#each mitglieder as f, i (schluessel(f))}
        {@const p = lage(f, i)}
        <div class="element" class:zieht={zieht?.schluessel === schluessel(f)} style="left: {p.x}px; top: {p.y}px;"
          onpointerdown={(e) => zieheStart(e, f)} role="group" aria-label={f.e.name}>
          <div class="bild" aria-hidden="true">{pick(ART[f.art], lang).slice(0, 2)}</div>
          <div class="beschriftung">{f.e.name}</div>
          <button type="button" class="entfernen" aria-label={pick({ de: 'Aus dem Gespann nehmen', en: 'Remove from convoy' }, lang)}
            onpointerdown={(e) => e.stopPropagation()} onclick={() => onentfernen?.(f)}>✕</button>
        </div>
      {:else}
        <p class="hinweis">{pick({ de: 'Kachel hierher ziehen, um sie ins Gespann zu legen.', en: 'Drag a card here to add it to the convoy.' }, lang)}</p>
      {/each}
    </div>
  </section>
{/if}

<style>
  .gespann-kopf { margin: .75rem 0 0; }
  .gespann { margin: .75rem 0 1rem; }
  h2 { font-size: 1rem; margin: 0 0 .5rem; }
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
  }
  .flaeche.ueber { border-color: var(--accent, #3b82f6); box-shadow: 0 0 0 2px var(--accent, #3b82f6); }
  .element {
    position: absolute;
    width: 112px;
    height: 112px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: .3rem;
    cursor: grab;
    user-select: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, .15);
  }
  .element.zieht { cursor: grabbing; box-shadow: 0 6px 16px rgba(0, 0, 0, .3); }
  /* Platzhalter für das Bild: die Icons kommen später */
  .bild { width: 56px; height: 56px; border: 1px dashed var(--border); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: .8rem; color: var(--fg-muted); }
  .beschriftung { font-size: .75rem; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entfernen { position: absolute; top: 2px; right: 4px; background: none; border: 0; color: var(--fg-muted); cursor: pointer; font: inherit; font-size: .8rem; padding: 0 .2rem; }
  .hinweis { position: absolute; left: 16px; bottom: 12px; font-size: .875rem; color: var(--fg-muted); margin: 0; }
</style>
