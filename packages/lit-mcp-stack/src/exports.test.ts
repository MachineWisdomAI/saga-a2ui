// @vitest-environment jsdom
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import * as main from '@saga-a2ui/lit-mcp-stack';
import * as card from '@saga-a2ui/lit-mcp-stack/faithful-card';

// The package is consumed through its installed subpath exports, the way an application does, and
// the module graph behind each export is bundled to show what a consumer really pulls in. This is
// the emitted-bundle footprint: the installed tree of the same application does include
// `@saga-a2ui/components` and `markdown-it`, as declared dependencies of the stack, and that is the
// correct install result (the install checks are scripts/check-react-pnpm.ts and candidate:verify).

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

describe('@saga-a2ui/lit-mcp-stack', () => {
  it('exposes exactly the supported names', () => {
    expect(Object.keys(main).sort()).toEqual([
      'ActionButton',
      'StartFailure',
      'actionButtonEntry',
      'createLitActions',
      'defineSurface',
      'startA2uiView',
      'z',
    ]);
    expect(Object.keys(card).sort()).toEqual([
      'FaithfulCardApp',
      'StartFailure',
      'contentPolicyFromDocument',
      'documentContentSecurityPolicies',
      'startFaithfulCardApp',
    ]);
  });

  it('keeps the main entry free of components and Markdown: nothing of the card reaches an own-catalog bundle', async () => {
    const modules = await bundledModules('@saga-a2ui/lit-mcp-stack');
    // The graph was really walked: the stack, the lifetime runner, the bound surface and the
    // action control are in it.
    expect(
      anyOf(modules, /\/packages\/lit-mcp-stack\/src\/start-a2ui-view\.ts$/),
    ).toHaveLength(1);
    expect(
      anyOf(modules, /\/packages\/mcp\/src\/view\/run-tool-result-view\.ts$/),
    ).toHaveLength(1);
    expect(
      anyOf(modules, /\/packages\/lit\/src\/a2ui\/app-element\.ts$/),
    ).toHaveLength(1);
    expect(
      anyOf(modules, /\/packages\/lit\/src\/actions\/action-button\.ts$/),
    ).toHaveLength(1);
    expect(anyOf(modules, /\/packages\/components\//)).toEqual([]);
    expect(anyOf(modules, /\/packages\/lit\/src\/faithful-card\//)).toEqual([]);
    expect(
      anyOf(
        modules,
        /node_modules\/(markdown-it|mdurl|linkify-it|uc\.micro|entities)\//,
      ),
    ).toEqual([]);
    expect(anyOf(modules, /\/packages\/react\//)).toEqual([]);
    expect(
      anyOf(modules, /node_modules\/(react|react-dom|@a2ui\/react)\//),
    ).toEqual([]);
  });

  it('gives the card entry the one shared reader and parser, through the renderer’s card, and no React renderer', async () => {
    const modules = await bundledModules(
      '@saga-a2ui/lit-mcp-stack/faithful-card',
    );
    expect(
      anyOf(
        modules,
        /\/packages\/lit-mcp-stack\/src\/faithful-card\/start-faithful-card-app\.ts$/,
      ),
    ).toHaveLength(1);
    expect(
      anyOf(modules, /\/packages\/components\/src\/faithful-card\/reader\.ts$/),
    ).toHaveLength(1);
    expect(
      anyOf(
        modules,
        /\/packages\/components\/src\/faithful-card\/card-app\.ts$/,
      ),
    ).toHaveLength(1);
    expect(
      anyOf(modules, /node_modules\/markdown-it\//).length,
    ).toBeGreaterThan(0);
    expect(anyOf(modules, /\/packages\/react\//)).toEqual([]);
    expect(
      anyOf(modules, /node_modules\/(react|react-dom|@a2ui\/react)\//),
    ).toEqual([]);
  });
});
