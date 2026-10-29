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
import { readRequestBody } from '@modelcontextprotocol/server';
import {
  createServerBudgets,
  type BudgetSettings,
  type LifetimeCause,
  type RequestLifetime,
} from '@saga-a2ui/react-mcp-stack/server';
import { Hono, type Context } from 'hono';
import { createEndpoint } from './endpoint.js';
import { createMemoryGameStore, type GameStore } from './game-store.js';
import { createGameServer, prepareBoardViews } from './operations.js';

// APPLICATION-OWNED HTTP hosting for the MCP server: a Hono application on a loopback Node listener,
// stateless Streamable HTTP (a persistent handler, a fresh server per request, modern auto responses) and
// DNS-rebinding protection from the official `@modelcontextprotocol/hono` middleware (Host and Origin). Put
// your own ingress (TLS, a public host name) in front of it, and add that host name to
// `ALLOWED_HOSTNAMES`, when you deploy.
//
// The adapter's `createMcpHonoApp` is not used: it reads and parses the request body before your routes
// run, so the application could not bound that wait by the request's lifetime. This file installs the
// adapter's two validators and reads the body itself, as a bounded stage.
//
// Games: every request builds its own MCP server, and all of them share the one `GameStore`. The game has
// no sign-in, so there is no identity to carry; the unguessable game identifier is the only thing a
// caller needs.
//
// Time: each request's lifetime starts when the request is admitted, before any body wait. This file wires
// that one deadline into the waits the application owns: the request body and delivery of the response. A
// body that stalls is answered once with 408 and its connection is closed. A response the deadline
// overtakes is destroyed, never replaced, so a committed response is not given a second status.

const HOST = '127.0.0.1';
const ALLOWED_HOSTNAMES = ['127.0.0.1', 'localhost'];
const GAME_PATH = '/mcp';
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface ListenerOptions {
  /** The built page, read by the caller before the port opens. */
  readonly html: string;
  /** Where the games live. Defaults to a bounded in-memory map. */
  readonly store?: GameStore;
  /** Use 0 for an ephemeral port. */
  readonly port: number;
  /**
   * 3,000 ms per operation and 10,000 ms per request unless stated. A field you leave out keeps
   * its default, and an invalid value fails before the port opens.
   */
  readonly budgets?: BudgetSettings;
}

export interface Listener {
  /** The game's MCP endpoint. */
  readonly url: string;
  close(): Promise<void>;
}

/** `Bindings` are the Node request and response the Hono Node adapter hands to every request. */
interface Environment {
  Bindings: HttpBindings;
  Variables: { lifetime: RequestLifetime };
}

type RequestContext = Context<Environment>;

export async function startListener(
  options: ListenerOptions,
): Promise<Listener> {
  // Prepare and validate deployment inputs once, before opening the port. Each request
  // reuses the same HTML, URI and store while owning its server and lifetime.
  const budgets = createServerBudgets(options.budgets);
  const views = prepareBoardViews(options.html);
  const store = options.store ?? createMemoryGameStore();
  const game = createEndpoint(
    (lifetime) => createGameServer({ views, lifetime, store }),
    { maxRequestBodySize: MAX_REQUEST_BYTES },
  );
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

  app.all(GAME_PATH, async (c) => {
    // The body is the application's wait, so it runs under the request's lifetime and is bounded
    // before any server or transport exists. Nothing is built for a request that has ended.
    const body = c.req.method === 'POST' ? await readJsonBody(c) : undefined;
    if (body instanceof Response) return body;
    if (c.get('lifetime').check() !== undefined) return unanswered();
    return game.fetch(c.req.raw, c.get('lifetime'), {
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
    url: `http://${HOST}:${port}${GAME_PATH}`,
    close: () =>
      (closing ??= (async () => {
        stopping = true;
        for (const lifetime of active) lifetime.disconnect();
        await game.close();
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
