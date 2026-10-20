import type { IncomingMessage, ServerResponse } from 'node:http';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/server';
import type { RequestLifetime } from '@saga-a2ui/mcp/server';
import { createNotesServer, type NotesBackend } from '../../../examples/pack1-consumer/server/index.js';
import { authenticate } from '../../../templates/lit-node/server/authenticate.js';

// The notes endpoint of the demonstration: the PACK1 notes application (a non-playback action
// example) served behind the clean starter's own request authentication. `authenticate` is the
// starter's glue, unchanged: bearer credential, expiry, scope and a frozen per-request identity,
// all before any server is built. The notes server then decides again for every protected call
// from that identity alone (a prior `check_session` authorizes nothing).

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
function bindToLifetime(req: IncomingMessage, res: ServerResponse, lifetime: RequestLifetime): void {
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

/** Serves one POST of the notes endpoint. The caller owns the path and the lifetime. */
export async function serveNotes(options: NotesEndpointOptions, req: IncomingMessage, res: ServerResponse, lifetime: RequestLifetime): Promise<void> {
  bindToLifetime(req, res, lifetime);
  if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();
  const decision = await authenticate(req, options.verifier, lifetime);
  if (!decision.ok) {
    if (!res.headersSent && !res.destroyed) res.writeHead(decision.status, decision.challenge === undefined ? {} : { 'WWW-Authenticate': decision.challenge }).end();
    return;
  }
  if (lifetime.check() !== undefined) return;
  // The transport reads the verified context only from the request, never from a tool argument.
  Object.assign(req, { auth: decision.authInfo });
  const server = createNotesServer({ html: options.html, backend: options.backend });
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
  await transport.handleRequest(req, res);
}
