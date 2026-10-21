import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lays out the Web host next to the bundle `rspeedy build` emitted: the Lynx Web runtime from the
// pinned `@lynx-js/web-core` (its production client, styles and wasm, exactly as published), and a
// page that mounts the bundle in a `<lynx-view>`.

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const dist = path.join(appRoot, 'dist');
const require = createRequire(import.meta.url);

// `client.prod.js` is published at `<static>/js/client.js`. It loads its chunks and wasm from `/static/...`,
// so the directory is served under that name.
const clientJs = require.resolve('@lynx-js/web-core/client.prod.js');
const staticDir = path.dirname(path.dirname(clientJs));
const target = path.join(dist, 'static');
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(staticDir, target, { recursive: true });

fs.writeFileSync(
  path.join(dist, 'index.html'),
  fs.readFileSync(path.join(appRoot, 'host', 'index.html')),
);
console.log(
  `web-core runtime copied from ${path.relative(appRoot, staticDir)}`,
);
