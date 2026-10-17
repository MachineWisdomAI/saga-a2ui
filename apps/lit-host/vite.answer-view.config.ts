import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the answer MCP Apps view as one self-contained HTML document
// (dist/answer-view/answer.html), served unchanged as the `ui://` resource.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist/answer-view',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: 'answer.html' },
  },
});
