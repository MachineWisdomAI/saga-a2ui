import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CAPABILITY_HEADER, PROOF_HEADER } from './media-proof.js';
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
  /** From now on the entitlement lookup throws `message` (or works again when omitted). */
  failEntitlementWith(message?: string): void;
  /** From now on the protected storage read throws `message` (or works again when omitted). */
  failReadsWith(message?: string): void;
  /**
   * Holds the next protected read open, as a slow storage backend would. `reached` settles once the
   * read has started; the read finishes only after `release()`.
   */
  holdNextRead(): { readonly reached: Promise<void>; release(): void };
}

export function countingPlayback(
  initialEntitlements: Readonly<Record<string, readonly string[]>>,
  options?: {
    episodes?: readonly EpisodeRecord[];
    recordFor?: Readonly<Record<string, EpisodeRecord>>;
    failEntitlementWith?: string;
    /** What the media store returns. Defaults to a small non-audio blob; browser tests pass a real WAV. */
    mediaBytes?: Uint8Array;
  },
): CountingPlayback {
  const entitlements = new Map(Object.entries(initialEntitlements).map(([account, ids]) => [account, new Set(ids)]));
  const episodes = options?.episodes ?? [
    // The extra field stands in for a private backend column that must never be published.
    { id: 'ep-1', title: 'The protected episode', description: 'A public description.', internalNote: PRIVATE_CANARY },
    { id: 'ep-2', title: 'Another protected episode', description: 'Also public.' },
  ];
  const entitlementChecks: { accountId: string; episodeId: string }[] = [];
  const mediaReads: string[] = [];
  let entitlementFault = options?.failEntitlementWith;
  let readFault: string | undefined;
  let heldRead: { readonly started: () => void; readonly gate: Promise<void> } | undefined;
  return {
    entitlementChecks,
    mediaReads,
    setEntitled(accountId, episodeIds) {
      entitlements.set(accountId, new Set(episodeIds));
    },
    failEntitlementWith(message) {
      entitlementFault = message;
    },
    failReadsWith(message) {
      readFault = message;
    },
    holdNextRead() {
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => void (release = resolve));
      const reached = new Promise<void>((resolve) => void (started = resolve));
      heldRead = { started, gate };
      return { reached, release };
    },
    backend: {
      // `recordFor` lets a test make the backend answer a lookup with a record whose own id differs.
      findEpisode: (episodeId) => options?.recordFor?.[episodeId] ?? episodes.find((episode) => episode.id === episodeId),
      async checkEntitlement(accountId, episodeId) {
        entitlementChecks.push({ accountId, episodeId });
        if (entitlementFault) throw new Error(entitlementFault);
        return entitlements.get(accountId)?.has(episodeId) ? 'entitled' : 'denied';
      },
    },
    store: {
      async read(episodeId) {
        if (readFault) throw new Error(readFault);
        mediaReads.push(episodeId);
        const held = heldRead;
        heldRead = undefined;
        if (held) {
          held.started();
          await held.gate;
        }
        return { contentType: 'audio/wav', bytes: options?.mediaBytes ?? MEDIA_BYTES };
      },
    },
  };
}

/** The static view document the harness serves. Tests compare resource bodies against it verbatim. */
export const PLAYER_VIEW_HTML = '<!doctype html><title>player</title>';

export interface PlaybackHarness {
  readonly listener: EpisodeListener;
  readonly playback: CountingPlayback;
}

/** The real listener with the playback endpoint, a development verifier and counting seams. */
export interface PlaybackHarnessOptions {
  readonly episodes?: readonly EpisodeRecord[];
  readonly recordFor?: Readonly<Record<string, EpisodeRecord>>;
  readonly mediaBytes?: Uint8Array;
  /** The view document the listener serves. Defaults to a placeholder; browser tests pass the built view. */
  readonly viewHtml?: string;
  readonly failEntitlementWith?: string;
  readonly capabilityTtlSeconds?: number;
  readonly nowSeconds?: () => number;
}

export async function startPlaybackHarness(
  entitlements: Readonly<Record<string, readonly string[]>>,
  options: PlaybackHarnessOptions = {},
): Promise<PlaybackHarness> {
  const playback = countingPlayback(entitlements, options);
  const viewHtml = options.viewHtml ?? PLAYER_VIEW_HTML;
  const listener = await startEpisodeListener({
    viewHtml,
    catalog: { find: () => undefined },
    port: 0,
    playback: {
      viewHtml,
      backend: playback.backend,
      mediaStore: playback.store,
      verifier: createDevelopmentVerifier(),
      ...(options.capabilityTtlSeconds === undefined ? {} : { capabilityTtlSeconds: options.capabilityTtlSeconds }),
      ...(options.nowSeconds === undefined ? {} : { nowSeconds: options.nowSeconds }),
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
export async function createRecipientKey(): Promise<RecipientKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publicJwk: await crypto.subtle.exportKey('jwk', pair.publicKey), privateKey: pair.privateKey };
}

export interface RecipientKey {
  readonly publicJwk: JsonWebKey;
  readonly privateKey: CryptoKey;
}

export interface GrantedView {
  readonly episodeId: string;
  readonly capability: string;
  readonly mediaUrl: string;
  readonly expiresAt: number;
}

/** Presses Play as `token` with `key` as the recipient, and returns the view-only projection. */
export async function playAndGetGrant(
  harness: PlaybackHarness,
  token: string,
  key: RecipientKey,
  episodeId = 'ep-1',
): Promise<GrantedView> {
  const response = await callToolOverHttp(harness.listener.playbackUrl, token, {
    name: 'play_episode',
    arguments: { episodeId },
    _meta: { 'saga-a2ui/recipient-key': key.publicJwk },
  });
  const result = (response.body as { result?: { isError?: boolean; _meta?: Record<string, unknown> } }).result;
  const view = result?._meta?.['saga-a2ui/playback'];
  if (result?.isError || !view) throw new Error(`Play was not authorized: ${JSON.stringify(response.body)}`);
  return view as GrantedView;
}

/**
 * A media proof built independently of production code, straight from the documented format:
 * an ES256 JWT whose header embeds the public key, binding method, URL and the capability's hash.
 */
export async function signMediaProof(options: {
  readonly key: RecipientKey;
  readonly capability: string;
  readonly url: string;
  readonly method?: string;
  readonly jti?: string;
  readonly issuedAt?: number;
}): Promise<string> {
  const { SignJWT } = await import('jose');
  const capabilityHash = createHash('sha256').update(options.capability).digest('base64url');
  const { kty, crv, x, y } = options.key.publicJwk;
  return new SignJWT({ htm: options.method ?? 'GET', htu: options.url, cap: capabilityHash })
    .setProtectedHeader({ alg: 'ES256', typ: 'saga-media-proof+jwt', jwk: { kty, crv, x, y } as never })
    .setJti(options.jti ?? randomUUID())
    .setIssuedAt(options.issuedAt)
    .sign(options.key.privateKey);
}

export interface MediaAttempt {
  readonly status: number;
  readonly bytes: Uint8Array;
  readonly headers: Headers;
}

/** One media acquisition exactly as the built player makes it: a GET with the capability and a proof. */
export async function acquireMedia(options: {
  readonly url: string;
  readonly capability?: string;
  readonly proof?: string;
  /** The raw `Range` request header, exactly as a client would send it. */
  readonly range?: string;
}): Promise<MediaAttempt> {
  const response = await fetch(options.url, {
    headers: {
      ...(options.capability === undefined ? {} : { [CAPABILITY_HEADER]: options.capability }),
      ...(options.proof === undefined ? {} : { [PROOF_HEADER]: options.proof }),
      ...(options.range === undefined ? {} : { range: options.range }),
    },
  });
  return { status: response.status, bytes: new Uint8Array(await response.arrayBuffer()), headers: response.headers };
}

/** One raw JSON-RPC request over HTTP to the playback endpoint (for methods other than tools/call). */
export async function rpcOverHttp(url: string | undefined, token: string | undefined, body: unknown): Promise<WireResponse> {
  if (url === undefined) throw new Error('the listener has no playback endpoint');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, challenge: response.headers.get('www-authenticate'), body: text.length === 0 ? undefined : JSON.parse(text) };
}

/** What a stand-in destination saw: the proof that nothing (or exactly what) reached it. */
export interface Recorder {
  /** `http://127.0.0.1:<port>`; a different origin from the listener under test. */
  readonly origin: string;
  readonly requests: { readonly url: string; readonly headers: IncomingHttpHeaders }[];
  close(): Promise<void>;
}

/**
 * A second HTTP origin that records every request it receives. It stands in for a destination the
 * view was never told about, or for a media origin that redirects, so a test can show that no
 * capability or proof ever arrives there. It answers with `respond`, or with 200 and the canary bytes.
 */
export async function startRecorder(respond?: (req: IncomingMessage, res: ServerResponse) => void): Promise<Recorder> {
  const requests: Recorder['requests'][number][] = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url ?? '', headers: req.headers });
    if (respond) return respond(req, res);
    res.writeHead(200, { 'content-type': 'audio/wav', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }).end(Buffer.from(MEDIA_BYTES));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo; // listen() on a TCP port yields AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
