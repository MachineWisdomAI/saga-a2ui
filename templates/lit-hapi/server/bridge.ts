import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';

import type {
  Lifecycle,
  Plugin,
  Request,
  ResponseToolkit,
  RouteOptionsAccess,
  RouteOptionsPayload,
  Server,
} from '@hapi/hapi';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import {
  validateHostHeader,
  validateOriginHeader,
} from '@modelcontextprotocol/server';
import type { AuthInfo, McpServer } from '@modelcontextprotocol/server';

// The hostnames @modelcontextprotocol/node's own localhost guard allows.
export const LOCALHOST_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

const DEFAULT_PATH = '/mcp';

// This bridge's own version, not the MCP server's. The server it hosts carries
// its own name and version, supplied by `createServer`.
const PLUGIN_VERSION = '1.0.0';

declare module '@hapi/hapi' {
  interface RequestApplicationState {
    /** The bounded application parser's result, when streaming payloads are configured. */
    mcpBody?: { readonly value: unknown };
  }
  interface AuthCredentials {
    /** Set only by the application's Hapi authentication strategy. */
    authInfo?: AuthInfo;
  }
}

/** Verified auth is explicit; the Hapi request also carries application-owned lifecycle state. */
export interface McpRequestContext {
  readonly authInfo: AuthInfo | undefined;
  readonly request: Request;
}

export interface McpPluginOptions {
  /**
   * Builds the MCP server for one request. Called per request because stateless
   * Streamable HTTP keeps nothing between calls. This is the only thing the
   * plugin knows about the tools it serves, which is what keeps the file
   * portable between repositories.
   */
  createServer: (context: McpRequestContext) => McpServer;
  /** Hapi body handling; a streaming application may bound and parse it before the handler. */
  payload?: RouteOptionsPayload;
  /**
   * hapi route auth config or strategy name, or `false` to record that the
   * endpoint is intentionally public. `true` is not a hapi-valid value.
   */
  auth: RouteOptionsAccess | string | false;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  path?: string;
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
 * `handleRequest` funnels every response through a single `writeHead`, so one
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
    /* istanbul ignore next -- defensive: handleRequest always passes a header object */
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
 * Deliberately free of relative imports. Everything specific to a deployment --
 * which tools exist, where their data comes from -- arrives through
 * `createServer`. That is what lets the same file live in more than one
 * application without a shared transport package, and it is why `root`/`maxBytes` are not
 * options here: they belong to one particular tool, not to the bridge.
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
      payload = { parse: true, allow: 'application/json' },
      allowedHosts = LOCALHOST_HOSTNAMES,
      allowedOrigins = allowedHosts,
    } = options;

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

    const handler: Lifecycle.Method = async (
      request: Request,
      h: ResponseToolkit,
    ) => {
      const { req, res } = request.raw;

      // Stateless: a fresh server and transport per request, nothing kept between
      // calls. Swap in sessionIdGenerator: () => randomUUID() plus a session map
      // if resumability is ever needed; the hapi wiring below does not change.
      const authInfo = request.auth.isAuthenticated
        ? request.auth.credentials.authInfo
        : undefined;
      const context = Object.freeze({ authInfo, request });
      // The Node adapter reads this request's auth only. Public routes overwrite it with
      // undefined even if the caller supplied a bearer header.
      Object.assign(req, { auth: authInfo });
      const mcpServer = createServer(context);
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      await mcpServer.connect(transport);

      // Closing the server closes the transport it is connected to, so this is
      // the only teardown needed. Errors during teardown must not become an
      // unhandled rejection on a socket that is already gone.
      res.on('close', () => {
        Promise.resolve(mcpServer.close()).catch(() => {});
      });

      // hapi already consumed the request stream, so hand over its parsed body.
      // GET and DELETE have none; the transport answers those itself.
      const capture = captureErrorResponse(res);
      await transport.handleRequest(
        req,
        res,
        request.app.mcpBody === undefined
          ? (request.payload ?? undefined)
          : request.app.mcpBody.value,
      );

      // A malformed request never reached the socket; re-send it as hapi's own
      // response so `request.response` is a real object.
      if (capture.captured) {
        // Put the real write methods back first: hapi is about to use them,
        // and while they are patched its output would be swallowed and the
        // socket would never close.
        capture.restore();
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

    // GET holds an SSE stream open for as long as the client stays connected, so
    // `handleRequest` does not resolve and `h.abandon` is returned only at
    // disconnect. A host with `routes.timeout.server` set would meanwhile write a
    // 503 onto a socket the transport has already written headers to, crashing the
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
