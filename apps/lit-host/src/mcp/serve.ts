import { readFile } from 'node:fs/promises';
import { createDevelopmentVerifier, DEV_ACCOUNTS } from './dev-auth.js';
import type { MediaStore } from '../playback/media-service.js';
import type { PlaybackBackend } from '../playback/playback-server.js';
import { toneWav } from '../playback/synthetic-media.js';
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

// Synthetic playback policy: only Alice may hear ep-001. The "protected media" is a generated tone.
const playableEntitlements: Readonly<Record<string, ReadonlySet<string>>> = {
  [DEV_ACCOUNTS.alice]: new Set(['ep-001']),
  [DEV_ACCOUNTS.bob]: new Set(),
};
const playbackBackend: PlaybackBackend = {
  findEpisode: (episodeId) => episodes.find((episode) => episode.id === episodeId),
  checkEntitlement: async (accountId, episodeId) =>
    playableEntitlements[accountId]?.has(episodeId) ? 'entitled' : 'denied',
};
const mediaStore: MediaStore = { read: async () => ({ contentType: 'audio/wav', bytes: toneWav() }) };

const viewHtml = await readFile(new URL('../../dist/view/view.html', import.meta.url), 'utf8');
const subscriptionsViewHtml = await readFile(
  new URL('../../dist/subscriptions-view/subscriptions.html', import.meta.url),
  'utf8',
);
const playbackViewHtml = await readFile(new URL('../../dist/playback-view/playback.html', import.meta.url), 'utf8');
const listener = await startEpisodeListener({
  viewHtml,
  catalog,
  port: Number(process.env.PORT ?? 3001),
  subscriptions: {
    viewHtml: subscriptionsViewHtml,
    backend: { listSubscriptions: async (accountId) => accounts[accountId] },
    verifier: createDevelopmentVerifier(),
  },
  playback: {
    viewHtml: playbackViewHtml,
    backend: playbackBackend,
    mediaStore,
    verifier: createDevelopmentVerifier(),
  },
});
console.log(`MCP server listening at ${listener.url}`);
console.log(`Protected subscriptions endpoint (development tokens only): ${listener.subscriptionsUrl}`);
console.log(`Protected playback endpoint (development tokens only): ${listener.playbackUrl}`);
