import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import * as a2uiV0_9 from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';

// The package is consumed through its installed subpath exports, the way an application does, and
// the module graph behind the protocol export is bundled to show what a consumer really pulls in.

async function bundledModules(specifier: string): Promise<{ modules: string[] }> {
  const entry = fileURLToPath(import.meta.resolve(specifier));
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    // Bundle dependencies too, so a renderer or transport reached through any dependency shows up.
    ssr: { noExternal: true },
    build: {
      write: false,
      minify: false,
      ssr: true,
      target: 'es2022',
      lib: { entry, formats: ['es'], fileName: 'entry' },
      // Any Node built-in in the graph would fail the build rather than ride along unnoticed.
      rollupOptions: { external: [] },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) => ('output' in one ? one.output : []));
  const chunks = outputs.flatMap((output) => (output.type === 'chunk' ? [output] : []));
  return { modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)) };
}

describe('@saga-a2ui/core exports', () => {
  it('expose exactly the supported names for the A2UI v0.9 protocol', () => {
    expect(Object.keys(a2uiV0_9).sort()).toEqual(['a2uiV0_9Decoder', 'createMessageSession']);
    expect(typeof z.object).toBe('function');
  });

  it('import no renderer, MCP package or DOM runtime', async () => {
    const { modules } = await bundledModules('@saga-a2ui/core/protocols/a2ui/v0_9');
    expect(modules.some((id) => id.endsWith('/packages/core/src/protocols/a2ui/v0_9/session.ts'))).toBe(true); // the graph was really walked
    const forbidden = /node_modules\/(lit|lit-html|lit-element|@lit|@lit-labs|react|react-dom|jsdom|happy-dom|@modelcontextprotocol|@a2ui\/lit)\//;
    expect(modules.filter((id) => forbidden.test(id))).toEqual([]);
    expect(modules.filter((id) => id.includes('/packages/lit/') || id.includes('/packages/mcp/'))).toEqual([]);
  });
});
