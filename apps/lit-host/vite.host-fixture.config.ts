import { defineConfig } from 'vite';

// Builds the test-only local host page (dist/host-fixture). It is never part of the app or
// the view bundle.
export default defineConfig({
  root: 'e2e/host-fixture',
  base: './',
  build: {
    outDir: '../../dist/host-fixture',
    emptyOutDir: true,
    target: 'es2022',
  },
});
