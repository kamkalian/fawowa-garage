<script>
  import { pick } from '../lib/i18n.js';
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import Fenster from './Fenster.svelte';

  // Gespann: eine kleine Vorschau der Anordnung. Ein Klick darauf öffnet die Fläche im modalen Fenster.
  // In der Fläche wird zuerst ein Element markiert (Klick oder Ziehen), dann lässt es sich verschieben und skalieren.
  // Ein erneuter Klick hebt die Markierung auf. Rechts daneben steht eine Liste, in der man ebenfalls markieren kann.
  // Das markierte Element lässt sich in den Vordergrund bringen.
  // Jeder Eintrag (Fahrrad, Anhänger, Gepäck) kann eine eigene Farbe haben; das Icon wird in dieser Farbe gezeigt.
  // Positionen sind in einem festen Koordinatensystem (FLAECHE_B × FLAECHE_H); Fläche und Vorschau haben das Seitenverhältnis 4:3.
  let { lang, mitglieder = [], positionen = {}, ondrop, onentfernen, onposition } = $props();

  const FLAECHE_B = 640;          // logische Breite der Fläche in Pixeln
  const FLAECHE_H = 480;          // logische Höhe (Seitenverhältnis 4:3)
  const VORSCHAU_B = 132;         // feste Größe der Vorschau
  const VORSCHAU_H = 99;
  const VORSCHAU = VORSCHAU_B / FLAECHE_B;   // Maßstab der Vorschau gegenüber der Fläche
  const KACHEL = 96;              // Breite eines Elements bei Größe 1
  const S_MIN = 0.5;
  const S_MAX = 5;
  const ZIEH_SCHWELLE = 4;        // weniger Bewegung in Pixeln zählt als Klick

  let offen = $state(false);
  let ueber = $state(false);      // eine Kachel wird von außen darübergezogen
  let breite = $state(FLAECHE_B); // gemessene Breite der Fläche am Bildschirm
  let live = $state({});          // Lage während des Ziehens: { x, y, s, e } in logischen Pixeln
  let zieht = $state(null);       // { schluessel, f, modus, px, py, ox, oy, os, war, bewegt }
  let markiert = $state(null);    // Schlüssel des markierten Elements

  const schluessel = (f) => f.art + '-' + f.e.id;
  const sWert = (v) => (typeof v === 'number' && v >= S_MIN && v <= S_MAX ? v : 1);
  const farbe = (f) => f.e.farbe ?? null;

  // Lage eines Mitglieds: während des Ziehens, sonst gespeichert, sonst im Raster (vier pro Zeile); e = Ebene
  const lage = (f, i) => {
    const s = schluessel(f);
    if (live[s]) return live[s];
    if (positionen[s]) return { x: positionen[s].x, y: positionen[s].y, s: sWert(positionen[s].s), e: positionen[s].e ?? 0 };
    return { x: 16 + (i % 4) * (KACHEL + 16), y: 16 + Math.floor(i / 4) * (KACHEL + 16), s: 1, e: 0 };
  };

  // Alle Mitglieder mit ihrer Lage; nach Ebene sortiert (die höhere Ebene liegt weiter vorne)
  const liste = $derived(mitglieder.map((f, i) => ({ f, p: lage(f, i) })));
  const sortiert = $derived(liste.slice().sort((a, b) => a.p.e - b.p.e));
  const markierterEintrag = $derived(liste.find((x) => schluessel(x.f) === markiert) ?? null);

  // Bildschirmpixel → logische Pixel
  const umrechnen = () => FLAECHE_B / breite;

  function zeigerStart(e, f, modus, i) {
    const s = schluessel(f);
    const war = markiert === s;
    markiert = s;                  // erst markieren, dann verschieben
    const { x, y, s: skal, e: ebene } = lage(f, i);
    zieht = { schluessel: s, f, modus, px: e.clientX, py: e.clientY, ox: x, oy: y, os: skal, oe: ebene, war, bewegt: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function zeigerBewegen(e) {
    if (!zieht) return;
    const k = umrechnen();
    const dx = (e.clientX - zieht.px) * k;
    const dy = (e.clientY - zieht.py) * k;
    if (Math.abs(e.clientX - zieht.px) > ZIEH_SCHWELLE || Math.abs(e.clientY - zieht.py) > ZIEH_SCHWELLE) zieht.bewegt = true;
    if (zieht.modus === 'bewegen') {
      // Auch nach oben und links aus dem Bild hinaus (bis zu einer Bildbreite), damit man es nicht ganz verliert
      live = { ...live, [zieht.schluessel]: { x: Math.min(FLAECHE_B - 16, Math.max(-FLAECHE_B, zieht.ox + dx)), y: Math.min(FLAECHE_H - 16, Math.max(-FLAECHE_H, zieht.oy + dy)), s: zieht.os, e: zieht.oe } };
    } else {
      const s = Math.min(S_MAX, Math.max(S_MIN, zieht.os + (dx + dy) / 200));
      live = { ...live, [zieht.schluessel]: { x: zieht.ox, y: zieht.oy, s: Math.round(s * 20) / 20, e: zieht.oe } };
    }
  }
  function zeigerEnde() {
    if (!zieht) return;
    const { schluessel: s, f, war, bewegt, modus } = zieht;
    const p = live[s];
    zieht = null;
    if (p) {
      // Erst im Stand merken (onposition), dann die Vorschau loslassen: so springt nichts zurück
      onposition?.(f.art, f.e.id, Math.round(p.x), Math.round(p.y), p.s, p.e);
      const { [s]: _, ...rest } = live;
      live = rest;
    } else if (!bewegt && war && modus === 'bewegen') {
      // Ein Klick auf das schon markierte Element hebt die Markierung auf
      markiert = null;
    }
  }

  // Die Liste rechts: ein Klick markiert, ein erneuter Klick hebt auf
  function listeKlick(s) {
    markiert = markiert === s ? null : s;
  }

  // Markierte Element in den Vordergrund: es bekommt die höchste Ebene
  function nachVorne() {
    if (!markierterEintrag) return;
    const hoechste = Math.max(0, ...liste.map((x) => x.p.e));
    const { f, p } = markierterEintrag;
    onposition?.(f.art, f.e.id, Math.round(p.x), Math.round(p.y), p.s, hoechste + 1);
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
  {#each sortiert as { f, p } (schluessel(f))}
    <span class="mini" style="left: {p.x * VORSCHAU}px; top: {p.y * VORSCHAU}px; --s: {p.s * VORSCHAU};">
      <Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} alt="" groesse="64px" farbe={farbe(f)} />
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
          onpointerdown={(e) => { if (e.target === e.currentTarget) markiert = null; }}
          onpointermove={zeigerBewegen} onpointerup={zeigerEnde} onpointercancel={zeigerEnde}>
          {#each sortiert as { f, p }, i (schluessel(f))}
            <div class="element" class:zieht={zieht?.schluessel === schluessel(f)} class:markiert={markiert === schluessel(f)}
              style="left: {(p.x / FLAECHE_B) * 100}%; top: {(p.y / FLAECHE_H) * 100}%; --s: {p.s};"
              onpointerdown={(e) => zeigerStart(e, f, 'bewegen', liste.findIndex((x) => schluessel(x.f) === schluessel(f)))} role="group" aria-label={f.e.name}>
              <div class="icon">
                <Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} motor={f.art === 'fahrraeder' && (f.e.motoren ?? []).length > 0} akku={(f.e.akkus ?? []).length > 0} alt={f.e.name} groesse="calc(64px * var(--s))" farbe={farbe(f)} />
              </div>
              <div class="beschriftung">{f.e.name}</div>
              {#if markiert === schluessel(f)}
                <button type="button" class="entfernen" aria-label={pick({ de: 'Aus dem Gespann nehmen', en: 'Remove from convoy' }, lang)}
                  onpointerdown={(e) => e.stopPropagation()} onclick={() => onentfernen?.(f)}>✕</button>
                <span class="griff" aria-hidden="true" onpointerdown={(e) => { e.stopPropagation(); zeigerStart(e, f, 'skalieren', liste.findIndex((x) => schluessel(x.f) === schluessel(f))); }}></span>
              {/if}
            </div>
          {:else}
            <p class="hinweis">{pick({ de: 'Kachel hierher ziehen, um sie ins Gespann zu legen.', en: 'Drag a card here to add it to the convoy.' }, lang)}</p>
          {/each}
        </div>

        <aside class="seite">
          <h3>{pick({ de: 'Im Gespann', en: 'In the convoy' }, lang)}</h3>
          <ul class="liste">
            {#each liste as { f }, i (schluessel(f))}
              <li>
                <button type="button" class="eintrag" class:markiert={markiert === schluessel(f)} aria-pressed={markiert === schluessel(f)}
                  onclick={() => listeKlick(schluessel(f))}>
                  <span class="symbol"><Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} alt="" groesse="28px" farbe={farbe(f)} /></span>
                  <span class="name">{f.e.name}</span>
                </button>
              </li>
            {:else}
              <li class="leer">{pick({ de: 'Noch niemand im Gespann.', en: 'Nobody in the convoy yet.' }, lang)}</li>
            {/each}
          </ul>
          <button type="button" class="btn btn-outline btn-sm vordergrund" disabled={!markierterEintrag} onclick={nachVorne}>
            {pick({ de: 'In den Vordergrund', en: 'Bring to front' }, lang)}
          </button>
        </aside>
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
  .mini :global(img), .mini :global(svg), .mini :global(.symbolmaske), .element :global(img), .element :global(svg), .element :global(.symbolmaske), .eintrag :global(img), .eintrag :global(svg), .eintrag :global(.symbolmaske) { pointer-events: none; -webkit-user-drag: none; user-select: none; }

  /* Im Fenster: Fläche links, Liste rechts (auf dem Handy darunter) */
  .gespann { display: flex; gap: 1rem; align-items: flex-start; width: 100%; }
  .flaeche {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
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
    border-radius: var(--radius-sm);
  }
  .element.zieht { cursor: grabbing; }
  .element.markiert { outline: 2px dashed var(--accent, #3b82f6); outline-offset: 4px; }
  .icon { display: flex; align-items: center; justify-content: center; }
  .beschriftung { font-size: .7rem; color: var(--fg-muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
  .entfernen { position: absolute; top: -8px; right: -4px; background: var(--bg); border: 1px solid var(--border); border-radius: 999px; width: 18px; height: 18px; color: var(--fg-muted); cursor: pointer; font: inherit; font-size: .6rem; line-height: 1; padding: 0; }
  /* Griff zum Skalieren unten rechts; nur am markierten Element */
  .griff { position: absolute; right: -6px; bottom: 18px; width: 12px; height: 12px; border-radius: 3px; background: var(--accent, #3b82f6); cursor: nwse-resize; }
  .hinweis { position: absolute; left: 16px; bottom: 12px; font-size: .875rem; color: var(--fg-muted); margin: 0; }

  /* Seite rechts: Liste der Mitglieder */
  .seite { flex: 0 0 12rem; display: flex; flex-direction: column; gap: .5rem; }
  .seite h3 { font-size: .9375rem; margin: 0; }
  .liste { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; max-height: 22rem; overflow-y: auto; }
  .eintrag { width: 100%; display: flex; align-items: center; gap: .5rem; padding: .3rem .4rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: inherit; font: inherit; font-size: .875rem; text-align: left; cursor: pointer; }
  .eintrag:hover { border-color: var(--accent, #3b82f6); }
  .eintrag.markiert { border-color: var(--accent, #3b82f6); box-shadow: 0 0 0 1px var(--accent, #3b82f6); font-weight: 600; }
  .eintrag .symbol { flex: none; display: inline-flex; }
  .eintrag .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .leer { font-size: .8125rem; color: var(--fg-muted); }
  .vordergrund { align-self: flex-start; }

  @media (max-width: 720px) {
    .gespann { flex-direction: column; }
    .seite { flex: none; width: 100%; }
    .liste { flex-direction: row; flex-wrap: wrap; max-height: none; }
    .eintrag { width: auto; }
  }
</style>
