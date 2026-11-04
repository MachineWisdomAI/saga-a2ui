import {
  hostHeaderValidation,
  originValidation,
} from '@modelcontextprotocol/hono';
import {
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  isJsonContentType,
  readRequestBody,
  type McpServer,
} from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import { createEndpoint } from '../endpoint.js';
import {
  createServerBudgets,
  type BoundedScope,
  type BudgetSettings,
  type LifetimeCause,
  type RequestLifetime,
} from '../lifetime.js';
import { attachRequestLifetime } from '../request-closure.js';

// Fetch hosting for a stateless MCP endpoint: `fetch(Request) => Response` for a Workers entry
// point, or for any Node listener the application chooses. The official Hono middleware admits by
// Host and Origin, the official handler owns transports, protocol negotiation, JSON/SSE delivery
// and transport cleanup, and the existing `attachRequestLifetime` ends each request's lifetime.
// This module starts no listener, reads no environment variable or file, forwards nothing to an
// upstream and keeps no state between requests.
//
// Time: a request's lifetime starts when the route admits it, before the body is read. The size
// check, the official bounded reader (`readRequestBody`) and the JSON parse then run as one `body`
// stage of that lifetime, so a body that is declared too large, grows too large, arrives too slowly
// or parses too slowly is refused before any server exists, and a lifetime already spent is never
// handed to the factory. When the stage ends a read that is waiting, the body is cancelled and
// unlocked. The platform or listener still owns network admission, socket timeouts and shutdown.

const DEFAULT_PATH = '/mcp';

/** A route is a literal path: no parameter, wildcard, query or trailing slash that could match more. */
const LITERAL_PATH = /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/;

/** The fixed kinds a diagnostic can report. None carries a request, a response or an exception. */
export type McpFetchFailureKind =
  /** The application's server factory threw, or its server could not carry the request's lifetime. */
  | 'server-factory'
  /** The official handler reported an error while serving a request. */
  | 'handler'
  /** The route itself failed outside the handler. */
  | 'route';

export interface McpFetchAppOptions {
  /**
   * A fresh server for one protocol request. Register operations on it with the supplied lifetime
   * (`registerPublicOperation` / `registerProtectedOperation`) and keep application state outside
   * this callback. The SDK ends `lifetime` when the returned server closes, with or without a
   * connected transport, and ends it if this callback throws; do not subclass the server to do so.
   */
  readonly createServer: (
    lifetime: RequestLifetime,
  ) => McpServer | Promise<McpServer>;
  /** Host names admitted to the route. Explicit; an empty array admits none. Nothing is added. */
  readonly allowedHosts: readonly string[];
  /** Origin host names admitted to the route. A request without an Origin header is not refused for it. */
  readonly allowedOrigins: readonly string[];
  /** The one exact route. Defaults to `/mcp`. Any other path answers 404. */
  readonly path?: string;
  /** `json` never streams (mid-call progress is dropped); `sse` always streams. Defaults to `json`. */
  readonly responseMode?: 'json' | 'sse';
  /** Operation and request budgets. A request's budget starts when the route admits it, before its body is read. */
  readonly budgets?: BudgetSettings;
  /** The most request body bytes read, declared or observed. Defaults to the official handler's (4 MiB). */
  readonly maxRequestBodySize?: number;
  /** Receives a fixed failure kind. Never receives arguments, responses, credentials or an exception. */
  readonly onFailure?: (kind: McpFetchFailureKind) => void;
}

export interface McpFetchApp {
  /** Serves one request. Safe to detach and pass around. */
  readonly fetch: (request: Request) => Promise<Response>;
  /** Aborts in-flight exchanges through the official handler. Repeated calls share one shutdown. */
  close(): Promise<void>;
}

/** The hosting settings are unusable. Names the setting, never a value. */
export class McpFetchConfigurationError extends Error {
  constructor(problems: readonly string[]) {
    super(`The MCP Fetch app is not configured: ${problems.join('; ')}.`);
    this.name = 'McpFetchConfigurationError';
  }
}

/** Trims and de-duplicates a list. Returns `undefined` when it is not a list of non-blank strings. */
function explicitList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string') return undefined;
    const trimmed = entry.trim();
    if (trimmed === '') return undefined;
    if (!entries.includes(trimmed)) entries.push(trimmed);
  }
  return entries;
}

function validated(options: McpFetchAppOptions): {
  path: string;
  hosts: string[];
  origins: string[];
} {
  const problems: string[] = [];
  if (typeof options.createServer !== 'function')
    problems.push('createServer must be a function');
  const hosts = explicitList(options.allowedHosts);
  if (hosts === undefined)
    problems.push('allowedHosts must be an explicit list of non-blank names');
  const origins = explicitList(options.allowedOrigins);
  if (origins === undefined)
    problems.push('allowedOrigins must be an explicit list of non-blank names');
  const path = options.path ?? DEFAULT_PATH;
  if (typeof path !== 'string' || !LITERAL_PATH.test(path))
    problems.push(
      'path must be a literal absolute path without a parameter, wildcard, query or trailing slash',
    );
  if (
    options.responseMode !== undefined &&
    options.responseMode !== 'json' &&
    options.responseMode !== 'sse'
  )
    problems.push('responseMode must be "json" or "sse"');
  const size = options.maxRequestBodySize;
  if (
    size !== undefined &&
    !(typeof size === 'number' && Number.isFinite(size) && size > 0)
  )
    problems.push('maxRequestBodySize must be a finite positive number');
  if (problems.length > 0 || hosts === undefined || origins === undefined)
    throw new McpFetchConfigurationError(problems);
  return { path, hosts, origins };
}

/** The error body of the official handler, so a refusal reads the same wherever it is made. */
function jsonRpcError(
  status: 400 | 413 | 408,
  code: number,
  message: string,
): Response {
  return Response.json(
    { jsonrpc: '2.0', error: { code, message }, id: null },
    // A refused body may still be arriving: ask the listener not to keep the connection for it.
    { status, headers: { connection: 'close' } },
  );
}

/** Thrown inside the server callback to stop the official handler before any application code runs. */
class SpentLifetime extends Error {
  constructor() {
    super('The request lifetime was spent before the server was built.');
    this.name = 'SpentLifetime';
  }
}

/** A body stage that did not finish. The caller going away is not answered; a stall or a failing stream is. */
function bodyFailure(cause: LifetimeCause): Response {
  switch (cause.kind) {
    case 'disconnected':
    case 'cancelled':
    case 'completed':
      return new Response(null, { status: 499 });
    case 'dependency-failure':
      return jsonRpcError(
        400,
        -32700,
        'Parse error: the request body could not be read',
      );
    default:
      return Response.json(
        { error: 'request_timeout' },
        { status: 408, headers: { connection: 'close' } },
      );
  }
}

/**
 * Hosts one stateless MCP endpoint behind `fetch`. Validates its settings (and budgets) before it
 * handles any traffic. A request that fails the Host or Origin rule, or names another path, runs
 * no application code.
 */
export function createMcpFetchApp(options: McpFetchAppOptions): McpFetchApp {
  const { path, hosts, origins } = validated(options);
  // The budgets are validated here, not on the first request.
  const budgets = createServerBudgets(options.budgets);
  const report = (kind: McpFetchFailureKind): void => {
    try {
      options.onFailure?.(kind);
    } catch {
      // A diagnostic sink must not change what the caller receives.
    }
  };

  // The lifetime a request was admitted with reaches the server factory through the request object.
  // A lifetime the factory never claims (a refusal, or a request the official handler answers without
  // building a server) is ended by the route that admitted it.
  const claimed = new WeakSet<RequestLifetime>();
  // A lifetime that was already spent when the official handler reached the factory: the cause it
  // ended with, for the route to answer once the handler has unwound.
  const refused = new WeakMap<RequestLifetime, LifetimeCause>();
  const maxRequestBodySize =
    options.maxRequestBodySize ?? DEFAULT_MAX_REQUEST_BODY_SIZE;
  const endpoint = createEndpoint(
    async (lifetime) => {
      // The official handler classifies and validates the parsed request before it calls the
      // factory, and that work spends the same budget. The last place to refuse a spent lifetime is
      // here, immediately before application code is built.
      const expired = lifetime.check();
      if (expired !== undefined) {
        refused.set(lifetime, expired);
        throw new SpentLifetime();
      }
      claimed.add(lifetime);
      try {
        const server = await options.createServer(lifetime);
        attachRequestLifetime(server, lifetime);
        return server;
      } catch (error) {
        // The factory failed, or its server already carries a different lifetime: nothing will
        // close a server for this lifetime, so it ends here.
        lifetime.finish();
        report('server-factory');
        throw error;
      }
    },
    {
      responseMode: options.responseMode ?? 'json',
      // A spent lifetime is a refusal the route answers itself, not a handler failure.
      onerror: (error) => {
        if (!(error instanceof SpentLifetime)) report('handler');
      },
      maxRequestBodySize,
    },
  );

  type BodyOutcome =
    | { readonly kind: 'parsed'; readonly value: unknown }
    | { readonly kind: 'too-large' }
    | { readonly kind: 'invalid' };

  /**
   * The same request with a body that this stage can end. The official reader locks whatever body
   * it is given and offers no way to stop a read that is waiting, so it is given a relay over the
   * original stream instead: when the stage ends for any reason, the relay's source is cancelled,
   * which settles the waiting read, stops further pulls and unlocks the original body.
   */
  function relayed(request: Request, scope: BoundedScope): Request {
    const original = request.body;
    if (original === null) return request;
    const source = original.getReader();
    let ended = false;
    const end = (reason: unknown): Promise<void> => {
      if (ended) return Promise.resolve();
      ended = true;
      return source.cancel(reason).then(
        () => source.releaseLock(),
        () => source.releaseLock(),
      );
    };
    scope.signal.addEventListener(
      'abort',
      () => void end(scope.signal.reason),
      {
        once: true,
      },
    );
    const relay = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          const next = await source.read();
          if (ended || next.done) controller.close();
          else controller.enqueue(next.value);
        },
        cancel: end,
      },
      // The official reader asks for one chunk at a time: nothing is read ahead of it.
      { highWaterMark: 0 },
    );
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: relay,
      duplex: 'half',
    } as RequestInit);
  }

  /**
   * Reads and parses a POST body as one bounded stage of the request, so a stall, an oversize body
   * and a slow parse all spend the same budget. A `Response` is the answer for a request that
   * cannot go on; nothing has been built for it.
   */
  async function readJsonBody(
    request: Request,
    lifetime: RequestLifetime,
  ): Promise<{ readonly value: unknown } | Response> {
    const read = await lifetime.run(
      'body',
      async (scope): Promise<BodyOutcome> => {
        const body = await readRequestBody(
          relayed(request, scope),
          maxRequestBodySize,
        );
        if (body.tooLarge) return { kind: 'too-large' };
        try {
          return { kind: 'parsed', value: JSON.parse(body.text) as unknown };
        } catch {
          return { kind: 'invalid' };
        }
      },
    );
    if (!read.ok) {
      if (read.cause.kind === 'dependency-failure') lifetime.record(read.cause);
      return bodyFailure(read.cause);
    }
    switch (read.value.kind) {
      case 'too-large':
        return jsonRpcError(
          413,
          -32000,
          `Payload Too Large: Request body must not exceed ${maxRequestBodySize} bytes`,
        );
      case 'invalid':
        return jsonRpcError(400, -32700, 'Parse error: Invalid JSON');
      case 'parsed':
        return { value: read.value.value };
    }
  }

  async function serve(request: Request): Promise<Response> {
    // The request's clock starts here, at admission and before any body wait.
    const lifetime = budgets.startRequest();
    try {
      // A body the official handler would refuse for its type is not read at all.
      const body =
        request.method.toUpperCase() === 'POST' &&
        isJsonContentType(request.headers.get('content-type'))
          ? await readJsonBody(request, lifetime)
          : undefined;
      if (body instanceof Response) return body;
      // A budget that ran out while the request was being prepared admits no server.
      const expired = lifetime.check();
      if (expired !== undefined) return bodyFailure(expired);
      // A bounded `parsedBody` keeps the official handler from cloning or re-reading the request,
      // which would also discard the object-identity association with this lifetime.
      const response = await endpoint.fetch(request, lifetime, {
        ...(body === undefined ? {} : { parsedBody: body.value }),
      });
      // The factory refused a lifetime the handler had spent: answer that, not the handler's error.
      const late = refused.get(lifetime);
      return late === undefined ? response : bodyFailure(late);
    } finally {
      if (!claimed.has(lifetime)) lifetime.finish();
    }
  }

  const app = new Hono();
  app.use(path, hostHeaderValidation(hosts));
  app.use(path, originValidation(origins));
  app.all(path, (c) => serve(c.req.raw));
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((_error, c) => {
    report('route');
    return c.json({ error: 'internal_error' }, 500);
  });

  let closing: Promise<void> | undefined;
  return {
    fetch: (request) => Promise.resolve(app.fetch(request)),
    close: () => (closing ??= endpoint.close()),
  };
}
