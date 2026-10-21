import type { IncomingMessage, ServerResponse } from 'node:http';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/server';
import type { LifetimeCause, RequestLifetime } from '@saga-a2ui/mcp/server';
import { mayAnswer } from '../../../apps/lit-host/src/mcp/response-lifetime.js';
import {
  createNotesServer,
  type NotesBackend,
} from '../../../examples/pack1-consumer/server/index.js';
import { authenticate } from '../../../templates/lit-node/server/authenticate.js';

// The notes endpoint of the demonstration: the PACK1 notes application (a non-playback action
// example) served behind the clean starter's own request authentication. `authenticate` is the
// starter's glue, unchanged: bearer credential, expiry, scope and a frozen per-request identity,
// all before any server is built. The notes server then decides again for every protected call
// from that identity alone (a prior `check_session` authorizes nothing).
//
// Time: the request's lifetime starts at admission (the caller starts it), and this file wires that
// one deadline into every wait: authentication, the request body (a stage of its own, so a body that
// stalls is answered once with 408 and the connection is closed) and, through `createNotesServer`,
// each backend call of the notes operations. Each stage is bounded by the operation limit and by what
// the request has left; none of them renews the request.

const MAX_REQUEST_BYTES = 64 * 1024;

export interface NotesEndpointOptions {
  /** The built notes page. Its bytes name its resource. */
  readonly html: string;
  readonly backend: NotesBackend;
  readonly verifier: OAuthTokenVerifier;
  /** Host header values this endpoint answers to (DNS-rebinding protection). */
  readonly allowedHosts: readonly string[];
}

/**
 * Connects the request's lifetime to its response: finishing the response ends the lifetime, the
 * caller going away disconnects it, and a deadline that passes first destroys the connection so a
 * stalled body cannot hold it open. A response is never given a second status.
 */
function bindToLifetime(
  req: IncomingMessage,
  res: ServerResponse,
  lifetime: RequestLifetime,
): void {
  res.on('error', () => undefined);
  req.on('error', () => undefined);
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
      setImmediate(() => {
        if (!res.writableFinished && !res.destroyed) res.destroy();
        req.destroy();
      });
    },
    { once: true },
  );
}

/**
 * Reads the request body until it ends, `MAX_REQUEST_BYTES` is exceeded or `gate` aborts, and settles
 * once. Avoids for-await: leaving that loop destroys the socket before a 413 can be written.
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
      finish({ tooLarge: false, text: Buffer.concat(chunks).toString('utf8') });
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

/** A body stage that did not finish. An expiry is answered once; a disconnect or cancellation writes nothing. */
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
 * Reads and parses a POST body as one bounded stage of the request. `undefined` means the response
 * has been dealt with (or the caller has gone) and nothing may be built for it.
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

/** Serves one POST of the notes endpoint. The caller owns the path and the lifetime. */
export async function serveNotes(
  options: NotesEndpointOptions,
  req: IncomingMessage,
  res: ServerResponse,
  lifetime: RequestLifetime,
): Promise<void> {
  bindToLifetime(req, res, lifetime);
  if (req.method !== 'POST')
    return void res.writeHead(405, { allow: 'POST' }).end();
  const decision = await authenticate(req, options.verifier, lifetime);
  if (!decision.ok) {
    if (mayAnswer(lifetime, res))
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
  // The body is the adapter's wait, so it runs under the request's lifetime (what authentication
  // left, never more) and is bounded before any server or transport exists.
  const body = await readJsonBody(req, res, lifetime);
  if (body === undefined) return;
  if (lifetime.check() !== undefined) return;
  // The transport reads the verified context only from the request, never from a tool argument.
  Object.assign(req, { auth: decision.authInfo });
  const server = createNotesServer({
    html: options.html,
    filename: 'notes.html',
    backend: options.backend,
    lifetime,
  });
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: [...options.allowedHosts],
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body.value);
}
