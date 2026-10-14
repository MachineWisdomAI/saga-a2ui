import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the MCP Apps view as one self-contained HTML document (dist/view/view.html). The MCP
// server serves that file unchanged as the `ui://` resource. Run after the app build, which
// empties `dist/`.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist/view',
    emptyOutDir: true,
    target: 'es2022', // the view uses top-level await
    rollupOptions: { input: 'view.html' },
  },
});
