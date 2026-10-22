// @vitest-environment jsdom
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import * as main from '@saga-a2ui/lit-mcp-stack';
import * as card from '@saga-a2ui/lit-mcp-stack/faithful-card';
import * as contentPolicy from '@saga-a2ui/lit-mcp-stack/content-policy';
import * as server from '@saga-a2ui/lit-mcp-stack/server';
import {
  checkPackageDirection,
  directionViolations,
  readPackage,
} from '../../../scripts/package-direction.js';

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
      'readingProfile',
      'startA2uiView',
      'z',
    ]);
    expect(Object.keys(card).sort()).toEqual([
      'FaithfulCardApp',
      'StartFailure',
      'bindHostLink',
      'contentPolicyFromDocument',
      'documentContentSecurityPolicies',
      'readingProfile',
      'startFaithfulCardApp',
    ]);
    expect(Object.keys(contentPolicy).sort()).toEqual([
      'createContentPolicy',
      'embedContentPolicy',
    ]);
    expect(Object.keys(server).sort()).toEqual([
      'attachRequestLifetime',
      'createServerBudgets',
      'operationViewFromHtml',
      'registerPublicOperation',
      'viewUriForHtml',
    ]);
  });

  it('serves one reading profile to the application from both entries', () => {
    expect(main.readingProfile).toBe(card.readingProfile);
    expect(
      main.readingProfile({ deviceClass: 'echo_show_15' }, undefined),
    ).toBe('device');
    expect(main.readingProfile({ platform: 'web' }, 'Some Host')).toBe(
      'desktop',
    );
  });

  it('keeps the server entry out of the browser graph, and the browser entries out of the server', async () => {
    const serverModules = await bundledModules(
      '@saga-a2ui/lit-mcp-stack/server',
    );
    // The graph was really walked: the operation registration and the view identity are in it.
    expect(
      anyOf(serverModules, /\/packages\/mcp\/src\/server\/operation\.ts$/),
    ).toHaveLength(1);
    expect(
      anyOf(serverModules, /\/packages\/mcp\/src\/server\/view-identity\.ts$/),
    ).toHaveLength(1);
    expect(anyOf(serverModules, /\/packages\/components\//)).toEqual([]);
    expect(anyOf(serverModules, /\/packages\/react\//)).toEqual([]);
    expect(anyOf(serverModules, /\/packages\/lit\//)).toEqual([]);
    expect(
      anyOf(serverModules, /node_modules\/(lit|lit-html|@lit|@a2ui\/lit)\//),
    ).toEqual([]);
    for (const entry of ['', '/faithful-card']) {
      const browser = await bundledModules(`@saga-a2ui/lit-mcp-stack${entry}`);
      expect(anyOf(browser, /\/packages\/mcp\/src\/server\//)).toEqual([]);
      expect(
        anyOf(browser, /node_modules\/@modelcontextprotocol\/(server|node)\//),
      ).toEqual([]);
    }
  });

  it('keeps the content-policy entry free of the renderer, the delivery and the stack', async () => {
    const modules = await bundledModules(
      '@saga-a2ui/lit-mcp-stack/content-policy',
    );
    expect(
      anyOf(modules, /\/packages\/components\/src\/faithful-card\/policy\.ts$/),
    ).toHaveLength(1);
    expect(
      anyOf(
        modules,
        /\/packages\/components\/src\/faithful-card\/policy-transport\.ts$/,
      ),
    ).toHaveLength(1);
    expect(anyOf(modules, /\/packages\/lit\//)).toEqual([]);
    expect(anyOf(modules, /\/packages\/mcp\//)).toEqual([]);
    expect(
      anyOf(modules, /node_modules\/(lit|lit-html|@lit|@a2ui\/lit)\//),
    ).toEqual([]);
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

describe('dependency direction', () => {
  it('connects the Lit renderer to MCP delivery and imports no React renderer or other stack', () => {
    const { files, violations } = checkPackageDirection('lit-mcp-stack');
    // The source was really read.
    expect(files).toBeGreaterThan(5);
    expect(violations).toEqual([]);
  });

  it.each([
    ["import { createElement } from 'react';", 'the other renderer'],
    [
      "import { startA2uiView } from '@saga-a2ui/react-mcp-stack';",
      'the other stack',
    ],
  ])(
    'fails for a deliberate wrong-direction change: %s (%s)',
    (line, _what) => {
      const { manifest, files } = readPackage('lit-mcp-stack');
      const mutant = { path: 'src/mutant.ts', text: `${line}\n` };
      const found = directionViolations('lit-mcp-stack', manifest, [
        ...files,
        mutant,
      ]);
      expect(found.map((one) => one.where)).toEqual(['src/mutant.ts']);
    },
  );

  it('fails for a wrong-direction dependency declared in the manifest', () => {
    const { manifest, files } = readPackage('lit-mcp-stack');
    const wrong = 'react';
    const found = directionViolations(
      'lit-mcp-stack',
      { ...manifest, dependencies: { ...manifest.dependencies, [wrong]: '*' } },
      files,
    );
    expect(found.map((one) => one.where)).toEqual([
      'package.json dependencies',
    ]);
  });
});
