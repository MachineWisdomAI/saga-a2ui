import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the test-only lifecycle probe as one self-contained HTML document
// (dist/view-lifecycle/index.html), mounted in the local host fixture's sandboxed iframe like a
// server's `ui://` resource. It is never part of an app or view bundle.
export default defineConfig({
  root: 'e2e/view-lifecycle',
  plugins: [viteSingleFile()],
  build: {
    outDir: '../../dist/view-lifecycle',
    emptyOutDir: true,
    target: 'es2022',
  },
});
