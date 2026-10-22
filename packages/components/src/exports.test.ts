import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import * as faithfulCard from '@saga-a2ui/components/faithful-card';
import {
  checkPackageDirection,
  directionViolations,
  readPackage,
} from '../../../scripts/package-direction.js';

// The package is consumed through its installed subpath export, the way an application does, and
// the module graph behind that export is bundled to show what a consumer really pulls in.

async function bundledModules(
  specifier: string,
): Promise<{ modules: string[]; rendered: Record<string, string> }> {
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
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) =>
    'output' in one ? one.output : [],
  );
  const chunks = outputs.flatMap((output) =>
    output.type === 'chunk' ? [output] : [],
  );
  return {
    modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)),
    rendered: Object.fromEntries(
      chunks.flatMap((chunk) =>
        Object.entries(chunk.modules).map(([id, module]) => [
          id,
          module.code ?? '',
        ]),
      ),
    ),
  };
}

describe('@saga-a2ui/components/faithful-card', () => {
  it('exposes exactly the supported names', () => {
    expect(Object.keys(faithfulCard).sort()).toEqual([
      'CONTENT_POLICY_ELEMENT_ID',
      'DEFAULT_CONTENT_POLICY',
      'FAITHFUL_CARD_CATALOG_ID',
      'FAITHFUL_CARD_CONTRACT_VERSION',
      'FAITHFUL_CARD_STYLING',
      'FaithfulCardApi',
      'FaithfulCardApp',
      'MAX_IMAGE_HOSTS',
      'MAX_NESTING_LEVEL',
      'cardData',
      'cardLayout',
      'closesWithParagraph',
      'contentPolicyFromEmbedded',
      'createCardView',
      'createContentPolicy',
      'createFaithfulCardReader',
      'createImageConsentScope',
      'describeContentFailure',
      'embedContentPolicy',
      'establishImageEnforcement',
      'requestLinkOpen',
      'resourcePermissionsOf',
    ]);
  });

  it('keeps the catalog contract strict: no action, handler, dialect or bound can be supplied as a property', () => {
    const { FaithfulCardApi } = faithfulCard;
    expect(FaithfulCardApi.name).toBe('FaithfulCard');
    expect(
      FaithfulCardApi.schema.safeParse({ contractVersion: 1, markdown: 'x' })
        .success,
    ).toBe(true);
    expect(
      FaithfulCardApi.schema.safeParse({
        contractVersion: { path: '/v' },
        markdown: { path: '/m' },
      }).success,
    ).toBe(true);
    for (const extra of [
      { action: { event: { name: 'x' } } },
      { handler: 'x' },
      { dialect: 'commonmark' },
      { maxLength: 9 },
      { html: '<b>' },
    ]) {
      expect(
        FaithfulCardApi.schema.safeParse({
          contractVersion: 1,
          markdown: 'x',
          ...extra,
        }).success,
        JSON.stringify(extra),
      ).toBe(false);
    }
    expect(FaithfulCardApi.schema.safeParse({ markdown: 'x' }).success).toBe(
      false,
    );
  });

  it('imports no renderer, MCP package, DOM runtime or other SAGA package than core', async () => {
    const { modules, rendered } = await bundledModules(
      '@saga-a2ui/components/faithful-card',
    );
    // The graph was really walked: the parser and the reader are in it.
    expect(
      modules.some((id) =>
        id.endsWith('/packages/components/src/faithful-card/reader.ts'),
      ),
    ).toBe(true);
    expect(modules.some((id) => /node_modules\/markdown-it\//.test(id))).toBe(
      true,
    );
    const forbidden =
      /node_modules\/(lit|lit-html|lit-element|@lit|@lit-labs|react|react-dom|jsdom|happy-dom|@modelcontextprotocol|@a2ui\/lit|@a2ui\/react)\//;
    expect(modules.filter((id) => forbidden.test(id))).toEqual([]);
    expect(
      modules.filter(
        (id) =>
          id.includes('/packages/lit/') ||
          id.includes('/packages/react/') ||
          id.includes('/packages/mcp/'),
      ),
    ).toEqual([]);
    // No browser global is reached for: the component's own source never names one.
    const own = modules.filter(
      (id) =>
        id.includes('/packages/components/src/') && !/\.test\.ts$/.test(id),
    );
    expect(own.length).toBeGreaterThan(0);
    // Comments may name a browser object when they explain a rule; only executable code counts.
    const ownCode = own
      .map((id) => rendered[id] ?? '')
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '');
    expect(ownCode.length).toBeGreaterThan(0);
    for (const marker of [
      'document.',
      'window.',
      'customElements',
      'HTMLElement',
      'localStorage',
      'fetch(',
    ]) {
      expect(ownCode, marker).not.toContain(marker);
    }
  });
});

describe('dependency direction', () => {
  it('imports core only, and no DOM, MCP or renderer', () => {
    const { files, violations } = checkPackageDirection('components');
    // The source was really read.
    expect(files).toBeGreaterThan(5);
    expect(violations).toEqual([]);
  });

  it.each([
    [
      "import { runToolResultView } from '@saga-a2ui/mcp/view';",
      'a delivery package',
    ],
    ["import { LitElement } from 'lit';", 'a renderer'],
    ["document.body.append(document.createElement('p'));", 'a browser object'],
    ['export const style = new CSSStyleSheet();', 'a browser constructor'],
    [
      "export const parsed = new DOMParser().parseFromString('', 'text/html');",
      'a browser parser',
    ],
    [
      'export const watch = (node: HTMLDivElement) => node.focus();',
      'a browser element type',
    ],
  ])(
    'fails for a deliberate wrong-direction change: %s (%s)',
    (line, _what) => {
      const { manifest, files } = readPackage('components');
      const mutant = { path: 'src/mutant.ts', text: `${line}\n` };
      const found = directionViolations('components', manifest, [
        ...files,
        mutant,
      ]);
      expect(found.map((one) => one.where)).toEqual(['src/mutant.ts']);
    },
  );

  it('allows pure code, and prose or names that only look like a browser object', () => {
    const { manifest } = readPackage('components');
    const pure = {
      path: 'src/pure.ts',
      text: [
        '// A constructable CSSStyleSheet is the renderer\u2019s, never this package\u2019s.',
        '/* document.body, window.name and customElements are not used here */',
        'export const sheetName = (id: string): string => `sheet-${id}`;',
        "export const event = new CustomEvent('x');",
        'export const controller = new AbortController();',
        "export const at = new URL('https://example.test').href;",
        '',
      ].join('\n'),
    };
    expect(directionViolations('components', manifest, [pure])).toEqual([]);
  });

  it('fails for a wrong-direction dependency declared in the manifest', () => {
    const { manifest, files } = readPackage('components');
    const wrong = 'react';
    const found = directionViolations(
      'components',
      { ...manifest, dependencies: { ...manifest.dependencies, [wrong]: '*' } },
      files,
    );
    expect(found.map((one) => one.where)).toEqual([
      'package.json dependencies',
    ]);
  });
});
