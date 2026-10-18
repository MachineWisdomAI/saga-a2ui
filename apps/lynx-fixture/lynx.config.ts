import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';
import { defineConfig } from '@lynx-js/rspeedy';

// The Web target only. A native bundle would need a native Lynx runtime that this repository does
// not run, so building one would qualify nothing. Output stays unminified so the main-thread and
// background partition can be inspected by name (`e2e/partition.spec.ts`).
export default defineConfig({
  source: { entry: { main: './src/index.tsx' } },
  plugins: [pluginReactLynx()],
  environments: { web: {} },
  output: { minify: false, filenameHash: false },
  tools: {
    rspack: {
      // `@saga-a2ui/core` is consumed from source, and its modules import siblings as `./x.js`.
      resolve: { extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } },
    },
  },
});
