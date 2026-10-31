import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { CLOSED_VIEW_CSP } from '../../policy/index.js';
import type { RequestLifetime } from '../lifetime.js';
import { registerPublicOperation } from '../operation.js';
import {
  McpFetchConfigurationError,
  createMcpFetchApp,
  type McpFetchApp,
  type McpFetchAppOptions,
  type McpFetchFailureKind,
} from './index.js';

// Fetch hosting is exercised through its public `fetch` only: a real MCP client speaks to it with
// `fetch` replaced by the app, so no listener is started. The unchanged lifetime and operation
// contracts have their own suites; here a lifetime is observed only by how many times it ends.

const ORIGIN = 'https://app.example';
const HOST = 'app.example';
const MODERN = '2026-07-28';
const VIEW_URI = 'ui://fetch-test/counter.html';

interface Harness {
  readonly app: McpFetchApp;
  readonly lifetimes: RequestLifetime[];
  readonly finishes: () => number[];
  readonly effects: () => number;
  readonly failures: McpFetchFailureKind[];
}

const open: McpFetchApp[] = [];
afterEach(async () => {
  for (const app of open.splice(0)) await app.close();
});

function harness(
  overrides: Partial<McpFetchAppOptions> = {},
  failFactory = false,
): Harness {
  const lifetimes: RequestLifetime[] = [];
  const finishSpies: ReturnType<typeof vi.spyOn>[] = [];
  const failures: McpFetchFailureKind[] = [];
  let effects = 0;
  const app = createMcpFetchApp({
    allowedHosts: [HOST],
    allowedOrigins: [HOST],
    onFailure: (kind) => failures.push(kind),
    createServer(lifetime) {
      lifetimes.push(lifetime);
      finishSpies.push(vi.spyOn(lifetime, 'finish'));
      if (failFactory) throw new Error('secret-upstream-detail');
      const server = new McpServer({ name: 'fetch-test', version: '0.0.0' });
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
          view: {
            uri: VIEW_URI,
            title: 'Counter',
            html: '<!doctype html><title>counter</title>',
            csp: CLOSED_VIEW_CSP,
          },
          failures: {
            absent: 'Absent',
            unavailable: 'Unavailable',
            invalidOutput: 'Invalid',
          },
          handle: () => {
            effects += 1;
            return { kind: 'record', record: effects };
          },
          project: (count: number) => ({
            text: String(count),
            data: { count },
          }),
        },
        { lifetime },
      );
      return server;
    },
    ...overrides,
  });
  open.push(app);
  return {
    app,
    lifetimes,
    finishes: () => finishSpies.map((spy) => spy.mock.calls.length),
    effects: () => effects,
    failures,
  };
}

const URL_OF = (path = '/mcp') => `${ORIGIN}${path}`;

/** A request as a host would send it: the Host header is stated, since Fetch derives none from the URL. */
function post(
  path: string,
  headers: Record<string, string> = {},
  body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list' },
): Request {
  return new Request(URL_OF(path), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      host: HOST,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function connect(
  app: McpFetchApp,
  path = '/mcp',
  headers: Record<string, string> = {},
): Promise<Client> {
  const client = new Client({ name: 'fetch-test-client', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(URL_OF(path)), {
      fetch: (input, init) => {
        const request = new Request(input, init);
        for (const [name, value] of Object.entries({
          host: HOST,
          ...headers,
        }))
          request.headers.set(name, value);
        return app.fetch(request);
      },
    }),
  );
  return client;
}

describe.each(['json', 'sse'] as const)('Fetch MCP hosting (%s)', (mode) => {
  it('discovers tools, calls an operation and retrieves its declared view', async () => {
    const { app, effects } = harness({ responseMode: mode });
    const client = await connect(app);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(['count']);
      const result = await client.callTool({ name: 'count', arguments: {} });
      expect(result.structuredContent).toEqual({ count: 1 });
      expect(effects()).toBe(1);
      const view = await client.readResource({ uri: VIEW_URI });
      expect(JSON.stringify(view.contents)).toContain('<title>counter</title>');
    } finally {
      await client.close();
    }
  });

  it('answers a modern call with the configured delivery mode', async () => {
    const { app, effects } = harness({ responseMode: mode });
    const response = await app.fetch(
      post(
        '/mcp',
        {
          'mcp-protocol-version': MODERN,
          'mcp-method': 'tools/call',
          'mcp-name': 'count',
        },
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'count',
            arguments: {},
            _meta: {
              'io.modelcontextprotocol/protocolVersion': MODERN,
              'io.modelcontextprotocol/clientInfo': {
                name: 'fetch-test-client',
                version: '0.0.0',
              },
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        },
      ),
    );
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain(
      mode === 'json' ? 'application/json' : 'text/event-stream',
    );
    expect(text).toContain('"count":1');
    expect(effects()).toBe(1);
  });
});

describe('Fetch MCP hosting route', () => {
  it('serves /mcp by default and any other path as not found, without running the application', async () => {
    const { app, lifetimes, effects } = harness();
    expect((await app.fetch(post('/mcp'))).status).toBe(200);
    const built = lifetimes.length;
    for (const path of ['/', '/other', '/mcp/', '/mcp/extra', '/health']) {
      const response = await app.fetch(post(path));
      expect([path, response.status]).toEqual([path, 404]);
    }
    expect(lifetimes.length).toBe(built);
    expect(effects()).toBe(0);
  });

  it('serves only the configured exact route', async () => {
    const { app } = harness({ path: '/tic-tac-toe/mcp' });
    expect((await app.fetch(post('/tic-tac-toe/mcp'))).status).toBe(200);
    expect((await app.fetch(post('/mcp'))).status).toBe(404);
    expect((await app.fetch(post('/tic-tac-toe'))).status).toBe(404);
    const client = await connect(app, '/tic-tac-toe/mcp');
    try {
      expect((await client.listTools()).tools).toHaveLength(1);
    } finally {
      await client.close();
    }
  });
});

describe('Fetch MCP hosting admission', () => {
  it('refuses an unlisted Host before any application code runs', async () => {
    const { app, lifetimes, effects } = harness();
    const response = await app.fetch(post('/mcp', { host: 'evil.example' }));
    expect(response.status).toBe(403);
    expect(lifetimes).toEqual([]);
    expect(effects()).toBe(0);
  });

  it('admits a listed Origin and an absent Origin, and refuses an unlisted one', async () => {
    const { app, lifetimes } = harness();
    expect((await app.fetch(post('/mcp', { origin: ORIGIN }))).status).toBe(
      200,
    );
    expect((await app.fetch(post('/mcp'))).status).toBe(200);
    const built = lifetimes.length;
    const refused = await app.fetch(
      post('/mcp', { origin: 'https://evil.example' }),
    );
    expect(refused.status).toBe(403);
    expect(lifetimes.length).toBe(built);
  });

  it('keeps an explicitly empty Host list closed to everyone', async () => {
    const { app, lifetimes } = harness({ allowedHosts: [] });
    expect((await app.fetch(post('/mcp'))).status).toBe(403);
    expect((await app.fetch(post('/mcp', { host: 'localhost' }))).status).toBe(
      403,
    );
    expect((await app.fetch(post('/mcp', { host: '127.0.0.1' }))).status).toBe(
      403,
    );
    expect(lifetimes).toEqual([]);
  });

  it('keeps an explicitly empty Origin list closed to any Origin but not to an absent one', async () => {
    const { app, lifetimes } = harness({ allowedOrigins: [] });
    expect((await app.fetch(post('/mcp', { origin: ORIGIN }))).status).toBe(
      403,
    );
    expect(
      (await app.fetch(post('/mcp', { origin: 'http://localhost' }))).status,
    ).toBe(403);
    expect(lifetimes).toEqual([]);
    expect((await app.fetch(post('/mcp'))).status).toBe(200);
  });

  it('adds no implicit localhost entry', async () => {
    const { app, lifetimes } = harness();
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      expect([host, (await app.fetch(post('/mcp', { host }))).status]).toEqual([
        host,
        403,
      ]);
    expect(
      (await app.fetch(post('/mcp', { origin: 'http://localhost' }))).status,
    ).toBe(403);
    expect(lifetimes).toEqual([]);
  });

  it('trims and de-duplicates the lists', async () => {
    const { app } = harness({
      allowedHosts: [` ${HOST} `, HOST],
      allowedOrigins: [`  ${HOST}`, HOST],
    });
    expect((await app.fetch(post('/mcp', { origin: ORIGIN }))).status).toBe(
      200,
    );
  });
});

describe('Fetch MCP hosting configuration', () => {
  const valid: McpFetchAppOptions = {
    allowedHosts: [HOST],
    allowedOrigins: [HOST],
    createServer: () => new McpServer({ name: 'x', version: '0.0.0' }),
  };

  it.each([
    ['missing hosts', { allowedHosts: undefined }],
    ['missing origins', { allowedOrigins: undefined }],
    ['a blank host', { allowedHosts: ['  '] }],
    ['a non-string origin', { allowedOrigins: [1] }],
    ['a relative path', { path: 'mcp' }],
    ['a wildcard path', { path: '/mcp/*' }],
    ['a parameter path', { path: '/:id' }],
    ['a trailing slash', { path: '/mcp/' }],
    ['a query', { path: '/mcp?x=1' }],
    ['an unknown mode', { responseMode: 'stream' }],
    ['a zero body bound', { maxRequestBodySize: 0 }],
    ['no factory', { createServer: undefined }],
  ])('fails before handling traffic for %s', (_name, patch) => {
    expect(() =>
      createMcpFetchApp({
        ...valid,
        ...patch,
      } as unknown as McpFetchAppOptions),
    ).toThrow(McpFetchConfigurationError);
  });

  it('fails for an invalid budget before handling traffic', () => {
    expect(() =>
      createMcpFetchApp({ ...valid, budgets: { requestMs: 0 } }),
    ).toThrow();
  });

  it('names the setting and never a value', () => {
    try {
      createMcpFetchApp({ ...valid, allowedHosts: [' '], path: '/secret*' });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain('allowedHosts');
      expect(String(error)).not.toContain('secret');
    }
  });

  it('accepts the root path and a nested literal path', () => {
    for (const path of ['/', '/a/b-c/d.e_f'])
      expect(() => createMcpFetchApp({ ...valid, path })).not.toThrow();
  });
});

describe('Fetch MCP hosting lifetime release', () => {
  it('ends each request lifetime once after its transport closes', async () => {
    const { app, lifetimes, finishes } = harness();
    const client = await connect(app);
    await client.listTools();
    await client.callTool({ name: 'count', arguments: {} });
    await client.close();
    await app.close();
    expect(lifetimes.length).toBeGreaterThan(0);
    expect(finishes()).toEqual(lifetimes.map(() => 1));
    for (const lifetime of lifetimes)
      expect(lifetime.cause).toEqual({ kind: 'completed' });
  });

  it('ends the lifetime once, leaks nothing and reports a fixed kind when the factory fails', async () => {
    const { app, lifetimes, finishes, failures } = harness({}, true);
    const response = await app.fetch(post('/mcp'));
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(text).not.toContain('secret-upstream-detail');
    expect(lifetimes).toHaveLength(1);
    expect(finishes()).toEqual([1]);
    expect(failures).toContain('server-factory');
    expect(
      failures.every((kind) => ['server-factory', 'handler'].includes(kind)),
    ).toBe(true);
  });

  it('ends the lifetime once when the server cannot carry it', async () => {
    const other = harness();
    const stranger = other.app;
    expect(stranger).toBeDefined();
    const lifetimes: RequestLifetime[] = [];
    const finishes: number[] = [];
    const app = createMcpFetchApp({
      allowedHosts: [HOST],
      allowedOrigins: [HOST],
      async createServer(lifetime) {
        lifetimes.push(lifetime);
        finishes.push(0);
        const spy = vi.spyOn(lifetime, 'finish');
        spy.mockImplementation(() => {
          finishes[0] = (finishes[0] ?? 0) + 1;
        });
        const { attachRequestLifetime, createServerBudgets } =
          await import('../index.js');
        const server = new McpServer({ name: 'x', version: '0.0.0' });
        attachRequestLifetime(server, createServerBudgets().startRequest());
        return server;
      },
    });
    open.push(app);
    expect((await app.fetch(post('/mcp'))).status).toBeGreaterThanOrEqual(500);
    expect(finishes).toEqual([1]);
  });

  it('ends the lifetime of a server the handler closes without a connected transport', async () => {
    const { app, lifetimes, finishes } = harness();
    // A modern listen stream and a rejected request are served without a connected transport on
    // some paths; whichever the handler builds, each built lifetime ends exactly once.
    for (const body of [
      { jsonrpc: '2.0', id: 1, method: 'unknown/method' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'ping' },
    ]) {
      const response = await app.fetch(post('/mcp', {}, body));
      await response.text();
    }
    await app.close();
    expect(finishes()).toEqual(lifetimes.map(() => 1));
  });

  it('shares one shutdown between repeated close calls', async () => {
    const { app } = harness();
    expect(app.close()).toBe(app.close());
    await app.close();
  });
});

describe('Fetch MCP hosting diagnostics', () => {
  it('reports only fixed kinds and survives a failing sink', async () => {
    const reported: unknown[] = [];
    const { app } = harness(
      {
        onFailure: (kind) => {
          reported.push(kind);
          throw new Error('sink failure with secret');
        },
      },
      true,
    );
    const response = await app.fetch(post('/mcp'));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.text()).not.toContain('secret');
    expect(reported.length).toBeGreaterThan(0);
    for (const kind of reported)
      expect(['server-factory', 'handler', 'route']).toContain(kind);
  });

  it('answers a route failure with fixed text', async () => {
    const { app } = harness();
    const response = await app.fetch(
      new Request(URL_OF('/mcp'), {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(response.status).toBeLessThan(500);
    expect(await response.text()).not.toContain('not json');
  });
});
