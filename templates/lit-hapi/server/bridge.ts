import type {
  IncomingMessage,
  OutgoingHttpHeaders,
  ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';

import type {
  Lifecycle,
  Plugin,
  Request,
  ResponseToolkit,
  ResponseObject,
  RouteOptionsAccess,
  Server,
} from '@hapi/hapi';
import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  createMcpHandler,
  validateHostHeader,
  validateOriginHeader,
} from '@modelcontextprotocol/server';
import type { AuthInfo, McpServer } from '@modelcontextprotocol/server';
import {
  createServerBudgets,
  type BudgetSettings,
  type LifetimeCause,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';

// The hostnames @modelcontextprotocol/node's own localhost guard allows.
export const LOCALHOST_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

const DEFAULT_PATH = '/mcp';

// This bridge's own version, not the MCP server's. The server it hosts carries
// its own name and version, supplied by `createServer`.
const PLUGIN_VERSION = '1.0.0';

declare module '@hapi/hapi' {
  interface AuthCredentials {
    /** Set only by the application's Hapi authentication strategy. */
    authInfo?: AuthInfo;
  }
}

/** Verified auth and the admission lifetime belong to this request alone. */
export interface McpRequestContext {
  readonly authInfo: AuthInfo | undefined;
  readonly request: Request;
  readonly lifetime: RequestLifetime;
}

export interface McpPluginOptions {
  /**
   * Builds a fresh MCP server for each admitted request. The endpoint handler keeps
   * its notification bus and subscription capacity across requests; identity stays
   * with this request. The application owns the tools and their data.
   */
  createServer: (context: McpRequestContext) => McpServer;
  /** Limits apply from admission, before authentication. Omitted values use saga a2ui defaults. */
  budgets?: BudgetSettings;
  /** Maximum JSON request size in bytes. Defaults to 1 MiB. */
  maxRequestBytes?: number;
  /** Concurrent subscription limit for this endpoint; uses the SDK default when omitted. */
  maxSubscriptions?: number;
  /**
   * hapi route auth config or strategy name, or `false` to record that the
   * endpoint is intentionally public. `true` is not a hapi-valid value.
   */
  auth: RouteOptionsAccess | string | false;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  path?: string;
}

// One lifetime per Hapi request. Kept private so hosts never assemble admission state.
const lifetimes = new WeakMap<Request, RequestLifetime>();

/** The admitted MCP lifetime, available to the Hapi authentication strategy before it waits. */
export function mcpRequestLifetime(request: Request): RequestLifetime {
  const lifetime = lifetimes.get(request);
  if (lifetime === undefined)
    throw new Error('The request was not admitted by the MCP bridge.');
  return lifetime;
}

// Set by whoever actually writes the response; never copied between the two.
const FRAMING_HEADERS = new Set([
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

interface CapturedResponse {
  status: number;
  headers: OutgoingHttpHeaders;
  body: string;
}

/**
 * Diverts an error response the transport is about to write, so hapi can send it.
 *
 * Same reason as the guard below: anything hapi did not produce leaves
 * `request.response` as `Symbol(abandon)`, and a host that inspects the response
 * on a 4xx then throws. The transport writes malformed-request errors -- a
 * missing `Accept` value is 406, a body that is not a JSON-RPC message is 400 --
 * straight to the socket, which would kill such a host on an unauthenticated
 * request just as the guard once did.
 *
 * The Node adapter funnels every response through a single `writeHead`, so one
 * interception point covers all of them. Success and SSE keep the raw socket:
 * they are the cases where the transport genuinely must own the stream, and
 * being 2xx they never reach the inspection that breaks.
 */
function captureErrorResponse(res: ServerResponse): {
  captured?: CapturedResponse;
  restore: () => void;
} {
  const originals = {
    writeHead: res.writeHead,
    write: res.write,
    end: res.end,
  };
  const chunks: Buffer[] = [];

  const restore = () => {
    res.writeHead = originals.writeHead;
    res.write = originals.write;
    res.end = originals.end;
  };
  const box: { captured?: CapturedResponse; restore: () => void } = { restore };

  res.writeHead = function patchedWriteHead(
    this: ServerResponse,
    status: number,
    ...rest: unknown[]
  ) {
    if (status < 400) {
      restore();
      return (
        originals.writeHead as (...args: unknown[]) => ServerResponse
      ).call(this, status, ...rest);
    }
    /* istanbul ignore next -- defensive: the Node adapter always passes a header object */
    const headers = (
      typeof rest[0] === 'object' && rest[0] !== null ? rest[0] : {}
    ) as OutgoingHttpHeaders;
    const captured: CapturedResponse = { status, headers, body: '' };
    box.captured = captured;

    // One collector for both, so `end()` with or without a final chunk and
    // `write()` all take the same path. The body arrives as Uint8Array
    // chunks, not strings or Buffers -- an earlier version tested
    // `Buffer.isBuffer` and silently dropped every error body.
    const collect = (chunk?: unknown) => {
      if (
        chunk === undefined ||
        chunk === null ||
        typeof chunk === 'function'
      ) {
        return;
      }
      chunks.push(Buffer.from(chunk as Uint8Array));
    };
    res.write = ((chunk: unknown) => {
      collect(chunk);
      return true;
    }) as ServerResponse['write'];
    res.end = ((chunk?: unknown) => {
      collect(chunk);
      captured.body = Buffer.concat(chunks).toString('utf8');
      return res;
    }) as ServerResponse['end'];
    return res;
  } as ServerResponse['writeHead'];

  return box;
}

/**
 * hapi plugin exposing an MCP endpoint over Streamable HTTP.
 *
 * There is no official `@modelcontextprotocol/hapi` adapter, so the wiring is
 * ours: raw Node objects out of `request.raw`, `h.abandon` back to hapi, and
 * the DNS-rebinding guards the Express/Fastify/Hono packages apply for free.
 *
 * The bridge composes saga a2ui request budgets with the official MCP transport. The
 * application supplies authentication, limit values and the MCP server factory;
 * body parsing and socket choreography remain bridge implementation details.
 */
export const mcpPlugin: Plugin<McpPluginOptions> = {
  name: 'mcp',
  version: PLUGIN_VERSION,
  multiple: true,
  register(server: Server, options: McpPluginOptions): void {
    const {
      path = DEFAULT_PATH,
      auth,
      createServer,
      maxRequestBytes = 1024 * 1024,
      allowedHosts = LOCALHOST_HOSTNAMES,
      allowedOrigins = allowedHosts,
    } = options;

    const budgets = createServerBudgets(options.budgets);
    if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= 0) {
      throw new Error(
        'mcp plugin requires a positive safe-integer maxRequestBytes.',
      );
    }
    const payload = {
      parse: false as const,
      output: 'stream' as const,
      timeout: false as const,
      maxBytes: maxRequestBytes,
      allow: 'application/json',
    };
    const active = new Set<RequestLifetime>();
    let stopping = false;

    // Checked by value, not by key presence: `{ auth: config.mcpAuth }` with a
    // missing config key passes an `in` test, destructures to undefined, and
    // leaves hapi treating the route as unauthenticated -- exactly the accident
    // this guard exists to prevent.
    if (auth === undefined) {
      throw new Error(
        'mcp plugin requires an explicit `auth` option and received undefined. Pass a hapi route ' +
          'auth config to protect the endpoint, or `auth: false` to record that it is intentionally public.',
      );
    }
    // Same reasoning as `auth`: a missing factory would otherwise surface as a
    // TypeError on the first request rather than at boot.
    if (typeof createServer !== 'function') {
      throw new Error(
        'mcp plugin requires a `createServer` function returning an McpServer.',
      );
    }
    if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
      throw new Error(
        'mcp plugin requires a non-empty `allowedHosts` list for DNS-rebinding protection.',
      );
    }
    if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
      throw new Error(
        'mcp plugin requires a non-empty `allowedOrigins` list for DNS-rebinding protection.',
      );
    }

    if (!('allowedHosts' in options)) {
      // Fails closed, but a 403 on every production request is a confusing way
      // to learn that. Say so at boot.
      server.log(
        ['mcp', 'warn'],
        `allowedHosts defaulted to ${allowedHosts.join(', ')}; any other Host header gets 403.`,
      );
    }

    // The 403 body the SDK's own Node guards emit, reproduced exactly -- but
    // written by hapi rather than onto the raw socket. See the comment below.
    const refuse = (h: ResponseToolkit, message: string) =>
      h
        .response({
          jsonrpc: '2.0',
          error: { code: -32000, message },
          id: null,
        })
        .code(403)
        .takeover();

    // Runs before authentication and before payload parsing: a rebinding attempt
    // should not reach token validation or get its body read.
    //
    // These are `validateHostHeader` / `validateOriginHeader` from
    // @modelcontextprotocol/server -- the same first-party checks that
    // @modelcontextprotocol/node's `hostHeaderValidation` and `originValidation`
    // wrap, and that the Express/Fastify/Hono adapters expose. Only the pure
    // predicates are used here.
    //
    // The wrappers write the 403 to the raw response themselves, which forces
    // `h.abandon` and leaves `request.response` set to Symbol(abandon). Any hapi
    // extension that inspects the response on a 4xx then fails: a host's
    // response logging extension does `'source' in request.response` and
    // throws `TypeError: Cannot use 'in' operator ... in Symbol(abandon)`,
    // killing the process on an unauthenticated request. Letting hapi own the
    // response keeps `request.response` a real object and the guard intact.
    const guardRebinding: Lifecycle.Method = (
      request: Request,
      h: ResponseToolkit,
    ) => {
      if (stopping) return h.response().code(503).takeover();
      const lifetime = budgets.startRequest();
      lifetimes.set(request, lifetime);
      active.add(lifetime);
      request.raw.res.once('close', () => active.delete(lifetime));
      bindResponseToLifetime(request.raw.req, request.raw.res, lifetime);

      // Node's raw headers, the same source the SDK's own guards read. hapi
      // types `request.headers` values as `unknown`.
      const { headers } = request.raw.req;
      const host = validateHostHeader(headers.host, allowedHosts);
      if (!host.ok) {
        return refuse(h, host.message);
      }
      const origin = validateOriginHeader(headers.origin, allowedOrigins);
      if (!origin.ok) {
        return refuse(h, origin.message);
      }
      // Hapi drains an invalid payload before answering its parser error. Refuse a
      // declared oversize here so a caller cannot stall that drain indefinitely.
      const declared = Number(headers['content-length']);
      if (
        payload.maxBytes !== undefined &&
        Number.isFinite(declared) &&
        declared > payload.maxBytes
      ) {
        request.raw.res.once('finish', () => request.raw.req.destroy());
        return h
          .response({ error: 'payload_too_large' })
          .code(413)
          .header('connection', 'close')
          .takeover();
      }
      return h.continue;
    };

    // One handler per plugin registration: public and protected endpoints never share
    // subscription capacity or notification delivery. Request identity is not retained.
    const admissions = new WeakMap<globalThis.Request, McpRequestContext>();
    const endpoint = createMcpHandler(
      (context) => {
        const admitted =
          context.requestInfo === undefined
            ? undefined
            : admissions.get(context.requestInfo);
        if (admitted === undefined)
          throw new Error('The MCP request has no admitted Hapi context.');
        return createServer(admitted);
      },
      {
        maxRequestBodySize: payload.maxBytes,
        maxSubscriptions: options.maxSubscriptions,
      },
    );
    server.ext('onPreStop', async () => {
      stopping = true;
      for (const lifetime of active) lifetime.disconnect();
      await endpoint.close();
    });

    /**
     * Reads until the body ends, its byte limit is exceeded or `gate` aborts, and
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
          if (received > maxRequestBytes) return finish({ tooLarge: true });
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
    function mayAnswer(
      lifetime: RequestLifetime,
      res: ServerResponse,
    ): boolean {
      if (res.headersSent || res.destroyed) return false;
      const cause = lifetime.cause;
      return cause === undefined || cause.kind === 'request-timeout';
    }

    /** Hapi owns each refusal; after it is sent the unread request body loses its socket. */
    function refuseAndClose(
      request: Request,
      h: ResponseToolkit,
      status: number,
      body: object,
    ): ResponseObject {
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
      request: Request,
      h: ResponseToolkit,
    ): ResponseObject | undefined {
      const lifetime = mcpRequestLifetime(request);
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
      request: Request,
      h: ResponseToolkit,
      body: Readable,
    ): Promise<{ value: unknown } | ResponseObject | undefined> {
      const lifetime = mcpRequestLifetime(request);
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

    const handler: Lifecycle.Method = async (
      request: Request,
      h: ResponseToolkit,
    ) => {
      const { req, res } = request.raw;
      const lifetime = mcpRequestLifetime(request);
      if (!mayAnswer(lifetime, res)) return h.abandon;
      let parsedBody: { value: unknown } | undefined;
      if (request.method === 'post') {
        if (!(request.payload instanceof Readable))
          throw new Error('Expected the MCP streaming payload.');
        const body = await readJsonBody(request, h, request.payload);
        if (body === undefined) return h.abandon;
        if (!('value' in body)) return body;
        parsedBody = body;
      }

      const authInfo = request.auth.isAuthenticated
        ? request.auth.credentials.authInfo
        : undefined;
      const context = Object.freeze({ authInfo, lifetime, request });
      // Public routes overwrite raw auth even when a bearer header was supplied.
      Object.assign(req, { auth: authInfo });
      const capture = captureErrorResponse(res);
      try {
        await toNodeHandler(
          {
            fetch: (webRequest, requestOptions) => {
              admissions.set(webRequest, context);
              // Keep the exact Request and the bounded parsed POST body. Without parsedBody,
              // legacy classification clones the Request and loses its admitted context.
              return endpoint.fetch(webRequest, requestOptions);
            },
          },
          { maxRequestBodySize: payload.maxBytes },
        )(req, res, parsedBody?.value);
      } finally {
        capture.restore();
      }

      // A malformed request never reached the socket; re-send it as hapi's own
      // response so `request.response` is a real object.
      if (capture.captured) {
        const { status, headers, body } = capture.captured;
        const response = h.response(body).code(status);
        for (const [name, value] of Object.entries(headers)) {
          // hapi frames its own response. Copying the transport's
          // content-length or transfer-encoding across puts two sets of
          // framing headers on one socket, and the client then fails to
          // parse the reply at all.
          if (value !== undefined && !FRAMING_HEADERS.has(name.toLowerCase())) {
            response.header(name, String(value));
          }
        }
        return response;
      }

      // Otherwise the transport owns the response. Without this hapi writes a
      // second one and Node throws ERR_HTTP_HEADERS_SENT.
      return h.abandon;
    };

    const ext = { onPreAuth: { method: guardRebinding } };

    // Subscription responses leave their stream with the SDK. A Hapi timeout
    // must never replace that response after its headers were sent: it would write a
    // 503 onto a socket the transport owns, crashing the
    // process with ERR_HTTP_HEADERS_SENT. Opt this route out of that timeout.
    const timeout = { server: false as const };

    // Split by method because hapi rejects payload settings on a GET route.
    // Both registrations share one path, one auth config, and one handler.
    server.route({
      method: 'POST',
      path,
      options: { auth, ext, timeout, payload },
      handler,
    });

    server.route({
      method: ['GET', 'DELETE'],
      path,
      options: { auth, ext, timeout },
      handler,
    });
  },
};

export default mcpPlugin;

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
      const cause = lifetime.cause?.kind;
      if (cause === 'completed') return;
      if (cause !== 'request-timeout') {
        if (!res.writableFinished && !res.destroyed) res.destroy();
        return;
      }
      // The stage that owns the response may write one safe answer in this turn of the event loop;
      // delivering it gets no extra time.
      setImmediate(() => {
        if (!res.writableFinished && !res.destroyed) res.destroy();
      });
    },
    { once: true },
  );
}
