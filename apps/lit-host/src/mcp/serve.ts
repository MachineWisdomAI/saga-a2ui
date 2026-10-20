import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDevelopmentVerifier, DEV_ACCOUNTS } from './dev-auth.js';
import type { MediaStore } from '../playback/media-service.js';
import type { PlaybackBackend } from '../playback/playback-server.js';
import { toneWav } from '../playback/synthetic-media.js';
import { startEpisodeListener } from './listener.js';
import type { AnswerBackend } from './answer-server.js';
import type { EpisodeCatalog, EpisodeRecord } from './server.js';
import type { AccountSubscriptions } from './subscriptions-server.js';

// Local demo entry (`npm run serve:mcp`). Synthetic data only; no real credentials are read.
// `/mcp` and `/answer/mcp` are public. `/subscriptions/mcp` uses the DEVELOPMENT-ONLY verifier and its fixed,
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

// Synthetic public answers. The "knowledge base" is two fixed sentences; the short pauses and
// progress reports stand in for a real backend that takes its time.
const knowledge: Readonly<Record<string, string>> = {
  'What is SAGA?': 'SAGA is a synthetic example application.',
  'Why is the sky blue?': 'Shorter wavelengths scatter more in the atmosphere.',
};
const answerBackend: AnswerBackend = {
  async answer(question, request) {
    await request.reportProgress({ progress: 1, total: 2, message: 'Looking up the question' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (request.signal.aborted) return undefined;
    await request.reportProgress({ progress: 2, total: 2, message: 'Writing the answer' });
    return knowledge[question];
  },
};

// The built views are read before the port opens, so a missing artifact stops the process instead
// of serving a listener without its view. `SAGA_VIEWS_DIR` names the directory that holds them
// (`view/view.html`, ...); an installed copy of this application, run outside the repository
// (PACK1, scripts/build-installed-lit-host.ts), points it at the views built beside it. Unset, it is `dist` here.
const viewsDirectory = process.env.SAGA_VIEWS_DIR ?? fileURLToPath(new URL('../../dist/', import.meta.url));
const readView = (relativePath: string) => readFile(path.join(viewsDirectory, relativePath), 'utf8');
const viewHtml = await readView('view/view.html');
const subscriptionsViewHtml = await readView('subscriptions-view/subscriptions.html');
const playbackViewHtml = await readView('playback-view/playback.html');
const answerViewHtml = await readView('answer-view/answer.html');
const listener = await startEpisodeListener({
  viewHtml,
  catalog,
  port: Number(process.env.PORT ?? 3001),
  subscriptions: {
    viewHtml: subscriptionsViewHtml,
    backend: { listSubscriptions: async (accountId) => accounts[accountId] },
    verifier: createDevelopmentVerifier(),
  },
  // Public: no verifier, because the operation reads no credential and has no identity.
  answer: { viewHtml: answerViewHtml, backend: answerBackend, responseMode: 'event-stream' },
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
console.log(`Public answer endpoint (no credential): ${listener.answerUrl}`);
