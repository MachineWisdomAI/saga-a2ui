import net from 'node:net';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createDevelopmentVerifier, DEV_RESOURCE } from './dev-auth.js';
import { startEpisodeListener, type EpisodeListener } from './listener.js';

// An answer given before the request body has arrived (an unknown path, a refused method, a missing
// credential) must not leave the connection waiting for the rest of a body that may never come. A body
// that does finish promptly is read and discarded, and the connection stays usable.

const VIEW_HTML =
  '<!doctype html><html><head><title>view</title></head><body><saga-app></saga-app></body></html>';
const open: { listener?: EpisodeListener } = {};

afterEach(async () => {
  await open.listener?.close();
  open.listener = undefined;
});

async function start(): Promise<EpisodeListener> {
  const listener = await startEpisodeListener({
    viewHtml: VIEW_HTML,
    catalog: { find: () => undefined },
    port: 0,
    subscriptions: {
      viewHtml: VIEW_HTML,
      backend: { listSubscriptions: async () => undefined },
      verifier: createDevelopmentVerifier(),
      resource: DEV_RESOURCE,
    },
  });
  open.listener = listener;
  return listener;
}

interface Seen {
  /** The status line's code, if an answer arrived. */
  status: number | undefined;
  /** True when the server closed the socket within the window. */
  closed: boolean;
  /** Writes the rest of the declared body. */
  finishBody(rest: string): void;
  /** Resolves when the server closes the socket or `windowMs` passes. */
  settled: Promise<void>;
  destroy(): void;
}

/** A request whose body is declared as `declared` bytes but only `sent` is written. */
function incomplete(
  url: string,
  method: string,
  sent: string,
  declared: number,
  headers: string[],
  windowMs: number,
): Seen {
  const target = new URL(url);
  const socket = net.connect(Number(target.port), target.hostname);
  const seen: Seen = {
    status: undefined,
    closed: false,
    finishBody: (rest) => void socket.write(rest),
    settled: new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, windowMs);
      socket.once('close', () => {
        seen.closed = true;
        clearTimeout(timer);
        resolve();
      });
    }),
    destroy: () => void socket.destroy(),
  };
  let head = '';
  socket.on('data', (chunk) => {
    head += chunk.toString('latin1');
    const match = /^HTTP\/1\.1 (\d{3})/.exec(head);
    if (match) seen.status = Number(match[1]);
  });
  socket.on('error', () => undefined);
  socket.write(
    [
      `${method} ${target.pathname} HTTP/1.1`,
      `Host: ${target.host}`,
      'Content-Type: application/json',
      `Content-Length: ${declared}`,
      ...headers,
      '',
      sent,
    ].join('\r\n'),
  );
  return seen;
}

describe('an early answer while the request body is incomplete', () => {
  it.each([
    [
      'an unknown path',
      (l: EpisodeListener) => `${l.url}/nowhere`,
      'POST',
      404,
    ],
    [
      'a method the endpoint refuses',
      (l: EpisodeListener) => l.url,
      'PUT',
      405,
    ],
    [
      'a missing credential',
      (l: EpisodeListener) => l.subscriptionsUrl ?? '',
      'POST',
      401,
    ],
  ] as const)(
    'closes the connection after %s',
    async (_label, urlOf, method, expected) => {
      const listener = await start();
      const seen = incomplete(urlOf(listener), method, '{', 1000, [], 2_500);
      await seen.settled;
      expect(seen.status).toBe(expected);
      expect(seen.closed).toBe(true);
      seen.destroy();
    },
  );

  it('keeps the connection when the rest of the body arrives promptly', async () => {
    const listener = await start();
    const seen = incomplete(`${listener.url}/nowhere`, 'POST', '{', 3, [], 600);
    await new Promise((resolve) => setTimeout(resolve, 100));
    seen.finishBody('  ');
    await seen.settled;
    expect(seen.status).toBe(404);
    expect(seen.closed).toBe(false);
    seen.destroy();
  });

  it('serves a complete request on a new connection after refusing a stalled one', async () => {
    const listener = await start();
    const stalled = incomplete(
      `${listener.url}/nowhere`,
      'POST',
      '{',
      1000,
      [],
      300,
    );
    await stalled.settled;
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(listener.url)),
    );
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
    stalled.destroy();
  });
});
