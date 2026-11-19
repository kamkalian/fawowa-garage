<script>
  import { pick } from '../lib/i18n.js';
  import { AKKU_CHEMIE } from '../../../lib/akku.js';

  // Assistent für einen Akku: fragt Zellchemie, Zellen in Reihe und parallel, Kapazität und Weiteres ab.
  // Über Knöpfe oder ein Textfeld. Ergebnis: Werte für den Akku, die die Rechnung der Reichweite braucht.
  let { lang, start = {}, onfertig, onabbrechen } = $props();
  const p = (de, en) => pick({ de, en }, lang);

  const CHEMIE = [
    { wert: 'nmc', name: 'NMC', hinweis: p('Üblich bei E-Bike-Akkus (18650/21700)', 'Common in e-bike packs (18650/21700)') },
    { wert: 'lfp', name: 'LFP', hinweis: p('Lithium-Eisenphosphat, sehr langlebig, niedrigere Spannung', 'Lithium iron phosphate, very long-lived, lower voltage') },
    { wert: 'nca', name: 'NCA', hinweis: p('Hohe Energiedichte', 'High energy density') },
    { wert: 'lto', name: 'LTO', hinweis: p('Sehr schnellladefest, geringe Energiedichte', 'Very fast-charge tolerant, low energy density') },
    { wert: null, name: p('Weiß ich nicht', "Don't know"), hinweis: p('Dann wird NMC angenommen', 'NMC is assumed') }
  ];
  const ZELLEN = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const PARALLEL = [1, 2, 3, 4];
  const AH = [4, 6, 8, 10, 12, 15, 20];
  const SCHRITTE = [p('Zellchemie', 'Cell chemistry'), p('Zellen in Reihe', 'Cells in series'), p('Parallel', 'In parallel'), p('Kapazität', 'Capacity'), p('Weiteres', 'More'), p('Ergebnis', 'Result')];

  const zahlOderNull = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  let schritt = $state(0);
  let chemie = $state(start.chemie ?? 'nmc');
  let s = $state(start.zellen_s ?? 10);
  let parallel = $state(start.zellen_p ?? 1);
  let voltText = $state('');
  let eingabe = $state('ah');        // 'ah' oder 'wh'
  let ahText = $state(start.ah ?? '');
  let whText = $state(start.kapazitaet_wh ?? '');
  let schlussText = $state(start.schluss_v ?? '');
  let stromText = $state(start.max_strom_a ?? '');

  const zelle = $derived(AKKU_CHEMIE[chemie] ?? AKKU_CHEMIE.nmc);
  const vNom = $derived(s * zelle.nenn_v);
  const vVoll = $derived(s * zelle.voll_v);
  const ah = $derived(eingabe === 'ah' ? zahlOderNull(ahText) : (zahlOderNull(whText) ? zahlOderNull(whText) / vNom : null));
  const wh = $derived(ah ? ah * vNom : null);
  const schluss = $derived(zahlOderNull(schlussText) ?? zelle.schluss_v);
  const strom = $derived(zahlOderNull(stromText));
  const schlussOk = $derived(schlussText === '' || (schluss >= 1 && schluss <= 4.5));
  const stromOk = $derived(stromText === '' || (strom !== null && strom <= 2000));

  const gueltig = $derived(
    schritt === 1 ? Number.isInteger(s) && s >= 2 && s <= 40
    : schritt === 2 ? Number.isInteger(parallel) && parallel >= 1 && parallel <= 20
    : schritt === 3 ? ah !== null && ah <= 1000
    : schritt === 4 ? schlussOk && stromOk
    : true
  );

  /** Spannung in V eingegeben: Zellzahl so wählen, dass die Nennspannung am nächsten liegt */
  function voltSetzen(v) {
    voltText = v;
    const n = zahlOderNull(v);
    if (n) s = Math.max(2, Math.min(40, Math.round(n / zelle.nenn_v)));
  }

  function fertig() {
    onfertig({
      chemie, zellen_s: s, zellen_p: parallel, ah: Math.round(ah * 100) / 100,
      kapazitaet_wh: Math.round(wh), spannung_v: Math.round(vNom),
      schluss_v: schlussText === '' ? null : schluss, max_strom_a: stromText === '' ? null : strom
    });
  }
</script>

<div class="assistent">
  <p class="schritt-kopf">{p('Schritt', 'Step')} {schritt + 1} / 6: <strong>{SCHRITTE[schritt]}</strong></p>

  {#if schritt === 0}
    <div class="wahl-gruppe" role="radiogroup" aria-label={SCHRITTE[0]}>
      {#each CHEMIE as c (c.wert)}
        <button type="button" role="radio" class="wahl" aria-checked={chemie === c.wert} onclick={() => (chemie = c.wert)}>
          <strong>{c.name}</strong><span>{c.hinweis}</span>
        </button>
      {/each}
    </div>
  {:else if schritt === 1}
    <div class="wahl-gruppe kompakt" role="radiogroup" aria-label={p('Zellen in Reihe', 'Cells in series')}>
      {#each ZELLEN as z (z)}
        <button type="button" role="radio" class="wahl klein" aria-checked={s === z} onclick={() => { s = z; voltText = ''; }}>{z}s</button>
      {/each}
    </div>
    <label class="feld">{p('Oder Nennspannung in Volt', 'Or nominal voltage in volts')}
      <input class="input" type="text" inputmode="decimal" placeholder="V" value={voltText} oninput={(e) => voltSetzen(e.currentTarget.value)} />
    </label>
    <p class="ergebnis">{s}s = {vNom.toFixed(1)} V {p('nominal', 'nominal')} · {vVoll.toFixed(1)} V {p('voll geladen', 'fully charged')}</p>
  {:else if schritt === 2}
    <div class="wahl-gruppe kompakt" role="radiogroup" aria-label={p('Parallel', 'In parallel')}>
      {#each PARALLEL as q (q)}
        <button type="button" role="radio" class="wahl klein" aria-checked={parallel === q} onclick={() => (parallel = q)}>{q}p</button>
      {/each}
    </div>
    <label class="feld">{p('Anzahl parallel (andere Zahl)', 'Number in parallel (other value)')}
      <input class="input" type="number" min="1" max="20" step="1" inputmode="numeric" bind:value={parallel} />
    </label>
    <p class="ergebnis">{s}s{parallel}p · {vNom.toFixed(1)} V</p>
  {:else if schritt === 3}
    <div class="gruppe">
      <button type="button" class="btn btn-ghost btn-sm" aria-pressed={eingabe === 'ah'} onclick={() => (eingabe = 'ah')}>Ah</button>
      <button type="button" class="btn btn-ghost btn-sm" aria-pressed={eingabe === 'wh'} onclick={() => (eingabe = 'wh')}>Wh</button>
    </div>
    {#if eingabe === 'ah'}
      <div class="wahl-gruppe kompakt">
        {#each AH as a (a)}
          <button type="button" class="wahl klein" aria-checked={ahText == a} onclick={() => (ahText = a)}>{a} Ah</button>
        {/each}
      </div>
      <label class="feld">{p('Kapazität des Akkus in Ah', 'Capacity of the battery in Ah')}
        <input class="input" type="text" inputmode="decimal" placeholder="Ah" bind:value={ahText} />
      </label>
    {:else}
      <label class="feld">{p('Energie des Akkus in Wh', 'Energy of the battery in Wh')}
        <input class="input" type="text" inputmode="decimal" placeholder="Wh" bind:value={whText} />
      </label>
    {/if}
    <p class="ergebnis">{ah ? `${ah.toFixed(1)} Ah · ${Math.round(wh)} Wh` : p('Bitte eine Kapazität angeben', 'Please enter a capacity')}</p>
  {:else if schritt === 4}
    <label class="feld">{p('Entladeschluss je Zelle in Volt (BMS)', 'Discharge cut-off per cell in volts (BMS)')}
      <input class="input" type="text" inputmode="decimal" placeholder={String(zelle.schluss_v)} bind:value={schlussText} />
    </label>
    <p class="notiz">{p('Leer lassen: üblich für die Chemie', 'Leave empty: usual for this chemistry')} ({zelle.schluss_v} V). {p('Ein höherer Wert schaltet früher ab.', 'A higher value cuts off earlier.')}</p>
    <label class="feld">{p('Höchster Dauerstrom in A (optional)', 'Maximum continuous current in A (optional)')}
      <input class="input" type="text" inputmode="decimal" placeholder="A" bind:value={stromText} />
    </label>
    <p class="notiz">{p('Begrenzt die Motorleistung, wenn der Akku nicht mehr Strom liefern kann.', 'Limits the motor power if the battery cannot deliver more current.')}</p>
  {:else}
    <dl class="zusammen">
      <dt>{p('Zellchemie', 'Chemistry')}</dt><dd>{chemie ? zelle.name : p('unbekannt (NMC angenommen)', 'unknown (NMC assumed)')}</dd>
      <dt>{p('Zellen', 'Cells')}</dt><dd>{s}s{parallel}p</dd>
      <dt>{p('Nennspannung', 'Nominal voltage')}</dt><dd>{vNom.toFixed(1)} V</dd>
      <dt>{p('Ladeschluss', 'Full charge')}</dt><dd>{vVoll.toFixed(1)} V</dd>
      <dt>{p('Kapazität', 'Capacity')}</dt><dd>{ah.toFixed(1)} Ah · {Math.round(wh)} Wh</dd>
      <dt>{p('Abschaltung (BMS)', 'Cut-off (BMS)')}</dt><dd>{schluss.toFixed(2)} V {p('je Zelle', 'per cell')} · {(schluss * s).toFixed(1)} V {p('gesamt', 'in total')}</dd>
    </dl>
    <p class="notiz">{p('Die Rechnung zieht nur die nutzbare Energie ab: der Akku schaltet je nach Last früher ab.', 'The calculation only counts the usable energy: the battery cuts off earlier depending on the load.')}</p>
  {/if}

  <div class="fuss">
    <button type="button" class="btn btn-ghost btn-sm" onclick={() => (schritt === 0 ? onabbrechen() : (schritt -= 1))}>
      {schritt === 0 ? p('Abbrechen', 'Cancel') : p('Zurück', 'Back')}
    </button>
    {#if schritt < 5}
      <button type="button" class="btn btn-primary btn-sm" disabled={!gueltig} onclick={() => (schritt += 1)}>{p('Weiter', 'Next')}</button>
    {:else}
      <button type="button" class="btn btn-primary btn-sm" onclick={fertig}>{p('Übernehmen', 'Apply')}</button>
    {/if}
  </div>
</div>

<style>
  .assistent { display: flex; flex-direction: column; gap: .6rem; }
  .schritt-kopf { font-size: .8125rem; color: var(--fg-muted); margin: 0; }
  .wahl-gruppe { display: grid; gap: .4rem; grid-template-columns: 1fr; }
  .wahl-gruppe.kompakt { grid-template-columns: repeat(auto-fill, minmax(4.25rem, 1fr)); }
  .wahl { display: flex; flex-direction: column; align-items: flex-start; gap: .15rem; text-align: left; padding: .5rem .6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: inherit; cursor: pointer; font: inherit; }
  .wahl span { font-size: .75rem; color: var(--fg-muted); }
  .wahl.klein { align-items: center; padding: .4rem; }
  .wahl[aria-checked='true'] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .feld { display: flex; flex-direction: column; gap: .25rem; font-size: .875rem; }
  .gruppe { display: flex; gap: .4rem; }
  .ergebnis { font-size: .875rem; margin: 0; }
  .notiz { font-size: .8125rem; color: var(--fg-muted); margin: 0; }
  .zusammen { display: grid; grid-template-columns: auto 1fr; gap: .3rem .9rem; margin: 0; font-size: .875rem; }
  .zusammen dt { color: var(--fg-muted); }
  .zusammen dd { margin: 0; font-weight: 600; }
  .fuss { display: flex; justify-content: space-between; gap: .5rem; margin-top: .4rem; }
</style>
