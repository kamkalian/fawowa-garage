<script>
  import { pick } from '../lib/i18n.js';
  import Fahrzeugbild from '../../shared/Fahrzeugbild.svelte';
  import Fenster from './Fenster.svelte';

  // Gespann: eine kleine Vorschau der Anordnung. Ein Klick darauf öffnet die Fläche im modalen Fenster.
  // Ausgewählt wird nur über die Liste rechts (ein Klick wählt, ein erneuter Klick hebt auf).
  // Nur das ausgewählte Element zeigt die Symbole: in der Mitte zum Verschieben (das ganze Element lässt sich ziehen), unten rechts zum Skalieren.
  // Die Reihenfolge der Liste bestimmt die Reihenfolge der Elemente: oben ist vorne. Die Liste wird per Drag and Drop geordnet.
  // Jeder Eintrag (Fahrrad, Anhänger, Gepäck) kann ein Farbpaar haben; das Icon wird darin gezeigt, das ausgewählte Element in der anderen Farbe des Paares hinterlegt.
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
  let ziehEintrag = $state(null); // Listeneintrag, der gerade per Drag and Drop bewegt wird
  let ziel = $state(null);        // Listenplatz, über dem gerade gezogen wird

  const schluessel = (f) => f.art + '-' + f.e.id;
  const sWert = (v) => (typeof v === 'number' && v >= S_MIN && v <= S_MAX ? v : 1);
  const farbe = (f) => f.e.farbe ?? null;
  // Erklärung unten rechts: was man tun kann
  const ERKLAERUNG = [
    { de: 'Klicke rechts einen Button an um das Element zu markieren.', en: 'Click a button on the right to mark the element.' },
    { de: 'Verschiebe links das Element an die gewünschte Stelle.', en: 'Drag the element on the left to the place you want.' },
    { de: 'Benutze die untere Ecke zum Ändern der Größe.', en: 'Use the bottom corner to change the size.' },
    { de: 'Ändere links die Reihenfolge der Buttons um ein Element in den Vordergrund zu holen.', en: 'Change the order of the buttons to bring an element to the front.' }
  ];

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

  // Per Drag and Drop: der gezogene Eintrag kommt an den Platz des Ziels
  function reihenfolgeNeu(s, zielPlatz) {
    const arr = vorneZuHinten.map((x) => schluessel(x.f));
    const von = arr.indexOf(s);
    if (von < 0 || von === zielPlatz) return;
    arr.splice(von, 1);
    arr.splice(zielPlatz, 0, s);
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
          {#each sortiert as { f } (schluessel(f))}
            {@const s = schluessel(f)}
            {@const sel = markiert === s}
            {@const p = liste[indexVon(s)].p}
            <div class="element" class:markiert={sel} class:zieht={zieht?.schluessel === s}
              style="left: {((live[s]?.x ?? p.x) / FLAECHE_B) * 100}%; top: {((live[s]?.y ?? p.y) / FLAECHE_H) * 100}%; --s: {p.s}; z-index: {p.e};"
              onpointerdown={(e) => { if (sel) zeigerStart(e, f, 'bewegen'); }} role="group" aria-label={f.e.name}>
              <div class="icon">
                <Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} motor={f.art === 'fahrraeder' && (f.e.motoren ?? []).length > 0} akku={(f.e.akkus ?? []).length > 0} alt={f.e.name} groesse="calc(64px * var(--s))" farbe={farbe(f)} />
              </div>
              <div class="beschriftung">{f.e.name}</div>
              {#if sel}
                <span class="skalieren" aria-label={pick({ de: 'Skalieren', en: 'Scale' }, lang)} role="presentation"
                  onpointerdown={(e) => { e.stopPropagation(); zeigerStart(e, f, 'skalieren'); }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M15 3h6v6M21 3l-7 7M9 21H3v-6M3 21l7-7" />
                  </svg>
                </span>
              {/if}
            </div>
          {:else}
            <p class="hinweis">{pick({ de: 'Kachel hierher ziehen, um sie ins Gespann zu legen.', en: 'Drag a card here to add it to the convoy.' }, lang)}</p>
          {/each}
        </div>

        <aside class="seite">
          <h3>{pick({ de: 'Im Gespann', en: 'In the convoy' }, lang)}</h3>
          <p class="reihenfolge-hinweis">{pick({ de: 'Oben ist vorne. Zum Ordnen ziehen.', en: 'Top is in front. Drag to reorder.' }, lang)}</p>
          <ul class="liste">
            {#each vorneZuHinten as { f }, k (schluessel(f))}
              <li class="zeile" class:ziel={ziel === k && ziehEintrag !== null && ziehEintrag !== schluessel(f)} draggable="true"
                ondragstart={(e) => { ziehEintrag = schluessel(f); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', schluessel(f)); }}
                ondragend={() => { ziehEintrag = null; ziel = null; }}
                ondragover={(e) => { if (!ziehEintrag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ziel = k; }}
                ondragleave={() => { if (ziel === k) ziel = null; }}
                ondrop={(e) => { e.preventDefault(); if (ziehEintrag) reihenfolgeNeu(ziehEintrag, k); ziehEintrag = null; ziel = null; }}>
                <button type="button" class="eintrag" class:markiert={markiert === schluessel(f)} aria-pressed={markiert === schluessel(f)}
                  onclick={() => listeKlick(schluessel(f))}>
                  <span class="symbol"><Fahrzeugbild art={f.art} bauart={f.e.bauart} aufbau={f.e.aufbau} alt="" groesse="28px" farbe={farbe(f)} /></span>
                  <span class="name">{f.e.name}</span>
                </button>
                <button type="button" class="weg" aria-label={pick({ de: 'Aus dem Gespann nehmen', en: 'Remove from convoy' }, lang)}
                  onclick={() => onentfernen?.(f)}>✕</button>
              </li>
            {:else}
              <li class="leer">{pick({ de: 'Noch niemand im Gespann.', en: 'Nobody in the convoy yet.' }, lang)}</li>
            {/each}
          </ul>

          <!-- Erklärung unten rechts -->
          <ul class="erklaerung">
            {#each ERKLAERUNG as satz}
              <li>{pick(satz, lang)}</li>
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
    cursor: default;
  }
  /* Ausgewählt: gestrichelter Rahmen; das ganze Element ist ziehbar */
  .element.markiert { outline: 2px dashed var(--accent, #3b82f6); outline-offset: 3px; cursor: grab; pointer-events: auto; }
  /* Nicht ausgewählte Elemente nehmen keine Zeigereingaben an: so lässt sich ein Element, das hinter anderen liegt, trotzdem anfassen */
  .element { pointer-events: none; }
  .element.zieht { cursor: grabbing; }
  .icon { position: relative; display: flex; align-items: center; justify-content: center; }
  .beschriftung { font-size: .7rem; color: var(--fg-muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; }
  /* Skalieren-Zeichen unten rechts */
  .skalieren { position: absolute; right: 0; bottom: 0; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 4px; background: var(--bg-card); color: var(--fg); opacity: .85; cursor: nwse-resize; touch-action: none; }
  .hinweis { position: absolute; left: 16px; bottom: 12px; font-size: .875rem; color: var(--fg-muted); margin: 0; }

  /* Seite rechts: Liste der Mitglieder */
  .seite { flex: 0 0 13rem; align-self: stretch; display: flex; flex-direction: column; gap: .4rem; }
  /* Erklärung unten rechts, als Aufzählung */
  .erklaerung { list-style: disc; margin: auto 0 0; padding: .6rem 0 0 1.1rem; border-top: 1px solid var(--border); font-size: .75rem; color: var(--fg-muted); display: flex; flex-direction: column; gap: .3rem; }
  .seite h3 { font-size: .9375rem; margin: 0; }
  .reihenfolge-hinweis { font-size: .75rem; color: var(--fg-muted); margin: 0; }
  .liste { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; max-height: 22rem; overflow-y: auto; }
  .zeile { display: flex; align-items: center; gap: .25rem; cursor: grab; border-radius: var(--radius-sm); }
  .zeile.ziel { box-shadow: 0 -2px 0 0 var(--accent, #3b82f6); }
  .eintrag { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: .5rem; padding: .3rem .4rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: inherit; font: inherit; font-size: .875rem; text-align: left; cursor: pointer; }
  .eintrag:hover { border-color: var(--accent, #3b82f6); }
  .eintrag.markiert { border-color: var(--accent, #3b82f6); background: rgba(59, 130, 246, .2); font-weight: 600; }
  .eintrag .symbol { flex: none; display: inline-flex; }
  .eintrag .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .weg { flex: none; width: 1.6rem; height: 1.6rem; padding: 0; border: 0; border-radius: 999px; background: none; color: var(--fg-muted); cursor: pointer; font: inherit; font-size: .8rem; }
  .weg:hover { color: var(--fg); }
  .leer { font-size: .8125rem; color: var(--fg-muted); }

  @media (max-width: 720px) {
    .gespann { flex-direction: column; }
    .seite { flex: none; width: 100%; }
    .liste { max-height: none; }
  }
</style>
