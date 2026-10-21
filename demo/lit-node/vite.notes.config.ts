import path from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The notes view of the PACK1 example (the own-catalog consumer: no optional component) as one
// self-contained document, served as an MCP App resource. The example's source is reused as it is.
// Run from `demo/lit-node`.
export default defineConfig({
  root: path.resolve('../../examples/pack1-consumer'),
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: path.resolve('dist/notes'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: path.resolve('../../examples/pack1-consumer/own.html'),
    },
  },
});
