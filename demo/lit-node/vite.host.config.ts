import path from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The demonstration host page as one self-contained document, served by the demonstration's own
// server. It is never a view and never part of one. Run from `demo/lit-node`.
export default defineConfig({
  root: path.resolve('host'),
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: path.resolve('dist/host'),
    emptyOutDir: true,
    target: 'es2022',
  }, // the page awaits its configuration at the top level
});
