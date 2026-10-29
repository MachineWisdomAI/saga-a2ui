import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startListener } from './listener.js';

// The server entry. It reads the built view before it opens a port, so a missing build stops the
// process instead of serving a listener without its view. `npm run build` writes the view beside
// this file; `npm start` runs it.
const html = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
  'utf8',
);
const listener = await startListener({
  html,
  port: Number(process.env.PORT ?? 3000),
});

console.log(`Tic-tac-toe MCP endpoint: ${listener.url}`);

// Stop the MCP handler and every HTTP exchange before allowing Node to exit.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void listener.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
