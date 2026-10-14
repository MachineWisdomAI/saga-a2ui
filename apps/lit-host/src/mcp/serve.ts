import { readFile } from 'node:fs/promises';
import { createDevelopmentVerifier, DEV_ACCOUNTS } from './dev-auth.js';
import { startEpisodeListener } from './listener.js';
import type { EpisodeCatalog, EpisodeRecord } from './server.js';
import type { AccountSubscriptions } from './subscriptions-server.js';

// Local demo entry (`npm run serve:mcp`). Synthetic data only; no real credentials are read.
// `/mcp` is public. `/subscriptions/mcp` uses the DEVELOPMENT-ONLY verifier and its fixed,
// public tokens, which is acceptable only because this process listens on loopback. A remote
// host must pass its own configured `OAuthTokenVerifier` instead.
const episodes: readonly EpisodeRecord[] = [
  { id: 'ep-001', title: 'The first synthetic episode', description: 'Plain text, shown exactly as written.' },
  { id: 'ep-002', title: 'The second synthetic episode', description: 'Another public description.' },
];
const catalog: EpisodeCatalog = { find: (id) => episodes.find((episode) => episode.id === id) };

const accounts: Readonly<Record<string, AccountSubscriptions>> = {
  [DEV_ACCOUNTS.alice]: {
    displayName: 'Alice (synthetic)',
    subscriptions: [
      { subscriptionId: 'sub-a1', creator: 'Synthetic Creator One', tier: 'Gold', status: 'active' },
      { subscriptionId: 'sub-a2', creator: 'Synthetic Creator Two', tier: 'Basic', status: 'paused' },
    ],
  },
  [DEV_ACCOUNTS.bob]: {
    displayName: 'Bob (synthetic)',
    subscriptions: [{ subscriptionId: 'sub-b1', creator: 'Synthetic Creator Three', tier: 'Silver', status: 'active' }],
  },
};

const viewHtml = await readFile(new URL('../../dist/view/view.html', import.meta.url), 'utf8');
const subscriptionsViewHtml = await readFile(
  new URL('../../dist/subscriptions-view/subscriptions.html', import.meta.url),
  'utf8',
);
const listener = await startEpisodeListener({
  viewHtml,
  catalog,
  port: Number(process.env.PORT ?? 3001),
  subscriptions: {
    viewHtml: subscriptionsViewHtml,
    backend: { listSubscriptions: async (accountId) => accounts[accountId] },
    verifier: createDevelopmentVerifier(),
  },
});
console.log(`MCP server listening at ${listener.url}`);
console.log(`Protected subscriptions endpoint (development tokens only): ${listener.subscriptionsUrl}`);
