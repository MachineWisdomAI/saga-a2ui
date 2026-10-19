import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpServer, OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { DEFAULT_CONTENT_POLICY, type ContentPolicy } from '@saga-a2ui/components/faithful-card';
import {
  assertBudgetSettings,
  createServerBudgets,
  type BudgetSettings,
  type LifetimeCause,
  type RequestBudgets,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { createMediaService, type MediaStore } from '../playback/media-service.js';
import { CAPABILITY_HEADER, PROOF_HEADER } from '../playback/media-proof.js';
import { MEDIA_PATH_PREFIX, OPEN_TOOL_NAME, PLAY_TOOL_NAME, PLAYBACK_LIMITS } from '../playback/playback.js';
import { createPlaybackServer, type PlaybackBackend } from '../playback/playback-server.js';
import { createAnswerServer, type AnswerBackend } from './answer-server.js';
import { authenticate, PLAYBACK_REQUIREMENT, SUBSCRIPTIONS_REQUIREMENT, type AuthRequirement } from './request-auth.js';
import { createEpisodeServer, type EpisodeCatalog } from './server.js';
import { SUBSCRIPTION_LIMITS, SUBSCRIPTIONS_TOOL_NAME } from './subscriptions.js';
import {
  classifyProtectedBody,
  declaredBodyTooLarge,
  transportHeaderFailure,
  writeProtocol,
  writeTransport,
  type ProtectedRequestPolicy,
} from './protected-request.js';
import { bindResponseToLifetime, mayAnswer, resolveStreamingPolicy, type StreamingPolicy } from './response-lifetime.js';
import {
  createSubscriptionsServer,
  createViewSessionLabeler,
  type SubscriptionBackend,
} from './subscriptions-server.js';

export { DEFAULT_STREAM_IDLE_MS, ListenerConfigurationError, type StreamingPolicy } from './response-lifetime.js';

/** Optional protected endpoint: the signed-in user's own subscriptions. */
export interface SubscriptionsEndpointOptions {
  readonly viewHtml: string;
  readonly backend: SubscriptionBackend;
  /** Decides who each request is. The application chooses it; nothing here falls back to a default. */
  readonly verifier: OAuthTokenVerifier;
  /**
   * This browse read's own limit: the per-operation override of the operation limit. Omitted, the
   * route's or listener's operation limit applies. It never extends the request. A later
   * resolution is not returned.
   */
  readonly readBoundMs?: number;
  /** This route's budgets, over the listener's. Each field overrides only its own counterpart. */
  readonly budgets?: BudgetSettings;
}

/** Optional protected endpoint: the app-only Play operation for the signed-in listener. */
export interface PlaybackEndpointOptions {
  readonly viewHtml: string;
  readonly backend: PlaybackBackend;
  /** Protected episode bytes. Reached only after authentication, entitlement and the capability check. */
  readonly mediaStore: MediaStore;
  /** Decides who each request is. The application chooses it; nothing here falls back to a default. */
  readonly verifier: OAuthTokenVerifier;
  /** Lifetime of an issued media capability. Defaults to the service's short default. */
  readonly capabilityTtlSeconds?: number;
  /** Test seam for the media service's clock. */
  readonly nowSeconds?: () => number;
  /**
   * This route's budgets, over the listener's. They apply to the Play tool and, separately for each
   * request, to every media acquisition: an acquisition starts a new deadline and inherits nothing
   * from the Play that issued its capability.
   */
  readonly budgets?: BudgetSettings;
}

/** Optional public endpoint: a question in, an answer out. No credential is read or required. */
export interface AnswerEndpointOptions {
  readonly viewHtml: string;
  readonly backend: AnswerBackend;
  /**
   * How a call is answered. `json` (the default) returns one body when the answer is ready.
   * `event-stream` streams progress notifications and then the answer as server-sent events.
   */
  readonly responseMode?: 'json' | 'event-stream';
  /**
   * This answer's own limit: the per-operation override of the operation limit. Omitted, the
   * route's or listener's operation limit applies.
   */
  readonly answerBoundMs?: number;
  /** This route's budgets, over the listener's. Each field overrides only its own counterpart. */
  readonly budgets?: BudgetSettings;
  /**
   * How an established event stream is kept finite. Used only with `event-stream`; absent, the
   * documented default (`DEFAULT_STREAM_IDLE_MS`) is selected. The request deadline covers setup
   * up to the established stream, not the stream's lifetime.
   */
  readonly streaming?: StreamingPolicy;
}

/** What the listener observed about one finished request, for the application's own diagnostics. */
export interface RequestOutcome {
  readonly path: string;
  /** The status the response was committed with, or `undefined` if none was. */
  readonly status: number | undefined;
  /** True when the transport reported the response finished, false when it was closed first. */
  readonly finished: boolean;
  /** Inspectable causes in order. They may hold original errors: log them, never send them to a caller. */
  readonly causes: readonly LifetimeCause[];
}

/** Header values arrive as `string | string[]`; a repeated header is not a valid credential. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export interface EpisodeListenerOptions {
  readonly viewHtml: string;
  readonly catalog: EpisodeCatalog;
  /** Trusted content policy of the public episode view. Defaults to Standard with no image host. */
  readonly contentPolicy?: ContentPolicy;
  /** Use 0 for an ephemeral port. */
  readonly port: number;
  /**
   * This listener's budgets: 3,000 ms per operation and 10,000 ms per request unless stated. Each
   * route and each operation may override either field; what a route or operation leaves unstated
   * it inherits from here. Invalid values fail before the listener opens.
   */
  readonly budgets?: BudgetSettings;
  /** When absent, the protected path does not exist. */
  readonly subscriptions?: SubscriptionsEndpointOptions;
  /** When absent, the protected path does not exist. */
  readonly playback?: PlaybackEndpointOptions;
  /** When absent, the public answer path does not exist. */
  readonly answer?: AnswerEndpointOptions;
  /** Called once for each request when its connection closes. Must not throw or block. */
  readonly observe?: (outcome: RequestOutcome) => void;
}

export interface EpisodeListener {
  /** Streamable HTTP endpoint, e.g. http://127.0.0.1:3001/mcp (public, unauthenticated). */
  readonly url: string;
  /** Protected endpoint (bearer credential required); undefined unless configured. */
  readonly subscriptionsUrl?: string;
  /** Protected endpoint (bearer credential required); undefined unless configured. */
  readonly playbackUrl?: string;
  /** Public answer endpoint (no credential); undefined unless configured. */
  readonly answerUrl?: string;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const MCP_PATH = '/mcp';
const SUBSCRIPTIONS_PATH = '/subscriptions/mcp';
const PLAYBACK_PATH = '/playback/mcp';
const ANSWER_PATH = '/answer/mcp';
/** The body bound of a public endpoint, which states none of its own. The MCP SDK's default. */
const PUBLIC_MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** What the protected subscriptions endpoint accepts: its one tool, within the browse bounds. */
const SUBSCRIPTIONS_POLICY: ProtectedRequestPolicy = {
  toolNames: [SUBSCRIPTIONS_TOOL_NAME],
  limits: SUBSCRIPTION_LIMITS,
};

/** What the protected playback endpoint accepts: the one Play tool, within the Play bounds. */
const PLAYBACK_POLICY: ProtectedRequestPolicy = {
  toolNames: [PLAY_TOOL_NAME, OPEN_TOOL_NAME],
  limits: PLAYBACK_LIMITS,
};

/** Everything that differs between protected endpoints; the request order does not. */
interface ProtectedEndpoint {
  readonly policy: ProtectedRequestPolicy;
  readonly requirement: AuthRequirement;
  readonly verifier: OAuthTokenVerifier;
  createServer(lifetime: RequestLifetime): McpServer;
}

/** The stages this listener owns around the tool handler, each with its own safe expiry answer. */
type OwnedStage = 'authentication' | 'body' | 'acquisition';

/** Throws before the listener opens when an operation limit stated by an application is unusable. */
function assertOperationLimit(where: string, operationMs: number | undefined): void {
  assertBudgetSettings(where, operationMs === undefined ? undefined : { operationMs });
}

/**
 * Application-owned HTTP hosting for the MCP servers: loopback only, stateless Streamable HTTP
 * (a fresh server and transport per POST, JSON responses), DNS-rebinding protection on the
 * Host header. `/mcp` is public. `/subscriptions/mcp`, when configured, authenticates every
 * request before any server is built; the verified identity reaches the tool only as the
 * SDK's per-request auth context.
 *
 * Time: each request's lifetime starts when it is admitted, before the first credential, header or
 * body wait, and that one absolute deadline covers authentication, body ingestion, the tool or
 * acquisition and delivery of a finite response through transport `finish`. See `RequestBudgets`.
 */
export async function startEpisodeListener(options: EpisodeListenerOptions): Promise<EpisodeListener> {
  // Everything an application can state about time is resolved and validated before the port opens.
  const instance = createServerBudgets(options.budgets);
  const routeBudgets = {
    episode: instance.forRoute(),
    subscriptions: instance.forRoute(options.subscriptions?.budgets),
    playback: instance.forRoute(options.playback?.budgets),
    answer: instance.forRoute(options.answer?.budgets),
  } as const;
  assertOperationLimit('Subscriptions readBoundMs', options.subscriptions?.readBoundMs);
  assertOperationLimit('Answer answerBoundMs', options.answer?.answerBoundMs);
  const answerStreaming = options.answer?.responseMode === 'event-stream' ? resolveStreamingPolicy(options.answer.streaming) : undefined;

  const http: Server = createServer();
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, HOST, resolve);
  });
  const { port } = http.address() as AddressInfo; // listen() on a TCP port yields AddressInfo
  const allowedHosts = [`${HOST}:${port}`, `localhost:${port}`];
  const labelViewSession = createViewSessionLabeler();
  const origin = `http://${HOST}:${port}`;
  // One service for the listener's lifetime: it holds the issued capabilities, while each
  // request still builds its own MCP server.
  const { playback } = options;
  const mediaService = playback
    ? createMediaService({
        store: playback.mediaStore,
        // The same lookup Play uses, asked again on every fresh acquisition.
        entitlement: (accountId, episodeId, signal) => playback.backend.checkEntitlement(accountId, episodeId, signal),
        ...(playback.capabilityTtlSeconds === undefined ? {} : { ttlSeconds: playback.capabilityTtlSeconds }),
        ...(playback.nowSeconds === undefined ? {} : { nowSeconds: playback.nowSeconds }),
      })
    : undefined;

  const MEDIA_PATH = new RegExp(`^${MEDIA_PATH_PREFIX}([a-z0-9][a-z0-9-]{0,63})$`);

  /** Picks the route's budgets from the path alone, so nothing a request sends can choose them. */
  function routeFor(path: string): { readonly budgets: RequestBudgets; readonly streaming?: StreamingPolicy } {
    if (path === SUBSCRIPTIONS_PATH) return { budgets: routeBudgets.subscriptions };
    if (path === PLAYBACK_PATH || (MEDIA_PATH.test(path) && options.playback)) return { budgets: routeBudgets.playback };
    if (path === ANSWER_PATH) return { budgets: routeBudgets.answer, ...(answerStreaming ? { streaming: answerStreaming } : {}) };
    return { budgets: routeBudgets.episode };
  }

  http.on('request', (req, res) => {
    let path = '/';
    try {
      path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    } catch {
      // An unparseable target is answered below as an unknown path.
    }
    const route = routeFor(path);
    const lifetime = route.budgets.startRequest();
    bindResponseToLifetime(req, res, lifetime, route.streaming, (delivered) => {
      try {
        options.observe?.({
          path,
          status: res.headersSent ? res.statusCode : undefined,
          // Delivered, not merely finished: a response the deadline destroyed also reports `writableFinished`.
          finished: delivered,
          causes: lifetime.causes,
        });
      } catch {
        // Diagnostics must never change what a caller sees or leave a request open.
      }
    });
    void handle(req, res, lifetime, path).catch(() => {
      if (res.destroyed) return;
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    });
  });

  async function serve(
    server: McpServer,
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
    maxRequestBodySize?: number,
    enableJsonResponse = true,
  ): Promise<void> {
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse,
      enableDnsRebindingProtection: true,
      allowedHosts,
      ...(maxRequestBodySize === undefined ? {} : { maxRequestBodySize }),
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  }

  /**
   * Reads the body until it ends, `maxBytes` is exceeded or `gate` aborts. Whichever happens first
   * settles it once, and every listener it added is removed.
   */
  async function readLimitedBody(
    req: IncomingMessage,
    maxBytes: number,
    gate: AbortSignal,
  ): Promise<{ tooLarge: true } | { tooLarge: false; text: string }> {
    // Do not iterate with for-await: leaving that loop destroys the socket before a 413 can be written.
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      let settled = false;
      const detach = () => {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
        gate.removeEventListener('abort', onGate);
      };
      const finish = (result: { tooLarge: true } | { tooLarge: false; text: string }) => {
        if (settled) return;
        settled = true;
        req.pause();
        detach();
        resolve(result);
      };
      const onData = (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.length;
        if (received > maxBytes) {
          finish({ tooLarge: true });
          return;
        }
        chunks.push(buf);
      };
      const onEnd = () => finish({ tooLarge: false, text: Buffer.concat(chunks).toString('utf8') });
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        detach();
        reject(error);
      };
      // The bounded stage that wraps this has already stopped waiting; this stops listening.
      const onGate = () => {
        if (settled) return;
        settled = true;
        detach();
        reject(new Error('The body read was abandoned.'));
      };
      if (gate.aborted) return onGate();
      gate.addEventListener('abort', onGate, { once: true });
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
    });
  }

  function closeAfter(req: IncomingMessage, res: ServerResponse): void {
    const cleanup = () => req.destroy();
    if (res.writableFinished) cleanup();
    else res.once('finish', cleanup);
  }

  function rejectOversized(req: IncomingMessage, res: ServerResponse): void {
    writeTransport(res, { kind: 'transport', status: 413, error: 'payload_too_large' });
    closeAfter(req, res);
  }

  function writeAuthDecision(res: ServerResponse, decision: { status: number; challenge?: string; error: string }): void {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (decision.challenge) headers['www-authenticate'] = decision.challenge;
    res.writeHead(decision.status, headers).end(JSON.stringify({ error: decision.error }));
  }

  /**
   * The safe answer for a stage that did not finish, before anything is committed. A disconnect or a
   * cancellation writes nothing; an expiry writes one answer and gets no extra time to deliver it.
   * Never a 401 for a wait that merely expired, and never a claim that access was denied.
   */
  function stageFailed(stage: OwnedStage, cause: LifetimeCause, lifetime: RequestLifetime, req: IncomingMessage, res: ServerResponse): void {
    // The lifetime recorded its own expiry, disconnect and completion itself; the rest are this stage's.
    if (cause.kind !== 'request-timeout' && cause.kind !== 'disconnected' && cause.kind !== 'completed') lifetime.record(cause);
    if (cause.kind === 'disconnected' || cause.kind === 'cancelled' || cause.kind === 'completed') return;
    if (!mayAnswer(lifetime, res)) return;
    if (stage === 'authentication') return writeAuthDecision(res, { status: 500, error: 'server_error' });
    if (stage === 'body') {
      writeTransport(res, { kind: 'transport', status: 408, error: 'request_timeout' });
      return closeAfter(req, res);
    }
    res.writeHead(503, REFUSED_HEADERS).end(JSON.stringify({ error: 'unavailable' }));
  }

  /** Reads the request body as one bounded stage. `undefined` means the response has been dealt with. */
  async function readBodyStage(req: IncomingMessage, res: ServerResponse, lifetime: RequestLifetime, maxBytes: number): Promise<string | undefined> {
    const read = await lifetime.run('body', (scope) => readLimitedBody(req, maxBytes, scope.signal));
    if (!read.ok) return void stageFailed('body', read.cause, lifetime, req, res);
    if (!mayAnswer(lifetime, res)) return undefined;
    if (read.value.tooLarge) return void rejectOversized(req, res);
    return read.value.text;
  }

  /**
   * The one order every protected endpoint follows: authenticate before reading the body, then
   * classify the request, then build a server and hand it the verified identity. Only the policy,
   * the credential requirement and the server differ between endpoints. Each wait is a bounded stage
   * of the request, and nothing starts once the request's lifetime has ended.
   */
  async function serveProtected(
    endpoint: ProtectedEndpoint,
    req: IncomingMessage,
    res: ServerResponse,
    lifetime: RequestLifetime,
  ): Promise<void> {
    if (declaredBodyTooLarge(req, endpoint.policy)) return writeTransport(res, { kind: 'transport', status: 413, error: 'payload_too_large' });
    const authenticated = await lifetime.run('authentication', (scope) =>
      authenticate(req, endpoint.verifier, endpoint.requirement, scope.signal),
    );
    if (!authenticated.ok) return stageFailed('authentication', authenticated.cause, lifetime, req, res);
    const decision = authenticated.value;
    if (!decision.ok) {
      lifetime.record(
        decision.status === 500
          ? { kind: 'dependency-failure', stage: 'authentication', effect: 'none', error: decision.fault }
          : { kind: 'auth-refused', status: decision.status },
      );
      if (mayAnswer(lifetime, res)) writeAuthDecision(res, decision);
      return;
    }
    if (!mayAnswer(lifetime, res)) return;
    const headerFailure = transportHeaderFailure(req);
    if (headerFailure) return writeTransport(res, headerFailure);
    const text = await readBodyStage(req, res, lifetime, endpoint.policy.limits.maxRequestBytes);
    if (text === undefined) return;
    const gate = classifyProtectedBody(text, endpoint.policy);
    if (gate.kind === 'transport') return writeTransport(res, gate);
    if (gate.kind === 'protocol') return writeProtocol(res, gate);
    // The SDK transport passes `req.auth` to each tool call as `extra.authInfo`. Neither the
    // snapshot nor a server is made for a request whose lifetime has ended.
    if (lifetime.signal.aborted) return;
    Object.assign(req, { auth: decision.authInfo });
    await serve(endpoint.createServer(lifetime), req, res, gate.body, endpoint.policy.limits.maxRequestBytes);
  }

  /** A public endpoint: the body is a bounded stage too, but no credential is read and no identity exists. */
  async function servePublic(
    req: IncomingMessage,
    res: ServerResponse,
    lifetime: RequestLifetime,
    createServerFor: (lifetime: RequestLifetime) => McpServer,
    enableJsonResponse = true,
  ): Promise<void> {
    const text = await readBodyStage(req, res, lifetime, PUBLIC_MAX_REQUEST_BYTES);
    if (text === undefined) return;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return writeProtocol(res, { kind: 'protocol', status: 400, id: null, code: -32700, message: 'Parse error' });
    }
    if (lifetime.signal.aborted) return;
    await serve(createServerFor(lifetime), req, res, body, PUBLIC_MAX_REQUEST_BYTES, enableJsonResponse);
  }

  function protectedEndpointAt(path: string): ProtectedEndpoint | undefined {
    if (path === SUBSCRIPTIONS_PATH && options.subscriptions) {
      const endpoint = options.subscriptions;
      return {
        policy: SUBSCRIPTIONS_POLICY,
        requirement: SUBSCRIPTIONS_REQUIREMENT,
        verifier: endpoint.verifier,
        createServer: (lifetime) =>
          createSubscriptionsServer({
            viewHtml: endpoint.viewHtml,
            backend: endpoint.backend,
            labelViewSession,
            lifetime,
            ...(endpoint.readBoundMs === undefined ? {} : { readBoundMs: endpoint.readBoundMs }),
          }),
      };
    }
    if (path === PLAYBACK_PATH && options.playback && mediaService) {
      const endpoint = options.playback;
      return {
        policy: PLAYBACK_POLICY,
        requirement: PLAYBACK_REQUIREMENT,
        verifier: endpoint.verifier,
        createServer: (lifetime) =>
          createPlaybackServer({
            viewHtml: endpoint.viewHtml,
            backend: endpoint.backend,
            mediaService,
            labelViewSession,
            mediaOrigin: origin,
            lifetime,
          }),
      };
    }
    return undefined;
  }

  // The player runs in a sandboxed iframe with an opaque origin, so its fetch is cross-origin and
  // sends `Origin: null`. Any origin may therefore read the response, which is safe only because
  // nothing ambient authorizes it: credentials are never allowed (no cookie or auth header is
  // honored) and the capability plus a fresh proof from the bound key decide every request.
  const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET',
    'access-control-allow-headers': `${CAPABILITY_HEADER}, ${PROOF_HEADER}, range`,
    'access-control-max-age': '600',
  } as const;
  // Every answer that can carry bytes or a status for one caller. `private, no-store` keeps it out of
  // shared and browser caches; `Vary` names what selects the representation, for a cache that ignores
  // no-store and would otherwise key on the URL alone and answer B with A's bytes.
  const MEDIA_ANSWER_HEADERS = {
    'cache-control': 'private, no-store',
    vary: `Origin, Range, ${CAPABILITY_HEADER}, ${PROOF_HEADER}`,
    ...CORS_HEADERS,
  } as const;
  const REFUSED_HEADERS = { 'content-type': 'application/json', ...MEDIA_ANSWER_HEADERS } as const;

  /**
   * The synthetic media service's HTTP edge. It never authenticates the person; the capability and
   * the recipient's proof decide, and a refusal says nothing about which check failed. The URL the
   * proof must name is built from this listener's own origin, never from the Host header. Each
   * acquisition is its own request: it starts a new deadline and inherits nothing from the Play that
   * issued its capability, and the capability keeps its own, separate expiry.
   */
  async function serveMedia(req: IncomingMessage, res: ServerResponse, lifetime: RequestLifetime, episodeId: string): Promise<void> {
    if (!mediaService) return void res.writeHead(404).end();
    const acquired = await lifetime.run('acquisition', (scope) =>
      mediaService.acquire(
        {
          episodeId,
          url: `${origin}${MEDIA_PATH_PREFIX}${episodeId}`,
          method: req.method ?? '',
          capability: singleHeader(req.headers[CAPABILITY_HEADER]),
          proof: singleHeader(req.headers[PROOF_HEADER]),
          range: singleHeader(req.headers.range),
        },
        scope,
      ),
    );
    // The entitlement lookup or the storage read failed or did not finish. That is neither a grant nor
    // a refusal of this caller, so say "try again" (503) without any dependency text, readable by the view.
    if (!acquired.ok) return stageFailed('acquisition', acquired.cause, lifetime, req, res);
    const outcome = acquired.value;
    if (!mayAnswer(lifetime, res)) return; // the caller went away or the request ended: nothing is written
    if (outcome.kind === 'refused') return void res.writeHead(403, REFUSED_HEADERS).end(JSON.stringify({ error: 'forbidden' }));
    if (outcome.kind === 'unsatisfiable') {
      // Sent only to a caller who passed every check, so the length is not a probe for anyone else.
      res.writeHead(416, { 'content-range': `bytes */${outcome.total}`, ...MEDIA_ANSWER_HEADERS }).end();
      return;
    }
    const delivered = {
      'content-type': outcome.media.contentType,
      'content-length': outcome.media.bytes.length,
      'accept-ranges': 'bytes',
      ...MEDIA_ANSWER_HEADERS,
    };
    if (outcome.kind === 'partial') {
      res
        .writeHead(206, { ...delivered, 'content-range': `bytes ${outcome.first}-${outcome.last}/${outcome.total}` })
        .end(Buffer.from(outcome.media.bytes));
      return;
    }
    res.writeHead(200, delivered).end(Buffer.from(outcome.media.bytes));
  }

  async function handle(req: IncomingMessage, res: ServerResponse, lifetime: RequestLifetime, path: string): Promise<void> {
    const mediaMatch = MEDIA_PATH.exec(path);
    if (mediaMatch?.[1] && options.playback) {
      // A preflight carries no credential and reaches no media: it only answers which headers the
      // real request may send.
      if (req.method === 'OPTIONS') return void res.writeHead(204, CORS_HEADERS).end();
      if (req.method !== 'GET') return void res.writeHead(405, { allow: 'GET, OPTIONS' }).end();
      return serveMedia(req, res, lifetime, mediaMatch[1]);
    }
    const protectedEndpoint = protectedEndpointAt(path);
    const answerEndpoint = path === ANSWER_PATH ? options.answer : undefined;
    if (path !== MCP_PATH && !protectedEndpoint && !answerEndpoint) return void res.writeHead(404).end();
    if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();

    // Public by design: nothing is authenticated and the server is built without any identity.
    if (answerEndpoint) {
      return servePublic(
        req,
        res,
        lifetime,
        (requestLifetime) =>
          createAnswerServer({
            viewHtml: answerEndpoint.viewHtml,
            backend: answerEndpoint.backend,
            lifetime: requestLifetime,
            ...(answerEndpoint.answerBoundMs === undefined ? {} : { answerBoundMs: answerEndpoint.answerBoundMs }),
          }),
        answerEndpoint.responseMode !== 'event-stream',
      );
    }

    if (protectedEndpoint) return serveProtected(protectedEndpoint, req, res, lifetime);
    await servePublic(req, res, lifetime, (requestLifetime) =>
      createEpisodeServer({
        viewHtml: options.viewHtml,
        catalog: options.catalog,
        contentPolicy: options.contentPolicy ?? DEFAULT_CONTENT_POLICY,
        lifetime: requestLifetime,
      }),
    );
  }

  return {
    url: `http://${HOST}:${port}${MCP_PATH}`,
    ...(options.subscriptions ? { subscriptionsUrl: `http://${HOST}:${port}${SUBSCRIPTIONS_PATH}` } : {}),
    ...(options.playback ? { playbackUrl: `http://${HOST}:${port}${PLAYBACK_PATH}` } : {}),
    ...(options.answer ? { answerUrl: `http://${HOST}:${port}${ANSWER_PATH}` } : {}),
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
        http.closeAllConnections();
      }),
  };
}
