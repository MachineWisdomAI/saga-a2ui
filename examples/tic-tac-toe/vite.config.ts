import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The view is one self-contained HTML document: an MCP host mounts the exact bytes the server
// serves, so nothing may load from a separate file. The server reads dist/index.html.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
