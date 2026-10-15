import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the player MCP Apps view as one self-contained HTML document
// (dist/playback-view/playback.html), served unchanged as the `ui://` resource.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist/playback-view',
    emptyOutDir: true,
    target: 'es2022', // the view uses top-level await
    rollupOptions: { input: 'playback.html' },
  },
});
