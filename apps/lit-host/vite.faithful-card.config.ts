import { defineConfig } from 'vite';

// Builds the test-only page that mounts several FaithfulCards, each in its own view, together
// with a catalog-bound card (dist/faithful-card). It is never part of an app or view bundle.
export default defineConfig({
  root: 'e2e/faithful-card',
  base: './',
  build: {
    outDir: '../../dist/faithful-card',
    emptyOutDir: true,
    target: 'es2022',
  },
});
