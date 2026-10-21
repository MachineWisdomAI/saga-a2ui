import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/server';
import {
  createContentPolicy,
  type ContentPolicy,
} from '@saga-a2ui/components/faithful-card';
import { createServerBudgets } from '@saga-a2ui/mcp/server';
import {
  startEpisodeListener,
  type EpisodeListener,
} from '../../../apps/lit-host/src/mcp/listener.js';
import { SIGN_INS, createDemoVerifier } from '../fixtures/sign-ins.js';
import {
  CONTROL_NAMES,
  EPISODE_IDS,
  createDemoWorld,
  isControlName,
  type DemoWorld,
} from '../fixtures/world.js';
import { serveNotes } from './notes-endpoint.js';

// The demonstration's composition root, as a function so a test can start it the way the process
// does. Four loopback listeners, all in this process:
//
//   the application's listener   browse, Play and the Standard episode description (apps/lit-host)
//   a second listener            the Strict episode description (a policy is fixed per listener)
//   this module's server         the host page, its small proxy and the notes endpoint
//
// The host page is a stand-in for an assistant host. A browser page cannot send the bearer
// credential to the MCP listeners itself (they allow no cross-origin caller), so the host's
// server side forwards the page's JSON-RPC calls, as a real host's backend does. It forwards
// three methods to five known endpoints and nothing else.

const HOST = '127.0.0.1';
const NOTES_PATH = '/notes/mcp';
const MAX_HOST_BODY_BYTES = 64 * 1024;
const FORWARD_TIMEOUT_MS = 15_000;

export const ENDPOINT_IDS = [
  'subscriptions',
  'playback',
  'episode-standard',
  'episode-strict',
  'notes',
] as const;
export type EndpointId = (typeof ENDPOINT_IDS)[number];
const isEndpointId = (value: unknown): value is EndpointId =>
  typeof value === 'string' &&
  (ENDPOINT_IDS as readonly string[]).includes(value);

const FORWARDED_METHODS = [
  'tools/list',
  'tools/call',
  'resources/read',
] as const;
const isForwardedMethod = (
  value: unknown,
): value is (typeof FORWARDED_METHODS)[number] =>
  typeof value === 'string' &&
  (FORWARDED_METHODS as readonly string[]).includes(value);

/** The built pages the demonstration serves; each is read by the caller before any port opens. */
export interface DemoViews {
  readonly episode: string;
  readonly subscriptions: string;
  readonly playback: string;
  readonly notes: string;
  readonly host: string;
}

export interface DemoOptions {
  readonly views: DemoViews;
  /** The port of the host page. Use 0 for an ephemeral port. */
  readonly port: number;
  /** How long an issued media capability lives, in seconds. */
  readonly capabilityTtlSeconds?: number;
  /** An HTTPS host whose images the episode descriptions may show. None by default, so the demonstration fetches nothing outside this machine. */
  readonly imageHost?: string;
  readonly world?: DemoWorld;
  /** Replaces the local-only verifier; for tests of the wiring. */
  readonly verifier?: OAuthTokenVerifier;
}

export interface RunningDemo {
  /** The page to open. */
  readonly hostUrl: string;
  readonly endpoints: Readonly<Record<EndpointId, string>>;
  readonly world: DemoWorld;
  close(): Promise<void>;
}

export class DemoConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoConfigurationError';
  }
}

function contentPolicy(
  config: Parameters<typeof createContentPolicy>[0],
): ContentPolicy {
  const created = createContentPolicy(config);
  if (!created.ok)
    throw new DemoConfigurationError(
      `The content policy is not valid: ${created.failure.message}`,
    );
  return created.policy;
}

const readJsonBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > MAX_HOST_BODY_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function startDemo(options: DemoOptions): Promise<RunningDemo> {
  if (process.env.NODE_ENV === 'production') {
    throw new DemoConfigurationError(
      'This demonstration uses fixed, public, local-only credentials and refuses to start in a production environment.',
    );
  }
  const world = options.world ?? createDemoWorld();
  const verifier = options.verifier ?? createDemoVerifier();
  const imageHosts = options.imageHost === undefined ? [] : [options.imageHost];
  const standard = contentPolicy({ imageHosts });
  const strict = contentPolicy({ level: 'strict', imageHosts });
  const { views } = options;

  const application = await startEpisodeListener({
    viewHtml: views.episode,
    viewFilename: 'episode.html',
    catalog: world.catalog,
    contentPolicy: standard,
    port: 0,
    subscriptions: {
      viewHtml: views.subscriptions,
      backend: world.subscriptions,
      verifier,
    },
    playback: {
      viewHtml: views.playback,
      backend: world.playback,
      mediaStore: world.media,
      verifier,
      ...(options.capabilityTtlSeconds === undefined
        ? {}
        : { capabilityTtlSeconds: options.capabilityTtlSeconds }),
    },
  });
  let strictListener: EpisodeListener | undefined;
  const http: Server = createServer();
  try {
    strictListener = await startEpisodeListener({
      viewHtml: views.episode,
      viewFilename: 'episode.html',
      catalog: world.catalog,
      contentPolicy: strict,
      port: 0,
    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(options.port, HOST, resolve);
    });
  } catch (error) {
    await Promise.allSettled([application.close(), strictListener?.close()]);
    throw error;
  }
  const { port } = http.address() as AddressInfo; // listen() on a TCP port yields AddressInfo
  const origin = `http://${HOST}:${port}`;
  const allowedHosts = [`${HOST}:${port}`, `localhost:${port}`];
  const budgets = createServerBudgets();
  const endpoints: Record<EndpointId, string> = {
    subscriptions: application.subscriptionsUrl ?? '',
    playback: application.playbackUrl ?? '',
    'episode-standard': application.url,
    'episode-strict': (strictListener as EpisodeListener).url,
    notes: `${origin}${NOTES_PATH}`,
  };

  const reply = (
    res: ServerResponse,
    status: number,
    type: string,
    body: string,
  ): void =>
    void res
      .writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
      .end(body);
  const json = (res: ServerResponse, status: number, body: unknown): void =>
    reply(res, status, 'application/json', JSON.stringify(body));

  /** The host's own surface answers only a request that names this origin: its Host header, and the Origin of any browser that sent one. */
  const namesThisOrigin = (req: IncomingMessage): boolean => {
    const host = req.headers.host;
    if (host === undefined || !allowedHosts.includes(host)) return false;
    return (
      req.headers.origin === undefined ||
      req.headers.origin === `http://${host}`
    );
  };

  /** One JSON-RPC call forwarded to a known endpoint with the credential the page chose. */
  async function forward(body: unknown): Promise<unknown> {
    if (
      !isRecord(body) ||
      !isEndpointId(body.endpoint) ||
      !isForwardedMethod(body.method)
    )
      return undefined;
    const { endpoint, method, params, token } = body;
    if (token !== undefined && typeof token !== 'string') return undefined;
    const response = await fetch(endpoints[endpoint], {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: isRecord(params) ? params : {},
      }),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // A refusal can carry only a status and a challenge; an empty body is reported as null.
    }
    return {
      status: response.status,
      challenge: response.headers.get('www-authenticate'),
      body: parsed,
    };
  }

  const config = {
    signIns: SIGN_INS.map((one) => ({
      id: one.id,
      label: one.label,
      token: one.token ?? null,
      effect: one.effect,
    })),
    episodes: [
      { id: EPISODE_IDS.entitled, title: 'The first synthetic episode' },
      { id: EPISODE_IDS.unavailable, title: 'The second synthetic episode' },
    ],
    controls: CONTROL_NAMES,
    imageHost: options.imageHost ?? null,
  };

  http.on('request', (req, res) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', origin).pathname;
    } catch {
      // An unparseable target is answered below as an unknown path.
    }
    const settle = (work: Promise<void>): void =>
      void work.catch(() => {
        if (res.destroyed) return;
        if (!res.headersSent) res.writeHead(500).end();
        else res.end();
      });

    // The notes endpoint is an SDK request: its clock starts at admission, before authentication.
    if (pathname === NOTES_PATH)
      return settle(
        serveNotes(
          { html: views.notes, backend: world.notes, verifier, allowedHosts },
          req,
          res,
          budgets.startRequest(),
        ),
      );

    if (!namesThisOrigin(req)) return void res.writeHead(403).end();
    if (req.method === 'GET' && pathname === '/')
      return reply(res, 200, 'text/html; charset=utf-8', views.host);
    if (req.method === 'GET' && pathname === '/host/config')
      return json(res, 200, { ...config, state: world.state() });
    if (req.method === 'GET' && pathname === '/host/state')
      return json(res, 200, world.state());
    if (
      req.method === 'POST' &&
      (pathname === '/host/rpc' || pathname === '/host/controls')
    ) {
      // Only a JSON content type: a cross-origin page then needs a preflight, which this server never grants.
      if (
        !String(req.headers['content-type'] ?? '').startsWith(
          'application/json',
        )
      )
        return void res.writeHead(415).end();
      return settle(
        readJsonBody(req).then(
          async (body) => {
            if (pathname === '/host/controls') {
              const name = isRecord(body) ? body.name : undefined;
              return isControlName(name)
                ? json(res, 200, world.control(name))
                : json(res, 400, { error: 'unknown_control' });
            }
            const forwarded = await forward(body);
            return forwarded === undefined
              ? json(res, 400, { error: 'request_not_forwarded' })
              : json(res, 200, forwarded);
          },
          () => json(res, 400, { error: 'unreadable_request' }),
        ),
      );
    }
    res.writeHead(404).end();
  });

  return {
    hostUrl: `${origin}/`,
    endpoints,
    world,
    close: async () => {
      await Promise.all([
        application.close(),
        strictListener?.close(),
        new Promise<void>((resolve) => {
          http.close(() => resolve());
          http.closeAllConnections();
        }),
      ]);
    },
  };
}
