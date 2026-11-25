<script>
  import { ARTEN, GRUPPEN, ANZAHL_RAEDER_AUS_AUFBAU, anzahlRaederAbleiten, ANZAHL_RAEDER_AUS_BAUART, anzahlRaederAusBauart } from '../../../lib/felder.js';
  import { t, pick } from '../lib/i18n.js';
  import { ApiFehler } from '../lib/api.js';
  import Fenster from './Fenster.svelte';
  import AntriebEditor from './AntriebEditor.svelte';
  import { ICONS, BILD_SYMBOLE } from '../../shared/icons.js';
  import { FARBPAARE } from '../../shared/farben.js';

  // Bauart und Art des Anhängers werden als Symbole zur Auswahl gezeigt, nicht als Liste
  const SYMBOLFELDER = ['bauart', 'aufbau'];

  // Formular für Fahrrad und Anhänger; die Felder kommen aus lib/felder.js.
  // onsave(werte, antriebe) legt an oder ändert und wirft bei Fehlern einen ApiFehler.
  // aktionen (nur beim Bearbeiten): { fotoVorhanden, onfoto, onfotoloeschen, onloeschen }; das Foto steht oben, Entfernen unten.
  let { lang, art, eintrag = null, onsave, onclose, aktionen = null } = $props();

  // Das Formular wird für genau einen Eintrag geöffnet und danach geschlossen: Art und Anfangswerte werden nur einmal gelesen
  // svelte-ignore state_referenced_locally
  const cfg = ARTEN[art];
  // svelte-ignore state_referenced_locally
  const werte = $state(Object.fromEntries(cfg.felder.map(f => [f.key, eintrag?.[f.key] ?? (f.typ === 'zahl' || f.typ === 'ganzzahl' ? null : '')])));
  // svelte-ignore state_referenced_locally
  let motoren = $state((eintrag?.motoren ?? []).map(m => ({ motor_art: m.motor_art, leistung_w: m.leistung_w, spannung_v: m.spannung_v ?? null, getriebe: m.getriebe ?? null })));
  // svelte-ignore state_referenced_locally
  let akkus = $state((eintrag?.akkus ?? []).map(a => ({ kapazitaet_wh: a.kapazitaet_wh, spannung_v: a.spannung_v ?? null, chemie: a.chemie ?? null, zellen_s: a.zellen_s ?? null, zellen_p: a.zellen_p ?? null, ah: a.ah ?? null, schluss_v: a.schluss_v ?? null, max_strom_a: a.max_strom_a ?? null })));
  // Die Bauart (Fahrrad 2, Trike 3, Quad 4) und die Art des Anhängers (Achsen) geben die Anzahl der Räder vor
  $effect(() => {
    if (art === 'anhaenger') anzahlRaederAbleiten(werte);
    if (art === 'fahrraeder') anzahlRaederAusBauart(werte);
  });
  // Die Anzahl der Räder wird nach Bauart bzw. Achsen vorgeschlagen, bleibt aber änderbar
  const feldGesperrt = () => false;

  let fehler = $state({});
  let allgemein = $state('');
  let laeuft = $state(false);

  // Felder nach Gruppen, in der Reihenfolge ihres ersten Auftretens
  const gruppen = [];
  for (const f of cfg.felder) {
    let g = gruppen.find(x => x.key === f.gruppe);
    if (!g) gruppen.push(g = { key: f.gruppe, felder: [] });
    g.felder.push(f);
  }

  function fehlerText(f) {
    const code = fehler[f.key];
    if (!code) return '';
    const grenze = code === 'zu_lang' || code === 'zu_gross' ? f.max : f.min;
    return t(lang, `v_${code}`, grenze, f.einheit ?? '');
  }

  async function senden(e) {
    e.preventDefault();
    laeuft = true;
    fehler = {};
    allgemein = '';
    try {
      await onsave({ ...werte }, {
        motoren: motoren.map(m => ({ motor_art: m.motor_art, leistung_w: m.leistung_w === '' ? null : m.leistung_w, spannung_v: m.spannung_v === '' ? null : m.spannung_v, getriebe: m.getriebe || null })),
        akkus: akkus.map(a => ({ kapazitaet_wh: a.kapazitaet_wh, spannung_v: a.spannung_v === '' ? null : a.spannung_v, chemie: a.chemie || null, zellen_s: a.zellen_s ?? null, zellen_p: a.zellen_p ?? null, ah: a.ah ?? null, schluss_v: a.schluss_v ?? null, max_strom_a: a.max_strom_a ?? null }))
      });
    } catch (err) {
      if (err instanceof ApiFehler && err.felder) fehler = err.felder;
      allgemein = t(lang, err instanceof ApiFehler && err.code ? `e_${err.code}` : 'e_allgemein');
      if (allgemein.startsWith('e_')) allgemein = t(lang, 'e_allgemein');
    } finally {
      laeuft = false;
    }
  }
</script>

<Fenster {lang} breit titel={t(lang, eintrag ? 'formEdit' : 'formNew', pick(cfg.name, lang))} {onclose}>
  <form onsubmit={senden} novalidate>
    {#if aktionen?.onfoto}
      <div class="foto">
        <span class="foto-titel">{pick({ de: 'Foto', en: 'Photo' }, lang)}</span>
        <button type="button" class="btn btn-outline btn-sm" onclick={aktionen.onfoto}>
          {pick(aktionen.fotoVorhanden ? { de: 'Foto ändern', en: 'Change photo' } : { de: 'Foto hochladen', en: 'Upload photo' }, lang)}
        </button>
        {#if aktionen.fotoVorhanden}
          <button type="button" class="btn btn-ghost btn-sm" onclick={aktionen.onfotoloeschen}>{pick({ de: 'Foto entfernen', en: 'Remove photo' }, lang)}</button>
        {/if}
      </div>
    {/if}

    {#each gruppen as g (g.key)}
      <fieldset>
        <legend>{pick(GRUPPEN[g.key], lang)}</legend>
        <div class="raster">
          {#snippet feld(f)}
            <div class="feld" class:voll={f.typ === 'langtext' || f.key === 'name' || f.typ === 'farbe' || SYMBOLFELDER.includes(f.key)}>
              <label for="f-{f.key}">{pick(f.label, lang) + (f.einheit ? ` (${f.einheit})` : '') + (f.pflicht ? ' *' : '')}</label>
              {#if f.typ === 'text'}
                <input id="f-{f.key}" class="input" type="text" maxlength={f.max} aria-invalid={!!fehler[f.key]} aria-describedby="h-{f.key}" bind:value={werte[f.key]} />
              {:else if f.typ === 'langtext'}
                <textarea id="f-{f.key}" class="input" rows="3" maxlength={f.max} aria-invalid={!!fehler[f.key]} aria-describedby="h-{f.key}" bind:value={werte[f.key]}></textarea>
              {:else if f.typ === 'zahl' || f.typ === 'ganzzahl'}
                <input id="f-{f.key}" class="input" type="number" inputmode={f.typ === 'zahl' ? 'decimal' : 'numeric'}
                  min={f.min} max={f.max} step={f.typ === 'zahl' ? 'any' : 1} disabled={feldGesperrt(f)} aria-invalid={!!fehler[f.key]} aria-describedby="h-{f.key}" bind:value={werte[f.key]} />
              {:else if f.typ === 'auswahl' && SYMBOLFELDER.includes(f.key)}
                <div class="symbole" role="radiogroup" aria-label={pick(f.label, lang)}>
                  {#each f.optionen as o (o.wert)}
                    <button type="button" role="radio" aria-checked={werte[f.key] === o.wert} title={pick(o, lang)}
                      class="symbol-knopf" class:aktiv={werte[f.key] === o.wert}
                      onclick={() => (werte[f.key] = werte[f.key] === o.wert ? '' : o.wert)}>
                      {#if BILD_SYMBOLE[o.wert]}
                        <img class="sym-bild" src={BILD_SYMBOLE[o.wert]} alt="" />
                      {:else}
                        <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS[o.wert] ?? ''}</svg>
                      {/if}
                      <span>{pick(o, lang)}</span>
                    </button>
                  {/each}
                </div>
              {:else if f.typ === 'farbe'}
                <div class="farbwahl">
                  <div class="paare" role="radiogroup" aria-label={pick(f.label, lang)}>
                    {#each FARBPAARE as p (p.dunkel)}
                      {@const aktiv = werte[f.key] === p.dunkel || werte[f.key] === p.hell}
                      <button type="button" role="radio" aria-checked={aktiv} title={pick(p, lang)} aria-label={pick(p, lang)}
                        class="paar" class:aktiv style="background: linear-gradient(90deg, {p.hell} 50%, {p.dunkel} 50%);"
                        onclick={() => (werte[f.key] = aktiv ? '' : p.dunkel)}></button>
                    {/each}
                  </div>
                </div>
              {:else if f.typ === 'auswahl'}
                <select id="f-{f.key}" class="input" aria-invalid={!!fehler[f.key]} aria-describedby="h-{f.key}" bind:value={werte[f.key]}>
                  <option value="">–</option>
                  {#each f.optionen as o (o.wert)}<option value={o.wert}>{pick(o, lang)}</option>{/each}
                </select>
              {/if}
              <p id="h-{f.key}" class="notiz" class:fehler={!!fehler[f.key]}>{fehler[f.key] ? fehlerText(f) : f.hinweis ? pick(f.hinweis, lang) : ''}</p>
            </div>
          {/snippet}
          {#each g.felder as f (f.key)}
            {@render feld(f)}
          {/each}
        </div>
      </fieldset>
    {/each}

    {#if art !== 'gepaecke'}
      <fieldset>
        <legend>{pick({ de: 'Motor & Akku', en: 'Motor & battery' }, lang)}</legend>
        <AntriebEditor {lang} bind:motoren bind:akkus />
      </fieldset>
    {/if}

    {#if eintrag}<p class="notiz">{t(lang, 'formResetNote')}</p>{/if}
    {#if allgemein}<p class="fehler" role="alert">{allgemein}</p>{/if}

    <div class="aktionen">
      {#if aktionen}
        <button type="button" class="btn btn-ghost" onclick={aktionen.onloeschen}>{t(lang, 'remove')}</button>
      {/if}
      <span class="rechts">
        <button type="button" class="btn btn-ghost" onclick={onclose}>{t(lang, 'cancel')}</button>
      </span>
    </div>

    <!-- Speichern als Symbol rechts neben dem Fenster: bleibt beim Scrollen sichtbar -->
    <button type="submit" class="speichern-schwebend" disabled={laeuft} aria-label={laeuft ? t(lang, 'saving') : t(lang, 'save')} title={laeuft ? t(lang, 'saving') : t(lang, 'save')}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <path d="M17 21v-8H7v8" />
        <path d="M7 3v5h8" />
      </svg>
    </button>
  </form>
</Fenster>

<style>
  .zeile-gegen { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .5rem; margin-bottom: .4rem; }
  fieldset { border: none; border-top: 1px solid var(--border); padding: 1rem 0 .25rem; margin: 0; min-width: 0; }
  fieldset:first-of-type { border-top: none; padding-top: 0; }
  legend { font-size: .875rem; font-weight: 600; padding: 0 .5rem 0 0; margin-bottom: .5rem; float: left; width: 100%; }
  legend + .raster { clear: both; }
  .raster { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem .75rem; }
  .feld.voll { grid-column: 1 / -1; }
  .notiz { min-height: 1.1rem; margin-top: .125rem; }
  .aktionen { display: flex; gap: .5rem; justify-content: space-between; align-items: center; flex-wrap: wrap; margin-top: 1rem; }
  /* Speichern als Symbol: schwebt rechts neben dem Fenster und bleibt beim Scrollen sichtbar */
  .speichern-schwebend { position: fixed; z-index: 150; right: 1rem; bottom: 1rem; width: 3rem; height: 3rem; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: 0; background: var(--primary); color: var(--primary-fg, #fff); box-shadow: 0 4px 14px rgba(0, 0, 0, .3); cursor: pointer; }
  .speichern-schwebend:hover { filter: brightness(1.08); }
  .speichern-schwebend:disabled { opacity: .6; cursor: wait; }
  .speichern-schwebend:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
  /* Breite Fenster: das Symbol steht direkt rechts neben dem Fenster (720 px breit, mittig) */
  @media (min-width: 820px) { .speichern-schwebend { right: auto; bottom: auto; top: 50%; left: calc(50% + 380px); transform: translateY(-50%); } }
  .rechts { display: inline-flex; gap: .5rem; margin-left: auto; }
  /* Symbole zur Auswahl von Bauart und Art des Anhängers */
  /* Symbole nebeneinander, bis die Zeile voll ist; dann umbrechen */
  /* Bauart-Optionen nebeneinander, bis der Platz nicht mehr reicht, dann in der nächsten Zeile */
  .symbole { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: .5rem; }
  .symbol-knopf { flex: 0 0 96px; }
  .symbol-knopf { --deck: var(--bg-card);
    display: flex; flex-direction: column; align-items: center; gap: .25rem; padding: .5rem .25rem;
    background: var(--bg-card); color: var(--fg-muted); border: 1px solid var(--border); border-radius: var(--radius-sm);
    font-family: inherit; font-size: .75rem; cursor: pointer; transition: all .15s;
  }
  .symbol-knopf svg, .symbol-knopf .sym-bild { width: 48px; height: 48px; }
  .symbol-knopf .sym-bild { object-fit: contain; }
  .symbol-knopf:hover { border-color: var(--primary); color: var(--fg); }
  .symbol-knopf.aktiv { border-color: var(--primary); color: var(--primary); background: var(--primary-bg); font-weight: 600; }
  .symbol-knopf:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  .foto { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; padding-bottom: 1rem; margin-bottom: .25rem; border-bottom: 1px solid var(--border); }
  .foto-titel { font-size: .875rem; font-weight: 600; margin-right: .5rem; }
  /* Bauart und Farbe in einer Zeile: die Farbe rechts daneben */
  /* Farbpaare: nebeneinander unter der Bauart; immer nur eines gewählt (heller und dunkler Anteil je zur Hälfte) */
  .farbwahl { min-height: 2.5rem; }
  .paare { display: flex; flex-wrap: wrap; gap: .5rem; }
  .paar { width: 2.5rem; height: 2.5rem; border-radius: 999px; border: 1px solid var(--border); padding: 0; cursor: pointer; }
  .paar:hover { border-color: var(--fg-muted); }
  .paar.aktiv { box-shadow: 0 0 0 2px var(--bg-card), 0 0 0 4px var(--primary); }
  .paar:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
  @media (max-width: 520px) { .raster { grid-template-columns: 1fr; } }
</style>
