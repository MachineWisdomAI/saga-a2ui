import type { McpServer } from '@modelcontextprotocol/server';
import type { RequestLifetime } from './lifetime.js';

// A stateless `createMcpHandler` factory builds one `McpServer` per request, and the request's
// lifetime must end when that server does. Two different events end a server: its transport
// closes, or the handler closes it before any transport was connected (a subscription listen, a
// rejected request). The first fires the server's `onclose`; the second never does. Attaching the
// lifetime covers both, so an application does not subclass `McpServer` to call `finish`.

/** A server already carries a different request lifetime. The lifetime offered was not touched. */
export class RequestLifetimeAttachmentError extends Error {
  constructor() {
    super('The MCP server already ends a different request lifetime.');
    this.name = 'RequestLifetimeAttachmentError';
  }
}

const attached = new WeakMap<McpServer, RequestLifetime>();

/**
 * Ends `lifetime` (`finish`) exactly once when `server` closes: on its transport closing, and on
 * `close()` with or without a transport, including when `close()` throws. Call it once, after the
 * server is created and before it is returned from the factory.
 *
 * It chains to a `server.server.onclose` callback that is already set, so attach after installing
 * your own; the upstream handler chains to this one in the same way. Attaching the same lifetime
 * again changes nothing. A different lifetime throws `RequestLifetimeAttachmentError`: it could
 * never be finished, and its request deadline would run on.
 */
export function attachRequestLifetime(
  server: McpServer,
  lifetime: RequestLifetime,
): void {
  const existing = attached.get(server);
  if (existing === lifetime) return;
  if (existing !== undefined) throw new RequestLifetimeAttachmentError();
  attached.set(server, lifetime);

  let finished = false;
  const finishOnce = (): void => {
    if (finished) return;
    finished = true;
    lifetime.finish();
  };

  const previousOnClose = server.server.onclose;
  server.server.onclose = () => {
    try {
      previousOnClose?.();
    } finally {
      finishOnce();
    }
  };

  const close = server.close.bind(server);
  server.close = async () => {
    try {
      await close();
    } finally {
      finishOnce();
    }
  };
}
