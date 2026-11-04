import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { RawHttpConnection } from '../../../../scripts/raw-http-connection.js';
import { createDevelopmentVerifier, DEV_RESOURCE } from './dev-auth.js';
import { startEpisodeListener, type EpisodeListener } from './listener.js';

// An answer given before the request body has arrived (an unknown path, a refused method, a missing
// credential) must not leave the connection waiting for the rest of a body that may never come. A body
// that does finish promptly is read and discarded, and the same connection serves the next request.
// Both are read off a real TCP connection, framing included: the answer must be whole and correct
// before the connection closes, and a kept connection must answer the next request without desync.

const VIEW_HTML =
  '<!doctype html><html><head><title>view</title></head><body><saga-app></saga-app></body></html>';
const open: { listener?: EpisodeListener; connections: RawHttpConnection[] } = {
  connections: [],
};

afterEach(async () => {
  for (const connection of open.connections) connection.destroy();
  open.connections = [];
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

async function connect(url: string): Promise<RawHttpConnection> {
  const connection = await RawHttpConnection.open(url);
  open.connections.push(connection);
  return connection;
}

describe('an early answer while the request body is incomplete', () => {
  it.each([
    [
      'an unknown path',
      (l: EpisodeListener) => `${l.url}/nowhere`,
      'POST',
      404,
      '',
      {},
    ],
    [
      'a method the endpoint refuses',
      (l: EpisodeListener) => l.url,
      'PUT',
      405,
      '',
      { allow: 'POST' },
    ],
    [
      'a missing credential',
      (l: EpisodeListener) => l.subscriptionsUrl ?? '',
      'POST',
      401,
      '{"error":"missing_token"}',
      {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="saga-a2ui-subscriptions"',
      },
    ],
  ] as const)(
    'delivers the whole answer to %s, then closes the connection',
    async (_label, urlOf, method, status, body, headers) => {
      const listener = await start();
      const connection = await connect(listener.url);
      connection.request(method, urlOf(listener), {
        declaredLength: 1000,
        body: '{',
      });

      // The whole response, with its framing, arrives while the body is still unfinished.
      const response = await connection.readResponse(2_500);
      expect(response.status).toBe(status);
      expect(response.body).toBe(body);
      expect(response.headers).toMatchObject(headers);
      const answered = Date.now();
      expect(connection.isClosed).toBe(false);

      // Then the listener drops the connection after its bounded drain, and writes nothing more.
      expect(await connection.waitForClose(2_500)).toBe(true);
      expect(Date.now() - answered).toBeLessThan(2_000);
      expect(connection.pending).toBe('');
    },
  );

  it('keeps the connection and answers the next requests on it when the body completes promptly', async () => {
    const listener = await start();
    const connection = await connect(listener.url);
    connection.request('POST', `${listener.url}/nowhere`, {
      declaredLength: 3,
      body: '{',
    });
    const first = await connection.readResponse(2_500);
    expect(first.status).toBe(404);
    expect(first.body).toBe('');

    // The rest of the declared body arrives inside the drain window; it is consumed, not parsed as a request.
    await new Promise((resolve) => setTimeout(resolve, 100));
    connection.write('  ');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(connection.pending).toBe('');
    expect(connection.isClosed).toBe(false);

    // The next requests go over the same socket, and each is answered whole and for itself.
    const port = connection.localPort;
    connection.request('PUT', listener.url, { declaredLength: 0 });
    const second = await connection.readResponse(2_500);
    expect(second.status).toBe(405);
    expect(second.body).toBe('');
    expect(second.headers).toMatchObject({ allow: 'POST' });

    connection.request('POST', listener.subscriptionsUrl ?? '', {
      declaredLength: 2,
      body: '{}',
    });
    const third = await connection.readResponse(2_500);
    expect(third.status).toBe(401);
    expect(third.body).toBe('{"error":"missing_token"}');
    expect(connection.localPort).toBe(port);

    // Nothing else was written, and the connection is still open well past the drain window.
    expect(await connection.waitForClose(800)).toBe(false);
    expect(connection.pending).toBe('');
  });

  it('serves a complete request on a new connection after refusing a stalled one', async () => {
    const listener = await start();
    const stalled = await connect(listener.url);
    stalled.request('POST', `${listener.url}/nowhere`, {
      declaredLength: 1000,
      body: '{',
    });
    expect((await stalled.readResponse(2_500)).status).toBe(404);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(listener.url)),
    );
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();
  });
});
