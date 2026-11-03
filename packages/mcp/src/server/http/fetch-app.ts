import {
  hostHeaderValidation,
  originValidation,
} from '@modelcontextprotocol/hono';
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';
import { Hono } from 'hono';
import {
  createServerBudgets,
  type BudgetSettings,
  type RequestLifetime,
} from '../lifetime.js';
import { attachRequestLifetime } from '../request-closure.js';

// Fetch hosting for a stateless MCP endpoint: `fetch(Request) => Response` for a Workers entry
// point, or for any Node listener the application chooses. The official Hono middleware admits by
// Host and Origin, the official handler owns transports, protocol negotiation, JSON/SSE delivery
// and transport cleanup, and the existing `attachRequestLifetime` ends each request's lifetime.
// This module starts no listener, reads no environment variable or file, forwards nothing to an
// upstream and keeps no state between requests. The platform or listener owns network admission,
// the body arriving, socket timeouts and shutdown.

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
  /** Operation and request budgets. A request's budget starts when `createServer` is entered. */
  readonly budgets?: BudgetSettings;
  /** The upstream handler's bound on a body it reads itself. Defaults to the handler's own (4 MiB). */
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

  const handler = createMcpHandler(
    async () => {
      // The request's budget starts here, when the server factory is entered.
      const lifetime = budgets.startRequest();
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
      onerror: () => report('handler'),
      ...(options.maxRequestBodySize === undefined
        ? {}
        : { maxRequestBodySize: options.maxRequestBodySize }),
    },
  );

  const app = new Hono();
  app.use(path, hostHeaderValidation(hosts));
  app.use(path, originValidation(origins));
  app.all(path, (c) => handler.fetch(c.req.raw));
  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((_error, c) => {
    report('route');
    return c.json({ error: 'internal_error' }, 500);
  });

  let closing: Promise<void> | undefined;
  return {
    fetch: (request) => Promise.resolve(app.fetch(request)),
    close: () => (closing ??= handler.close()),
  };
}
