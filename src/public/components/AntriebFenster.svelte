<script>
  import Fenster from './Fenster.svelte';
  import { t, pick } from '../lib/i18n.js';
  import { MOTOR_ARTEN } from '../../shared/antrieb.js';

  // Motoren und Akkus eines Fahrrads oder Anhängers; beliebig viele je Fahrzeug.
  // onsave({ motoren, akkus }) speichert und schließt das Fenster; wirft es einen Fehler, bleibt das Fenster offen.
  let { lang, eintrag, onsave, onclose } = $props();

  // Der Startwert wird beim Öffnen übernommen; das Fenster wird für jedes Fahrzeug neu erzeugt
  // svelte-ignore state_referenced_locally
  let motoren = $state((eintrag.motoren ?? []).map(m => ({ motor_art: m.motor_art, leistung_w: m.leistung_w })));
  // svelte-ignore state_referenced_locally
  let akkus = $state((eintrag.akkus ?? []).map(a => ({ kapazitaet_wh: a.kapazitaet_wh })));
  let laeuft = $state(false);

  const titel = $derived(pick({ de: 'Motoren und Akkus', en: 'Motors and batteries' }, lang));

  async function senden(e) {
    e.preventDefault();
    if (laeuft) return;
    laeuft = true;
    try {
      await onsave({
        motoren: motoren.map(m => ({ motor_art: m.motor_art, leistung_w: m.leistung_w === '' ? null : m.leistung_w })),
        akkus: akkus.map(a => ({ kapazitaet_wh: a.kapazitaet_wh }))
      });
    } finally {
      laeuft = false;
    }
  }
</script>

<Fenster {lang} {titel} {onclose}>
  <form class="antrieb" onsubmit={senden} novalidate>
    <p class="hinweis">{pick({ de: 'Leistung in Watt, Kapazität in Wh. Ein Fahrzeug kann mehrere Motoren und Akkus haben. Ohne Motor erscheint kein Blitz-Symbol.', en: 'Power in watts, capacity in Wh. A vehicle can have several motors and batteries. Without a motor no lightning symbol is shown.' }, lang)}</p>

    <h3 class="abschnitt">{pick({ de: 'Motoren', en: 'Motors' }, lang)}</h3>
    {#each motoren as m, i (i)}
      <div class="reihe">
        <select class="input" aria-label={pick({ de: 'Motorart', en: 'Motor type' }, lang)} bind:value={m.motor_art}>
          {#each MOTOR_ARTEN as o (o.wert)}<option value={o.wert}>{pick(o, lang)}</option>{/each}
        </select>
        <input class="input" type="number" min="0" max="20000" step="1" inputmode="numeric"
          aria-label={pick({ de: 'Leistung in Watt', en: 'Power in watts' }, lang)} placeholder="W" bind:value={m.leistung_w} />
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => (motoren = motoren.filter((_, k) => k !== i))}>
          {pick({ de: 'Entfernen', en: 'Remove' }, lang)}
        </button>
      </div>
    {/each}
    <button type="button" class="btn btn-outline btn-sm" onclick={() => (motoren = [...motoren, { motor_art: 'mittelmotor', leistung_w: null }])}>
      {pick({ de: '+ Motor', en: '+ Motor' }, lang)}
    </button>

    <h3 class="abschnitt">{pick({ de: 'Akkus', en: 'Batteries' }, lang)}</h3>
    {#each akkus as a, i (i)}
      <div class="reihe">
        <input class="input" type="number" min="1" max="10000" step="1" inputmode="numeric"
          aria-label={pick({ de: 'Kapazität in Wh', en: 'Capacity in Wh' }, lang)} placeholder="Wh" bind:value={a.kapazitaet_wh} />
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => (akkus = akkus.filter((_, k) => k !== i))}>
          {pick({ de: 'Entfernen', en: 'Remove' }, lang)}
        </button>
      </div>
    {/each}
    <button type="button" class="btn btn-outline btn-sm" onclick={() => (akkus = [...akkus, { kapazitaet_wh: null }])}>
      {pick({ de: '+ Akku', en: '+ Battery' }, lang)}
    </button>

    <div class="aktionen">
      <button type="button" class="btn btn-ghost" onclick={onclose}>{t(lang, 'cancel')}</button>
      <button type="submit" class="btn btn-primary" disabled={laeuft}>{laeuft ? t(lang, 'saving') : t(lang, 'save')}</button>
    </div>
  </form>
</Fenster>

<style>
  .hinweis { font-size: .8125rem; color: var(--fg-muted); margin-bottom: .75rem; }
  .abschnitt { font-size: .9375rem; margin: .75rem 0 .375rem; }
  .reihe { display: grid; grid-template-columns: minmax(0, 1fr) 6rem auto; gap: .5rem; align-items: center; margin-bottom: .5rem; }
  .reihe:has(> select) { grid-template-columns: minmax(0, 1fr) 6rem auto; }
  .reihe:not(:has(> select)) { grid-template-columns: minmax(0, 1fr) auto; }
  .aktionen { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
</style>
