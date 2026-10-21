import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/node';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/server';
import {
  createServerBudgets,
  type BudgetSettings,
  type LifetimeCause,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { createEndpoint, type Endpoint } from './endpoint.js';
import { authenticate } from './authenticate.js';
import {
  createAccountServer,
  createStatusServer,
  prepareStarterView,
  type AccountServerOptions,
} from './operations.js';

// APPLICATION-OWNED HTTP hosting for the MCP servers: loopback only, stateless Streamable HTTP
// (a persistent handler per endpoint, a fresh server per request, modern auto responses) and DNS-rebinding protection on the
// Host header. Put your own ingress (TLS, a public host name) in front of it, and add that host
// name through `hostHeaderValidation([...])` instead of localhost-only validation when you deploy.
// If clients send a remote Origin, also replace `localhostOriginValidation()` with an explicit
// trusted-origin policy; allowing the Host alone does not allow that Origin.
//
// Time: each request's lifetime starts when the request is admitted, before any credential or body
// wait. This file wires that one deadline into the waits the application owns: authentication, the
// request body and delivery of the response through the transport's `finish`. A body that stalls is
// answered once with 408 and its connection is closed. A response the deadline overtakes is
// destroyed, never replaced, so a committed response is not given a second status.

const HOST = '127.0.0.1';
const STATUS_PATH = '/status/mcp';
const ACCOUNT_PATH = '/account/mcp';
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface ListenerOptions {
  /** The built page, read by the caller before the port opens. */
  readonly html: string;
  /** The built page's relative filename; the starter builds index.html. */
  readonly filename?: string;
  /** Decides who a bearer credential belongs to. */
  readonly verifier: OAuthTokenVerifier;
  /** Decides what a verified account may see. */
  readonly authorize: AccountServerOptions['authorize'];
  /** Use 0 for an ephemeral port. */
  readonly port: number;
  /**
   * 3,000 ms per operation and 10,000 ms per request unless stated. A field you leave out keeps
   * its default, and an invalid value fails before the port opens.
   */
  readonly budgets?: BudgetSettings;
}

export interface Listener {
  /** Public endpoint: no credential is read. */
  readonly statusUrl: string;
  /** Protected endpoint: a bearer credential is required. */
  readonly accountUrl: string;
  close(): Promise<void>;
}

export async function startListener(
  options: ListenerOptions,
): Promise<Listener> {
  // Prepare and validate deployment inputs once, before opening the port. Each request
  // reuses the same HTML and URI while owning its server, identity and lifetime.
  const budgets = createServerBudgets(options.budgets);
  // #region saga-snippet:prepare-view
  const view = prepareStarterView(options.html, options.filename);
  const status = createEndpoint(
    (lifetime) => createStatusServer({ view, lifetime }),
    { maxRequestBodySize: MAX_REQUEST_BYTES },
  );
  const account = createEndpoint(
    (lifetime) =>
      createAccountServer({ view, lifetime, authorize: options.authorize }),
    { maxRequestBodySize: MAX_REQUEST_BYTES },
  );
  // #endregion saga-snippet:prepare-view
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

  const http = createServer();
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, HOST, resolve);
  });
  const { port } = http.address() as AddressInfo; // listen() on a TCP port yields AddressInfo
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();

  /**
   * Reads the request body until it ends, `MAX_REQUEST_BYTES` is exceeded or `gate` aborts, and
   * settles once. Avoids for-await: leaving that loop destroys the socket before a 413 can be written.
   */
  function readLimitedBody(
    req: IncomingMessage,
    gate: AbortSignal,
  ): Promise<{ tooLarge: true } | { tooLarge: false; text: string }> {
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
      const finish = (
        result: { tooLarge: true } | { tooLarge: false; text: string },
      ) => {
        if (settled) return;
        settled = true;
        req.pause();
        detach();
        resolve(result);
      };
      const onData = (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += bytes.length;
        if (received > MAX_REQUEST_BYTES) return finish({ tooLarge: true });
        chunks.push(bytes);
      };
      const onEnd = () =>
        finish({
          tooLarge: false,
          text: Buffer.concat(chunks).toString('utf8'),
        });
      const onError = (error: Error) => {
        if (settled) return;
        settled = true;
        detach();
        reject(error);
      };
      // The stage that wraps this has already stopped waiting; this stops listening.
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

  /** One safe answer, and only while nothing is committed and the caller has not gone. */
  function mayAnswer(lifetime: RequestLifetime, res: ServerResponse): boolean {
    if (res.headersSent || res.destroyed) return false;
    const cause = lifetime.cause;
    return cause === undefined || cause.kind === 'request-timeout';
  }

  /** Answers, then drops the connection: the rest of the request body is not wanted. */
  function refuseAndClose(
    req: IncomingMessage,
    res: ServerResponse,
    status: number,
    body: object,
  ): void {
    res
      .writeHead(status, {
        'content-type': 'application/json',
        connection: 'close',
      })
      .end(JSON.stringify(body));
    if (res.writableFinished) req.destroy();
    else res.once('finish', () => req.destroy());
  }

  /** A body stage that did not finish. An expiry is answered once; a disconnect writes nothing. */
  function bodyFailed(
    cause: LifetimeCause,
    lifetime: RequestLifetime,
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
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
      return;
    if (mayAnswer(lifetime, res))
      refuseAndClose(req, res, 408, { error: 'request_timeout' });
  }

  /**
   * Reads and parses a POST body as one bounded stage of the request. `undefined` means the
   * response has been dealt with (or the caller has gone) and nothing may be built for it.
   */
  async function readJsonBody(
    req: IncomingMessage,
    res: ServerResponse,
    lifetime: RequestLifetime,
  ): Promise<{ value: unknown } | undefined> {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      if (mayAnswer(lifetime, res))
        refuseAndClose(req, res, 413, { error: 'payload_too_large' });
      return undefined;
    }
    const read = await lifetime.run('body', (scope) =>
      readLimitedBody(req, scope.signal),
    );
    if (!read.ok) return void bodyFailed(read.cause, lifetime, req, res);
    if (!mayAnswer(lifetime, res)) return undefined;
    if (read.value.tooLarge)
      return void refuseAndClose(req, res, 413, { error: 'payload_too_large' });
    try {
      return { value: JSON.parse(read.value.text) as unknown };
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }),
      );
      return undefined;
    }
  }

  async function serve(
    endpoint: Endpoint,
    req: IncomingMessage,
    res: ServerResponse,
    lifetime: RequestLifetime,
  ): Promise<void> {
    // The body is the adapter's wait, so it runs under the request's lifetime and is bounded
    // before any server or transport exists. Nothing is built for a request that has ended.
    const body =
      req.method === 'POST'
        ? await readJsonBody(req, res, lifetime)
        : undefined;
    if (req.method === 'POST' && body === undefined) return;
    if (lifetime.check() !== undefined) return;
    await toNodeHandler(
      {
        fetch: (request, requestOptions) =>
          endpoint.fetch(request, lifetime, requestOptions ?? {}),
      },
      { maxRequestBodySize: MAX_REQUEST_BYTES },
    )(req, res, body?.value);
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    lifetime: RequestLifetime,
  ): Promise<void> {
    const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    if (path === STATUS_PATH) return serve(status, req, res, lifetime);
    if (path !== ACCOUNT_PATH) {
      res.writeHead(404).end();
      return;
    }
    // #region saga-snippet:identity-handoff
    // Who is asking is decided before any server is built. The verified context travels to the tool
    // only as the transport's per-request auth; no tool argument can name an account.
    const decision = await authenticate(req, options.verifier, lifetime);
    if (!decision.ok) {
      res
        .writeHead(
          decision.status,
          decision.challenge === undefined
            ? {}
            : { 'WWW-Authenticate': decision.challenge },
        )
        .end();
      return;
    }
    Object.assign(req, { auth: decision.authInfo });
    // #endregion saga-snippet:identity-handoff
    return serve(account, req, res, lifetime);
  }

  http.on('request', (req, res) => {
    if (stopping) {
      res.writeHead(503).end();
      return;
    }
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    // The request's clock starts at admission, before any credential or body wait.
    const lifetime = budgets.startRequest();
    track(req, res, lifetime);
    handle(req, res, lifetime).catch(() => {
      if (res.destroyed) return;
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    });
  });

  return {
    statusUrl: `http://${HOST}:${port}${STATUS_PATH}`,
    accountUrl: `http://${HOST}:${port}${ACCOUNT_PATH}`,
    close: () =>
      (closing ??= (async () => {
        stopping = true;
        for (const lifetime of active) lifetime.disconnect();
        await Promise.all([status.close(), account.close()]);
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
