import Hapi from '@hapi/hapi';
import Boom from '@hapi/boom';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { McpServer, type AuthInfo } from '@modelcontextprotocol/server';
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  mcpPlugin,
  type McpPluginOptions,
} from '../templates/lit-hapi/server/bridge.js';
import { startListener } from '../templates/lit-hapi/server/listener.js';

const servers: Hapi.Server[] = [];
const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.stop({ timeout: 0 });
});

it('keeps application body refusals inspectable by Hapi host response listeners', async () => {
  const original = Hapi.server;
  const kinds: string[] = [];
  const factory = vi.spyOn(Hapi, 'server').mockImplementation((options) => {
    const server = original(options);
    servers.push(server);
    server.events.on('response', (request) => {
      if (request.raw.res.statusCode >= 400)
        kinds.push(typeof request.response);
    });
    return server;
  });
  let listener;
  try {
    listener = await startListener({
      html: '<starter-app></starter-app>',
      port: 0,
      verifier: {
        verifyAccessToken: async () => {
          throw new Error('unused');
        },
      },
      authorize: async () => true,
    });
  } finally {
    factory.mockRestore();
  }
  const response = await fetch(listener.statusUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: '{invalid',
  });
  expect(response.status).toBe(400);
  await response.text();
  await new Promise((resolve) => setImmediate(resolve));
  expect(kinds).toEqual(['object']);
});

it('refuses an omitted auth decision at registration instead of publishing a route', async () => {
  const server = Hapi.server();
  servers.push(server);
  const options: Partial<McpPluginOptions> = {
    createServer: () => new McpServer({ name: 'unused', version: '0.0.0' }),
  };
  // @ts-expect-error Deliberately exercise a JavaScript caller that omitted required configuration.
  await expect(server.register({ plugin: mcpPlugin, options })).rejects.toThrow(
    'explicit `auth` option',
  );
});

it('returns transport and guard errors as Hapi responses that host response extensions can inspect', async () => {
  const server = Hapi.server({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  const responseKinds: string[] = [];
  server.ext('onPreResponse', (request, h) => {
    responseKinds.push(typeof request.response);
    return h.continue;
  });
  await server.register({
    plugin: mcpPlugin,
    options: {
      auth: false,
      allowedHosts: ['127.0.0.1'],
      createServer: () => new McpServer({ name: 'errors', version: '0.0.0' }),
    },
  });
  await server.start();
  const url = `${server.info.uri}/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {},
  });
  for (const [headers, status, payload] of [
    [{ 'content-type': 'application/json' }, 406, body],
    [
      {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      400,
      '{}',
    ],
    [
      { 'content-type': 'application/json', origin: 'https://other.example' },
      403,
      body,
    ],
  ] as const) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { code: expect.any(Number) },
    });
    expect(responseKinds.at(-1)).toBe('object');
  }
});

it('keeps an SDK-owned SSE stream open beyond a host timeout and releases it on disconnect', async () => {
  const server = Hapi.server({
    host: '127.0.0.1',
    port: 0,
    routes: { timeout: { server: 30 } },
  });
  servers.push(server);
  await server.register({
    plugin: mcpPlugin,
    options: {
      auth: false,
      allowedHosts: ['127.0.0.1'],
      createServer: () =>
        new McpServer(
          { name: 'stream', version: '0.0.0' },
          { capabilities: { resources: { subscribe: true } } },
        ),
    },
  });
  await server.start();
  const abort = new AbortController();
  try {
    const response = await fetch(`${server.info.uri}/mcp`, {
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
      signal: abort.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    let ended = false;
    const pending = (async () => {
      try {
        while (!(await reader.read()).done) {
          /* Observe the stream through termination. */
        }
      } finally {
        ended = true;
      }
    })().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 90));
    expect(ended).toBe(false);
    abort.abort();
    await pending;
  } finally {
    abort.abort();
  }
});

it('hands Hapi-authenticated identity to the request factory and the MCP handler', async () => {
  const server = Hapi.server({ host: '127.0.0.1', port: 0 });
  servers.push(server);
  const identity: AuthInfo = Object.freeze({
    token: 'identity-proof',
    clientId: 'identity-client',
    scopes: [],
    extra: Object.freeze({ accountId: 'route-verified-account' }),
  });
  server.auth.scheme('verified', () => ({
    authenticate(request, h) {
      return request.headers.authorization === 'Bearer identity-proof'
        ? h.authenticated({ credentials: { authInfo: identity } })
        : h.unauthenticated(Boom.unauthorized());
    },
  }));
  server.auth.strategy('account', 'verified');
  await server.register({
    plugin: mcpPlugin,
    options: {
      auth: 'account',
      allowedHosts: ['127.0.0.1'],
      createServer(context: { readonly authInfo?: AuthInfo }) {
        const mcp = new McpServer({ name: 'identity-proof', version: '0.0.0' });
        mcp.registerTool(
          'who',
          { inputSchema: z.object({}) },
          (_input, request) => ({
            content: [],
            structuredContent: {
              factory: context?.authInfo?.extra?.accountId,
              handler: request.http?.authInfo?.extra?.accountId,
            },
          }),
        );
        return mcp;
      },
    },
  });
  await server.start();
  const client = new Client({
    name: 'identity-proof-client',
    version: '0.0.0',
  });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${server.info.uri}/mcp`), {
      requestInit: { headers: { authorization: 'Bearer identity-proof' } },
    }),
  );
  expect(
    (await client.callTool({ name: 'who', arguments: {} })).structuredContent,
  ).toEqual({
    factory: 'route-verified-account',
    handler: 'route-verified-account',
  });
});
