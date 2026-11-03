import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Builds the test-only pages that show the branded FaithfulCard in each renderer (dist/card-styling):
// one React page and one Lit page, each mounting the card through its public card surface with the
// same application stylesheet. React is built as its development build on purpose, so Strict Mode's
// extra setup and cleanup run. Never part of an app or view bundle.
const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'e2e/card-styling',
  base: './',
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  build: {
    outDir: '../../dist/card-styling',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    rollupOptions: {
      input: {
        react: path.join(here, 'e2e/card-styling/react.html'),
        lit: path.join(here, 'e2e/card-styling/lit.html'),
      },
    },
  },
});
