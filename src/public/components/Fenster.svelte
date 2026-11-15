<script>
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.js';

  // Fenster nach den Design-Regeln (7.9): Schließen mit Esc, Klick auf den Hintergrund oder ×; role="dialog"
  let { lang, titel, breit = false, onclose, children } = $props();
  const id = `fenster-${Math.random().toString(36).slice(2, 8)}`;
  let overlay;

  onMount(() => {
    const vorher = document.activeElement;
    const taste = (e) => { if (e.key === 'Escape') onclose(); };
    window.addEventListener('keydown', taste);
    overlay.querySelector('input, select, textarea, button.btn-primary')?.focus();
    return () => {
      window.removeEventListener('keydown', taste);
      vorher?.focus?.();
    };
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="modal-overlay" bind:this={overlay} onmousedown={(e) => { if (e.target === overlay) onclose(); }}>
  <div class="modal" class:breit role="dialog" aria-modal="true" aria-labelledby={id}>
    <div class="modal-head">
      <h2 {id}>{titel}</h2>
      <button type="button" class="btn btn-ghost btn-icon" aria-label={t(lang, 'close')} onclick={onclose}>×</button>
    </div>
    {@render children()}
  </div>
</div>

<style>
  .breit { max-width: 720px; }
</style>
