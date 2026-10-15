import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticate } from './request-auth.js';
import { createEpisodeServer, type EpisodeCatalog } from './server.js';
import { SUBSCRIPTION_LIMITS } from './subscriptions.js';
import {
  classifySubscriptionsBody,
  declaredBodyTooLarge,
  transportHeaderFailure,
  writeProtocol,
  writeTransport,
} from './subscriptions-request.js';
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

export interface EpisodeListenerOptions {
  readonly viewHtml: string;
  readonly catalog: EpisodeCatalog;
  /** Use 0 for an ephemeral port. */
  readonly port: number;
  /** When absent, the protected path does not exist. */
  readonly subscriptions?: SubscriptionsEndpointOptions;
}

export interface EpisodeListener {
  /** Streamable HTTP endpoint, e.g. http://127.0.0.1:3001/mcp (public, unauthenticated). */
  readonly url: string;
  /** Protected endpoint (bearer credential required); undefined unless configured. */
  readonly subscriptionsUrl?: string;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const MCP_PATH = '/mcp';
const SUBSCRIPTIONS_PATH = '/subscriptions/mcp';

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

  async function readLimitedBody(req: IncomingMessage): Promise<{ tooLarge: true } | { tooLarge: false; text: string }> {
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
        if (received > SUBSCRIPTION_LIMITS.maxRequestBytes) {
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

  async function serveSubscriptions(
    endpoint: SubscriptionsEndpointOptions,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    if (declaredBodyTooLarge(req)) return writeTransport(res, { kind: 'transport', status: 413, error: 'payload_too_large' });
    const decision = await authenticate(req, endpoint.verifier);
    if (!decision.ok) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (decision.challenge) headers['www-authenticate'] = decision.challenge;
      return void res.writeHead(decision.status, headers).end(JSON.stringify({ error: decision.error }));
    }
    const headerFailure = transportHeaderFailure(req);
    if (headerFailure) return writeTransport(res, headerFailure);
    const body = await readLimitedBody(req);
    if (body.tooLarge) return rejectOversized(req, res);
    const gate = classifySubscriptionsBody(body.text);
    if (gate.kind === 'transport') return writeTransport(res, gate);
    if (gate.kind === 'protocol') return writeProtocol(res, gate);
    // The SDK transport passes `req.auth` to each tool call as `extra.authInfo`.
    Object.assign(req, { auth: decision.authInfo });
    const server = createSubscriptionsServer({
      viewHtml: endpoint.viewHtml,
      backend: endpoint.backend,
      labelViewSession,
      ...(endpoint.readBoundMs === undefined ? {} : { readBoundMs: endpoint.readBoundMs }),
    });
    await serve(server, req, res, gate.body, SUBSCRIPTION_LIMITS.maxRequestBytes);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    const protectedEndpoint = path === SUBSCRIPTIONS_PATH ? options.subscriptions : undefined;
    if (path !== MCP_PATH && !protectedEndpoint) return void res.writeHead(404).end();
    if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();

    if (protectedEndpoint) return serveSubscriptions(protectedEndpoint, req, res);
    await serve(createEpisodeServer({ viewHtml: options.viewHtml, catalog: options.catalog }), req, res);
  }

  return {
    url: `http://${HOST}:${port}${MCP_PATH}`,
    ...(options.subscriptions ? { subscriptionsUrl: `http://${HOST}:${port}${SUBSCRIPTIONS_PATH}` } : {}),
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
        http.closeAllConnections();
      }),
  };
}
