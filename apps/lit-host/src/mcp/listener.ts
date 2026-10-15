import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMediaService, type MediaStore } from '../playback/media-service.js';
import { CAPABILITY_HEADER, PROOF_HEADER } from '../playback/media-proof.js';
import { MEDIA_PATH_PREFIX, OPEN_TOOL_NAME, PLAY_TOOL_NAME, PLAYBACK_LIMITS } from '../playback/playback.js';
import { createPlaybackServer, type PlaybackBackend } from '../playback/playback-server.js';
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
import {
  createSubscriptionsServer,
  createViewSessionLabeler,
  type SubscriptionBackend,
} from './subscriptions-server.js';

/** Optional protected endpoint: the signed-in user's own subscriptions. */
export interface SubscriptionsEndpointOptions {
  readonly viewHtml: string;
  readonly backend: SubscriptionBackend;
  /** Decides who each request is. The application chooses it; nothing here falls back to a default. */
  readonly verifier: OAuthTokenVerifier;
  /**
   * How long the backend read may run before the server retires it.
   * Defaults to the documented browse bound. A later resolution is not returned.
   */
  readonly readBoundMs?: number;
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
}

/** Header values arrive as `string | string[]`; a repeated header is not a valid credential. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export interface EpisodeListenerOptions {
  readonly viewHtml: string;
  readonly catalog: EpisodeCatalog;
  /** Use 0 for an ephemeral port. */
  readonly port: number;
  /** When absent, the protected path does not exist. */
  readonly subscriptions?: SubscriptionsEndpointOptions;
  /** When absent, the protected path does not exist. */
  readonly playback?: PlaybackEndpointOptions;
}

export interface EpisodeListener {
  /** Streamable HTTP endpoint, e.g. http://127.0.0.1:3001/mcp (public, unauthenticated). */
  readonly url: string;
  /** Protected endpoint (bearer credential required); undefined unless configured. */
  readonly subscriptionsUrl?: string;
  /** Protected endpoint (bearer credential required); undefined unless configured. */
  readonly playbackUrl?: string;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const MCP_PATH = '/mcp';
const SUBSCRIPTIONS_PATH = '/subscriptions/mcp';
const PLAYBACK_PATH = '/playback/mcp';

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
  createServer(): McpServer;
}

/**
 * Application-owned HTTP hosting for the MCP servers: loopback only, stateless Streamable HTTP
 * (a fresh server and transport per POST, JSON responses), DNS-rebinding protection on the
 * Host header. `/mcp` is public. `/subscriptions/mcp`, when configured, authenticates every
 * request before any server is built; the verified identity reaches the tool only as the
 * SDK's per-request auth context.
 */
export async function startEpisodeListener(options: EpisodeListenerOptions): Promise<EpisodeListener> {
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
        entitlement: (accountId, episodeId) => playback.backend.checkEntitlement(accountId, episodeId),
        ...(playback.capabilityTtlSeconds === undefined ? {} : { ttlSeconds: playback.capabilityTtlSeconds }),
        ...(playback.nowSeconds === undefined ? {} : { nowSeconds: playback.nowSeconds }),
      })
    : undefined;

  http.on('request', (req, res) => {
    void handle(req, res).catch(() => {
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
  ): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
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

  async function readLimitedBody(req: IncomingMessage, maxBytes: number): Promise<{ tooLarge: true } | { tooLarge: false; text: string }> {
    // Do not iterate with for-await: leaving that loop destroys the socket before a 413 can be written.
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      let settled = false;
      const detach = () => {
        req.off('data', onData);
        req.off('end', onEnd);
        req.off('error', onError);
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
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', onError);
    });
  }

  function rejectOversized(req: IncomingMessage, res: ServerResponse): void {
    writeTransport(res, { kind: 'transport', status: 413, error: 'payload_too_large' });
    const cleanup = () => req.destroy();
    if (res.writableFinished) cleanup();
    else res.once('finish', cleanup);
  }

  /**
   * The one order every protected endpoint follows: authenticate before reading the body, then
   * classify the request, then build a server and hand it the verified identity. Only the policy,
   * the credential requirement and the server differ between endpoints.
   */
  async function serveProtected(
    endpoint: ProtectedEndpoint,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (declaredBodyTooLarge(req, endpoint.policy)) return writeTransport(res, { kind: 'transport', status: 413, error: 'payload_too_large' });
    const decision = await authenticate(req, endpoint.verifier, endpoint.requirement);
    if (!decision.ok) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (decision.challenge) headers['www-authenticate'] = decision.challenge;
      return void res.writeHead(decision.status, headers).end(JSON.stringify({ error: decision.error }));
    }
    const headerFailure = transportHeaderFailure(req);
    if (headerFailure) return writeTransport(res, headerFailure);
    const body = await readLimitedBody(req, endpoint.policy.limits.maxRequestBytes);
    if (body.tooLarge) return rejectOversized(req, res);
    const gate = classifyProtectedBody(body.text, endpoint.policy);
    if (gate.kind === 'transport') return writeTransport(res, gate);
    if (gate.kind === 'protocol') return writeProtocol(res, gate);
    // The SDK transport passes `req.auth` to each tool call as `extra.authInfo`.
    Object.assign(req, { auth: decision.authInfo });
    await serve(endpoint.createServer(), req, res, gate.body, endpoint.policy.limits.maxRequestBytes);
  }

  function protectedEndpointAt(path: string): ProtectedEndpoint | undefined {
    if (path === SUBSCRIPTIONS_PATH && options.subscriptions) {
      const endpoint = options.subscriptions;
      return {
        policy: SUBSCRIPTIONS_POLICY,
        requirement: SUBSCRIPTIONS_REQUIREMENT,
        verifier: endpoint.verifier,
        createServer: () =>
          createSubscriptionsServer({
            viewHtml: endpoint.viewHtml,
            backend: endpoint.backend,
            labelViewSession,
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
        createServer: () =>
          createPlaybackServer({
            viewHtml: endpoint.viewHtml,
            backend: endpoint.backend,
            mediaService,
            labelViewSession,
            mediaOrigin: origin,
          }),
      };
    }
    return undefined;
  }

  const MEDIA_PATH = new RegExp(`^${MEDIA_PATH_PREFIX}([a-z0-9][a-z0-9-]{0,63})$`);
  // The player runs in a sandboxed iframe with an opaque origin, so its fetch is cross-origin and
  // sends `Origin: null`. Any origin may therefore read the response, which is safe only because
  // nothing ambient authorizes it: credentials are never allowed (no cookie or auth header is
  // honored) and the capability plus a fresh proof from the bound key decide every request.
  const CORS_HEADERS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET',
    'access-control-allow-headers': `${CAPABILITY_HEADER}, ${PROOF_HEADER}`,
    'access-control-max-age': '600',
  } as const;
  const REFUSED_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS_HEADERS } as const;

  /**
   * The synthetic media service's HTTP edge. It never authenticates the person; the capability and
   * the recipient's proof decide, and a refusal says nothing about which check failed. The URL the
   * proof must name is built from this listener's own origin, never from the Host header.
   */
  async function serveMedia(req: IncomingMessage, res: ServerResponse, episodeId: string): Promise<void> {
    if (!mediaService) return void res.writeHead(404).end();
    let outcome;
    try {
      outcome = await mediaService.acquire({
        episodeId,
        url: `${origin}${MEDIA_PATH_PREFIX}${episodeId}`,
        method: req.method ?? '',
        capability: singleHeader(req.headers[CAPABILITY_HEADER]),
        proof: singleHeader(req.headers[PROOF_HEADER]),
        range: singleHeader(req.headers.range),
      });
    } catch {
      // The entitlement lookup or the storage read failed. That is neither a grant nor a refusal of
      // this caller, so say "try again" (503) without any dependency text, readable by the view.
      return void res.writeHead(503, REFUSED_HEADERS).end(JSON.stringify({ error: 'unavailable' }));
    }
    if (outcome.kind === 'refused') return void res.writeHead(403, REFUSED_HEADERS).end(JSON.stringify({ error: 'forbidden' }));
    if (outcome.kind === 'unsatisfiable') {
      // Sent only to a caller who passed every check, so the length is not a probe for anyone else.
      res.writeHead(416, { 'cache-control': 'private, no-store', 'content-range': `bytes */${outcome.total}`, ...CORS_HEADERS }).end();
      return;
    }
    const delivered = {
      'content-type': outcome.media.contentType,
      'cache-control': 'private, no-store',
      'content-length': outcome.media.bytes.length,
      'accept-ranges': 'bytes',
      ...CORS_HEADERS,
    };
    if (outcome.kind === 'partial') {
      res
        .writeHead(206, { ...delivered, 'content-range': `bytes ${outcome.first}-${outcome.last}/${outcome.total}` })
        .end(Buffer.from(outcome.media.bytes));
      return;
    }
    res.writeHead(200, delivered).end(Buffer.from(outcome.media.bytes));
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    const mediaMatch = MEDIA_PATH.exec(path);
    if (mediaMatch?.[1] && options.playback) {
      // A preflight carries no credential and reaches no media: it only answers which headers the
      // real request may send.
      if (req.method === 'OPTIONS') return void res.writeHead(204, CORS_HEADERS).end();
      if (req.method !== 'GET') return void res.writeHead(405, { allow: 'GET, OPTIONS' }).end();
      return serveMedia(req, res, mediaMatch[1]);
    }
    const protectedEndpoint = protectedEndpointAt(path);
    if (path !== MCP_PATH && !protectedEndpoint) return void res.writeHead(404).end();
    if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();

    if (protectedEndpoint) return serveProtected(protectedEndpoint, req, res);
    await serve(createEpisodeServer({ viewHtml: options.viewHtml, catalog: options.catalog }), req, res);
  }

  return {
    url: `http://${HOST}:${port}${MCP_PATH}`,
    ...(options.subscriptions ? { subscriptionsUrl: `http://${HOST}:${port}${SUBSCRIPTIONS_PATH}` } : {}),
    ...(options.playback ? { playbackUrl: `http://${HOST}:${port}${PLAYBACK_PATH}` } : {}),
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
        http.closeAllConnections();
      }),
  };
}
