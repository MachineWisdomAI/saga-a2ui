import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { getRequestListener } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import {
  createServerBudgets,
  registerPublicOperation,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEndpoint } from '../templates/lit-node/server/endpoint.js';

// The maintained endpoint composition is identical in all four templates. Exercise its two
// mounting faces here; the packed starter suites separately drive every actual framework.
const URI = 'ui://synthetic/account-only.html';
const endpoints: ReturnType<typeof createEndpoint>[] = [];
const servers: Server[] = [];
const lifetimes: ReturnType<
  ReturnType<typeof createServerBudgets>['startRequest']
>[] = [];
afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
  for (const lifetime of lifetimes.splice(0)) lifetime.finish();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
});

async function mounted(face: 'node' | 'hono') {
  const build = (lifetime: RequestLifetime) => {
    const server = new McpServer(
      { name: 'synthetic-notifications', version: '0.0.0' },
      { capabilities: { resources: { subscribe: true, listChanged: true } } },
    );
    registerPublicOperation(
      server,
      {
        name: 'progress_probe',
        title: 'Synthetic progress',
        description: 'Reports one progress update before returning.',
        annotations: { readOnlyHint: true },
        input: z.strictObject({}),
        output: z.strictObject({ done: z.boolean() }),
        view: {
          uri: URI,
          title: 'Synthetic view',
          html: '<html></html>',
          csp: CLOSED_VIEW_CSP,
        },
        failures: {
          absent: 'absent',
          unavailable: 'unavailable',
          invalidOutput: 'invalid',
        },
        async handle(_input, request) {
          await request.reportProgress({
            progress: 1,
            total: 1,
            message: 'ready',
          });
          return { kind: 'record', record: { done: true } };
        },
        project: (record) => ({ text: 'done', data: record }),
      },
      { lifetime },
    );
    return server;
  };
  const status = createEndpoint(build, { maxSubscriptions: 1, keepAliveMs: 0 });
  const account = createEndpoint(build, {
    maxSubscriptions: 1,
    keepAliveMs: 0,
  });
  endpoints.push(status, account);
  const budgets = createServerBudgets();
  const admit = () => {
    const lifetime = budgets.startRequest();
    lifetimes.push(lifetime);
    return lifetime;
  };
  const app = new Hono();
  app.post('/:endpoint/mcp', async (c) => {
    const endpoint = c.req.param('endpoint') === 'status' ? status : account;
    return endpoint.fetch(c.req.raw, admit(), {
      parsedBody: await c.req.json(),
    });
  });
  const server =
    face === 'hono'
      ? createServer(getRequestListener(app.fetch))
      : createServer(async (req, res) => {
          const lifetime = admit();
          const endpoint = req.url === '/status/mcp' ? status : account;
          let text = '';
          for await (const chunk of req) text += String(chunk);
          await toNodeHandler({
            fetch: (request, options) =>
              endpoint.fetch(request, lifetime, options ?? {}),
          })(req, res, JSON.parse(text));
        });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const listen = (endpoint: 'status' | 'account', id: number) =>
    fetch(`${origin}/${endpoint}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'subscriptions/listen',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'subscriptions/listen',
        params: {
          notifications: { resourceSubscriptions: [URI] },
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
  return { status, account, listen, origin };
}

const updates = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((message) => message.method === 'notifications/resources/updated');

describe.each(['node', 'hono'] as const)(
  'endpoint isolation through %s mounting',
  (face) => {
    it.each([false, true])(
      'uses modern auto responses with progress requested=%s',
      async (wantsProgress) => {
        const { origin } = await mounted(face);
        const response = await fetch(`${origin}/status/mcp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2026-07-28',
            'Mcp-Method': 'tools/call',
            'Mcp-Name': 'progress_probe',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'progress_probe',
              arguments: {},
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
                ...(wantsProgress ? { progressToken: 'probe' } : {}),
              },
            },
          }),
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain(
          wantsProgress ? 'text/event-stream' : 'application/json',
        );
        const text = await response.text();
        const messages = wantsProgress
          ? text
              .split('\n')
              .filter((line) => line.startsWith('data: '))
              .map((line) => JSON.parse(line.slice(6)))
          : [JSON.parse(text)];
        expect(
          messages.filter(
            (message) => message.method === 'notifications/progress',
          ),
        ).toEqual(
          wantsProgress
            ? [
                {
                  jsonrpc: '2.0',
                  method: 'notifications/progress',
                  params: {
                    progressToken: 'probe',
                    progress: 1,
                    total: 1,
                    message: 'ready',
                  },
                },
              ]
            : [],
        );
        expect(
          messages.find((message) => message.id === 1)?.result
            .structuredContent,
        ).toEqual({ done: true });
      },
    );

    it('keeps protected updates and capacity separate from public subscriptions', async () => {
      const { status, account, listen } = await mounted(face);
      const publicStream = await listen('status', 1);
      const overflow = await listen('status', 2);
      expect((await overflow.json()).error.message).toBe(
        'Subscription limit reached',
      );
      const protectedStream = await listen('account', 3);
      expect(protectedStream.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      account.notify.resourceUpdated(URI);
      await Promise.all([status.close(), account.close()]);
      expect(updates(await publicStream.text())).toEqual([]);
      expect(updates(await protectedStream.text())).toMatchObject([
        { params: { uri: URI } },
      ]);
    });
  },
);
