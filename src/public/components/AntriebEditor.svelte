<script>
  import { pick } from '../lib/i18n.js';
  import { MOTOR_ARTEN } from '../../shared/antrieb.js';
  import Fenster from './Fenster.svelte';
  import AkkuAssistent from './AkkuAssistent.svelte';
  import { AKKU_CHEMIE } from '../../../lib/akku.js';

  // Motoren und Akkus eines Fahrrads oder Anhängers als Listen; beliebig viele. Die Werte gehören dem umgebenden Formular.
  let { lang, motoren = $bindable([]), akkus = $bindable([]) } = $props();

  // Index des Akkus, für den der Assistent offen ist (null: zu); neu: der Akku wurde gerade angelegt und wird beim Abbrechen entfernt
  let assistent = $state(null);
  let neu = $state(false);

  // Kurzinfo unter dem Akku: Chemie, Zellen, Abschaltung, Dauerstrom
  function akkuInfo(a) {
    if (!a.zellen_s && !a.chemie) return pick({ de: 'Angaben fehlen: Assistent öffnen', en: 'Details missing: open the wizard' }, lang);
    const teile = [a.chemie ? AKKU_CHEMIE[a.chemie]?.name : pick({ de: 'Chemie unbekannt', en: 'Chemistry unknown' }, lang)];
    if (a.zellen_s) teile.push(`${a.zellen_s}s${a.zellen_p ?? 1}p`);
    if (a.schluss_v) teile.push(`${pick({ de: 'Abschaltung', en: 'cut-off' }, lang)} ${a.schluss_v} V`);
    if (a.max_strom_a) teile.push(`${a.max_strom_a} A`);
    return teile.join(' · ');
  }

  const LEER_AKKU = () => ({ kapazitaet_wh: null, spannung_v: null, chemie: null, zellen_s: null, zellen_p: null, ah: null, schluss_v: null, max_strom_a: null });

  /** Neuer Akku: legt ihn an und öffnet direkt den Assistenten */
  function neuerAkku() {
    akkus = [...akkus, LEER_AKKU()];
    assistent = akkus.length - 1;
    neu = true;
  }
  function bearbeiten(i) {
    assistent = i;
    neu = false;
  }
  function uebernehmen(werte) {
    akkus[assistent] = { ...akkus[assistent], ...werte };
    assistent = null;
    neu = false;
  }
  /** Schließen ohne Übernehmen; ein gerade angelegter Akku entfällt wieder */
  function schliessen() {
    if (neu && assistent !== null) akkus = akkus.filter((_, k) => k !== assistent);
    assistent = null;
    neu = false;
  }

  const GETRIEBE = [
    { wert: 'getriebe', de: 'Mit Getriebe', en: 'Geared' },
    { wert: 'direkt', de: 'Direktläufer', en: 'Direct drive' }
  ];
</script>

<div class="antrieb">
  <p class="hinweis">{pick({ de: 'Leistung in Watt, Kapazität in Wh, Spannung in Volt. Ohne Motor erscheint kein Blitz-Symbol.', en: 'Power in watts, capacity in Wh, voltage in volts. Without a motor no lightning symbol is shown.' }, lang)}</p>

  <h4 class="abschnitt">{pick({ de: 'Motoren', en: 'Motors' }, lang)}</h4>
  {#each motoren as m, i (i)}
    <div class="motor">
      <div class="reihe kopf-reihe">
        <select class="input" aria-label={pick({ de: 'Motorart', en: 'Motor type' }, lang)} bind:value={m.motor_art}>
          {#each MOTOR_ARTEN as o (o.wert)}<option value={o.wert}>{pick(o, lang)}</option>{/each}
        </select>
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => (motoren = motoren.filter((_, k) => k !== i))}>
          {pick({ de: 'Entfernen', en: 'Remove' }, lang)}
        </button>
      </div>
      <div class="reihe werte">
        <input class="input" type="number" min="0" max="20000" step="1" inputmode="numeric"
          aria-label={pick({ de: 'Nenndauerleistung in Watt', en: 'Continuous rated power in watts' }, lang)} placeholder="W" bind:value={m.leistung_w} />
        <input class="input" type="number" min="1" max="1000" step="1" inputmode="numeric"
          aria-label={pick({ de: 'Spannung in Volt', en: 'Voltage in volts' }, lang)} placeholder="V" bind:value={m.spannung_v} />
        <select class="input" aria-label={pick({ de: 'Getriebe oder Direktläufer', en: 'Geared or direct drive' }, lang)} bind:value={m.getriebe}>
          <option value={null}>{pick({ de: 'Getriebe?', en: 'Geared?' }, lang)}</option>
          {#each GETRIEBE as o (o.wert)}<option value={o.wert}>{pick(o, lang)}</option>{/each}
        </select>
      </div>
    </div>
  {/each}
  <button type="button" class="btn btn-outline btn-sm" onclick={() => (motoren = [...motoren, { motor_art: 'mittelmotor', leistung_w: 250, spannung_v: null, getriebe: null }])}>
    {pick({ de: '+ Motor', en: '+ Motor' }, lang)}
  </button>

  <h4 class="abschnitt">{pick({ de: 'Akkus', en: 'Batteries' }, lang)}</h4>
  <div class="akku-kacheln">
    {#each akkus as a, i (i)}
      <article class="akku-kachel">
        <header class="kopf">
          <strong>{pick({ de: 'Akku', en: 'Battery' }, lang)} {i + 1}</strong>
        </header>
        <p class="wert">{a.kapazitaet_wh ?? '–'} Wh · {a.spannung_v ?? '–'} V</p>
        {#if a.ah}<p class="zeile">{a.ah} Ah</p>{/if}
        <p class="zeile info">{akkuInfo(a)}</p>
        <div class="aktionen">
          <button type="button" class="btn btn-outline btn-sm" onclick={() => bearbeiten(i)}>
            {pick({ de: 'Bearbeiten', en: 'Edit' }, lang)}
          </button>
          <button type="button" class="btn btn-ghost btn-sm" onclick={() => (akkus = akkus.filter((_, k) => k !== i))}>
            {pick({ de: 'Entfernen', en: 'Remove' }, lang)}
          </button>
        </div>
      </article>
    {/each}
    <button type="button" class="akku-kachel neu" onclick={neuerAkku}>
      <span>+ {pick({ de: 'Akku', en: 'Battery' }, lang)}</span>
    </button>
  </div>

  {#if assistent !== null && akkus[assistent]}
    <Fenster {lang} breit titel={pick({ de: 'Akku-Assistent', en: 'Battery wizard' }, lang)} onclose={schliessen}>
      <AkkuAssistent {lang} start={akkus[assistent]} bearbeiten={!neu} onfertig={uebernehmen} onabbrechen={schliessen} />
    </Fenster>
  {/if}
</div>

<style>
  .hinweis { font-size: .8125rem; color: var(--fg-muted); margin-bottom: .5rem; }
  .abschnitt { font-size: .875rem; font-weight: 600; margin: .75rem 0 .375rem; }
  .motor { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .5rem; margin-bottom: .5rem; display: grid; gap: .4rem; }
  .reihe { display: grid; gap: .5rem; align-items: center; }
  .kopf-reihe { grid-template-columns: minmax(0, 1fr) auto; }
  .werte { grid-template-columns: 1fr 1fr 1fr; }
  .akku-kacheln { display: grid; grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr)); gap: .5rem; }
  .akku-kachel { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .6rem; display: flex; flex-direction: column; gap: .2rem; background: var(--bg); min-width: 0; }
  .akku-kachel .kopf { font-size: .875rem; }
  .akku-kachel .wert { margin: 0; font-weight: 600; font-size: .9375rem; }
  .akku-kachel .zeile { margin: 0; font-size: .8125rem; color: var(--fg-muted); overflow-wrap: anywhere; }
  .akku-kachel .aktionen { display: flex; gap: .3rem; flex-wrap: wrap; margin-top: auto; padding-top: .4rem; }
  .akku-kachel.neu { align-items: center; justify-content: center; border-style: dashed; cursor: pointer; color: var(--fg-muted); background: none; font: inherit; min-height: 7rem; }
  @media (max-width: 520px) { .werte { grid-template-columns: 1fr 1fr; } }
</style>
