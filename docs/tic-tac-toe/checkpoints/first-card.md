# First-card checkpoint

These are the files after [the first lesson](../1-first-card.md). Vite generates the project configuration; the lesson explains the changes and application code. Use this page to compare your result.

## `package.json`

```json file=package.json
{
  "name": "my-tic-tac-toe",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "npm run build:view && npm run build:server",
    "lint": "eslint .",
    "preview": "vite preview",
    "build:view": "vite build",
    "build:server": "vite build --config vite.server.config.ts",
    "typecheck": "tsc -b",
    "start": "node dist/server.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "2.3.1",
    "@saga-a2ui/react-mcp-stack": "0.9.0-rc.1",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@eslint/js": "9.39.1",
    "@types/node": "22.20.5",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "eslint": "9.39.1",
    "eslint-plugin-react-hooks": "7.0.1",
    "eslint-plugin-react-refresh": "0.4.24",
    "globals": "16.5.0",
    "typescript": "5.9.3",
    "typescript-eslint": "8.46.4",
    "vite": "8.3.4",
    "vite-plugin-singlefile": "2.3.3"
  },
  "overrides": {
    "@a2ui/markdown-it": "0.2.1"
  }
}
```

## `tsconfig.json`

```json file=tsconfig.json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

## `tsconfig.app.json`

```json file=tsconfig.app.json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "types": ["vite/client"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": false,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

## `tsconfig.node.json`

```json file=tsconfig.node.json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.node.tsbuildinfo",
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "types": ["node"],
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "erasableSyntaxOnly": false,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts", "vite.server.config.ts", "server"]
}
```

## `eslint.config.js`

```js file=eslint.config.js
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
```

## `vite.config.ts`

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

## `vite.server.config.ts`

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

## `index.html`

```html file=index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tic-tac-toe</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

## `src/index.css`

```css file=src/index.css
:root { font-family: system-ui, sans-serif; color-scheme: light dark; }
body { margin: 0; padding: 1rem; }
```

## `src/main.tsx`

```tsx file=src/main.tsx
import './index.css';
import { startView } from './view.js';

await startView();
```

## `src/view.tsx`

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

## `server/operations.ts`

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

## `server/main.ts`

```ts file=server/main.ts
import { readFile } from 'node:fs/promises';
import { startLocalMcpServer } from '@saga-a2ui/react-mcp-stack/server/node';
import { createGameServer, prepareBoardViews } from './operations.js';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const views = prepareBoardViews(html);
const listener = await startLocalMcpServer({
  port: Number(process.env.PORT ?? 3000),
  createServer: (lifetime) => createGameServer({ views, lifetime }),
});

console.log(`Tic-tac-toe MCP endpoint: ${listener.url}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void listener.close().catch(() => { process.exitCode = 1; });
  });
}
```

