import { createDevelopmentVerifier } from '../mcp/dev-auth.js';
import { startEpisodeListener, type EpisodeListener } from '../mcp/listener.js';
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

const VIEW_HTML = '<!doctype html><title>player</title>';

export interface PlaybackHarness {
  readonly listener: EpisodeListener;
  readonly playback: CountingPlayback;
}

/** The real listener with the playback endpoint, a development verifier and counting seams. */
export async function startPlaybackHarness(
  entitlements: Readonly<Record<string, readonly string[]>>,
  options?: Parameters<typeof countingPlayback>[1],
): Promise<PlaybackHarness> {
  const playback = countingPlayback(entitlements, options);
  const listener = await startEpisodeListener({
    viewHtml: VIEW_HTML,
    catalog: { find: () => undefined },
    port: 0,
    playback: {
      viewHtml: VIEW_HTML,
      backend: playback.backend,
      mediaStore: playback.store,
      verifier: createDevelopmentVerifier(),
    },
  });
  return { listener, playback };
}

export interface WireResponse {
  readonly status: number;
  readonly challenge: string | null;
  readonly body: unknown;
}

/** One raw `tools/call` over HTTP, as the host proxies a view's call. `_meta` is the call's own metadata. */
export async function callToolOverHttp(
  url: string | undefined,
  token: string | undefined,
  params: { name: string; arguments?: unknown; _meta?: Record<string, unknown> },
): Promise<WireResponse> {
  if (url === undefined) throw new Error('the listener has no playback endpoint');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params }),
  });
  const text = await response.text();
  return {
    status: response.status,
    challenge: response.headers.get('www-authenticate'),
    body: text.length === 0 ? undefined : JSON.parse(text),
  };
}

/** What the view does in a browser: a non-extractable-in-practice key pair whose public half is shared. */
export async function createRecipientKey(): Promise<{ readonly publicJwk: JsonWebKey; readonly privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey), privateKey: pair.privateKey };
}
