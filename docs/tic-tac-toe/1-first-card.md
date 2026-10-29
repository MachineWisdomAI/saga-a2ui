# Connect a React component to a server result

The first version of your app displays one message from the server. When you ask Claude or ChatGPT to open it, the host calls `new_game`, receives the message, and opens a React view that displays it. This small example introduces the same connection the board will use later.

## 1. Let Vite create the project

From your projects directory, run:

```sh
npm create vite@8.2.0 my-tic-tac-toe -- --template react-ts --no-interactive
cd my-tic-tac-toe
```

Accept npm's prompt to install `create-vite` if it appears. If you already have an empty app directory, run the same command there with `.` in place of `my-tic-tac-toe`, and skip `cd`.

[Vite's React/TypeScript generator](https://vite.dev/guide/#scaffolding-your-first-vite-project) creates the package file, compiler configuration, React entry point and lint setup. Keep that configuration. We will replace its demo counter and add the parts that connect the app to an MCP host. All commands below run from this app directory. Continue with the installation commands below; the generator’s suggested `npm run dev` starts a standalone website, while this app opens in Claude or ChatGPT.

SAGA's supported A2UI dependency combination needs one npm override. Set it before installing:

```sh
npm pkg set 'overrides.@a2ui/markdown-it=0.2.1'
```

Install the stack, the React version it supports, and the MCP server and schema libraries used by your operations:

```sh
npm install --save-exact --strict-peer-deps \
  @saga-a2ui/react-mcp-stack@0.9.0-rc.1 \
  react@19.3.1 react-dom@19.3.1 \
  @modelcontextprotocol/server@2.3.1 zod@4.6.7
```

Pin the build and lint tools to the versions used for this walkthrough. `vite-plugin-singlefile` is the addition that packages the React view for its host; the other tools belong to the generated React/TypeScript project.

```sh
npm install --save-dev --save-exact --strict-peer-deps \
  typescript@5.9.3 vite@8.3.4 @vitejs/plugin-react@6.1.2 \
  vite-plugin-singlefile@2.3.3 \
  @types/node@22.20.5 @types/react@19.3.0 @types/react-dom@19.3.0 \
  @eslint/js@9.39.1 eslint@9.39.1 eslint-plugin-react-hooks@7.0.1 \
  eslint-plugin-react-refresh@0.4.24 globals@16.5.0 typescript-eslint@8.46.4
```

Keep the generated `package-lock.json`; subsequent installations use `npm ci`. The [main guide's dependency notes](../build-tic-tac-toe-with-react.md#1-create-the-app) explain the inherited audit warnings and the Markdown override.

## 2. Return a message from the server

Create a `server` directory and add `server/operations.ts` below. This file describes what the assistant can ask your app to do.

`registerPublicOperation` exposes a tool named `new_game`. Its empty input schema means the caller supplies no arguments. `handle` produces the application value; `project` gives that value two representations: text the assistant can read and structured data the React view can use. Both contain the same welcome message here.

```ts file=server/operations.ts
import { McpServer } from '@modelcontextprotocol/server';
import {
  operationViewFromHtml,
  registerPublicOperation,
  type OperationView,
} from '@saga-a2ui/react-mcp-stack/server';
import { z } from 'zod';

export function prepareBoardViews(html: string): OperationView {
  if (!html.includes('<div id="root"'))
    throw new Error('Build the view before starting the server.');
  return operationViewFromHtml({
    html,
    filename: 'welcome.html',
    title: 'Tic-tac-toe',
  });
}

export function createGameServer({
  views,
}: {
  views: OperationView;
}): McpServer {
  const server = new McpServer({ name: 'saga-tic-tac-toe', version: '0.0.0' });
  registerPublicOperation(server, {
    name: 'new_game',
    title: 'Open tic-tac-toe',
    description:
      'Opens the tic-tac-toe welcome card. The game is not implemented yet.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    input: z.strictObject({}),
    output: z.strictObject({ message: z.string() }),
    view: views,
    failures: {
      absent: 'No welcome message was found.',
      unavailable: 'The welcome card is unavailable.',
      invalidOutput: 'The welcome message is invalid.',
    },
    handle: async () => ({
      kind: 'record',
      record: 'Your React app is connected. Next, build the board.',
    }),
    project: (message) => ({ text: message, data: { message } }),
  });
  return server;
}
```

`output` describes the structured result: an object with a `message` string. SAGA checks it before returning the response. `view` attaches the HTML that the host should open with this tool's result. The annotations describe the operation's effects to the host; this first version only displays a message. The named failures provide the safe text to use when the operation cannot return a valid result.

The operation uses Zod from `zod` for its tool schemas. The React catalog in the next section uses `z` from the SAGA stack, whose schema API matches A2UI's catalog types.

## 3. Display that message in React

Create `src/view.tsx`. The component at the start is ordinary React: it renders a paragraph from a `text` prop. `createComponentImplementation` gives that component a name and a prop schema so SAGA can use it in a layout. A catalog is the collection of components that this view allows; for now, it contains only `Message`.

The layout has one data field, `message`, and one component. `bind: { text: 'message' }` connects that field to the paragraph's `text` prop.

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
  {
    name: 'Message',
    schema: z.object({ text: CommonSchemas.DynamicString }).strict(),
  },
  ({ props }) => <p role="status">{String(props.text ?? '')}</p>,
);
const catalog = new Catalog<ReactCatalogComponent>(catalogId, 'v0.9', [
  Message,
]);
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
      const parsed = z
        .object({ message: z.string() })
        .safeParse(result.structuredContent);
      running.surface.update({
        message: parsed.success
          ? parsed.data.message
          : 'The server did not return a welcome message.',
      });
    },
  });
  await view.ready;
}
```

`startA2uiView` mounts the layout into `#root` and connects it to the host. The initial message is `Connecting…`. When the tool result arrives, `onToolResult` reads its structured data and calls `surface.update`. That changes `message`, so React redraws the paragraph with the server's text. You do not write the host handshake or send A2UI protocol messages.

Replace Vite's generated `src/main.tsx` with this entry point:

```tsx file=src/main.tsx
import './index.css';
import { startView } from './view.js';

await startView();
```

Delete the generated counter files, `src/App.tsx` and `src/App.css`; this app starts through `startView` instead. Replace the demo styles in `src/index.css` with:

```css file=src/index.css
:root { font-family: system-ui, sans-serif; color-scheme: light dark; }
body { margin: 0; padding: 1rem; }
```

In Vite's generated `index.html`, change the title to `Tic-tac-toe` and remove the favicon `<link>`. Keep its `#root` element and `/src/main.tsx` script entry. The host supplies the surrounding page, so the card only needs its content and styles.

## 4. Serve the operation and its view

Create `server/main.ts`:

```ts file=server/main.ts
import { readFile } from 'node:fs/promises';
import { startLocalMcpServer } from '@saga-a2ui/react-mcp-stack/server/node';
import { createGameServer, prepareBoardViews } from './operations.js';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const views = prepareBoardViews(html);
const listener = await startLocalMcpServer({
  port: Number(process.env.PORT ?? 3000),
  createServer: () => createGameServer({ views }),
});

console.log(`Tic-tac-toe MCP endpoint: ${listener.url}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void listener.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
```

The server reads the built HTML before opening a port. `prepareBoardViews` turns it into the view attached to `new_game`. `startLocalMcpServer` supplies the HTTP listener and MCP transport; its callback registers your application operations for each request. Each operation runs under the SDK's default deadlines.

The helper binds to `127.0.0.1` and serves `/mcp`, checks hosts and origins, limits request bodies, and cancels requests during shutdown. The signal handlers above let **Ctrl-C** stop it cleanly. Those mechanics belong to the [SDK's local listener](../local-mcp-server.md); your app supplies the message and the component. This server has no sign-in and is intended for the disposable games described in the main guide.

## 5. Build for an MCP host

A normal Vite website loads JavaScript and CSS as separate files. An MCP host receives this view as an HTML resource, so bundle its assets into that document. Replace the generated `vite.config.ts` with:

```ts file=vite.config.ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { target: 'es2022' },
});
```

The server has a different entry point and runs in Node. Add `vite.server.config.ts`:

```ts file=vite.server.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: 'server/main.ts',
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2022',
    rollupOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
});
```

`ssr` selects the server entry. `noExternal: true` bundles its dependencies, including the TypeScript source shipped by SAGA. `emptyOutDir: false` preserves the HTML that the view build already wrote. The result is `dist/index.html` beside `dist/server.mjs`, which is where `server/main.ts` reads it.

Make two small changes to Vite's generated compiler configuration:

- In both `tsconfig.app.json` and `tsconfig.node.json`, set `erasableSyntaxOnly` to `false`. The current SAGA packages use TypeScript constructor parameter properties, which Vite compiles; this option otherwise prohibits that syntax. Keep `strict: true`.
- In `tsconfig.node.json`, replace its `include` list with `["vite.config.ts", "vite.server.config.ts", "server"]` so typechecking covers your server too.

Add the scripts with npm rather than rewriting `package.json`:

```sh
npm pkg set \
  'scripts.build:view=vite build' \
  'scripts.build:server=vite build --config vite.server.config.ts' \
  'scripts.build=npm run build:view && npm run build:server' \
  'scripts.typecheck=tsc -b' \
  'scripts.start=node dist/server.mjs'
```

## 6. Open it and make a change

```sh
npm run typecheck
npm run build
npm start
```

The terminal prints `Tic-tac-toe MCP endpoint: http://127.0.0.1:3000/mcp`. Leave it running and follow [Open the card in Claude or ChatGPT](../build-tic-tac-toe-with-react.md#2-open-the-card-in-claude-or-chatgpt). Your first UI result is in that host.

Once the welcome message appears, change the string returned by `handle` in `server/operations.ts`. Stop the server, rebuild and start it, refresh the host's tools as described in the main guide, then open the app in a new chat. The paragraph should show your new text without a change to the React component. The value travelled through `project.data.message`, `onToolResult`, and the layout binding.

Next, change the paragraph in the `Message` component to include `<strong>{String(props.text ?? '')}</strong>`. Rebuild and open it again. The server still returns the same value; the React component controls how it looks. These are the two places you will extend when the welcome card becomes a board.

Compare your files with the [complete first-card checkpoint](checkpoints/first-card.md) if needed, then return to [Build and play the game](../build-tic-tac-toe-with-react.md#3-build-and-play-the-game).
