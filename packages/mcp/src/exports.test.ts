import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import * as policy from '@saga-a2ui/mcp/policy';
import * as server from '@saga-a2ui/mcp/server';
import * as view from '@saga-a2ui/mcp/view';

// The package is consumed through its installed subpath exports, the way an application does, and
// the module graph behind each export is bundled to show what a consumer would really pull in.

interface Bundled {
  /** Every source module that went into the entry, by path. */
  readonly modules: readonly string[];
  readonly code: string;
}

async function bundle(specifier: string, target: 'node' | 'browser'): Promise<Bundled> {
  // Resolve the way an installed consumer does: through the package name and its exports map.
  const entry = fileURLToPath(import.meta.resolve(specifier));
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    // Bundle dependencies too, so a renderer reached through any dependency would be seen.
    ssr: { noExternal: true },
    build: {
      write: false,
      minify: false,
      ssr: target === 'node',
      target: 'es2022',
      lib: { entry, formats: ['es'], fileName: 'entry' },
      rollupOptions: { external: target === 'node' ? [/^node:/] : [] },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) => ('output' in one ? one.output : []));
  const chunks = outputs.flatMap((output) => (output.type === 'chunk' ? [output] : []));
  return {
    modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)),
    code: chunks.map((chunk) => chunk.code).join('\n'),
  };
}

const RENDERER = /node_modules\/(lit|lit-html|lit-element|@lit|@a2ui|react|react-dom)\//;
const SERVER_ONLY = /node_modules\/@modelcontextprotocol\/(server|node)\//;

describe('package subpath exports', () => {
  it('expose exactly the supported names on each subpath', () => {
    expect(Object.keys(server).sort()).toEqual([
      'BudgetConfigurationError',
      'OperationConfigurationError',
      'StageFailure',
      'createServerBudgets',
      'registerProtectedOperation',
      'registerPublicOperation',
      'valueOrThrow',
      'viewUriForHtml',
    ]);
    expect(Object.keys(view).sort()).toEqual(['connectToolResultView']);
    expect(Object.keys(policy).sort()).toEqual(['CLOSED_VIEW_CSP', 'DEFAULT_OPERATION_MS', 'DEFAULT_REQUEST_MS']);
  });

  it('keep the server export free of any renderer, view or application code', async () => {
    const { modules, code } = await bundle('@saga-a2ui/mcp/server', 'node');
    expect(modules.some((id) => id.endsWith('/packages/mcp/src/server/operation.ts'))).toBe(true); // the graph was really walked
    expect(modules.filter((id) => RENDERER.test(id))).toEqual([]);
    expect(modules.filter((id) => id.includes('/packages/mcp/src/view/'))).toEqual([]);
    expect(modules.filter((id) => id.includes('/apps/'))).toEqual([]);
    expect(code).not.toMatch(/\bdocument\./);
  });

  it('keep the view export free of any server module, Node built-in or renderer', async () => {
    const { modules, code } = await bundle('@saga-a2ui/mcp/view', 'browser');
    expect(modules.some((id) => id.endsWith('/packages/mcp/src/view/index.ts'))).toBe(true);
    expect(modules.filter((id) => SERVER_ONLY.test(id) || RENDERER.test(id))).toEqual([]);
    expect(modules.filter((id) => id.includes('/packages/mcp/src/server/'))).toEqual([]);
    expect(code).not.toMatch(/node:[a-z_/]+/);
  });

  it('keep the policy export free of every runtime dependency', async () => {
    const { modules } = await bundle('@saga-a2ui/mcp/policy', 'browser');
    expect(modules.filter((id) => id.includes('node_modules'))).toEqual([]);
  });
});
