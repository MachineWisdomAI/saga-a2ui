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

describe('Fetch MCP hosting server construction lifetime', () => {
  const NEVER = Symbol('still waiting');
  const budgets = { operationMs: 100, requestMs: 150 };

  /** Settles with the answer, or with `NEVER` when the app has not answered by `ms`. */
  async function answered(
    app: McpFetchApp,
    ms = 2_000,
  ): Promise<Response | typeof NEVER> {
    let timer: NodeJS.Timeout | undefined;
    const waiting = new Promise<typeof NEVER>((resolve) => {
      timer = setTimeout(() => resolve(NEVER), ms);
    });
    try {
      return await Promise.race([app.fetch(post('/mcp')), waiting]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** A factory the test settles by hand, as a non-cooperative upstream would. */
  function deferredFactory() {
    const lifetimes: RequestLifetime[] = [];
    let settle!: (server: McpServer) => void;
    let fail!: (error: unknown) => void;
    const pending = new Promise<McpServer>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    return {
      lifetimes,
      settle,
      fail,
      createServer: (lifetime: RequestLifetime) => {
        lifetimes.push(lifetime);
        return pending;
      },
    };
  }

  it('answers a factory that never settles once the request budget is spent, and ends its lifetime once', async () => {
    const factory = deferredFactory();
    const failures: McpFetchFailureKind[] = [];
    const app = createMcpFetchApp({
      allowedHosts: [HOST],
      allowedOrigins: [HOST],
      budgets,
      createServer: factory.createServer,
      onFailure: (kind) => failures.push(kind),
    });
    open.push(app);
    const response = await answered(app);
    expect(response).not.toBe(NEVER);
    if (response === NEVER) return;
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.text()).not.toContain('still waiting');
    expect(factory.lifetimes).toHaveLength(1);
    expect(['operation-timeout', 'request-timeout']).toContain(
      factory.lifetimes[0]?.cause?.kind,
    );
    expect(failures).toContain('server-factory');
  });

  it('closes a server that a late factory result delivers after the request was answered', async () => {
    const factory = deferredFactory();
    const app = createMcpFetchApp({
      allowedHosts: [HOST],
      allowedOrigins: [HOST],
      budgets,
      createServer: factory.createServer,
    });
    open.push(app);
    expect(await answered(app)).not.toBe(NEVER);
    const late = new McpServer({ name: 'late', version: '0.0.0' });
    const close = vi.spyOn(late, 'close');
    factory.settle(late);
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    const lifetime = factory.lifetimes[0];
    expect(lifetime?.signal.aborted).toBe(true);
  });

  it('does not raise a late factory failure as an unhandled rejection', async () => {
    const factory = deferredFactory();
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      const app = createMcpFetchApp({
        allowedHosts: [HOST],
        allowedOrigins: [HOST],
        budgets,
        createServer: factory.createServer,
      });
      open.push(app);
      expect(await answered(app)).not.toBe(NEVER);
      factory.fail(new Error('late-failure-detail'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  it('still serves a factory that settles inside its budget, and closes nothing early', async () => {
    const lifetimes: RequestLifetime[] = [];
    const closes: ReturnType<typeof vi.spyOn>[] = [];
    const failures: McpFetchFailureKind[] = [];
    const app = createMcpFetchApp({
      allowedHosts: [HOST],
      allowedOrigins: [HOST],
      budgets,
      onFailure: (kind) => failures.push(kind),
      async createServer(lifetime) {
        lifetimes.push(lifetime);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const server = new McpServer({ name: 'slow', version: '0.0.0' });
        // The SDK wraps `close` when it attaches the lifetime; this spy sits under that wrapper.
        closes.push(vi.spyOn(server, 'close'));
        return server;
      },
    });
    open.push(app);
    const response = await app.fetch(
      post('/mcp', {}, { jsonrpc: '2.0', id: 2, method: 'ping' }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"result"');
    // The handler closes the server it used; that is the only close, and it ended the lifetime.
    await vi.waitFor(() =>
      expect(lifetimes[0]?.cause).toEqual({ kind: 'completed' }),
    );
    expect(lifetimes).toHaveLength(1);
    expect(closes).toHaveLength(1);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([]);
  });

  it('keeps the factory failure reported unchanged when it fails inside its budget', async () => {
    const { app, lifetimes, finishes, failures } = harness({ budgets }, true);
    const response = await app.fetch(post('/mcp'));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.text()).not.toContain('secret-upstream-detail');
    expect(lifetimes).toHaveLength(1);
    expect(finishes()).toEqual([1]);
    expect(failures).toContain('server-factory');
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

// The request budget starts when the app admits a request, so a body that is declared too large,
// grows too large, or arrives too slowly is bounded by it before any server exists.
describe('Fetch MCP hosting request lifetime', () => {
  const encoder = new TextEncoder();
  const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  interface BodyProbe {
    readonly request: Request;
    readonly cancelled: () => boolean;
  }

  /** A POST whose body is the given chunks, each arriving after its delay; `hold` keeps the stream open afterwards. */
  function slowPost(
    chunks: readonly { readonly text: string; readonly afterMs: number }[],
    options: { readonly hold?: boolean; readonly headers?: HeadersInit } = {},
  ): BodyProbe {
    let cancelled = false;
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const next = chunks[index++];
        if (next === undefined) {
          if (options.hold === true) return new Promise<void>(() => undefined);
          controller.close();
          return undefined;
        }
        await new Promise((resolve) => setTimeout(resolve, next.afterMs));
        controller.enqueue(encoder.encode(next.text));
        return undefined;
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request(URL_OF('/mcp'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        host: HOST,
        ...(options.headers as Record<string, string> | undefined),
      },
      body,
      duplex: 'half',
    } as RequestInit);
    return { request, cancelled: () => cancelled };
  }

  /** Resolves with the response, or `undefined` when none arrived in time (a hang is a failed assertion, not a timeout). */
  async function answeredWithin(
    app: McpFetchApp,
    request: Request,
    ms: number,
  ): Promise<Response | undefined> {
    return Promise.race([
      app.fetch(request),
      new Promise<undefined>((resolve) => setTimeout(resolve, ms)),
    ]);
  }

  it('answers 408 and builds nothing when the body stalls past the request budget', async () => {
    const { app, lifetimes } = harness({ budgets: { requestMs: 250 } });
    const probe = slowPost([{ text: LIST.slice(0, 10), afterMs: 0 }], {
      hold: true,
    });
    const response = await answeredWithin(app, probe.request, 2_000);
    expect(response?.status).toBe(408);
    expect(await response?.json()).toEqual({ error: 'request_timeout' });
    expect(lifetimes).toHaveLength(0);
    // The connection is not kept for a body that is still owed.
    expect(response?.headers.get('connection')).toBe('close');
  });

  it('counts the time a legitimate body takes against the request budget', async () => {
    const { app, lifetimes } = harness({ budgets: { requestMs: 1_000 } });
    const probe = slowPost([
      { text: LIST.slice(0, 20), afterMs: 150 },
      { text: LIST.slice(20), afterMs: 150 },
    ]);
    const response = await app.fetch(probe.request);
    expect(response.status).toBe(200);
    expect(lifetimes).toHaveLength(1);
    // About 300 ms of the 1,000 ms budget was spent before the server was built.
    expect(lifetimes[0]?.remainingMs()).toBeLessThan(800);
  });

  it('refuses a declared oversize body without reading it', async () => {
    const { app, lifetimes } = harness({ maxRequestBodySize: 64 });
    const probe = slowPost([{ text: 'x', afterMs: 0 }], {
      hold: true,
      headers: { 'content-length': '65' },
    });
    const response = await answeredWithin(app, probe.request, 2_000);
    expect(response?.status).toBe(413);
    expect(lifetimes).toHaveLength(0);
  });

  it('refuses a body that grows past the limit and releases the stream', async () => {
    const { app, lifetimes } = harness({ maxRequestBodySize: 64 });
    const probe = slowPost(
      [
        { text: 'x'.repeat(40), afterMs: 0 },
        { text: 'x'.repeat(40), afterMs: 0 },
      ],
      { hold: true },
    );
    const response = await answeredWithin(app, probe.request, 2_000);
    expect(response?.status).toBe(413);
    expect(lifetimes).toHaveLength(0);
    expect(probe.cancelled()).toBe(true);
  });

  it('still serves a body exactly at the limit', async () => {
    const { app } = harness({ maxRequestBodySize: LIST.length });
    expect((await app.fetch(post('/mcp'))).status).toBe(200);
  });

  it('answers a request that is not JSON-typed or not parseable without building a server', async () => {
    const { app, lifetimes } = harness();
    const wrongType = await app.fetch(
      new Request(URL_OF('/mcp'), {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'text/plain' },
        body: LIST,
      }),
    );
    expect(wrongType.status).toBe(415);
    for (const body of ['', 'not json']) {
      const response = await app.fetch(
        new Request(URL_OF('/mcp'), {
          method: 'POST',
          headers: {
            host: HOST,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body,
        }),
      );
      expect(response.status).toBe(400);
      await response.text();
    }
    expect(lifetimes).toHaveLength(0);
  });

  it('leaves no request timer behind when a request ends before a server is built', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { app } = harness({ maxRequestBodySize: 64 });
      const wrongType = new Request(URL_OF('/mcp'), {
        method: 'POST',
        headers: { host: HOST, 'content-type': 'text/plain' },
        body: LIST,
      });
      expect((await app.fetch(wrongType)).status).toBe(415);
      const oversize = post('/mcp', {}, { pad: 'x'.repeat(100) });
      expect((await app.fetch(oversize)).status).toBe(413);
      expect(
        (
          await app.fetch(
            new Request(URL_OF('/mcp'), {
              method: 'POST',
              headers: {
                host: HOST,
                'content-type': 'application/json',
                accept: 'application/json, text/event-stream',
              },
              body: 'not json',
            }),
          )
        ).status,
      ).toBe(400);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves a body-less request under the same lifetime', async () => {
    const { app, lifetimes, finishes } = harness({
      budgets: { requestMs: 5_000 },
    });
    const response = await app.fetch(
      new Request(URL_OF('/mcp'), {
        method: 'DELETE',
        headers: { host: HOST },
      }),
    );
    await response.text();
    await app.close();
    expect(response.status).toBeLessThan(500);
    expect(finishes()).toEqual(lifetimes.map(() => 1));
  });

  /** A body that counts how often it is pulled and cancelled, and can be fed after the fact. */
  function countedBody(options: { readonly stuckCancel?: boolean } = {}): {
    readonly request: Request;
    readonly stream: ReadableStream<Uint8Array>;
    readonly counts: () => { pulls: number; cancels: number };
    readonly feed: (text: string) => void;
  } {
    let pulls = 0;
    let cancels = 0;
    let feeder: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        feeder = controller;
      },
      pull() {
        pulls += 1;
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancels += 1;
        // A supported source may never settle its own cancellation.
        return options.stuckCancel === true
          ? new Promise<void>(() => undefined)
          : undefined;
      },
    });
    const request = new Request(URL_OF('/mcp'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        host: HOST,
      },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    return {
      request,
      stream,
      counts: () => ({ pulls, cancels }),
      feed: (text) => {
        try {
          feeder?.enqueue(encoder.encode(text));
        } catch {
          // A cancelled stream refuses further chunks, which is the point of the assertion.
        }
      },
    };
  }

  it('cancels and unlocks the body when its stage expires, and reads no more of it', async () => {
    const { app, lifetimes } = harness({ budgets: { requestMs: 60 } });
    const probe = countedBody();
    const response = await answeredWithin(app, probe.request, 2_000);
    expect(response?.status).toBe(408);
    expect(lifetimes).toHaveLength(0);
    const settled = probe.counts();
    expect(settled.cancels).toBe(1);
    expect(probe.stream.locked).toBe(false);
    // Bytes that arrive after the answer are not pulled, and closing the app changes nothing.
    probe.feed(LIST);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.close();
    expect(probe.counts()).toEqual(settled);
    expect(probe.stream.locked).toBe(false);
  });

  it('unlocks the body when the stream source never settles its cancellation', async () => {
    const { app, lifetimes } = harness({ budgets: { requestMs: 25 } });
    const probe = countedBody({ stuckCancel: true });
    const response = await answeredWithin(app, probe.request, 2_000);
    expect(response?.status).toBe(408);
    expect(lifetimes).toHaveLength(0);
    const settled = probe.counts();
    expect(settled.cancels).toBe(1);
    // The lock does not wait for the source's cancellation, which here never settles.
    expect(probe.stream.locked).toBe(false);
    probe.feed(LIST);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.close();
    expect(probe.counts()).toEqual(settled);
    expect(probe.stream.locked).toBe(false);
  });

  it('keeps JSON parsing inside the request budget and builds no server for an expired one', async () => {
    const realParse = JSON.parse.bind(JSON);
    const slow = vi.spyOn(JSON, 'parse').mockImplementation((text, reviver) => {
      // A parse that takes longer than the whole request budget, whatever the machine's speed.
      const until = performance.now() + 120;
      while (performance.now() < until) {
        // Spin: the work is synchronous, so no timer can interrupt it.
      }
      return realParse(text, reviver) as unknown;
    });
    try {
      const { app, lifetimes } = harness({ budgets: { requestMs: 40 } });
      const response = await app.fetch(post('/mcp'));
      expect(response.status).toBe(408);
      expect(response.headers.get('connection')).toBe('close');
      expect(lifetimes).toHaveLength(0);
    } finally {
      slow.mockRestore();
    }
  });

  /**
   * One request in which the official handler's own work, after the body stage and before the
   * server factory, takes 120 ms of synchronous time, whatever the machine's speed.
   */
  async function serveWithSlowHandler(requestMs: number): Promise<{
    readonly response: Response;
    readonly lifetimes: RequestLifetime[];
    readonly failures: McpFetchFailureKind[];
    readonly spent: boolean;
  }> {
    const realParse = JSON.parse.bind(JSON);
    const realGet = Headers.prototype.get;
    let parsed = false;
    let spent = false;
    const parse = vi
      .spyOn(JSON, 'parse')
      .mockImplementation((text, reviver) => {
        parsed = true;
        return realParse(text, reviver) as unknown;
      });
    // The first header the official handler reads after the body stage stands in for its own work
    // (classifying and validating a large parsed request) running past the whole request budget.
    const read = vi
      .spyOn(Headers.prototype, 'get')
      .mockImplementation(function (this: Headers, name: string) {
        if (parsed && !spent) {
          spent = true;
          const until = performance.now() + 120;
          while (performance.now() < until) {
            // Spin: the work is synchronous, so no timer can interrupt it.
          }
        }
        return realGet.call(this, name);
      });
    try {
      const { app, lifetimes, failures } = harness({
        budgets: { requestMs },
      });
      const response = await app.fetch(post('/mcp'));
      return { response, lifetimes, failures, spent };
    } finally {
      read.mockRestore();
      parse.mockRestore();
    }
  }

  it('refuses a lifetime the official handler spent before the server factory, and builds no server', async () => {
    const { response, lifetimes, failures, spent } =
      await serveWithSlowHandler(60);
    expect(spent).toBe(true);
    expect(response.status).toBe(408);
    expect(response.headers.get('connection')).toBe('close');
    expect(lifetimes).toHaveLength(0);
    // A refusal is not a factory failure, and it is not reported as one.
    expect(failures).toEqual([]);
  });

  it('serves the identical request when the budget outlasts the handler', async () => {
    const { response, lifetimes, failures, spent } =
      await serveWithSlowHandler(5_000);
    expect(spent).toBe(true);
    expect(response.status).toBe(200);
    expect(lifetimes).toHaveLength(1);
    expect(lifetimes[0]?.remainingMs()).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it('serves the same small body when the budget is not exhausted', async () => {
    const { app, lifetimes } = harness({ budgets: { requestMs: 5_000 } });
    const response = await app.fetch(post('/mcp'));
    expect(response.status).toBe(200);
    expect(lifetimes).toHaveLength(1);
    expect(lifetimes[0]?.remainingMs()).toBeGreaterThan(0);
  });
});
