import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener, type HttpBindings } from '@hono/node-server';
import {
  hostHeaderValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/hono';
import { readRequestBody, type McpServer } from '@modelcontextprotocol/server';
import {
  createServerBudgets,
  type BudgetSettings,
  type LifetimeCause,
  type RequestLifetime,
} from '../lifetime.js';
import { Hono, type Context } from 'hono';
import { createEndpoint } from './endpoint.js';

// Local Node hosting for a stateless MCP endpoint. The official Hono middleware owns Host
// and Origin validation. This adapter owns admission, bounded body reading, response completion
// and shutdown; the application supplies a fresh MCP server for each admitted request.
// createMcpHonoApp parses the body before routes run, so its validators are installed separately
// here to keep body reading within the same request deadline as operation execution.

const HOST = '127.0.0.1';
const ALLOWED_HOSTNAMES = ['127.0.0.1', 'localhost'];
const MCP_PATH = '/mcp';
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface LocalMcpServerOptions {
  /** A fresh server for one request. Keep application state outside this callback. */
  readonly createServer: (lifetime: RequestLifetime) => McpServer;
  /** Use 0 for an ephemeral port. */
  readonly port: number;
  /**
   * 3,000 ms per operation and 10,000 ms per request unless stated. A field you leave out keeps
   * its default, and an invalid value fails before the port opens.
   */
  readonly budgets?: BudgetSettings;
}

export interface LocalMcpServer {
  /** The loopback MCP endpoint, always at /mcp. */
  readonly url: string;
  close(): Promise<void>;
}

/** `Bindings` are the Node request and response the Hono Node adapter hands to every request. */
interface Environment {
  Bindings: HttpBindings;
  Variables: { lifetime: RequestLifetime };
}

type RequestContext = Context<Environment>;

/**
 * Serves /mcp on 127.0.0.1 with a 1 MiB body limit and bounded request lifetimes.
 * Only localhost/127.0.0.1 Host headers and local Origins are accepted. A development
 * tunnel must preserve an accepted Host header. This listener supplies no authentication.
 * The caller owns process signals and calls close() to cancel requests and release the port.
 */
export async function startLocalMcpServer(
  options: LocalMcpServerOptions,
): Promise<LocalMcpServer> {
  // Validate budgets before opening the port. Each admitted request owns one lifetime.
  const budgets = createServerBudgets(options.budgets);
  const endpoint = createEndpoint(options.createServer, {
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });
  const active = new Set<RequestLifetime>();
  let stopping = false;
  let closing: Promise<void> | undefined;
  function track(
    req: IncomingMessage,
    res: ServerResponse,
    lifetime: RequestLifetime,
  ): void {
    active.add(lifetime);
    res.once('close', () => active.delete(lifetime));
    bindResponseToLifetime(req, res, lifetime);
  }

  const app = new Hono<Environment>();

  // The request's clock starts at admission, before any body wait.
  app.use('*', async (c, next) => {
    if (stopping) return c.json({ error: 'shutting_down' }, 503);
    const lifetime = budgets.startRequest();
    track(c.env.incoming, c.env.outgoing, lifetime);
    c.set('lifetime', lifetime);
    await next();
  });
  app.use('*', hostHeaderValidation(ALLOWED_HOSTNAMES));
  app.use('*', localhostOriginValidation());

  /** One safe answer, and only while nothing is committed and the caller has not gone. */
  function mayAnswer(lifetime: RequestLifetime, res: ServerResponse): boolean {
    if (res.headersSent || res.destroyed) return false;
    const cause = lifetime.cause;
    return cause === undefined || cause.kind === 'request-timeout';
  }

  /** What a handler returns when nothing may be written: the caller has gone, or the connection is being destroyed. */
  const unanswered = (): Response => new Response(null, { status: 408 });

  /** Answers, then drops the connection: the rest of the request body is not wanted. */
  function refuseAndClose(
    c: RequestContext,
    status: 408 | 413,
    body: object,
  ): Response {
    const { incoming, outgoing } = c.env;
    if (outgoing.writableFinished) incoming.destroy();
    else outgoing.once('finish', () => incoming.destroy());
    return c.json(body, status, { connection: 'close' });
  }

  /** A body stage that did not finish. An expiry is answered once; a disconnect writes nothing. */
  function bodyFailed(c: RequestContext, cause: LifetimeCause): Response {
    const lifetime = c.get('lifetime');
    // The lifetime recorded its own expiry, disconnect and completion; the rest are this stage's.
    if (
      cause.kind !== 'request-timeout' &&
      cause.kind !== 'disconnected' &&
      cause.kind !== 'completed'
    )
      lifetime.record(cause);
    if (
      cause.kind === 'disconnected' ||
      cause.kind === 'cancelled' ||
      cause.kind === 'completed'
    )
      return unanswered();
    return mayAnswer(lifetime, c.env.outgoing)
      ? refuseAndClose(c, 408, { error: 'request_timeout' })
      : unanswered();
  }

  /**
   * Reads and parses a POST body as one bounded stage of the request. A `Response` means the
   * request has been dealt with (or the caller has gone) and nothing may be built for it.
   */
  async function readJsonBody(
    c: RequestContext,
  ): Promise<{ readonly value: unknown } | Response> {
    const lifetime = c.get('lifetime');
    // The adapter's own bounded reader (it refuses a declared or observed size over the limit); the
    // stage stops waiting when the budget ends, and the connection is closed behind it.
    const read = await lifetime.run('body', () =>
      readRequestBody(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!read.ok) return bodyFailed(c, read.cause);
    if (!mayAnswer(lifetime, c.env.outgoing)) return unanswered();
    if (read.value.tooLarge)
      return refuseAndClose(c, 413, { error: 'payload_too_large' });
    try {
      return { value: JSON.parse(read.value.text) as unknown };
    } catch {
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        },
        400,
      );
    }
  }

  app.all(MCP_PATH, async (c) => {
    // The body is the application's wait, so it runs under the request's lifetime and is bounded
    // before any server or transport exists. Nothing is built for a request that has ended.
    const body = c.req.method === 'POST' ? await readJsonBody(c) : undefined;
    if (body instanceof Response) return body;
    if (c.get('lifetime').check() !== undefined) return unanswered();
    return endpoint.fetch(c.req.raw, c.get('lifetime'), {
      ...(body === undefined ? {} : { parsedBody: body.value }),
    });
  });

  app.notFound(() => new Response(null, { status: 404 }));
  app.onError(() => new Response(null, { status: 500 }));

  const http = createServer(getRequestListener(app.fetch));
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, HOST, resolve);
  });
  const { port } = http.address() as AddressInfo; // listen() on a TCP port yields AddressInfo

  return {
    url: `http://${HOST}:${port}${MCP_PATH}`,
    close: () =>
      (closing ??= (async () => {
        stopping = true;
        for (const lifetime of active) lifetime.disconnect();
        await endpoint.close();
        await new Promise<void>((resolve, reject) => {
          http.close((error) => (error ? reject(error) : resolve()));
          http.closeAllConnections();
        });
      })()),
  };
}

/**
 * Connects one request's lifetime to its response when the request is admitted. The transport
 * finishing the response ends the lifetime; the caller going away does too. In the other direction,
 * a request deadline that passes before the response is delivered destroys the response, which
 * releases the connection and the transport's listeners. A response is never given a second status.
 */
function bindResponseToLifetime(
  req: IncomingMessage,
  res: ServerResponse,
  lifetime: RequestLifetime,
): void {
  // A write to a response this listener destroyed must not escape as an unhandled error.
  res.on('error', () => undefined);
  req.on('error', () => undefined);

  // Destroying a response also emits `finish` on current Node, with `destroyed` already true, so
  // neither the event nor `writableFinished` says the peer received the whole response.
  let delivered = false;
  res.once('finish', () => {
    if (res.destroyed) return;
    delivered = true;
    lifetime.finish();
  });
  res.once('close', () => {
    if (!delivered) lifetime.disconnect();
  });
  lifetime.signal.addEventListener(
    'abort',
    () => {
      if (lifetime.cause?.kind !== 'request-timeout') return;
      // The stage that owns the response may write one safe answer in this turn of the event loop;
      // delivering it gets no extra time.
      setImmediate(() => {
        if (!res.writableFinished && !res.destroyed) res.destroy();
      });
    },
    { once: true },
  );
}
