import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RawHttpConnection } from '../../../../scripts/raw-http-connection.js';
import { registerPublicOperation } from './operation.js';
import { startLocalMcpServer } from '@saga-a2ui/mcp/server/node';

describe('local MCP hosting', () => {
  it('serves app operations over HTTP while state stays with the application', async () => {
    let count = 0;
    const listener = await startLocalMcpServer({
      port: 0,
      createServer(lifetime) {
        const server = new McpServer({
          name: 'local-host-test',
          version: '1.0.0',
        });
        registerPublicOperation(
          server,
          {
            name: 'count',
            title: 'Count',
            description: 'Increments the application counter.',
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: false,
            },
            input: z.strictObject({}),
            output: z.strictObject({ count: z.number() }),
            failures: {
              absent: 'Absent',
              unavailable: 'Unavailable',
              invalidOutput: 'Invalid',
            },
            handle: async () => ({ kind: 'record', record: ++count }),
            project: (value) => ({
              text: String(value),
              data: { count: value },
            }),
          },
          { lifetime },
        );
        return server;
      },
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    try {
      expect(new URL(listener.url).hostname).toBe('127.0.0.1');
      await client.connect(
        new StreamableHTTPClientTransport(new URL(listener.url)),
      );
      expect(
        (await client.callTool({ name: 'count', arguments: {} }))
          .structuredContent,
      ).toEqual({ count: 1 });
      expect(
        (await client.callTool({ name: 'count', arguments: {} }))
          .structuredContent,
      ).toEqual({ count: 2 });
    } finally {
      await client.close();
      await listener.close();
    }
    await listener.close();
    await expect(fetch(listener.url)).rejects.toThrow();
  });
});

describe('local MCP request admission', () => {
  it('rejects untrusted hosts/origins and oversized or malformed bodies before building a server', async () => {
    let builds = 0;
    const listener = await startLocalMcpServer({
      port: 0,
      createServer() {
        builds++;
        return new McpServer({ name: 'admission-test', version: '1.0.0' });
      },
    });
    const post = (body: string, headers: Record<string, string> = {}) =>
      fetch(listener.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body,
      });
    try {
      const { request } = await import('node:http');
      const rawPost = (headers: Record<string, string>) =>
        new Promise<number | undefined>((resolve, reject) => {
          const req = request(
            listener.url,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...headers },
            },
            (res) => {
              res.resume();
              res.once('end', () => resolve(res.statusCode));
            },
          );
          req.once('error', reject);
          req.end('{}');
        });
      expect(await rawPost({ Host: 'untrusted.example' })).toBe(403);
      expect(
        (await post('{}', { Origin: 'https://untrusted.example' })).status,
      ).toBe(403);
      expect(await rawPost({ 'Content-Length': String(1024 * 1024 + 1) })).toBe(
        413,
      );
      const malformed = await post('{');
      expect(malformed.status).toBe(400);
      expect(await malformed.json()).toMatchObject({ error: { code: -32700 } });
      expect((await fetch(new URL('/other', listener.url))).status).toBe(404);
      expect(builds).toBe(0);
    } finally {
      await listener.close();
    }
  });

  // The router may not skip the wildcard admission middleware for a path that carries an encoded
  // line terminator: Host and Origin validation and the request clock cover every path, found or not.
  it.each(['%0A', '%0D', '%E2%80%A8', '%E2%80%A9'])(
    'applies Host and Origin validation to a path with the encoded line terminator %s',
    async (terminator) => {
      let builds = 0;
      const listener = await startLocalMcpServer({
        port: 0,
        createServer() {
          builds++;
          return new McpServer({ name: 'admission-test', version: '1.0.0' });
        },
      });
      const { request } = await import('node:http');
      const status = (path: string, headers: Record<string, string>) =>
        new Promise<number | undefined>((resolve, reject) => {
          const req = request(
            new URL(path, listener.url),
            { method: 'POST', headers: { 'Content-Type': 'application/json' } },
            (res) => {
              res.resume();
              res.once('end', () => resolve(res.statusCode));
            },
          );
          // Node would otherwise replace the header it was given with the connection's own.
          for (const [name, value] of Object.entries(headers))
            req.setHeader(name, value);
          req.once('error', reject);
          req.end('{}');
        });
      try {
        for (const path of [
          `/mcp${terminator}`,
          `/other${terminator}`,
          `/${terminator}`,
          `/mcp/${terminator}x`,
        ]) {
          // Refused before routing, as for any other path.
          expect(await status(path, { Host: 'untrusted.example' }), path).toBe(
            403,
          );
          expect(
            await status(path, { Origin: 'https://untrusted.example' }),
            path,
          ).toBe(403);
          // Control: a trusted caller reaches the same not-found answer, and nothing is built.
          expect(await status(path, {}), path).toBe(404);
        }
        // Control: the same refusals on a path without a terminator.
        expect(await status('/other', { Host: 'untrusted.example' })).toBe(403);
        expect(await status('/other', {})).toBe(404);
        expect(builds).toBe(0);
      } finally {
        await listener.close();
      }
    },
  );

  it('ends a stalled body at the request deadline before invoking application code', async () => {
    const { request } = await import('node:http');
    let builds = 0;
    const listener = await startLocalMcpServer({
      port: 0,
      budgets: { requestMs: 100 },
      createServer() {
        builds++;
        return new McpServer({ name: 'body-test', version: '1.0.0' });
      },
    });
    try {
      const status = await new Promise<number | undefined>(
        (resolve, reject) => {
          const req = request(
            listener.url,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': '100',
              },
            },
            (res) => {
              res.resume();
              res.once('end', () => resolve(res.statusCode));
            },
          );
          req.once('error', reject);
          req.setTimeout(2000, () =>
            req.destroy(new Error('request deadline did not close the body')),
          );
          req.write('{');
        },
      );
      expect(status).toBe(408);
      expect(builds).toBe(0);
    } finally {
      await listener.close();
    }
  });

  // An early refusal answers before the body has arrived. The unread remainder must not keep the
  // connection open until Node's own (much longer) request timeout, and the refusal itself must be a
  // whole, correct answer delivered before the connection goes. Node's HTTP client parses the framing,
  // so a response that ended (`end`) arrived complete; the socket's own close is observed separately.
  interface Exchange {
    status?: number;
    allow?: string;
    body: string;
    /** When the whole response had arrived, if it did. */
    endedAt?: number;
    /** When the socket closed, if it did within the window. */
    closedAt?: number;
  }

  /** POSTs to `path` on a fresh connection, declaring `declared` body bytes and writing only `sent`. */
  async function refusedOnce(
    listenerUrl: string,
    path: string,
    headers: Record<string, string>,
    declared: number,
    sent: string,
    windowMs: number,
  ): Promise<Exchange> {
    const { request } = await import('node:http');
    return new Promise<Exchange>((resolve) => {
      const outcome: Exchange = { body: '' };
      const req = request(new URL(path, listenerUrl), {
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(declared),
          ...headers,
        },
      });
      const finish = () => {
        clearTimeout(timer);
        req.destroy();
        resolve(outcome);
      };
      const timer = setTimeout(finish, windowMs);
      // The socket's own close, not the response's: the response also closes when it ends.
      req.on('socket', (socket) =>
        socket.once('close', () => {
          outcome.closedAt = Date.now();
          finish();
        }),
      );
      req.on('response', (res) => {
        outcome.status = res.statusCode;
        outcome.allow = res.headers.allow;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (outcome.body += chunk));
        res.on('end', () => (outcome.endedAt = Date.now()));
      });
      req.on('error', () => undefined);
      req.write(sent);
    });
  }

  it.each([
    ['an untrusted Host', '/mcp', { Host: 'untrusted.example' }, 403],
    [
      'an untrusted Origin',
      '/mcp',
      { Origin: 'https://untrusted.example' },
      403,
    ],
    ['an unknown path', '/other', {}, 404],
  ] as const)(
    'delivers the whole answer to %s, then closes the connection while the body is incomplete',
    async (_label, path, headers, expected) => {
      let builds = 0;
      const listener = await startLocalMcpServer({
        port: 0,
        // Long enough that only the refusal path can end the connection inside the window.
        budgets: { requestMs: 30_000, operationMs: 3_000 },
        createServer() {
          builds++;
          return new McpServer({ name: 'refusal-test', version: '1.0.0' });
        },
      });
      try {
        // The same refusal when the body is delivered whole: the answer the stalled one must match.
        const whole = await refusedOnce(
          listener.url,
          path,
          headers,
          1,
          '{',
          1_500,
        );
        const seen = await refusedOnce(
          listener.url,
          path,
          headers,
          1000,
          '{',
          1_500,
        );
        expect(seen.status).toBe(expected);
        expect(seen.body).toBe(whole.body);
        expect(seen.allow).toBe(whole.allow);
        // Complete before the close, then closed.
        expect(seen.endedAt).toBeDefined();
        expect(seen.closedAt).toBeDefined();
        expect(seen.closedAt).toBeGreaterThanOrEqual(seen.endedAt ?? Infinity);
        expect(builds).toBe(0);
      } finally {
        await listener.close();
      }
    },
  );

  it('keeps the connection and answers the next requests on it when a refused body completes promptly', async () => {
    const { Agent, request } = await import('node:http');
    const listener = await startLocalMcpServer({
      port: 0,
      createServer() {
        return new McpServer({ name: 'refusal-control', version: '1.0.0' });
      },
    });
    // One socket for everything below: a second request that needed a new one would not be reuse.
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      const send = (
        path: string,
        headers: Record<string, string>,
        declared: number,
        first: string,
        rest?: Promise<string>,
      ) =>
        new Promise<{
          status?: number;
          body: string;
          reused: boolean;
          ended: boolean;
        }>((resolve, reject) => {
          const req = request(new URL(path, listener.url), {
            method: 'POST',
            agent,
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': String(declared),
              ...headers,
            },
          });
          const seen = {
            status: undefined as number | undefined,
            body: '',
            reused: false,
            ended: false,
          };
          req.on('error', reject);
          req.on('response', (res) => {
            seen.status = res.statusCode;
            seen.reused = req.reusedSocket;
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (seen.body += chunk));
            res.on('end', () => {
              seen.ended = true;
              resolve(seen);
            });
          });
          req.write(first);
          // The rest of the declared body arrives after the answer, inside the drain window.
          if (rest) void rest.then((more) => req.end(more));
          else if (declared === first.length) req.end();
        });

      // The unknown path is answered while two of its three body bytes are still to come.
      const later = new Promise<string>((resolve) =>
        setTimeout(() => resolve('  '), 100),
      );
      const first = await send('/other', {}, 3, '{', later);
      expect(first.status).toBe(404);
      expect(first.ended).toBe(true);
      await later;
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The same socket then answers two more refusals, each whole and for itself.
      const second = await send('/mcp', { Host: 'untrusted.example' }, 1, '{');
      expect(second.status).toBe(403);
      expect(second.ended).toBe(true);
      expect(second.reused).toBe(true);
      const third = await send('/other', {}, 2, '{}');
      expect(third.status).toBe(404);
      expect(third.ended).toBe(true);
      expect(third.reused).toBe(true);
      expect(second.body).not.toBe('');
    } finally {
      agent.destroy();
      await listener.close();
    }
  });

  // Requests queued in one write behind a refused one's remainder, read off a raw connection so the
  // framing and the pipelining are the test's own: a small remainder keeps the connection and each
  // queued request is answered whole. This listener is hosted by the pinned `@hono/node-server` adapter,
  // whose own drain is bounded at 500 ms and 64 MiB, so the SDK's 1 MiB cap does not apply to it.
  it('answers both requests queued behind a small refused-body remainder in the same write, each whole and with nothing stray', async () => {
    const listener = await startLocalMcpServer({
      port: 0,
      createServer() {
        return new McpServer({ name: 'refusal-control', version: '1.0.0' });
      },
    });
    const connection = await RawHttpConnection.open(listener.url);
    try {
      const url = new URL(listener.url);
      connection.request('POST', new URL('/other', listener.url).href, {
        declaredLength: 3,
        body: '{',
      });
      expect((await connection.readResponse(3_000)).status).toBe(404);
      connection.write(
        `  POST /other HTTP/1.1\r\nHost: ${url.host}\r\nContent-Type: application/json\r\nContent-Length: 1\r\n\r\n{` +
          `POST /mcp HTTP/1.1\r\nHost: untrusted.example\r\nContent-Type: application/json\r\nContent-Length: 1\r\n\r\n{`,
      );
      const second = await connection.readResponse(3_000);
      expect(second.status).toBe(404);
      const third = await connection.readResponse(3_000);
      expect(third.status).toBe(403);
      expect(await connection.waitForClose(800)).toBe(false);
      expect(connection.pending).toBe('');
    } finally {
      connection.destroy();
      await listener.close();
    }
  });

  it('keeps serving a well-formed request after refusing one with an incomplete body', async () => {
    const { request } = await import('node:http');
    const listener = await startLocalMcpServer({
      port: 0,
      createServer() {
        return new McpServer({ name: 'refusal-control', version: '1.0.0' });
      },
    });
    try {
      const stalled = request(listener.url, {
        method: 'POST',
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '1000',
          Host: 'untrusted.example',
        },
      });
      stalled.on('error', () => undefined);
      stalled.on('response', (res) => res.resume());
      stalled.write('{');
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(listener.url)),
      );
      await client.close();
      stalled.destroy();
    } finally {
      await listener.close();
    }
  });
});

describe('local MCP shutdown', () => {
  it('cancels an operation that is still running', async () => {
    let entered!: (signal: AbortSignal) => void;
    const started = new Promise<AbortSignal>((resolve) => {
      entered = resolve;
    });
    const listener = await startLocalMcpServer({
      port: 0,
      createServer(lifetime) {
        const server = new McpServer({
          name: 'shutdown-test',
          version: '1.0.0',
        });
        registerPublicOperation(
          server,
          {
            name: 'wait',
            title: 'Wait',
            description: 'Waits until the request ends.',
            input: z.strictObject({}),
            output: z.strictObject({ message: z.string() }),
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            failures: {
              absent: 'Absent',
              unavailable: 'Unavailable',
              invalidOutput: 'Invalid',
            },
            handle: async () => {
              entered(lifetime.signal);
              return await new Promise<{ kind: 'record'; record: string }>(
                () => {},
              );
            },
            project: (message) => ({ text: message, data: { message } }),
          },
          { lifetime },
        );
        return server;
      },
    });
    const client = new Client({ name: 'test', version: '1.0.0' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(listener.url)),
      );
      const pending = client
        .callTool({ name: 'wait', arguments: {} })
        .catch(() => undefined);
      const signal = await started;
      await listener.close();
      expect(signal.aborted).toBe(true);
      await pending;
    } finally {
      await client.close();
      await listener.close();
    }
  });
});
