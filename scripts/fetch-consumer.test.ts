import fs from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { getRequestListener } from '@hono/node-server';
import { Miniflare } from 'miniflare';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { McpFetchApp } from '../packages/mcp/src/server/http/index.js';
import {
  bundleConsumerServer,
  createWorkDirectory,
  installPackedSdk,
  linkDeclaredDependencies,
  repoRoot,
} from './packed-consumer.js';

// An application outside this repository hosts MCP operations through the stack's Fetch export. The
// packed packages are unpacked into a clean directory, only their declared dependencies are linked,
// and one application composition (scripts/fetch-consumer/app.ts) is built twice from that copy:
// into a Worker that runs in the real workerd runtime (Miniflare, with `nodejs_compat`),
// and into a module that a Node listener hosts. Both are driven by the same MCP client scenario.
// This is installed-consumer evidence from a candidate pack of this revision. It is neither a
// package-registry observation nor a deployed host.

const consumerSource = fileURLToPath(
  new URL('./fetch-consumer', import.meta.url),
);
const work = createWorkDirectory('saga-fetch-consumer-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const STACK_PACKAGES = [
  'core',
  'components',
  'lit',
  'mcp',
  'lit-mcp-stack',
] as const;
const WORKER_HOST = 'app.example';

interface Built {
  readonly consumer: string;
  readonly nodeFile: string;
  readonly nodeModules: string[];
  readonly workerCode: string;
  readonly workerModules: string[];
}

async function bundleWorker(consumer: string): Promise<{
  code: string;
  modules: string[];
}> {
  const result = await build({
    configFile: false,
    root: consumer,
    logLevel: 'silent',
    ssr: {
      target: 'webworker',
      noExternal: true,
      resolve: { conditions: ['workerd', 'worker', 'browser'] },
    },
    build: {
      write: false,
      minify: false,
      ssr: path.join(consumer, 'worker.ts'),
      target: 'es2022',
      rollupOptions: { output: { format: 'es' } },
    },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap((one) => ('output' in one ? one.output : []))
    .flatMap((output) => (output.type === 'chunk' ? [output] : []));
  return {
    code: chunks.map((chunk) => chunk.code).join('\n'),
    modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)),
  };
}

let building: Promise<Built> | undefined;
const built = (): Promise<Built> =>
  (building ??= (async () => {
    const consumer = path.join(work, 'consumer');
    fs.cpSync(consumerSource, consumer, { recursive: true });
    const sdk = installPackedSdk(work, consumer, [...STACK_PACKAGES]);
    linkDeclaredDependencies(consumer, sdk, [
      '@modelcontextprotocol/server',
      'zod',
    ]);
    const node = await bundleConsumerServer(consumer, 'app.ts');
    const worker = await bundleWorker(consumer);
    return {
      consumer,
      nodeFile: node.file,
      nodeModules: node.modules,
      workerCode: worker.code,
      workerModules: worker.modules,
    };
  })());

type Send = (
  host: string,
  path: string,
  init?: RequestInit,
) => Promise<Response>;

/** Sends with node:http, since fetch() cannot state a Host header: the Host names the host being tested. */
function sendOverHttp(port: number): Send {
  return (requestHost, requestPath, init) =>
    new Promise<Response>((resolve, reject) => {
      const headers = Object.fromEntries(new Headers(init?.headers));
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: requestPath,
          method: init?.method ?? 'GET',
          headers: { ...headers, host: requestHost },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve(
              new Response(
                [204, 304].includes(response.statusCode ?? 0)
                  ? null
                  : Buffer.concat(chunks),
                {
                  status: response.statusCode ?? 500,
                  headers: response.headers as Record<string, string>,
                },
              ),
            ),
          );
        },
      );
      request.on('error', reject);
      init?.signal?.addEventListener('abort', () => request.destroy());
      request.end(typeof init?.body === 'string' ? init.body : undefined);
    });
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};
const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

/** The scenario both hosts must satisfy, through nothing but `send`. */
async function exercise(
  send: Send,
  goodHost: string,
  goodOrigin: string,
): Promise<void> {
  const client = new Client({
    name: 'fetch-consumer-client',
    version: '0.0.0',
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://${goodHost}/mcp`), {
      fetch: (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        return send(url.host, url.pathname, init);
      },
    }),
  );
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'count',
    ]);
    const first = await client.callTool({ name: 'count', arguments: {} });
    expect(first.structuredContent).toEqual({ count: 1 });
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(1);
    const view = await client.readResource({ uri: resources[0]!.uri });
    expect(JSON.stringify(view.contents)).toContain('fetch-consumer-view');
  } finally {
    await client.close();
  }

  // Refused requests: no response body of the application, and no application effect.
  const refusals: [string, string, Record<string, string>][] = [
    ['unlisted Host', 'evil.example', {}],
    ['unlisted Origin', goodHost, { origin: 'https://evil.example' }],
    ['implicit localhost Origin', goodHost, { origin: 'http://localhost' }],
  ];
  for (const [name, host, extra] of refusals) {
    const response = await send(host, '/mcp', {
      method: 'POST',
      headers: { ...MCP_HEADERS, ...extra },
      body: LIST,
    });
    expect([name, response.status]).toEqual([name, 403]);
    await response.text();
  }
  const elsewhere = await send(goodHost, '/other', {
    method: 'POST',
    headers: MCP_HEADERS,
    body: LIST,
  });
  expect(elsewhere.status).toBe(404);
  await elsewhere.text();
  // A listed Origin, and an absent Origin, are admitted.
  for (const extra of [{ origin: goodOrigin }, {}] as Record<
    string,
    string
  >[]) {
    const response = await send(goodHost, '/mcp', {
      method: 'POST',
      headers: { ...MCP_HEADERS, ...extra },
      body: LIST,
    });
    expect(response.status).toBe(200);
    await response.text();
  }
  // The counter proves it: only the one admitted call ever ran the application's handler.
  const again = new Client({ name: 'fetch-consumer-client', version: '0.0.0' });
  await again.connect(
    new StreamableHTTPClientTransport(new URL(`http://${goodHost}/mcp`), {
      fetch: (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        return send(url.host, url.pathname, init);
      },
    }),
  );
  try {
    expect(
      (await again.callTool({ name: 'count', arguments: {} }))
        .structuredContent,
    ).toEqual({
      count: 2,
    });
  } finally {
    await again.close();
  }
}

describe('the Fetch MCP composition installed from the packed packages', () => {
  it('imports only the supported stack exports and declared packages', () => {
    const source = fs.readFileSync(path.join(consumerSource, 'app.ts'), 'utf8');
    expect(
      [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]).sort(),
    ).toEqual([
      '@modelcontextprotocol/server',
      '@saga-a2ui/lit-mcp-stack/server',
      '@saga-a2ui/lit-mcp-stack/server/http',
      'zod',
    ]);
  });

  describe('in the Workers runtime', () => {
    let mf: Miniflare;
    beforeAll(async () => {
      const { workerCode } = await built();
      mf = new Miniflare({
        modules: [
          { type: 'ESModule', path: 'worker.mjs', contents: workerCode },
        ],
        compatibilityDate: '2026-07-01',
        // The SDK's existing view identity hashes with node:crypto, as the MCP SDK itself does, so a
        // Worker enables `nodejs_compat` (docs/fetch-mcp-hosting.md). Nothing else from Node is needed.
        compatibilityFlags: ['nodejs_compat'],
        // A direct socket delivers a request with the Host header it states, as a platform edge does.
        unsafeDirectSockets: [{ host: '127.0.0.1', port: 0 }],
      });
      await mf.ready;
    }, 300_000);
    afterAll(async () => {
      await mf?.dispose();
    });

    it('is built from installed copies, with no Node listener or filesystem module', async () => {
      const { workerModules, workerCode } = await built();
      expect(
        workerModules.some((id) =>
          id.includes(
            '/consumer/node_modules/@saga-a2ui/mcp/src/server/http/fetch-app.ts',
          ),
        ),
      ).toBe(true);
      expect(
        workerModules.filter(
          (id) =>
            id.startsWith(path.join(repoRoot, 'packages')) ||
            id.startsWith(path.join(repoRoot, 'apps')),
        ),
      ).toEqual([]);
      expect(workerModules.filter((id) => /\/server\/node\//.test(id))).toEqual(
        [],
      );
      expect(
        workerModules.filter((id) => /@hono\/node-server/.test(id)),
      ).toEqual([]);
      expect(workerCode).not.toMatch(
        /from ['"]node:(http|https|http2|net|tls|dgram|fs|os|child_process)['"]/,
      );
    }, 300_000);

    it('discovers tools, calls an operation and retrieves its view, and refuses what is not admitted', async () => {
      await built();
      const send = sendOverHttp(Number((await mf.unsafeGetDirectURL()).port));
      await exercise(send, WORKER_HOST, `https://${WORKER_HOST}`);
    }, 120_000);
  });

  describe('behind a Node listener', () => {
    let http: Server;
    let host: string;
    let app: McpFetchApp;
    beforeAll(async () => {
      const { nodeFile } = await built();
      const loaded = (await import(pathToFileURL(nodeFile).href)) as {
        createConsumerApp(settings: object): McpFetchApp;
      };
      app = loaded.createConsumerApp({
        allowedHosts: ['127.0.0.1'],
        allowedOrigins: ['127.0.0.1'],
      });
      http = createServer(getRequestListener((request) => app.fetch(request)));
      await new Promise<void>((resolve) =>
        http.listen(0, '127.0.0.1', resolve),
      );
      host = `127.0.0.1:${(http.address() as AddressInfo).port}`;
    }, 300_000);
    afterAll(async () => {
      await app?.close();
      await new Promise<void>((resolve) => {
        http?.close(() => resolve());
        http?.closeAllConnections();
      });
    });

    it('is built from installed copies alone', async () => {
      const { nodeModules } = await built();
      expect(
        nodeModules.filter(
          (id) =>
            id.startsWith(path.join(repoRoot, 'packages')) ||
            id.startsWith(path.join(repoRoot, 'apps')),
        ),
      ).toEqual([]);
      expect(
        nodeModules.some((id) =>
          id.includes(
            '/consumer/node_modules/@saga-a2ui/mcp/src/server/http/fetch-app.ts',
          ),
        ),
      ).toBe(true);
    });

    it('discovers tools, calls an operation and retrieves its view, and refuses what is not admitted', async () => {
      const send = sendOverHttp(Number(host.split(':')[1]));
      await exercise(send, host, `http://${host}`);
    }, 120_000);
  });
});
