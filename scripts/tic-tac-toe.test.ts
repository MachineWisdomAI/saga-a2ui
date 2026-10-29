import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildTicTacToe,
  prepareTicTacToe,
  ticTacToeGuidedChange,
  ticTacToeSource,
  typecheckTicTacToe,
} from './build-tic-tac-toe.js';
import { blankComments, repoRoot } from './consumer-boundary.js';
import { createWorkDirectory } from './packed-consumer.js';
import { templateDirectory } from './starter-template.js';

// examples/tic-tac-toe: generated with the React/Hono `saga init`, keeping the template's
// structure, and built from packed SDK packages. The rules and the store are checked by
// tic-tac-toe-rules.test.ts, the page by apps/lit-host/e2e/tic-tac-toe.spec.ts, and the
// guide by tic-tac-toe-document.test.ts.

const template = templateDirectory('react-hono');
const work = createWorkDirectory('saga-tic-tac-toe-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const read = (root: string, file: string): string =>
  fs.readFileSync(path.join(root, file), 'utf8');

const sourceFiles = (directory: string): string[] =>
  fs
    .readdirSync(path.join(ticTacToeSource, directory), { recursive: true })
    .map(String)
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => path.join(directory, file));

/** Every module specifier a file imports, exports from or loads, comments blanked. */
const specifiersOf = (file: string): string[] => {
  const code = blankComments(read(ticTacToeSource, file));
  return [
    ...code.matchAll(/\bfrom\s*(['"`])([^'"`]+)\1/g),
    ...code.matchAll(/(?<![\w$.])import\s*(['"`])([^'"`]+)\1/g),
  ].map((match) => match[2]!);
};

describe('the example keeps the template it was generated from', () => {
  it('has the template’s build files and its server wiring, importing the server types through the stack', () => {
    for (const file of [
      'vite.config.ts',
      'vite.server.config.ts',
      'tsconfig.json',
      'tsconfig.server.json',
      'server/endpoint.ts',
    ])
      expect(read(ticTacToeSource, file), file).toBe(
        read(template, file).replace(
          "'@saga-a2ui/mcp/server'",
          "'@saga-a2ui/react-mcp-stack/server'",
        ),
      );
  });

  it('declares the template’s dependencies and scripts, with SDK packages as "*"', () => {
    const own = JSON.parse(read(ticTacToeSource, 'package.json')) as Record<
      string,
      unknown
    >;
    const generated = JSON.parse(read(template, 'package.json')) as Record<
      string,
      unknown
    >;
    for (const field of [
      'scripts',
      'dependencies',
      'devDependencies',
      'overrides',
      'engines',
      'type',
    ])
      expect(own[field], field).toEqual(generated[field]);
  });

  it('keeps the template’s server files that carry no sign-in, and the layout of src', () => {
    for (const file of [
      'server/endpoint.ts',
      'server/listener.ts',
      'server/main.ts',
      'server/operations.ts',
      'src/actions.ts',
      'src/catalog.tsx',
      'src/contract.ts',
      'src/main.ts',
      'src/surface.ts',
      'src/view.tsx',
      'index.html',
    ])
      expect(fs.existsSync(path.join(ticTacToeSource, file)), file).toBe(true);
    // The game has no sign-in, so the starter's identity files are gone, not stubbed.
    for (const file of [
      'server/verifier.ts',
      'server/authenticate.ts',
      'server/identity.ts',
      'server/authorization.ts',
    ])
      expect(fs.existsSync(path.join(ticTacToeSource, file)), file).toBe(false);
  });
});

describe('what the example imports', () => {
  it('uses no MCP Apps module and no SAGA package but the stack and the server export', () => {
    const everything = [...sourceFiles('src'), ...sourceFiles('server')];
    expect(everything.length).toBeGreaterThan(10);
    for (const file of everything)
      for (const specifier of specifiersOf(file)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /ext-apps/,
        );
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /^@a2ui\//,
        );
      }
    for (const file of sourceFiles('src'))
      for (const specifier of specifiersOf(file)) {
        if (specifier.startsWith('.') || specifier === 'zod') continue;
        expect(specifier, file).toMatch(
          /^(@saga-a2ui\/react-mcp-stack|react|react-dom)(\/.*)?$/,
        );
      }
    for (const file of sourceFiles('server'))
      for (const specifier of specifiersOf(file)) {
        if (specifier.startsWith('.') || specifier.startsWith('node:'))
          continue;
        expect(specifier, file).toMatch(
          /^(@saga-a2ui\/react-mcp-stack\/server|@modelcontextprotocol\/(server|hono)|@hono\/node-server|hono|zod)$/,
        );
      }
  });

  it('keeps the rules free of every package and of the clock', () => {
    const rules = read(ticTacToeSource, 'server/rules.ts');
    expect(specifiersOf('server/rules.ts')).toEqual(['../src/contract.js']);
    expect(rules).not.toMatch(/Date\.now|Math\.random|new Date|setTimeout/);
  });
});

describe('the example built from the packed SDK packages', () => {
  const prepared = prepareTicTacToe(work);

  it('type-checks, builds, and holds no server code in the page', async () => {
    typecheckTicTacToe(prepared.consumer);
    const built = await buildTicTacToe(prepared);
    const own = built.viewModules
      .filter((module) => !module.includes('node_modules'))
      .map((module) =>
        path.relative(fs.realpathSync(prepared.consumer), module),
      )
      .filter((module) => !module.startsWith('..'));
    expect(own).toEqual(
      expect.arrayContaining(['src/view.tsx', 'src/contract.ts']),
    );
    expect(own.some((module) => module.startsWith('server/'))).toBe(false);
    const html = fs.readFileSync(built.view, 'utf8');
    expect(html).toContain('<div id="root"');
    // One self-contained document: nothing is loaded from beside it.
    const markup = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '<script></script>')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '<style></style>');
    expect(markup).not.toMatch(/<link\b/);
    expect(markup).not.toMatch(/<script[^>]*\bsrc=/);
    // The server serves it whole: it requires the marker the page carries.
    expect(fs.readFileSync(built.server, 'utf8')).toContain('new-game.html');

    // `npm start` of the example is `node dist/server.mjs`: it serves the game over MCP.
    const server = spawn(process.execPath, [built.server], {
      cwd: prepared.consumer,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('the example server printed no endpoint')),
          15_000,
        );
        server.stdout.on('data', (chunk: Buffer) => {
          const found = /endpoint: (\S+)/.exec(chunk.toString());
          if (found?.[1] !== undefined) {
            clearTimeout(timer);
            resolve(found[1]);
          }
        });
        server.once('exit', () =>
          reject(new Error('the example server exited')),
        );
      });
      const client = new Client({ name: 'tic-tac-toe-test', version: '0.0.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(url)));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'get_game',
        'new_game',
        'play_move',
        'show_game',
      ]);
      const created = await client.callTool({
        name: 'new_game',
        arguments: {},
      });
      expect(created.isError).not.toBe(true);
      await client.close();
    } finally {
      server.kill();
    }
  }, 120_000);

  it('applies the guided change to a clean copy and still type-checks', () => {
    const copy = path.join(work, 'guided');
    fs.mkdirSync(copy);
    const guided = prepareTicTacToe(copy, { guidedChange: true });
    typecheckTicTacToe(guided.consumer);
    expect(read(guided.consumer, 'src/catalog.tsx')).toContain('MoveList');
    expect(read(guided.consumer, 'src/surface.ts')).toContain('/history');
    // The change touches the layout and the catalog and nothing else.
    const patch = fs.readFileSync(ticTacToeGuidedChange, 'utf8');
    expect(
      [...patch.matchAll(/^diff --git a\/(\S+)/gm)].map((match) => match[1]),
    ).toEqual(['src/catalog.tsx', 'src/surface.ts']);
    for (const file of ['src/controller.ts', 'src/actions.ts', 'src/view.tsx'])
      expect(read(guided.consumer, file)).toBe(read(ticTacToeSource, file));
  }, 120_000);
});

describe('the repository', () => {
  it('lists the example in the root build and type-check', () => {
    const manifest = JSON.parse(read(repoRoot, 'package.json')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts.build).toContain('npm run build:tic-tac-toe');
    expect(manifest.scripts['build:tic-tac-toe']).toBe(
      'tsx scripts/build-tic-tac-toe.ts',
    );
    for (const project of ['tsconfig.json', 'tsconfig.server.json'])
      expect(manifest.scripts.typecheck).toContain(
        `tsc -p examples/tic-tac-toe/${project}`,
      );
  });
});
