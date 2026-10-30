import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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
