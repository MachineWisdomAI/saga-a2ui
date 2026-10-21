import { defineConfig } from 'vite';

// Builds the test-only page that mounts two application-owned catalogs together
// (dist/catalog-isolation). It is never part of an app or view bundle.
export default defineConfig({
  root: 'e2e/catalog-isolation',
  base: './',
  build: {
    outDir: '../../dist/catalog-isolation',
    emptyOutDir: true,
    target: 'es2022',
  },
});
