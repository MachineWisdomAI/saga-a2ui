import path from 'node:path';
import { defineConfig } from 'vite';

// The server is bundled for Node into dist/server.mjs. The SAGA packages ship TypeScript source,
// which Node does not load from node_modules. Bundle dependencies so the server is self-contained.
export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: path.resolve('server/main.ts'),
    outDir: 'dist',
    emptyOutDir: false, // the view build wrote dist/index.html; keep it
    minify: false,
    target: 'es2022',
    rollupOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
});
