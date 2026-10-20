import path from 'node:path';
import { defineConfig } from 'vite';

// The server is bundled for Node into dist/server.mjs. The SAGA packages ship TypeScript source,
// which Node does not load from node_modules, so they are bundled in; every other dependency
// stays external and resolves from node_modules at run time.
export default defineConfig({
  ssr: { noExternal: [/^@saga-a2ui\//] },
  build: {
    ssr: path.resolve('server/main.ts'),
    outDir: 'dist',
    emptyOutDir: false, // the view build wrote dist/index.html; keep it
    minify: false,
    target: 'es2022',
    rollupOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
});
