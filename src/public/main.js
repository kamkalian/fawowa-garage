import '../style.css';
import { mount } from 'svelte';
import App from './App.svelte';

const gespeichert = (() => {
  try { return localStorage.getItem('theme'); } catch { return null; }
})();
document.documentElement.dataset.theme = gespeichert === 'light' ? 'light' : 'dark';

mount(App, { target: document.getElementById('app') });
