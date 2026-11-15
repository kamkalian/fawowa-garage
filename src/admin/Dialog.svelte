<script>
  import { onMount } from 'svelte';

  // Fenster nach den Design-Regeln: Esc und Klick auf den Hintergrund schließen, role="dialog"
  let { titel, onclose, children } = $props();
  const id = `dialog-${Math.random().toString(36).slice(2, 8)}`;
  let overlay;

  onMount(() => {
    const vorher = document.activeElement;
    const taste = (e) => { if (e.key === 'Escape') onclose(); };
    window.addEventListener('keydown', taste);
    return () => { window.removeEventListener('keydown', taste); vorher?.focus?.(); };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="modal-overlay" bind:this={overlay} onmousedown={(e) => { if (e.target === overlay) onclose(); }}>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby={id}>
    <div class="kopf">
      <h2 {id}>{titel}</h2>
      <button type="button" class="btn btn-ghost btn-icon" aria-label="Schließen" onclick={onclose}>×</button>
    </div>
    {@render children()}
  </div>
</div>

<style>
  .kopf { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
  h2 { font-size: 1.0625rem; font-weight: 600; }
  :global(.dialog-aktionen) { display: flex; gap: .5rem; justify-content: flex-end; margin-top: 1rem; }
</style>
