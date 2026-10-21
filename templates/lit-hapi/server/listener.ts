import Hapi from '@hapi/hapi';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/server';
import {
  createServerBudgets,
  type BudgetSettings,
  type LifetimeCause,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { authenticate } from './authenticate.js';
import { mcpPlugin } from './bridge.js';
import {
  createAccountServer,
  createStatusServer,
  prepareStarterView,
  type AccountServerOptions,
} from './operations.js';

// APPLICATION-OWNED Hapi hosting. The bridge owns the raw MCP response; Hapi owns auth and
// refusal responses. One admission lifetime bounds authentication, the body and delivery.
const HOST = '127.0.0.1';
const ALLOWED_HOSTNAMES = ['127.0.0.1', 'localhost'];
const STATUS_PATH = '/status/mcp';
const ACCOUNT_PATH = '/account/mcp';
const MAX_REQUEST_BYTES = 1024 * 1024;

declare module '@hapi/hapi' {
  interface RequestApplicationState {
    lifetime: RequestLifetime;
  }
}

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
  const budgets = createServerBudgets(options.budgets);
  // #region saga-snippet:prepare-view
  // Both endpoint registrations below keep one persistent handler and reuse this immutable view.
  const view = prepareStarterView(options.html, options.filename);
  // #endregion saga-snippet:prepare-view
  const active = new Set<RequestLifetime>();
  let stopping = false;
  let closing: Promise<void> | undefined;
  const http = Hapi.server({ host: HOST, port: options.port });
  http.ext('onPreStop', () => {
    stopping = true;
    for (const lifetime of active) lifetime.disconnect();
  });
  http.ext('onRequest', (request, h) => {
    if (stopping) return h.response().code(503).takeover();
    const lifetime = budgets.startRequest();
    request.app.lifetime = lifetime;
    active.add(lifetime);
    request.raw.res.once('close', () => active.delete(lifetime));
    bindResponseToLifetime(request.raw.req, request.raw.res, lifetime);
    return h.continue;
  });

  http.auth.scheme('account-bearer', () => ({
    async authenticate(request, h) {
      const header = request.headers.authorization;
      const decision = await authenticate(
        typeof header === 'string' ? header : undefined,
        options.verifier,
        request.app.lifetime,
      );
      if (decision.ok)
        return h.authenticated({
          credentials: { authInfo: decision.authInfo },
        });
      const response = h.response().code(decision.status).takeover();
      if (decision.challenge !== undefined)
        response.header('WWW-Authenticate', decision.challenge);
      return response;
    },
  }));
  http.auth.strategy('account', 'account-bearer');

  /**
   * Reads the request body until it ends, `MAX_REQUEST_BYTES` is exceeded or `gate` aborts, and
   * settles once. Avoids for-await: leaving that loop destroys the socket before a 413 can be written.
   */
  function readLimitedBody(
    req: Readable,
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

  /** Hapi owns each refusal; after it is sent the unread request body loses its socket. */
  function refuseAndClose(
    request: Hapi.Request,
    h: Hapi.ResponseToolkit,
    status: number,
    body: object,
  ): Hapi.ResponseObject {
    request.raw.res.once('finish', () => request.raw.req.destroy());
    return h
      .response(body)
      .code(status)
      .header('connection', 'close')
      .takeover();
  }

  /** A body stage that did not finish. An expiry is answered once; a disconnect writes nothing. */
  function bodyFailed(
    cause: LifetimeCause,
    request: Hapi.Request,
    h: Hapi.ResponseToolkit,
  ): Hapi.ResponseObject | undefined {
    const lifetime = request.app.lifetime;
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
      return undefined;
    return mayAnswer(lifetime, request.raw.res)
      ? refuseAndClose(request, h, 408, { error: 'request_timeout' })
      : undefined;
  }

  /** A parsed body, an inspectable Hapi refusal, or no response when the caller has gone. */
  async function readJsonBody(
    request: Hapi.Request,
    h: Hapi.ResponseToolkit,
    body: Readable,
  ): Promise<{ value: unknown } | Hapi.ResponseObject | undefined> {
    const lifetime = request.app.lifetime;
    const read = await lifetime.run('body', (scope) =>
      readLimitedBody(body, scope.signal),
    );
    if (!read.ok) return bodyFailed(read.cause, request, h);
    if (!mayAnswer(lifetime, request.raw.res)) return undefined;
    if (read.value.tooLarge)
      return refuseAndClose(request, h, 413, { error: 'payload_too_large' });
    try {
      return { value: JSON.parse(read.value.text) as unknown };
    } catch {
      return h
        .response({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })
        .code(400)
        .takeover();
    }
  }

  // Hapi admits a streaming payload without buffering it. The application owns the bounded read
  // after authentication, so a stalled body cannot outlive either request or operation budget.
  http.ext('onPreHandler', async (request, h) => {
    if (request.method !== 'post') return h.continue;
    if (!(request.payload instanceof Readable))
      throw new Error('Expected the Hapi streaming payload.');
    const body = await readJsonBody(request, h, request.payload);
    if (body === undefined) return h.abandon;
    if ('value' in body) {
      request.app.mcpBody = body;
      return h.continue;
    }
    return body;
  });

  const payload = {
    parse: false as const,
    output: 'stream' as const,
    timeout: false as const,
    maxBytes: MAX_REQUEST_BYTES,
  };
  await http.register({
    plugin: mcpPlugin,
    options: {
      path: STATUS_PATH,
      auth: false,
      payload,
      allowedHosts: ALLOWED_HOSTNAMES,
      createServer: ({ request }) =>
        createStatusServer({
          view,
          lifetime: request.app.lifetime,
        }),
    },
  });
  await http.register({
    plugin: mcpPlugin,
    options: {
      path: ACCOUNT_PATH,
      auth: 'account',
      payload,
      allowedHosts: ALLOWED_HOSTNAMES,
      // #region saga-snippet:identity-handoff
      // Hapi's authentication strategy snapshots the verified credential before the body wait.
      // The bridge carries that request's auth to this factory and the Node transport; SAGA's
      // identityOf hook reads only that auth. No argument or previous request names an account.
      createServer: ({ request, authInfo }) => {
        if (authInfo === undefined)
          throw new Error(
            'The protected route did not establish request identity.',
          );
        return createAccountServer({
          view,
          lifetime: request.app.lifetime,
          authorize: options.authorize,
        });
      },
      // #endregion saga-snippet:identity-handoff
    },
  });
  await http.start();
  return {
    statusUrl: `${http.info.uri}${STATUS_PATH}`,
    accountUrl: `${http.info.uri}${ACCOUNT_PATH}`,
    close: () => (closing ??= http.stop({ timeout: 0 })),
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
