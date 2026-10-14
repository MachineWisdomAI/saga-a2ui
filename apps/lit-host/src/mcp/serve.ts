import { readFile } from 'node:fs/promises';
import { startEpisodeListener } from './listener.js';
import type { EpisodeCatalog, EpisodeRecord } from './server.js';

// Local demo entry (`npm run serve:mcp`). Synthetic, public data only; no credentials are read.
const episodes: readonly EpisodeRecord[] = [
  { id: 'ep-001', title: 'The first synthetic episode', description: 'Plain text, shown exactly as written.' },
  { id: 'ep-002', title: 'The second synthetic episode', description: 'Another public description.' },
];
const catalog: EpisodeCatalog = { find: (id) => episodes.find((episode) => episode.id === id) };

const viewHtml = await readFile(new URL('../../dist/view/view.html', import.meta.url), 'utf8');
const listener = await startEpisodeListener({ viewHtml, catalog, port: Number(process.env.PORT ?? 3001) });
console.log(`MCP server listening at ${listener.url}`);
