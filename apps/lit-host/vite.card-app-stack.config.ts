import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the test-only probes of the two card application stacks as self-contained HTML documents
// (dist/card-app-stack/react.html and lit.html), each mounted in the local host fixture's sandboxed
// iframe like a server's `ui://` resource. `STACK` selects the page. React is built as its
// development build, as the other React consumers here are. Never part of an app or view bundle.
const stack = process.env.STACK === 'lit' ? 'lit' : 'react';

export default defineConfig({
  root: 'e2e/card-app-stack',
  plugins: [viteSingleFile()],
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  build: {
    outDir: '../../dist/card-app-stack',
    emptyOutDir: false,
    target: 'es2022',
    minify: false,
    rollupOptions: { input: `e2e/card-app-stack/${stack}.html` },
  },
});
