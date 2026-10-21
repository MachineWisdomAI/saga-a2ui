import Hapi from '@hapi/hapi';
import http from 'node:http';
import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { afterEach, expect, it } from 'vitest';
import type { RequestLifetime } from '@saga-a2ui/mcp/server';
import {
  mcpPlugin,
  mcpRequestLifetime,
  type McpPluginOptions,
} from '../templates/lit-hapi/server/bridge.js';
import {
  createStatusServer,
  prepareStarterView,
} from '../templates/lit-hapi/server/operations.js';

const servers: Hapi.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop({ timeout: 0 });
});

it('gives a directly registered factory the admitted lifetime and completes it with the response', async () => {
  const server = Hapi.server({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  let admitted: RequestLifetime | undefined;
  await server.register({
    plugin: mcpPlugin,
    options: {
      auth: false,
      allowedHosts: ['127.0.0.1'],
      createServer(context) {
        admitted = context.lifetime;
        return new McpServer({ name: 'direct-lifetime', version: '0.0.0' });
      },
    },
  });
  await server.start();
  const response = await fetch(`${server.info.uri}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
  expect(response.status).toBe(200);
  await response.text();
  expect(admitted).toBeDefined();
  expect(admitted?.operationMs).toBe(3_000);
  expect(admitted?.requestMs).toBe(10_000);
  expect(admitted?.cause).toEqual({ kind: 'completed' });
});

it('keeps subscription capacity separate for two directly registered endpoints', async () => {
  const server = Hapi.server({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  for (const path of ['/first/mcp', '/second/mcp']) {
    await server.register({
      plugin: mcpPlugin,
      options: {
        path,
        auth: false,
        allowedHosts: ['127.0.0.1'],
        maxSubscriptions: 1,
        createServer: () =>
          new McpServer(
            { name: 'direct-subscription', version: '0.0.0' },
            { capabilities: { resources: { subscribe: true } } },
          ),
      },
    });
  }
  await server.start();
  const listen = (path: string) =>
    fetch(`${server.info.uri}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'subscriptions/listen',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'subscriptions/listen',
        params: {
          notifications: {
            resourceSubscriptions: ['ui://synthetic/probe.html'],
          },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
  const first = await listen('/first/mcp');
  const overflow = await listen('/first/mcp');
  expect(overflow.headers.get('content-type')).toContain('application/json');
  expect((await overflow.json()).error.message).toBe(
    'Subscription limit reached',
  );
  const second = await listen('/second/mcp');
  expect(second.headers.get('content-type')).toContain('text/event-stream');
  await server.stop({ timeout: 0 });
  // Shutdown cancels open streams; a socket termination is an allowed cancellation result.
  await Promise.allSettled([first.text(), second.text()]);
});

const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};
const LIST = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {},
});
const IDENTITY: AuthInfo = Object.freeze({
  token: 'direct-only',
  clientId: 'synthetic-client',
  scopes: [],
});

async function directlyRegistered(
  options: Partial<McpPluginOptions> = {},
  configure: (server: Hapi.Server) => void | Promise<void> = () => undefined,
) {
  const server = Hapi.server({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  await configure(server);
  let factories = 0;
  const {
    createServer = () => new McpServer({ name: 'direct', version: '0.0.0' }),
    ...settings
  } = options;
  await server.register({
    plugin: mcpPlugin,
    options: {
      auth: false,
      allowedHosts: ['127.0.0.1'],
      ...settings,
      createServer(context) {
        factories++;
        return createServer(context);
      },
    },
  });
  await server.start();
  return { server, url: `${server.info.uri}/mcp`, factories: () => factories };
}

function incompleteBody(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status?: number; closed: boolean }>((resolve) => {
    const outcome: { status?: number; closed: boolean } = { closed: false };
    const req = http.request(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'content-length': '1000', ...headers },
    });
    const timer = setTimeout(() => {
      req.destroy();
      resolve(outcome);
    }, 1_500);
    req.on('response', (res) => {
      outcome.status = res.statusCode;
      res.resume();
    });
    req.on('error', () => undefined);
    req.on('close', () => {
      outcome.closed = true;
      clearTimeout(timer);
      resolve(outcome);
    });
    req.write('{');
  });
}

it('exposes the same already-admitted lifetime to Hapi authentication and the server factory', async () => {
  let authenticated: RequestLifetime | undefined;
  let built: RequestLifetime | undefined;
  const direct = await directlyRegistered(
    {
      auth: 'account',
      budgets: { operationMs: 200, requestMs: 500 },
      createServer({ lifetime, authInfo, request }) {
        built = lifetime;
        expect(authInfo).toBe(IDENTITY);
        expect(mcpRequestLifetime(request)).toBe(lifetime);
        return new McpServer({ name: 'same-lifetime', version: '0.0.0' });
      },
    },
    (server) => {
      server.auth.scheme('verified', () => ({
        async authenticate(request, h) {
          authenticated = mcpRequestLifetime(request);
          const result = await authenticated.run(
            'authentication',
            async () => IDENTITY,
          );
          if (!result.ok) return h.response().code(503).takeover();
          return h.authenticated({ credentials: { authInfo: result.value } });
        },
      }));
      server.auth.strategy('account', 'verified');
    },
  );
  const response = await fetch(direct.url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: LIST,
  });
  expect(response.status).toBe(200);
  await response.text();
  expect(authenticated).toBeDefined();
  expect(built).toBe(authenticated);
  expect(built?.operationMs).toBe(200);
  expect(built?.requestMs).toBe(500);
  expect(built?.cause).toEqual({ kind: 'completed' });
});

it('bounds authentication with the admitted lifetime and never builds a server after refusal', async () => {
  let lifetime: RequestLifetime | undefined;
  const direct = await directlyRegistered(
    { auth: 'account', budgets: { operationMs: 50, requestMs: 200 } },
    (server) => {
      server.auth.scheme('stalled', () => ({
        async authenticate(request, h) {
          lifetime = mcpRequestLifetime(request);
          const result = await lifetime.run(
            'authentication',
            () => new Promise<never>(() => undefined),
          );
          expect(result).toMatchObject({
            ok: false,
            cause: { kind: 'operation-timeout', stage: 'authentication' },
          });
          return h.response().code(503).takeover();
        },
      }));
      server.auth.strategy('account', 'stalled');
    },
  );
  const response = await fetch(direct.url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: LIST,
  });
  expect(response.status).toBe(503);
  await response.text();
  expect(lifetime?.signal.aborted).toBe(true);
  expect(direct.factories()).toBe(0);
});

it.each([
  ['operation', { operationMs: 50, requestMs: 200 }],
  ['request', { operationMs: 5_000, requestMs: 100 }],
] as const)(
  'direct registration closes a stalled body at its %s bound before factory work',
  async (_name, budgets) => {
    const direct = await directlyRegistered({ budgets });
    const outcome = await incompleteBody(direct.url);
    expect(outcome).toEqual({ status: 408, closed: true });
    expect(direct.factories()).toBe(0);
    const recovery = await fetch(direct.url, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: LIST,
    });
    expect(recovery.status).toBe(200);
    await recovery.text();
  },
);

it('rejects malformed, declared oversized and chunked oversized JSON without factory work', async () => {
  const kinds: string[] = [];
  const direct = await directlyRegistered(
    { maxRequestBytes: 128 },
    (server) => {
      server.events.on('response', (request) => {
        kinds.push(typeof request.response);
      });
    },
  );
  const malformed = await fetch(direct.url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: '{broken',
  });
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({ error: { code: -32700 } });
  expect(await incompleteBody(direct.url)).toEqual({
    status: 413,
    closed: true,
  });
  const chunkedStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      const req = http.request(direct.url, {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'transfer-encoding': 'chunked' },
      });
      req.on('error', reject);
      req.on('response', (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      });
      req.write('x'.repeat(200));
      req.end();
    },
  );
  expect(chunkedStatus).toBe(413);
  expect(direct.factories()).toBe(0);
  await new Promise((resolve) => setImmediate(resolve));
  expect(kinds).toEqual(['object', 'object', 'object']);
});

it('disconnects a directly registered request during the body read and continues serving', async () => {
  let admitted!: (lifetime: RequestLifetime) => void;
  const entered = new Promise<RequestLifetime>((resolve) => {
    admitted = resolve;
  });
  const direct = await directlyRegistered({ auth: 'account' }, (server) => {
    server.auth.scheme('observed', () => ({
      authenticate(request, h) {
        admitted(mcpRequestLifetime(request));
        return h.authenticated({ credentials: { authInfo: IDENTITY } });
      },
    }));
    server.auth.strategy('account', 'observed');
  });
  const req = http.request(direct.url, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'content-length': '1000' },
  });
  req.on('error', () => undefined);
  req.write('{');
  const lifetime = await entered;
  const aborted = new Promise<void>((resolve) =>
    lifetime.signal.addEventListener('abort', () => resolve(), { once: true }),
  );
  req.destroy();
  await aborted;
  expect(lifetime.cause?.kind).toBe('disconnected');
  expect(direct.factories()).toBe(0);
  const recovery = await fetch(direct.url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: LIST,
  });
  expect(recovery.status).toBe(200);
  await recovery.text();
});

it.each([false, true])(
  'shutdown cancels an active directly registered modern=%s call',
  async (modern) => {
    let admitted!: (lifetime: RequestLifetime) => void;
    const entered = new Promise<RequestLifetime>((resolve) => {
      admitted = resolve;
    });
    const direct = await directlyRegistered({
      createServer({ lifetime }) {
        const mcp = new McpServer({ name: 'shutdown', version: '0.0.0' });
        mcp.registerTool('wait', {}, async () => {
          admitted(lifetime);
          await new Promise<void>((resolve) =>
            lifetime.signal.addEventListener('abort', () => resolve(), {
              once: true,
            }),
          );
          return { content: [] };
        });
        return mcp;
      },
    });
    const pending = fetch(direct.url, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        ...(modern
          ? {
              'MCP-Protocol-Version': '2026-07-28',
              'Mcp-Method': 'tools/call',
              'Mcp-Name': 'wait',
            }
          : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'wait',
          arguments: {},
          ...(modern
            ? {
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                  'io.modelcontextprotocol/clientCapabilities': {},
                },
              }
            : {}),
        },
      }),
    }).then(
      async (response) => {
        await response.text().catch(() => undefined);
      },
      () => undefined,
    );
    const lifetime = await entered;
    await direct.server.stop();
    await pending;
    expect(lifetime.signal.aborted).toBe(true);
    expect(lifetime.cause?.kind).toBe('disconnected');
  },
);

it('leaves unrelated Hapi routes, their auth, JSON payloads and request timeouts unchanged', async () => {
  let authentications = 0;
  const direct = await directlyRegistered(
    { maxRequestBytes: 64, budgets: { operationMs: 10, requestMs: 20 } },
    async (server) => {
      server.auth.scheme('ordinary', () => ({
        authenticate(_request, h) {
          authentications++;
          return h.authenticated({ credentials: { user: 'ordinary' } });
        },
      }));
      server.auth.strategy('ordinary', 'ordinary');
      await server.register({
        plugin: mcpPlugin,
        options: {
          path: '/another/mcp',
          auth: false,
          allowedHosts: ['127.0.0.1'],
          budgets: { operationMs: 10, requestMs: 20 },
          createServer: () =>
            new McpServer({ name: 'another', version: '0.0.0' }),
        },
      });
      server.route({
        method: 'POST',
        path: '/ordinary',
        options: { auth: 'ordinary', timeout: { server: 500 } },
        async handler(request) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            payload: request.payload,
            user: request.auth.credentials.user,
          };
        },
      });
    },
  );
  const payload = { text: 'x'.repeat(256) };
  const response = await fetch(`${direct.server.info.uri}/ordinary`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://unrelated.example',
    },
    body: JSON.stringify(payload),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ payload, user: 'ordinary' });
  expect(authentications).toBe(1);
  expect(direct.factories()).toBe(0);
});

it('ends a blocked finite response at the direct registration delivery deadline', async () => {
  const html = `<starter-app></starter-app><!--${'x'.repeat(48 * 1024 * 1024)}-->`;
  const view = prepareStarterView(html);
  const direct = await directlyRegistered({
    budgets: { operationMs: 500, requestMs: 600 },
    createServer: ({ lifetime }) => createStatusServer({ view, lifetime }),
  });
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'resources/read',
    params: { uri: view.uri },
  });
  const outcome = await new Promise<{
    status?: number;
    complete: boolean;
    received: number;
  }>((resolve, reject) => {
    const req = http.request(direct.url, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'content-length': String(Buffer.byteLength(body)),
      },
    });
    req.on('error', reject);
    req.on('response', (res) => {
      let received = 0;
      res.on('data', (chunk: Buffer) => {
        received += chunk.length;
      });
      res.on('error', () => undefined);
      res.pause();
      setTimeout(() => res.resume(), 1_200);
      res.on('close', () =>
        resolve({ status: res.statusCode, complete: res.complete, received }),
      );
    });
    req.end(body);
  });
  expect(outcome.status).toBe(200);
  expect(outcome.complete).toBe(false);
  expect(outcome.received).toBeLessThan(html.length);
}, 30_000);
