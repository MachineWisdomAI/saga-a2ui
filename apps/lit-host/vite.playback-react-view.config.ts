import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds the React player MCP Apps view as one self-contained HTML document
// (dist/playback-react-view/playback-react.html), served unchanged as the `ui://` resource.
//
// React and the JSX transform are pinned to their production forms whatever NODE_ENV the build
// runs under (the headless suite builds under NODE_ENV=test): the development JSX transform embeds
// each source file's absolute path, which would make the bytes depend on where the build ran.
// Strict Mode's extra setup and cleanup exist only in React's development build, so the control's
// behavior under it is qualified headlessly (src/react/play-control.test.ts), not through this file.
export default defineConfig({
  plugins: [viteSingleFile()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  oxc: { jsx: { development: false } },
  build: {
    outDir: 'dist/playback-react-view',
    emptyOutDir: true,
    target: 'es2022', // the view uses top-level await
    rollupOptions: { input: 'playback-react.html' },
  },
});
