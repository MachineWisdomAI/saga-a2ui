import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the test-only probes of the own-catalog entry of the two stacks as self-contained HTML
// documents (dist/view-stack/react.html and lit.html), each mounted in the local host fixture's
// sandboxed iframe like a server's `ui://` resource. `STACK` selects the page. React is built as its
// development build, as the other React consumers here are. Never part of an app or view bundle.
const stack = process.env.STACK === 'lit' ? 'lit' : 'react';

export default defineConfig({
  root: 'e2e/view-stack',
  plugins: [viteSingleFile()],
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  build: {
    outDir: '../../dist/view-stack',
    emptyOutDir: false,
    target: 'es2022',
    minify: true, // the bridge package's comments name the credential header the bundle spec forbids
    rollupOptions: { input: `e2e/view-stack/${stack}.html` },
  },
});
