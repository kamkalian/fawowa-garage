<script>
  import { pick } from '../lib/i18n.js';
  import Fenster from './Fenster.svelte';

  // Checkliste der Garage: die Gegenstände aus dem Inventar und eigene Punkte. Jeder Punkt bekommt einen Haken.
  // Sind alle abgehakt, wird die Liste grün. Die Haken lassen sich alle auf einmal entfernen.
  let { lang, punkte = [], onumschalten, onanlegen, onentfernen, onzuruecksetzen, onschliessen } = $props();

  let neu = $state('');
  const alleErledigt = $derived(punkte.length > 0 && punkte.every((p) => p.gepackt));
  const hakenGesetzt = $derived(punkte.some((p) => p.gepackt));

  function hinzufuegen(e) {
    e.preventDefault();
    const text = neu.trim();
    if (!text) return;
    neu = '';
    onanlegen?.(text);
  }

  // Hängt das Fenster an den Seitenkörper, damit es über der Kopfleiste liegt
  function insBodyHaengen(node) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<div use:insBodyHaengen>
  <Fenster {lang} titel={pick({ de: 'Checkliste', en: 'Checklist' }, lang)} onclose={onschliessen}>
    <div class="liste" class:fertig={alleErledigt}>
      {#each punkte as p (p.key)}
        <div class="zeile">
          <label class="punkt">
            <input type="checkbox" checked={p.gepackt} onchange={() => onumschalten?.(p)} />
            <span class:erledigt={p.gepackt}>{p.name}</span>
          </label>
          {#if p.quelle === 'punkt'}
            <button type="button" class="weg" aria-label={pick({ de: 'Punkt löschen', en: 'Delete item' }, lang)} onclick={() => onentfernen?.(p)}>✕</button>
          {:else}
            <span class="herkunft">{pick({ de: 'aus dem Inventar', en: 'from the inventory' }, lang)}</span>
          {/if}
        </div>
      {:else}
        <p class="notiz">{pick({ de: 'Noch nichts auf der Liste. Unten kannst du Punkte hinzufügen.', en: 'Nothing on the list yet. Add items below.' }, lang)}</p>
      {/each}
    </div>

    <form class="neu" onsubmit={hinzufuegen}>
      <input class="input" type="text" maxlength="80" bind:value={neu}
        aria-label={pick({ de: 'Neuer Punkt', en: 'New item' }, lang)} placeholder={pick({ de: 'Neuer Punkt …', en: 'New item …' }, lang)} />
      <button type="submit" class="btn btn-outline btn-sm" disabled={!neu.trim()}>{pick({ de: 'Hinzufügen', en: 'Add' }, lang)}</button>
    </form>

    <div class="aktionen">
      <button type="button" class="btn btn-ghost btn-sm" disabled={!hakenGesetzt} onclick={() => onzuruecksetzen?.()}>
        {pick({ de: 'Alle Haken entfernen', en: 'Remove all ticks' }, lang)}
      </button>
    </div>
  </Fenster>
</div>

<style>
  .liste { display: flex; flex-direction: column; gap: .4rem; padding: .6rem; border: 1px solid var(--border); border-radius: var(--radius-sm); }
  /* Alles abgehakt: grün */
  .liste.fertig { border: 2px solid #22c55e; background: rgba(34, 197, 94, .15); }
  .zeile { display: flex; align-items: center; justify-content: space-between; gap: .5rem; }
  .punkt { display: flex; align-items: center; gap: .5rem; cursor: pointer; min-width: 0; }
  .erledigt { text-decoration: line-through; color: var(--fg-muted); }
  .herkunft { font-size: .75rem; color: var(--fg-muted); white-space: nowrap; }
  .weg { background: none; border: 0; color: var(--fg-muted); cursor: pointer; font: inherit; }
  .notiz { font-size: .8125rem; color: var(--fg-muted); margin: 0; }
  .neu { display: flex; gap: .5rem; margin-top: .75rem; }
  .neu .input { flex: 1; min-width: 0; }
  .aktionen { display: flex; justify-content: flex-end; margin-top: .75rem; }
</style>
