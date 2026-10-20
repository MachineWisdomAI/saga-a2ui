import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpServer, OAuthTokenVerifier } from '@modelcontextprotocol/server';
import { createServerBudgets, type BudgetSettings, type RequestLifetime } from '@saga-a2ui/mcp/server';
import { authenticate } from './authenticate.js';
import { createAccountServer, createStatusServer, type AccountServerOptions } from './operations.js';

// APPLICATION-OWNED HTTP hosting for the MCP servers: loopback only, stateless Streamable HTTP
// (a fresh server and transport per POST, JSON responses) and DNS-rebinding protection on the
// Host header. Put your own ingress (TLS, a public host name) in front of it, and add that host
// name to `allowedHosts`, when you deploy.

const HOST = '127.0.0.1';
const STATUS_PATH = '/status/mcp';
const ACCOUNT_PATH = '/account/mcp';
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface ListenerOptions {
  /** The built page, read by the caller before the port opens. */
  readonly html: string;
  /** Decides who a bearer credential belongs to. */
  readonly verifier: OAuthTokenVerifier;
  /** Decides what a verified account may see. */
  readonly authorize: AccountServerOptions['authorize'];
  /** Use 0 for an ephemeral port. */
  readonly port: number;
  /**
   * 3,000 ms per operation and 10,000 ms per request unless stated. A field you leave out keeps
   * its default, and an invalid value fails before the port opens.
   */
  readonly budgets?: BudgetSettings;
}

export interface Listener {
  /** Public endpoint: no credential is read. */
  readonly statusUrl: string;
  /** Protected endpoint: a bearer credential is required. */
  readonly accountUrl: string;
  close(): Promise<void>;
}

export async function startListener(options: ListenerOptions): Promise<Listener> {
  // Resolved and validated before the port opens. Building the servers once up front also makes a
  // missing view stop the process here, not at the first request.
  const budgets = createServerBudgets(options.budgets);
  const probe = budgets.startRequest();
  try {
    createStatusServer({ html: options.html, lifetime: probe });
  } finally {
    probe.finish();
  }

  const http = createServer();
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, HOST, resolve);
  });
  const { port } = http.address() as AddressInfo; // listen() on a TCP port yields AddressInfo
  const allowedHosts = [`${HOST}:${port}`, `localhost:${port}`];

  async function serve(server: McpServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts,
      maxRequestBodySize: MAX_REQUEST_BYTES,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  async function handle(req: IncomingMessage, res: ServerResponse, lifetime: RequestLifetime): Promise<void> {
    const path = new URL(req.url ?? '/', `http://${HOST}`).pathname;
    if (path === STATUS_PATH) return serve(createStatusServer({ html: options.html, lifetime }), req, res);
    if (path !== ACCOUNT_PATH) {
      res.writeHead(404).end();
      return;
    }
    // #region saga-snippet:identity-handoff
    // Who is asking is decided before any server is built. The verified context travels to the tool
    // only as the transport's per-request auth; no tool argument can name an account.
    const decision = await authenticate(req, options.verifier, lifetime);
    if (!decision.ok) {
      res.writeHead(decision.status, decision.challenge === undefined ? {} : { 'WWW-Authenticate': decision.challenge }).end();
      return;
    }
    Object.assign(req, { auth: decision.authInfo });
    // #endregion saga-snippet:identity-handoff
    return serve(createAccountServer({ html: options.html, lifetime, authorize: options.authorize }), req, res);
  }

  http.on('request', (req, res) => {
    // The request's clock starts at admission, before any credential or body wait.
    const lifetime = budgets.startRequest();
    res.on('close', () => (res.writableFinished ? lifetime.finish() : lifetime.disconnect()));
    handle(req, res, lifetime).catch(() => {
      if (res.destroyed) return;
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    });
  });

  return {
    statusUrl: `http://${HOST}:${port}${STATUS_PATH}`,
    accountUrl: `http://${HOST}:${port}${ACCOUNT_PATH}`,
    close: () =>
      new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      }),
  };
}
