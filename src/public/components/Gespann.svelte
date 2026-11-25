<script>
  import { pick } from '../lib/i18n.js';
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import Fenster from './Fenster.svelte';

  // Gespann: eine kleine Vorschau der Anordnung. Ein Klick darauf öffnet die Fläche im modalen Fenster.
  // Ausgewählt wird nur über die Liste rechts (ein Klick wählt, ein erneuter Klick hebt auf).
  // Das ausgewählte Element lässt sich in der Fläche über das Verschiebe-Symbol in der Mitte bewegen und über das Symbol unten rechts skalieren.
  // Die Reihenfolge in der Liste bestimmt die Reihenfolge der Elemente: oben ist vorne, unten hinten.
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

  let offen = $state(false);
  let ueber = $state(false);      // eine Kachel wird von außen darübergezogen
  let breite = $state(FLAECHE_B); // gemessene Breite der Fläche am Bildschirm
  let live = $state({});          // Lage während des Ziehens: { x, y, s, e } in logischen Pixeln
  let zieht = $state(null);       // { schluessel, f, modus, px, py, ox, oy, os, oe }
  let markiert = $state(null);    // Schlüssel des ausgewählten Elements (nur über die Liste)

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

  // Alle Mitglieder mit ihrer Lage
  const liste = $derived(mitglieder.map((f, i) => ({ f, p: lage(f, i) })));
  // Zum Zeichnen: nach Ebene, die höhere liegt weiter vorne
  const sortiert = $derived(liste.slice().sort((a, b) => a.p.e - b.p.e));
  // Für die Liste: oben vorne, unten hinten
  const vorneZuHinten = $derived(sortiert.slice().reverse());

  // Bildschirmpixel → logische Pixel
  const umrechnen = () => FLAECHE_B / breite;
  const indexVon = (s) => liste.findIndex((x) => schluessel(x.f) === s);

  function zeigerStart(e, f, modus) {
    const s = schluessel(f);
    // Nur das ausgewählte Element lässt sich bewegen oder skalieren
    if (markiert !== s) return;
    const { x, y, s: skal, e: ebene } = lage(f, indexVon(s));
    zieht = { schluessel: s, f, modus, px: e.clientX, py: e.clientY, ox: x, oy: y, os: skal, oe: ebene };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function zeigerBewegen(e) {
    if (!zieht) return;
    const k = umrechnen();
    const dx = (e.clientX - zieht.px) * k;
    const dy = (e.clientY - zieht.py) * k;
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
    const { schluessel: s, f } = zieht;
    const p = live[s];
    zieht = null;
    if (p) {
      // Erst im Stand merken (onposition), dann die Vorschau loslassen: so springt nichts zurück
      onposition?.(f.art, f.e.id, Math.round(p.x), Math.round(p.y), p.s, p.e);
      const { [s]: _, ...rest } = live;
      live = rest;
    }
  }

  // Die Liste: ein Klick wählt aus, ein erneuter Klick hebt die Auswahl auf
  function listeKlick(s) {
    markiert = markiert === s ? null : s;
  }

  // Reihenfolge der Liste (vorne zuerst) übernehmen: jedes Element bekommt eine Ebene nach seinem Platz
  function reihenfolgeSetzen(vornZuHinten) {
    const n = vornZuHinten.length;
    vornZuHinten.forEach((s, k) => {
      const { f, p } = liste.find((x) => schluessel(x.f) === s);
      const ebene = n - 1 - k;
      if (p.e !== ebene) onposition?.(f.art, f.e.id, Math.round(p.x), Math.round(p.y), p.s, ebene);
    });
  }

  // Ein Eintrag der Liste eine Stelle nach vorne (-1) oder nach hinten (+1)
  function verschieben(k, richtung) {
    const arr = vorneZuHinten.map((x) => schluessel(x.f));
    const j = k + richtung;
    if (j < 0 || j >= arr.length) return;
    [arr[k], arr[j]] = [arr[j], arr[k]];
    reihenfolgeSetzen(arr);
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
        <div class="flaeche" class:ablegen={ueber} role="region" aria-label={pick({ de: 'Fläche für das Gespann', en: 'Area for the convoy' }, lang)}
          bind:clientWidth={breite}
          ondragover={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ueber = true; }}
          ondragleave={() => (ueber = false)}
          ondrop={(e) => { e.preventDefault(); ueber = false; ondrop?.(e); }}
          ondragstart={(e) => e.preventDefault()}
          onpointermove={zeigerBewegen} onpointerup={zeigerEnde} onpointercancel={zeigerEnde}>
          {#each sortiert as { f }, i (schluessel(f))}
            {@const s = schluessel(f)}
            <div class="element" class:markiert={markiert === s} class:zieht={zieht?.schluessel === s}
              style="left: {(live[s]?.x ?? positionen[s]?.x ?? liste[indexVon(s)].p.x) / FLAECHE_B * 100}%; top: {(live[s]?.y ?? positionen[s]?.y ?? liste[indexVon(s)].p.y) / FLAECHE_H * 100}%; --s: {liste[indexVon(s)].p.s}; z-index: {liste[indexVon(s)].p.e};"
              role="group" aria-label={f.e.name}>
              <div class="icon">
                <Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} motor={f.art === 'fahrraeder' && (f.e.motoren ?? []).length > 0} akku={(f.e.akkus ?? []).length > 0} alt={f.e.name} groesse="calc(64px * var(--s))" farbe={farbe(f)} />
                <button type="button" class="ziehen" class:aus={markiert !== s} aria-label={pick({ de: 'Verschieben', en: 'Move' }, lang)}
                  title={pick({ de: 'Verschieben', en: 'Move' }, lang)}
                  onpointerdown={(e) => zeigerStart(e, f, 'bewegen')}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3" />
                  </svg>
                </button>
              </div>
              <div class="beschriftung">{f.e.name}</div>
              <button type="button" class="skalieren" class:aus={markiert !== s} aria-label={pick({ de: 'Skalieren', en: 'Scale' }, lang)}
                title={pick({ de: 'Skalieren', en: 'Scale' }, lang)}
                onpointerdown={(e) => zeigerStart(e, f, 'skalieren')}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />
                </svg>
              </button>
            </div>
          {:else}
            <p class="hinweis">{pick({ de: 'Kachel hierher ziehen, um sie ins Gespann zu legen.', en: 'Drag a card here to add it to the convoy.' }, lang)}</p>
          {/each}
        </div>

        <aside class="seite">
          <h3>{pick({ de: 'Im Gespann', en: 'In the convoy' }, lang)}</h3>
          <p class="reihenfolge-hinweis">{pick({ de: 'Oben ist vorne.', en: 'Top is in front.' }, lang)}</p>
          <ul class="liste">
            {#each vorneZuHinten as { f }, k (schluessel(f))}
              <li class="zeile">
                <button type="button" class="eintrag" class:markiert={markiert === schluessel(f)} aria-pressed={markiert === schluessel(f)}
                  onclick={() => listeKlick(schluessel(f))}>
                  <span class="symbol"><Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} alt="" groesse="28px" farbe={farbe(f)} /></span>
                  <span class="name">{f.e.name}</span>
                </button>
                <span class="reihe">
                  <button type="button" class="pfeil" aria-label={pick({ de: 'Nach vorne', en: 'Forward' }, lang)} disabled={k === 0}
                    onclick={() => verschieben(k, -1)}>↑</button>
                  <button type="button" class="pfeil" aria-label={pick({ de: 'Nach hinten', en: 'Back' }, lang)} disabled={k === vorneZuHinten.length - 1}
                    onclick={() => verschieben(k, 1)}>↓</button>
                </span>
                <button type="button" class="weg" aria-label={pick({ de: 'Aus dem Gespann nehmen', en: 'Remove from convoy' }, lang)}
                  onclick={() => onentfernen?.(f)}>✕</button>
              </li>
            {:else}
              <li class="leer">{pick({ de: 'Noch niemand im Gespann.', en: 'Nobody in the convoy yet.' }, lang)}</li>
            {/each}
          </ul>
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
  }
  /* Grüner Rahmen nur, wenn eine Kachel von außen darübergezogen wird */
  .flaeche.ablegen { border: 2px solid #22c55e; box-shadow: 0 0 0 2px rgba(34, 197, 94, .35); }
  .element {
    position: absolute;
    /* Breite wächst mit dem Icon, mindestens 96 px; der Name bleibt immer gleich groß */
    width: max(96px, calc(64px * var(--s)));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .25rem;
    padding: 4px;
    border-radius: var(--radius-sm);
    user-select: none;
  }
  /* Ausgewählt: halbtransparenter Hintergrund */
  .element.markiert { background: rgba(59, 130, 246, .2); }
  .icon { position: relative; display: flex; align-items: center; justify-content: center; }
  .beschriftung { font-size: .7rem; color: var(--fg-muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
  /* Verschieben-Symbol in der Mitte des Icons */
  .ziehen { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 999px; border: 1px solid var(--border); background: rgba(255, 255, 255, .6); color: #111; cursor: grab; touch-action: none; }
  .ziehen:active { cursor: grabbing; }
  /* Skalieren-Symbol unten rechts */
  .skalieren { position: absolute; right: 0; bottom: 0; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border-radius: 4px; border: 1px solid var(--border); background: rgba(255, 255, 255, .6); color: #111; cursor: nwse-resize; touch-action: none; }
  /* Ohne Auswahl sind die Symbole blass und tun nichts */
  .ziehen.aus, .skalieren.aus { opacity: .45; cursor: default; }
  .hinweis { position: absolute; left: 16px; bottom: 12px; font-size: .875rem; color: var(--fg-muted); margin: 0; }

  /* Seite rechts: Liste der Mitglieder */
  .seite { flex: 0 0 13rem; display: flex; flex-direction: column; gap: .4rem; }
  .seite h3 { font-size: .9375rem; margin: 0; }
  .reihenfolge-hinweis { font-size: .75rem; color: var(--fg-muted); margin: 0; }
  .liste { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; max-height: 22rem; overflow-y: auto; }
  .zeile { display: flex; align-items: center; gap: .25rem; }
  .eintrag { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: .5rem; padding: .3rem .4rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: inherit; font: inherit; font-size: .875rem; text-align: left; cursor: pointer; }
  .eintrag:hover { border-color: var(--accent, #3b82f6); }
  .eintrag.markiert { border-color: var(--accent, #3b82f6); background: rgba(59, 130, 246, .2); font-weight: 600; }
  .eintrag .symbol { flex: none; display: inline-flex; }
  .eintrag .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .reihe { display: flex; flex-direction: column; }
  .pfeil { width: 1.4rem; height: 1.1rem; padding: 0; border: 0; background: none; color: var(--fg-muted); cursor: pointer; font: inherit; font-size: .75rem; line-height: 1; }
  .pfeil:disabled { opacity: .3; cursor: default; }
  .weg { flex: none; width: 1.6rem; height: 1.6rem; padding: 0; border: 0; border-radius: 999px; background: none; color: var(--fg-muted); cursor: pointer; font: inherit; font-size: .8rem; }
  .weg:hover { color: var(--fg); }
  .leer { font-size: .8125rem; color: var(--fg-muted); }

  @media (max-width: 720px) {
    .gespann { flex-direction: column; }
    .seite { flex: none; width: 100%; }
    .liste { max-height: none; }
  }
</style>
