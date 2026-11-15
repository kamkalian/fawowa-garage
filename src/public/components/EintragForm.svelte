<script>
  import { ARTEN, GRUPPEN } from '../../../lib/felder.js';
  import { t, pick } from '../lib/i18n.js';
  import { ApiFehler } from '../lib/api.js';
  import Fenster from './Fenster.svelte';

  // Formular für Fahrrad, Anhänger und Gespann; die Felder kommen aus lib/felder.js.
  // onsave(werte) legt an oder ändert und wirft bei Fehlern einen ApiFehler.
  let { lang, art, eintrag = null, daten, onsave, onclose } = $props();

  // Das Formular wird für genau einen Eintrag geöffnet und danach geschlossen: Art und Anfangswerte werden nur einmal gelesen
  // svelte-ignore state_referenced_locally
  const cfg = ARTEN[art];
  // svelte-ignore state_referenced_locally
  const werte = $state(Object.fromEntries(cfg.felder.map(f => [f.key, eintrag?.[f.key] ?? (f.typ === 'zahl' || f.typ === 'ganzzahl' || f.typ === 'verweis' ? null : '')])));
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

  const optionenFuer = (f) => (daten[f.verweis] ?? []);

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
      await onsave({ ...werte });
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
    {#each gruppen as g (g.key)}
      <fieldset>
        <legend>{pick(GRUPPEN[g.key], lang)}</legend>
        <div class="raster">
          {#each g.felder as f (f.key)}
            <div class="feld" class:voll={f.typ === 'langtext' || f.typ === 'verweis' || f.key === 'name'}>
              <label for="f-{f.key}">{pick(f.label, lang) + (f.einheit ? ` (${f.einheit})` : '') + (f.pflicht ? ' *' : '')}</label>
              {#if f.typ === 'text'}
                <input id="f-{f.key}" class="input" type="text" maxlength={f.max} aria-invalid={!!fehler[f.key]} aria-describedby="h-{f.key}" bind:value={werte[f.key]} />
              {:else if f.typ === 'langtext'}
                <textarea id="f-{f.key}" class="input" rows="3" maxlength={f.max} aria-invalid={!!fehler[f.key]} aria-describedby="h-{f.key}" bind:value={werte[f.key]}></textarea>
              {:else if f.typ === 'zahl' || f.typ === 'ganzzahl'}
                <input id="f-{f.key}" class="input" type="number" inputmode={f.typ === 'zahl' ? 'decimal' : 'numeric'}
                  min={f.min} max={f.max} step={f.typ === 'zahl' ? 'any' : 1} aria-invalid={!!fehler[f.key]} aria-describedby="h-{f.key}" bind:value={werte[f.key]} />
              {:else if f.typ === 'auswahl'}
                <select id="f-{f.key}" class="input" aria-invalid={!!fehler[f.key]} aria-describedby="h-{f.key}" bind:value={werte[f.key]}>
                  <option value="">–</option>
                  {#each f.optionen as o (o.wert)}<option value={o.wert}>{pick(o, lang)}</option>{/each}
                </select>
              {:else if f.typ === 'verweis'}
                <select id="f-{f.key}" class="input" aria-invalid={!!fehler[f.key]} aria-describedby="h-{f.key}" bind:value={werte[f.key]}>
                  <option value={null}>{t(lang, 'choose')}</option>
                  {#each optionenFuer(f) as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
                </select>
              {/if}
              <p id="h-{f.key}" class="notiz" class:fehler={!!fehler[f.key]}>{fehler[f.key] ? fehlerText(f) : f.hinweis ? pick(f.hinweis, lang) : ''}</p>
            </div>
          {/each}
        </div>
      </fieldset>
    {/each}

    {#if eintrag}<p class="notiz">{t(lang, 'formResetNote')}</p>{/if}
    {#if allgemein}<p class="fehler" role="alert">{allgemein}</p>{/if}

    <div class="aktionen">
      <button type="button" class="btn btn-ghost" onclick={onclose}>{t(lang, 'cancel')}</button>
      <button type="submit" class="btn btn-primary" disabled={laeuft}>{laeuft ? t(lang, 'saving') : t(lang, 'save')}</button>
    </div>
  </form>
</Fenster>

<style>
  fieldset { border: none; border-top: 1px solid var(--border); padding: 1rem 0 .25rem; margin: 0; min-width: 0; }
  fieldset:first-of-type { border-top: none; padding-top: 0; }
  legend { font-size: .875rem; font-weight: 600; padding: 0 .5rem 0 0; margin-bottom: .5rem; float: left; width: 100%; }
  legend + .raster { clear: both; }
  .raster { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .5rem .75rem; }
  .feld.voll { grid-column: 1 / -1; }
  .notiz { min-height: 1.1rem; margin-top: .125rem; }
  .aktionen { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
  @media (max-width: 520px) { .raster { grid-template-columns: 1fr; } }
</style>
