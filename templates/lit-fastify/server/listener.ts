import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpServer, OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { createServerBudgets, type BudgetSettings, type LifetimeCause, type RequestLifetime } from '@saga-a2ui/mcp/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from './authenticate.js';
import { createAccountServer, createStatusServer, type AccountServerOptions } from './operations.js';

// APPLICATION-OWNED HTTP hosting for the MCP servers, on Fastify: loopback only, stateless
// Streamable HTTP (a fresh server and transport per POST, JSON responses). The official
// `@modelcontextprotocol/fastify` adapter creates the app and owns DNS-rebinding protection (Host
// and Origin validation); add your ingress host name to `ALLOWED_HOSTS` when you deploy, and put
// your own ingress (TLS, a public host name) in front of the listener.
//
// Time: each request's lifetime starts when the request is admitted, before any credential or body
// wait. This file wires that one deadline into the waits the application owns: authentication, the
// request body and delivery of the response through the transport's `finish`. Fastify does not
// read the body: its JSON parser is replaced by one that hands the stream on, so the body is read
// here, as a bounded stage of the lifetime. A body that stalls is answered once with 408 and its
// connection is closed. A response the deadline overtakes is destroyed, never replaced, so a
// committed response is not given a second status.

const HOST = '127.0.0.1';
/** Host names (no port) the Host header may name. The adapter rejects every other with 403. */
const ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const STATUS_PATH = '/status/mcp';
const ACCOUNT_PATH = '/account/mcp';
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface ListenerOptions {
  /** The built page, read by the caller before the port opens. */
  readonly html: string;
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

type BodyRead = { tooLarge: true } | { tooLarge: false; text: string };

/**
 * Reads the request body until it ends, `MAX_REQUEST_BYTES` is exceeded or `gate` aborts, and
 * settles once. Avoids for-await: leaving that loop destroys the socket before a 413 can be written.
 */
function readLimitedBody(req: IncomingMessage, gate: AbortSignal): Promise<BodyRead> {
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
    const finish = (result: BodyRead) => {
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
    const onEnd = () => finish({ tooLarge: false, text: Buffer.concat(chunks).toString('utf8') });
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
function refuseAndClose(req: IncomingMessage, res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { 'content-type': 'application/json', connection: 'close' }).end(JSON.stringify(body));
  if (res.writableFinished) req.destroy();
  else res.once('finish', () => req.destroy());
}

/** A body stage that did not finish. An expiry is answered once; a disconnect writes nothing. */
function bodyFailed(cause: LifetimeCause, lifetime: RequestLifetime, req: IncomingMessage, res: ServerResponse): void {
  // The lifetime recorded its own expiry, disconnect and completion; the rest are this stage's.
  if (cause.kind !== 'request-timeout' && cause.kind !== 'disconnected' && cause.kind !== 'completed') lifetime.record(cause);
  if (cause.kind === 'disconnected' || cause.kind === 'cancelled' || cause.kind === 'completed') return;
  if (mayAnswer(lifetime, res)) refuseAndClose(req, res, 408, { error: 'request_timeout' });
}

/**
 * Reads and parses a POST body as one bounded stage of the request. `undefined` means the
 * response has been dealt with (or the caller has gone) and nothing may be built for it.
 */
async function readJsonBody(req: IncomingMessage, res: ServerResponse, lifetime: RequestLifetime): Promise<{ value: unknown } | undefined> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    if (mayAnswer(lifetime, res)) refuseAndClose(req, res, 413, { error: 'payload_too_large' });
    return undefined;
  }
  const read = await lifetime.run('body', (scope) => readLimitedBody(req, scope.signal));
  if (!read.ok) return void bodyFailed(read.cause, lifetime, req, res);
  if (!mayAnswer(lifetime, res)) return undefined;
  if (read.value.tooLarge) return void refuseAndClose(req, res, 413, { error: 'payload_too_large' });
  try {
    return { value: JSON.parse(read.value.text) as unknown };
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
    return undefined;
  }
}

/**
 * Connects one request's lifetime to its response when the request is admitted. The transport
 * finishing the response ends the lifetime; the caller going away does too. In the other direction,
 * a request deadline that passes before the response is delivered destroys the response, which
 * releases the connection and the transport's listeners. A response is never given a second status.
 */
function bindResponseToLifetime(req: IncomingMessage, res: ServerResponse, lifetime: RequestLifetime): void {
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

export async function startListener(options: ListenerOptions): Promise<Listener> {
  // Resolved and validated before the port opens. Building the servers once up front also makes a
  // missing view stop the process here, not at the first request.
  const budgets = createServerBudgets(options.budgets);
  const probe = budgets.startRequest();
  try {
    createStatusServer({ html: options.html, lifetime: probe });
  } finally {
    probe.finish();
  }

  const app = createMcpFastifyApp({ host: HOST, allowedHosts: ALLOWED_HOSTS });

  // The request's clock starts at admission, before any credential or body wait. Fastify runs the
  // adapter's Host and Origin validation first, so a request it refuses never reaches a lifetime.
  const lifetimes = new WeakMap<IncomingMessage, RequestLifetime>();
  const lifetimeOf = (request: FastifyRequest): RequestLifetime => {
    const lifetime = lifetimes.get(request.raw);
    if (lifetime === undefined) throw new Error('The request has no lifetime.');
    return lifetime;
  };
  app.addHook('onRequest', async (request, reply) => {
    const lifetime = budgets.startRequest();
    lifetimes.set(request.raw, lifetime);
    bindResponseToLifetime(request.raw, reply.raw, lifetime);
  });

  // Fastify's body parsers read the whole body with no deadline. Every content type is handed on
  // as the unread stream instead, and `readJsonBody` reads it under the request's lifetime.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', (_request, payload, done) => done(null, payload));

  // #region saga-snippet:identity-handoff
  // Who is asking is decided before any server is built or any body is read. The verified context
  // travels to the tool only as the transport's per-request auth; no tool argument can name an account.
  const identityHandoff = async (request: FastifyRequest, reply: FastifyReply) => {
    const decision = await authenticate(request.raw, options.verifier, lifetimeOf(request));
    if (!decision.ok) {
      if (decision.challenge !== undefined) reply.header('WWW-Authenticate', decision.challenge);
      return reply.code(decision.status).send();
    }
    Object.assign(request.raw, { auth: decision.authInfo });
  };
  // #endregion saga-snippet:identity-handoff

  /** Serves one MCP request on a fresh server and transport. Fastify does not answer it: this does. */
  async function serve(build: (lifetime: RequestLifetime) => McpServer, request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const lifetime = lifetimeOf(request);
    const req = request.raw;
    const res = reply.raw;
    reply.hijack();
    try {
      // The body is this listener's wait, so it runs under the request's lifetime and is bounded
      // before any server or transport exists. Nothing is built for a request that has ended.
      const body = req.method === 'POST' ? await readJsonBody(req, res, lifetime) : undefined;
      if (req.method === 'POST' && body === undefined) return;
      if (lifetime.check() !== undefined) return;
      const server = build(lifetime);
      const transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        maxRequestBodySize: MAX_REQUEST_BYTES,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body?.value);
    } catch {
      if (res.destroyed) return;
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    }
  }

  app.all(STATUS_PATH, (request, reply) => serve((lifetime) => createStatusServer({ html: options.html, lifetime }), request, reply));
  app.all(ACCOUNT_PATH, { onRequest: identityHandoff }, (request, reply) =>
    serve((lifetime) => createAccountServer({ html: options.html, lifetime, authorize: options.authorize }), request, reply),
  );

  await app.listen({ port: options.port, host: HOST });
  const { port } = app.server.address() as AddressInfo; // listen() on a TCP port yields AddressInfo

  return {
    statusUrl: `http://${HOST}:${port}${STATUS_PATH}`,
    accountUrl: `http://${HOST}:${port}${ACCOUNT_PATH}`,
    close: async () => {
      const closing = app.close();
      app.server.closeAllConnections();
      await closing;
    },
  };
}
