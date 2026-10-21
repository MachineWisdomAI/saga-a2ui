import { defineConfig } from 'vite';

// Builds the test-only synthetic consumer of direct action attachment (dist/action-consumer):
// its own catalog with the opt-in ActionButton, two app elements and a trace the browser spec
// reads. It is never part of an app or view bundle.
export default defineConfig({
  root: 'e2e/action-consumer',
  base: './',
  build: {
    outDir: '../../dist/action-consumer',
    emptyOutDir: true,
    target: 'es2022',
  },
});
