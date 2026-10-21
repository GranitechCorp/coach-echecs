import { defineConfig } from 'vite';

// base relative : l'appli marche aussi bien à la racine que sous /coach-echecs/ (GitHub Pages)
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
