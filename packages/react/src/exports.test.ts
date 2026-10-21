// @vitest-environment jsdom
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import * as actions from '@saga-a2ui/react/actions';
import * as faithfulCard from '@saga-a2ui/react/faithful-card';

// The package is consumed through its installed subpath exports, the way an application does, and
// the module graph behind each export is bundled to show what a consumer really pulls in.

async function bundledModules(specifier: string): Promise<string[]> {
  const entry = fileURLToPath(import.meta.resolve(specifier));
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    // Bundle dependencies too, so anything reached through any dependency shows up.
    ssr: { noExternal: true },
    build: {
      write: false,
      minify: false,
      ssr: true,
      target: 'es2022',
      lib: { entry, formats: ['es'], fileName: 'entry' },
      rollupOptions: { external: [] },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) =>
    'output' in one ? one.output : [],
  );
  return outputs.flatMap((output) =>
    output.type === 'chunk' ? Object.keys(output.modules) : [],
  );
}

const anyOf = (modules: string[], pattern: RegExp): string[] =>
  modules.filter((id) => pattern.test(id));

describe('the optional React exports', () => {
  it('expose exactly the supported names', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'ActionButton',
      'ActionButtonEntry',
      'InstanceHostProvider',
      'useActionSetup',
    ]);
    expect(Object.keys(faithfulCard).sort()).toEqual([
      'FaithfulCard',
      'FaithfulCardProvider',
      'faithfulCardEntry',
    ]);
  });

  it('give an application with its own catalog no card, Markdown parser or components package', async () => {
    const modules = await bundledModules('@saga-a2ui/react/actions');
    // The graph was really walked: the control and the shared action runtime are in it.
    expect(
      anyOf(modules, /\/packages\/react\/src\/actions\/action-button\.tsx$/),
    ).toHaveLength(1);
    expect(
      anyOf(modules, /\/packages\/core\/src\/actions\//).length,
    ).toBeGreaterThan(0);
    expect(anyOf(modules, /\/packages\/react\/src\/faithful-card\//)).toEqual(
      [],
    );
    expect(anyOf(modules, /\/packages\/components\//)).toEqual([]);
    expect(
      anyOf(
        modules,
        /node_modules\/(markdown-it|mdurl|linkify-it|uc\.micro|entities)\//,
      ),
    ).toEqual([]);
  });

  it('give the card the shared reader and parser, and no second parser, Lit, MCP or DOM runtime', async () => {
    const modules = await bundledModules('@saga-a2ui/react/faithful-card');
    expect(
      anyOf(modules, /\/packages\/react\/src\/faithful-card\/card\.tsx$/),
    ).toHaveLength(1);
    // One parser: the components package's reader over the maintained markdown-it. The card's own
    // sources contain no Markdown handling of their own.
    expect(
      anyOf(modules, /\/packages\/components\/src\/faithful-card\/reader\.ts$/),
    ).toHaveLength(1);
    expect(
      anyOf(modules, /node_modules\/markdown-it\//).length,
    ).toBeGreaterThan(0);
    expect(
      anyOf(
        modules,
        /node_modules\/(marked|remark[^/]*|micromark[^/]*|mdast[^/]*|showdown|snarkdown|commonmark|dompurify|sanitize-html)\//,
      ),
    ).toEqual([]);
    expect(
      anyOf(
        modules,
        /node_modules\/(lit|lit-html|lit-element|@lit|@lit-labs|jsdom|happy-dom|@modelcontextprotocol|@a2ui\/lit)\//,
      ),
    ).toEqual([]);
    expect(anyOf(modules, /\/packages\/(lit|mcp)\//)).toEqual([]);
  });
});
