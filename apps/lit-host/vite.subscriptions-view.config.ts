import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the subscriptions MCP Apps view as one self-contained HTML document
// (dist/subscriptions-view/subscriptions.html), served unchanged as the `ui://` resource.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist/subscriptions-view',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: 'subscriptions.html' },
  },
});
