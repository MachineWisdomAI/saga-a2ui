import { defineConfig } from 'vite';

// Builds the test-only page that shows a FaithfulCard beside an application-authored protected
// control in one surface (dist/card-workflow). It is never part of an app or view bundle.
export default defineConfig({
  root: 'e2e/card-workflow',
  base: './',
  build: {
    outDir: '../../dist/card-workflow',
    emptyOutDir: true,
    target: 'es2022',
  },
});
