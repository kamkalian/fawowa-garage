import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: '.',
  plugins: [svelte()],
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': 'http://localhost:3470'
    }
  }
});
