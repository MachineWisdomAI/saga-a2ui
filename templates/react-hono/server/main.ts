import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mayViewAccount } from './authorization.js';
import { startListener } from './listener.js';
import { verifier } from './verifier.js';

// The server entry. It reads the built view before it opens a port, so a missing build stops the
// process instead of serving a listener without its view. `npm run build` writes the view beside
// this file; `npm start` runs it.
const html = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
  'utf8',
);
const listener = await startListener({
  html,
  verifier,
  authorize: mayViewAccount,
  port: Number(process.env.PORT ?? 3000),
});

console.log(`Public status endpoint: ${listener.statusUrl}`);
console.log(
  `Protected account endpoint (every credential is refused until you replace server/verifier.ts): ${listener.accountUrl}`,
);

// Stop both MCP handlers and every HTTP exchange before allowing Node to exit.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void listener.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
