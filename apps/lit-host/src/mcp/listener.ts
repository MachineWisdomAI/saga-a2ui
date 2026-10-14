import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createEpisodeServer, type EpisodeCatalog } from './server.js';

export interface EpisodeListenerOptions {
  readonly viewHtml: string;
  readonly catalog: EpisodeCatalog;
  /** Use 0 for an ephemeral port. */
  readonly port: number;
}

export interface EpisodeListener {
  /** Streamable HTTP endpoint, e.g. http://127.0.0.1:3001/mcp */
  readonly url: string;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const MCP_PATH = '/mcp';

/**
 * Application-owned HTTP hosting for the MCP server: loopback only, stateless Streamable HTTP
 * (a fresh server and transport per POST, JSON responses), DNS-rebinding protection on the
 * Host header. The listener performs no authentication because the single tool is public.
 */
export async function startEpisodeListener(options: EpisodeListenerOptions): Promise<EpisodeListener> {
  const http: Server = createServer();
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, HOST, resolve);
  });
  const { port } = http.address() as AddressInfo; // listen() on a TCP port yields AddressInfo
  const allowedHosts = [`${HOST}:${port}`, `localhost:${port}`];

  http.on('request', (req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    if (path !== MCP_PATH) return void res.writeHead(404).end();
    if (req.method !== 'POST') return void res.writeHead(405, { allow: 'POST' }).end();

    const server = createEpisodeServer({ viewHtml: options.viewHtml, catalog: options.catalog });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  return {
    url: `http://${HOST}:${port}${MCP_PATH}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((error) => (error ? reject(error) : resolve()));
        http.closeAllConnections();
      }),
  };
}
