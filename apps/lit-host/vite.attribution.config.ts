import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Builds the test-only page that shows the React SagaAttribution in an own-catalog application's
// footer (dist/attribution). React is built as its development build on purpose, so Strict Mode's
// extra setup and cleanup run. Never part of an app or view bundle.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'e2e/attribution',
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  build: {
    outDir: '../../dist/attribution',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    rollupOptions: {
      input: { index: path.join(here, 'e2e/attribution/index.html') },
    },
  },
});
