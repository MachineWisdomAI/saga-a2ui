import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { AuthInfo, McpServer } from '@modelcontextprotocol/server';

// Test-only application listener. It plays the part the connector leaves to the application:
// hosting, deciding who each request is, and handing that verified context to the transport. The
// connector under test only ever sees what the transport passes to a tool callback.

export interface TestHost {
  readonly url: URL;
  /** Connects a real MCP client; `credential` is whatever the test's `authenticate` understands. */
  connect(credential?: string): Promise<Client>;
  close(): Promise<void>;
}

export interface TestHostOptions {
  /** A fresh server per request, as the application listener builds one. */
  readonly buildServer: () => McpServer;
  /** Decides the request's verified context from its `x-test-credential` header. */
  readonly authenticate?: (
    credential: string | undefined,
  ) => AuthInfo | undefined;
  /** `true` answers with one JSON body; `false` streams the answer as server-sent events. */
  readonly jsonResponse: boolean;
}

export async function startTestHost(
  options: TestHostOptions,
): Promise<TestHost> {
  const clients: Client[] = [];
  const http: Server = createServer((req: IncomingMessage, res) => {
    const credential = req.headers['x-test-credential'];
    const authInfo = options.authenticate?.(
      typeof credential === 'string' ? credential : undefined,
    );
    const server = options.buildServer();
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: options.jsonResponse,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    if (authInfo) Object.assign(req, { auth: authInfo });
    void server
      .connect(transport)
      .then(() => transport.handleRequest(req, res));
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const url = new URL(
    `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`,
  );

  return {
    url,
    async connect(credential) {
      const client = new Client({
        name: 'connector-test-client',
        version: '0.0.0',
      });
      await client.connect(
        new StreamableHTTPClientTransport(url, {
          requestInit:
            credential === undefined
              ? {}
              : { headers: { 'x-test-credential': credential } },
        }),
      );
      clients.push(client);
      return client;
    },
    async close() {
      await Promise.all(
        clients
          .splice(0)
          .map((client) => client.close().catch(() => undefined)),
      );
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeAllConnections();
      });
    },
  };
}
