import type { MediaStore } from './media-service.js';
import type { PlaybackBackend, EpisodeRecord } from './playback-server.js';

/**
 * Synthetic playback data and counting seams for tests. Nothing here is a credential, a real
 * account or real content. Tests drive these through the listener and the view; every canary
 * must stay off the model-visible wire, off logs, and out of the view.
 */
export const PRIVATE_CANARY = 'canary-private-backend-field';

/** A recognizable value the media store would return; never part of any tool result. */
export const MEDIA_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x63, 0x61, 0x6e, 0x61, 0x72, 0x79]);

export interface CountingPlayback {
  readonly backend: PlaybackBackend;
  readonly store: MediaStore;
  /** Every entitlement lookup, in order. A protected backend fetch is one entry here. */
  readonly entitlementChecks: { accountId: string; episodeId: string }[];
  /** Every protected media read, in order. */
  readonly mediaReads: string[];
  /** Grants or revokes access between requests, as the application's subscription rules would. */
  setEntitled(accountId: string, episodeIds: readonly string[]): void;
}

export function countingPlayback(
  initialEntitlements: Readonly<Record<string, readonly string[]>>,
  options?: { episodes?: readonly EpisodeRecord[]; failEntitlementWith?: string },
): CountingPlayback {
  const entitlements = new Map(Object.entries(initialEntitlements).map(([account, ids]) => [account, new Set(ids)]));
  const episodes = options?.episodes ?? [
    // The extra field stands in for a private backend column that must never be published.
    { id: 'ep-1', title: 'The protected episode', description: 'A public description.', internalNote: PRIVATE_CANARY },
    { id: 'ep-2', title: 'Another protected episode', description: 'Also public.' },
  ];
  const entitlementChecks: { accountId: string; episodeId: string }[] = [];
  const mediaReads: string[] = [];
  return {
    entitlementChecks,
    mediaReads,
    setEntitled(accountId, episodeIds) {
      entitlements.set(accountId, new Set(episodeIds));
    },
    backend: {
      findEpisode: (episodeId) => episodes.find((episode) => episode.id === episodeId),
      async checkEntitlement(accountId, episodeId) {
        entitlementChecks.push({ accountId, episodeId });
        if (options?.failEntitlementWith) throw new Error(options.failEntitlementWith);
        return entitlements.get(accountId)?.has(episodeId) ? 'entitled' : 'denied';
      },
    },
    store: {
      async read(episodeId) {
        mediaReads.push(episodeId);
        return { contentType: 'audio/wav', bytes: MEDIA_BYTES };
      },
    },
  };
}
