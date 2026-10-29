import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { createMcpHandler, type McpServer } from '@modelcontextprotocol/server';
import type { Hono } from 'hono';

// Local Node hosting for a stateless MCP endpoint, following Hono's basic pattern: create an app
// (here `createMcpHonoApp`, which adds Host/Origin validation and JSON body parsing), define a
// route, serve it. Known gap: the upstream body reader limits a body's size but not how long it
// takes to arrive, so a stalled body is bounded only by Node's own request timeout.

const HOST = '127.0.0.1';
const MCP_PATH = '/mcp';
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface LocalMcpServerOptions {
  /** A fresh server for one request. Keep application state outside this callback. */
  readonly createServer: () => McpServer;
  /** Use 0 for an ephemeral port. */
  readonly port: number;
}

export interface LocalMcpServer {
  /** The loopback MCP endpoint, always at /mcp. */
  readonly url: string;
  close(): Promise<void>;
}

/**
 * Serves /mcp on 127.0.0.1 with a 1 MiB body limit. Only localhost/127.0.0.1 Host headers and
 * local Origins are accepted. A development tunnel must preserve an accepted Host header. This
 * listener supplies no authentication. The caller owns process signals and calls close() to
 * release the port.
 */
export async function startLocalMcpServer(
  options: LocalMcpServerOptions,
): Promise<LocalMcpServer> {
  const handler = createMcpHandler(() => options.createServer(), {
    maxRequestBodySize: MAX_REQUEST_BYTES,
  });

  // createMcpHonoApp returns an untyped Hono; the cast declares the `parsedBody` it sets
  // (modelcontextprotocol/typescript-sdk#1877 asks for generics).
  const app = createMcpHonoApp({
    host: HOST,
    maxRequestBodySize: MAX_REQUEST_BYTES,
  }) as unknown as Hono<{ Variables: { parsedBody: unknown } }>;
  app.all(MCP_PATH, (c) =>
    handler.fetch(c.req.raw, { parsedBody: c.get('parsedBody') }),
  );

  const server = await new Promise<Server>((resolve, reject) => {
    // With the default options, serve() returns a node:http Server.
    const listening = serve(
      { fetch: app.fetch, port: options.port, hostname: HOST },
      () => resolve(listening as Server),
    );
    listening.once('error', reject);
  });
  const { port } = server.address() as AddressInfo; // listen() on a TCP port yields AddressInfo

  let closing: Promise<void> | undefined;
  return {
    url: `http://${HOST}:${port}${MCP_PATH}`,
    close: () =>
      (closing ??= (async () => {
        await handler.close();
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      })()),
  };
}
