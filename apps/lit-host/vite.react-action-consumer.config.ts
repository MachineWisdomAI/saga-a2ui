import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Builds the test-only React consumer of direct action attachment (dist/react-action-consumer):
// a real React root over the published @a2ui/react with the opt-in ActionButton and the public
// @saga-a2ui/react/actions exports. It is never part of an app or view bundle.
//
// React is built as its development build on purpose. Strict Mode's extra setup and cleanup, which
// the lifecycle claims depend on, only exist there. The installed package versions are read here and
// compiled in, so the browser spec asserts the identities this bundle was actually built from.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const versionOf = (name: string): string =>
  (
    JSON.parse(
      fs.readFileSync(
        path.join(root, 'node_modules', name, 'package.json'),
        'utf8',
      ),
    ) as { version: string }
  ).version;

export default defineConfig({
  root: 'e2e/react-action-consumer',
  base: './',
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
    __REACT_ACTION_CONSUMER_IDENTITIES__: JSON.stringify({
      '@a2ui/react': versionOf('@a2ui/react'),
      '@a2ui/web_core': versionOf('@a2ui/web_core'),
      react: versionOf('react'),
      'react-dom': versionOf('react-dom'),
      vite: versionOf('vite'),
      reactBuild: 'development',
    }),
  },
  build: {
    outDir: '../../dist/react-action-consumer',
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
  },
});
