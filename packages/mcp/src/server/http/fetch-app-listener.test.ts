import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createMcpFetchApp, type McpFetchApp } from './index.js';

// The Fetch app behind a real Node listener (`@hono/node-server`), spoken to by a real Node `fetch`
// client over a socket. The in-process suite cannot observe how the connection is handled after a
// refusal; this one can.

const MAX = 4 * 1024 * 1024;

const running: { app: McpFetchApp; server: Server }[] = [];
afterEach(async () => {
  for (const { app, server } of running.splice(0)) {
    await app.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
});

async function listen(): Promise<{ url: string; built: () => number }> {
  let built = 0;
  const app = createMcpFetchApp({
    allowedHosts: ['127.0.0.1'],
    allowedOrigins: ['127.0.0.1'],
    createServer() {
      built += 1;
      return new McpServer({ name: 'listener-test', version: '0.0.0' });
    },
  });
  const server = createServer(getRequestListener(app.fetch));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  running.push({ app, server });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp`, built: () => built };
}

function oversizePost(url: string, bytes: number): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: new Uint8Array(bytes).fill(0x20),
  });
}

describe('createMcpFetchApp behind @hono/node-server', () => {
  it('delivers the 413 for a declared oversize body to a Node fetch client', async () => {
    const { url, built } = await listen();
    const response = await oversizePost(url, MAX + 1);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: { code: -32000 },
    });
    expect(built()).toBe(0);
  });

  it('discards a refused body only within the listener bound, then closes the socket', async () => {
    const { url, built } = await listen();
    const declared = 1024 * 1024 * 1024;
    const chunk = Buffer.alloc(64 * 1024, 0x20);
    const started = Date.now();
    const outcome = await new Promise<{ status?: number; written: number }>(
      (resolve) => {
        let status: number | undefined;
        let written = 0;
        const req = httpRequest(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': String(declared),
          },
        });
        req.on('response', (res) => {
          status = res.statusCode;
          res.resume();
        });
        // The client never stops on its own: only the server can end this exchange.
        const pump = (): void => {
          while (written < declared && req.write(chunk))
            written += chunk.length;
        };
        req.on('drain', pump);
        req.on('error', () => undefined);
        req.on('close', () => resolve({ status, written }));
        pump();
      },
    );
    expect(outcome.status).toBe(413);
    // 64 MiB drained plus what the socket buffers held when it was closed; nowhere near 1 GiB.
    expect(outcome.written).toBeLessThan(160 * 1024 * 1024);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(built()).toBe(0);
  });

  it('keeps serving after refusing an oversize body', async () => {
    const { url, built } = await listen();
    for (let attempt = 0; attempt < 3; attempt += 1)
      expect((await oversizePost(url, MAX + 1)).status).toBe(413);
    const ok = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    expect(ok.status).toBe(200);
    expect(built()).toBe(1);
  });
});
