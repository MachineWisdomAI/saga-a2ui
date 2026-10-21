import { McpServer } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import {
  createServerBudgets,
  registerPublicOperation,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createEndpoint } from '../templates/lit-node/server/endpoint.js';

// Shared endpoint behavior is checked once. The packed starter suites own framework mounting.
const URI = 'ui://synthetic/account-only.html';
const endpoints: ReturnType<typeof createEndpoint>[] = [];
const lifetimes: RequestLifetime[] = [];
afterEach(async () => {
  await Promise.all(endpoints.splice(0).map((endpoint) => endpoint.close()));
  for (const lifetime of lifetimes.splice(0)) lifetime.finish();
});

function fixture() {
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
  const meta = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientCapabilities': {},
  };
  const send = (
    endpoint: ReturnType<typeof createEndpoint>,
    method: string,
    params: Record<string, unknown>,
    id = 1,
  ) => {
    const parsedBody = { jsonrpc: '2.0', id, method, params };
    const request = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': method,
        ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}),
      },
      body: JSON.stringify(parsedBody),
    });
    return endpoint.fetch(request, admit(), { parsedBody });
  };
  return {
    status,
    account,
    call: (wantsProgress: boolean) =>
      send(status, 'tools/call', {
        name: 'progress_probe',
        arguments: {},
        _meta: {
          ...meta,
          ...(wantsProgress ? { progressToken: 'probe' } : {}),
        },
      }),
    listen: (endpoint: 'status' | 'account', id: number) =>
      send(
        endpoint === 'status' ? status : account,
        'subscriptions/listen',
        { notifications: { resourceSubscriptions: [URI] }, _meta: meta },
        id,
      ),
  };
}

const updates = (text: string) =>
  text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((message) => message.method === 'notifications/resources/updated');

describe('the shared endpoint contract', () => {
  it.each([false, true])(
    'uses modern auto responses with progress requested=%s',
    async (wantsProgress) => {
      const { call } = fixture();
      const response = await call(wantsProgress);
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
        messages.find((message) => message.id === 1)?.result.structuredContent,
      ).toEqual({ done: true });
    },
  );

  it('keeps protected updates and capacity separate from public subscriptions', async () => {
    const { status, account, listen } = fixture();
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
});
