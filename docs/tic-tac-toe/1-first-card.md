# Create the app files

In your `my-tic-tac-toe` directory, create the files below. Paths are relative to that directory. Each block is a complete file.

Vite builds the React view into one HTML file, then bundles the server beside it. The server offers `new_game`, which opens the welcome card. In `src/view.tsx`, the catalog supplies a React component and the layout binds the server's message to it.

The HTTP listener uses Hono and the official MCP server adapter. It binds to loopback, checks incoming hosts and origins, and limits request size and duration. These files stay in your app; SAGA handles operation validation and the connection between the card and its host.

### `package.json`

```json file=package.json
{
  "name": "saga-tic-tac-toe-example",
  "private": true,
  "description": "A React tic-tac-toe game built with the SAGA MCP stack.",
  "license": "Apache-2.0",
  "type": "module",
  "scripts": {
    "build:view": "vite build",
    "build:server": "vite build --config vite.server.config.ts",
    "build": "npm run build:view && npm run build:server",
    "typecheck": "tsc -p tsconfig.json && tsc -p tsconfig.server.json",
    "start": "node dist/server.mjs"
  },
  "dependencies": {
    "@hono/node-server": "2.1.5",
    "@modelcontextprotocol/hono": "2.0.2",
    "@modelcontextprotocol/server": "2.3.1",
    "hono": "4.13.13",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "zod": "4.6.7",
    "@saga-a2ui/react-mcp-stack": "0.8.1-rc.1"
  },
  "devDependencies": {
    "@types/node": "22.20.5",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "typescript": "5.9.3",
    "vite": "8.3.4",
    "vite-plugin-singlefile": "2.3.3"
  },
  "overrides": {
    "@a2ui/markdown-it": "0.2.1"
  },
  "engines": {
    "node": ">=22.12.0"
  }
}
```

### `tsconfig.json`

```json file=tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "jsx": "react-jsx",
    "noEmit": true,
    "skipLibCheck": true,
    "types": []
  },
  "include": ["src"]
}
```

### `tsconfig.server.json`

```json file=tsconfig.server.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["server", "src/contract.ts", "vite.server.config.ts"]
}
```

### `vite.config.ts`

```ts file=vite.config.ts
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The view is one self-contained HTML document: an MCP host mounts the exact bytes the server
// serves, so nothing may load from a separate file. The server reads dist/index.html.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});
```

### `vite.server.config.ts`

```ts file=vite.server.config.ts
import path from 'node:path';
import { defineConfig } from 'vite';

// The server is bundled for Node into dist/server.mjs. The SAGA packages ship TypeScript source,
// which Node does not load from node_modules, so they are bundled in; every other dependency
// stays external and resolves from node_modules at run time.
export default defineConfig({
  ssr: { noExternal: [/^@saga-a2ui\//] },
  build: {
    ssr: path.resolve('server/main.ts'),
    outDir: 'dist',
    emptyOutDir: false, // the view build wrote dist/index.html; keep it
    minify: false,
    target: 'es2022',
    rollupOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
});
```

### `index.html`

```html file=index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!--
      No Content-Security-Policy here: the host applies the one the server publishes with this
      resource (a closed view: no network, no external resource).
    -->
    <title>Tic-tac-toe</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: system-ui, sans-serif;
      }
      body {
        margin: 0;
        padding: 1rem;
      }
      .column {
        display: grid;
        gap: 0.75rem;
        justify-items: start;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .status {
        margin: 0;
        min-height: 1.5em;
        font-size: 1.05rem;
      }
      .board {
        display: grid;
        grid-template-columns: repeat(3, 5rem);
        gap: 0.4rem;
      }
      .board button {
        width: 5rem;
        height: 5rem;
        padding: 0;
        font-size: 2.25rem;
        font-weight: 600;
        border: 2px solid currentColor;
        border-radius: 0.5rem;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .board button:disabled {
        cursor: default;
      }
      .board button:not(:disabled):hover {
        background: color-mix(in srgb, currentColor 12%, transparent);
      }
      .board button:focus-visible,
      .row button:focus-visible {
        outline: 3px solid Highlight;
        outline-offset: 2px;
      }
      .square.winning {
        text-decoration: underline;
        text-decoration-thickness: 0.2rem;
      }
      .row button {
        padding: 0.45rem 0.9rem;
        font: inherit;
        border: 2px solid currentColor;
        border-radius: 0.5rem;
        background: transparent;
        color: inherit;
        cursor: pointer;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

### `src/main.ts`

```ts file=src/main.ts
import { startView } from './view.js';

await startView();
```

### `src/view.tsx`

```tsx file=src/view.tsx
import {
  Catalog,
  CommonSchemas,
  createComponentImplementation,
  defineSurface,
  startA2uiView,
  z,
  type ReactCatalogComponent,
} from '@saga-a2ui/react-mcp-stack';

const catalogId = 'https://tic-tac-toe.example/catalogs/welcome/v1';
const Message = createComponentImplementation(
  { name: 'Message', schema: z.object({ text: CommonSchemas.DynamicString }).strict() },
  ({ props }) => <p role="status">{String(props.text ?? '')}</p>,
);
const catalog = new Catalog<ReactCatalogComponent>(catalogId, 'v0.9', [Message]);
const layout = defineSurface({
  surfaceId: 'welcome',
  catalogId,
  data: z.object({ message: z.string() }),
  initial: { message: 'Connecting…' },
  root: { component: 'Message', bind: { text: 'message' }, props: {} },
  components: [],
});

export async function startView(): Promise<void> {
  const container = document.getElementById('root');
  if (container === null) throw new Error('The page has no #root.');
  const view = startA2uiView({
    container,
    catalog,
    layout,
    onToolResult: (result, running) => {
      const parsed = z.object({ message: z.string() }).safeParse(result.structuredContent);
      running.surface.update({
        message: parsed.success ? parsed.data.message : 'The server did not return a welcome message.',
      });
    },
  });
  await view.ready;
}
```

### `server/operations.ts`

```ts file=server/operations.ts
import { McpServer } from '@modelcontextprotocol/server';
import {
  operationViewFromHtml,
  registerPublicOperation,
  type OperationView,
  type RequestLifetime,
} from '@saga-a2ui/react-mcp-stack/server';
import { z } from 'zod';

export function prepareBoardViews(html: string): OperationView {
  if (!html.includes('<div id="root"')) throw new Error('Build the view before starting the server.');
  return operationViewFromHtml({ html, filename: 'welcome.html', title: 'Tic-tac-toe' });
}

export function createGameServer({ views, lifetime }: {
  views: OperationView;
  lifetime: RequestLifetime;
}): McpServer {
  const server = new McpServer({ name: 'saga-tic-tac-toe', version: '0.0.0' });
  registerPublicOperation(server, {
    name: 'new_game',
    title: 'Open tic-tac-toe',
    description: 'Opens the tic-tac-toe welcome card. The game is not implemented yet.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    input: z.strictObject({}),
    output: z.strictObject({ message: z.string() }),
    view: views,
    failures: { absent: 'No welcome message was found.', unavailable: 'The welcome card is unavailable.', invalidOutput: 'The welcome message is invalid.' },
    handle: async () => ({ kind: 'record', record: 'Your React app is connected. Next, build the board.' }),
    project: (message) => ({ text: message, data: { message } }),
  }, { lifetime });
  return server;
}
```

### `server/endpoint.ts`

```ts file=server/endpoint.ts
import {
  createMcpHandler,
  type CreateMcpHandlerOptions,
  type McpHandlerRequestOptions,
  type McpServer,
} from '@modelcontextprotocol/server';
import type { RequestLifetime } from '@saga-a2ui/react-mcp-stack/server';

/** One endpoint's persistent handler, admission association, notification bus and capacity. */
export function createEndpoint(
  build: (lifetime: RequestLifetime) => McpServer,
  options: CreateMcpHandlerOptions = {},
) {
  const admissions = new WeakMap<Request, RequestLifetime>();
  const handler = createMcpHandler((context) => {
    const lifetime =
      context.requestInfo === undefined
        ? undefined
        : admissions.get(context.requestInfo);
    if (lifetime === undefined)
      throw new Error('The MCP request has no admitted lifetime.');
    return build(lifetime);
  }, options);
  return {
    notify: handler.notify,
    close: handler.close,
    fetch(
      request: Request,
      lifetime: RequestLifetime,
      requestOptions: McpHandlerRequestOptions,
    ): Promise<Response> {
      admissions.set(request, lifetime);
      // A bounded parsedBody must be supplied for POST: the legacy classifier otherwise clones
      // the Request, which would discard this object-identity association.
      return handler.fetch(request, requestOptions);
    },
  };
}

export type Endpoint = ReturnType<typeof createEndpoint>;
```

### `server/listener.ts`

```ts file=server/listener.ts
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { getRequestListener, type HttpBindings } from '@hono/node-server';
import {
  hostHeaderValidation,
  localhostOriginValidation,
} from '@modelcontextprotocol/hono';
import { readRequestBody } from '@modelcontextprotocol/server';
import {
  createServerBudgets,
  type BudgetSettings,
  type LifetimeCause,
  type RequestLifetime,
} from '@saga-a2ui/react-mcp-stack/server';
import { Hono, type Context } from 'hono';
import { createEndpoint } from './endpoint.js';
import { createGameServer, prepareBoardViews } from './operations.js';

// APPLICATION-OWNED HTTP hosting for the MCP server: a Hono application on a loopback Node listener,
// stateless Streamable HTTP (a persistent handler, a fresh server per request, modern auto responses) and
// DNS-rebinding protection from the official `@modelcontextprotocol/hono` middleware (Host and Origin). Put
// your own ingress (TLS, a public host name) in front of it, and add that host name to
// `ALLOWED_HOSTNAMES`, when you deploy.
//
// The adapter's `createMcpHonoApp` is not used: it reads and parses the request body before your routes
// run, so the application could not bound that wait by the request's lifetime. This file installs the
// adapter's two validators and reads the body itself, as a bounded stage.
//
// Time: each request's lifetime starts when the request is admitted, before any body wait. This file wires
// that one deadline into the waits the application owns: the request body and delivery of the response. A
// body that stalls is answered once with 408 and its connection is closed. A response the deadline
// overtakes is destroyed, never replaced, so a committed response is not given a second status.

const HOST = '127.0.0.1';
const ALLOWED_HOSTNAMES = ['127.0.0.1', 'localhost'];
const GAME_PATH = '/mcp';
const MAX_REQUEST_BYTES = 1024 * 1024;

export interface ListenerOptions {
  /** The built page, read by the caller before the port opens. */
  readonly html: string;
  /** Use 0 for an ephemeral port. */
  readonly port: number;
  /**
   * 3,000 ms per operation and 10,000 ms per request unless stated. A field you leave out keeps
   * its default, and an invalid value fails before the port opens.
   */
  readonly budgets?: BudgetSettings;
}

export interface Listener {
  /** The game's MCP endpoint. */
  readonly url: string;
  close(): Promise<void>;
}

/** `Bindings` are the Node request and response the Hono Node adapter hands to every request. */
interface Environment {
  Bindings: HttpBindings;
  Variables: { lifetime: RequestLifetime };
}

type RequestContext = Context<Environment>;

export async function startListener(
  options: ListenerOptions,
): Promise<Listener> {
  // Prepare and validate deployment inputs once, before opening the port. Each request
  // reuses the same HTML, URI and store while owning its server and lifetime.
  const budgets = createServerBudgets(options.budgets);
  const views = prepareBoardViews(options.html);
  const game = createEndpoint(
    (lifetime) => createGameServer({ views, lifetime }),
    { maxRequestBodySize: MAX_REQUEST_BYTES },
  );
  const active = new Set<RequestLifetime>();
  let stopping = false;
  let closing: Promise<void> | undefined;
  function track(
    req: IncomingMessage,
    res: ServerResponse,
    lifetime: RequestLifetime,
  ): void {
    active.add(lifetime);
    res.once('close', () => active.delete(lifetime));
    bindResponseToLifetime(req, res, lifetime);
  }

  const app = new Hono<Environment>();

  // The request's clock starts at admission, before any body wait.
  app.use('*', async (c, next) => {
    if (stopping) return c.json({ error: 'shutting_down' }, 503);
    const lifetime = budgets.startRequest();
    track(c.env.incoming, c.env.outgoing, lifetime);
    c.set('lifetime', lifetime);
    await next();
  });
  app.use('*', hostHeaderValidation(ALLOWED_HOSTNAMES));
  app.use('*', localhostOriginValidation());

  /** One safe answer, and only while nothing is committed and the caller has not gone. */
  function mayAnswer(lifetime: RequestLifetime, res: ServerResponse): boolean {
    if (res.headersSent || res.destroyed) return false;
    const cause = lifetime.cause;
    return cause === undefined || cause.kind === 'request-timeout';
  }

  /** What a handler returns when nothing may be written: the caller has gone, or the connection is being destroyed. */
  const unanswered = (): Response => new Response(null, { status: 408 });

  /** Answers, then drops the connection: the rest of the request body is not wanted. */
  function refuseAndClose(
    c: RequestContext,
    status: 408 | 413,
    body: object,
  ): Response {
    const { incoming, outgoing } = c.env;
    if (outgoing.writableFinished) incoming.destroy();
    else outgoing.once('finish', () => incoming.destroy());
    return c.json(body, status, { connection: 'close' });
  }

  /** A body stage that did not finish. An expiry is answered once; a disconnect writes nothing. */
  function bodyFailed(c: RequestContext, cause: LifetimeCause): Response {
    const lifetime = c.get('lifetime');
    // The lifetime recorded its own expiry, disconnect and completion; the rest are this stage's.
    if (
      cause.kind !== 'request-timeout' &&
      cause.kind !== 'disconnected' &&
      cause.kind !== 'completed'
    )
      lifetime.record(cause);
    if (
      cause.kind === 'disconnected' ||
      cause.kind === 'cancelled' ||
      cause.kind === 'completed'
    )
      return unanswered();
    return mayAnswer(lifetime, c.env.outgoing)
      ? refuseAndClose(c, 408, { error: 'request_timeout' })
      : unanswered();
  }

  /**
   * Reads and parses a POST body as one bounded stage of the request. A `Response` means the
   * request has been dealt with (or the caller has gone) and nothing may be built for it.
   */
  async function readJsonBody(
    c: RequestContext,
  ): Promise<{ readonly value: unknown } | Response> {
    const lifetime = c.get('lifetime');
    // The adapter's own bounded reader (it refuses a declared or observed size over the limit); the
    // stage stops waiting when the budget ends, and the connection is closed behind it.
    const read = await lifetime.run('body', () =>
      readRequestBody(c.req.raw, MAX_REQUEST_BYTES),
    );
    if (!read.ok) return bodyFailed(c, read.cause);
    if (!mayAnswer(lifetime, c.env.outgoing)) return unanswered();
    if (read.value.tooLarge)
      return refuseAndClose(c, 413, { error: 'payload_too_large' });
    try {
      return { value: JSON.parse(read.value.text) as unknown };
    } catch {
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        },
        400,
      );
    }
  }

  app.all(GAME_PATH, async (c) => {
    // The body is the application's wait, so it runs under the request's lifetime and is bounded
    // before any server or transport exists. Nothing is built for a request that has ended.
    const body = c.req.method === 'POST' ? await readJsonBody(c) : undefined;
    if (body instanceof Response) return body;
    if (c.get('lifetime').check() !== undefined) return unanswered();
    return game.fetch(c.req.raw, c.get('lifetime'), {
      ...(body === undefined ? {} : { parsedBody: body.value }),
    });
  });

  app.notFound(() => new Response(null, { status: 404 }));
  app.onError(() => new Response(null, { status: 500 }));

  const http = createServer(getRequestListener(app.fetch));
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, HOST, resolve);
  });
  const { port } = http.address() as AddressInfo; // listen() on a TCP port yields AddressInfo

  return {
    url: `http://${HOST}:${port}${GAME_PATH}`,
    close: () =>
      (closing ??= (async () => {
        stopping = true;
        for (const lifetime of active) lifetime.disconnect();
        await game.close();
        await new Promise<void>((resolve, reject) => {
          http.close((error) => (error ? reject(error) : resolve()));
          http.closeAllConnections();
        });
      })()),
  };
}

/**
 * Connects one request's lifetime to its response when the request is admitted. The transport
 * finishing the response ends the lifetime; the caller going away does too. In the other direction,
 * a request deadline that passes before the response is delivered destroys the response, which
 * releases the connection and the transport's listeners. A response is never given a second status.
 */
function bindResponseToLifetime(
  req: IncomingMessage,
  res: ServerResponse,
  lifetime: RequestLifetime,
): void {
  // A write to a response this listener destroyed must not escape as an unhandled error.
  res.on('error', () => undefined);
  req.on('error', () => undefined);

  // Destroying a response also emits `finish` on current Node, with `destroyed` already true, so
  // neither the event nor `writableFinished` says the peer received the whole response.
  let delivered = false;
  res.once('finish', () => {
    if (res.destroyed) return;
    delivered = true;
    lifetime.finish();
  });
  res.once('close', () => {
    if (!delivered) lifetime.disconnect();
  });
  lifetime.signal.addEventListener(
    'abort',
    () => {
      if (lifetime.cause?.kind !== 'request-timeout') return;
      // The stage that owns the response may write one safe answer in this turn of the event loop;
      // delivering it gets no extra time.
      setImmediate(() => {
        if (!res.writableFinished && !res.destroyed) res.destroy();
      });
    },
    { once: true },
  );
}
```

### `server/main.ts`

```ts file=server/main.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startListener } from './listener.js';

// The server entry. It reads the built view before it opens a port, so a missing build stops the
// process instead of serving a listener without its view. `npm run build` writes the view beside
// this file; `npm start` runs it.
const html = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
  'utf8',
);
const listener = await startListener({
  html,
  port: Number(process.env.PORT ?? 3000),
});

console.log(`Tic-tac-toe MCP endpoint: ${listener.url}`);

// Stop the MCP handler and every HTTP exchange before allowing Node to exit.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void listener.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
```

