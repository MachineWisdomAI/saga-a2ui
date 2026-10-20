import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DemoConfigurationError, startDemo, type DemoViews } from './demo-server.js';

// The process entry of the downloaded demonstration (`npm start`). It reads every built page before
// it opens a port, so a missing page ends the process instead of serving a half-working demo.
//
//   PORT                                  the host page's port (default 3000; 0 picks a free one)
//   SAGA_DEMO_CAPABILITY_TTL_SECONDS      how long an issued media capability lives (default 60)
//   SAGA_DEMO_IMAGE_HOST                  an HTTPS host whose images descriptions may show (default none)
//   SAGA_DEMO_VIEWS_DIR                   where the built pages are (default: `views` beside this file)

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new DemoConfigurationError(`${name} must be a whole number of zero or more, got "${raw}".`);
  return value;
}

const viewsDirectory = process.env.SAGA_DEMO_VIEWS_DIR ?? fileURLToPath(new URL('./views/', import.meta.url));
const read = (name: string): Promise<string> => readFile(path.join(viewsDirectory, name), 'utf8');
const views: DemoViews = {
  episode: await read('episode.html'),
  subscriptions: await read('subscriptions.html'),
  playback: await read('playback.html'),
  notes: await read('notes.html'),
  host: await read('host.html'),
};

const ttl = process.env.SAGA_DEMO_CAPABILITY_TTL_SECONDS;
const demo = await startDemo({
  views,
  port: integer('PORT', 3000),
  ...(ttl === undefined ? {} : { capabilityTtlSeconds: integer('SAGA_DEMO_CAPABILITY_TTL_SECONDS', 60) }),
  ...(process.env.SAGA_DEMO_IMAGE_HOST === undefined ? {} : { imageHost: process.env.SAGA_DEMO_IMAGE_HOST }),
});

console.log('LOCAL DEMONSTRATION ONLY: synthetic data and fixed, public sign-in credentials. This is not authentication.');
console.log(`Open the demo host page: ${demo.hostUrl}`);
for (const [id, url] of Object.entries(demo.endpoints)) console.log(`MCP endpoint ${id}: ${url}`);

const stop = (): void => void demo.close().finally(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
