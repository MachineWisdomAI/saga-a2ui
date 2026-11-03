import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import * as actions from '@saga-a2ui/core/actions';
import * as conversation from '@saga-a2ui/core/conversation';
import * as deliveredResult from '@saga-a2ui/core/delivered-result';
import type {
  ContentBlock,
  DeliveredResult,
} from '@saga-a2ui/core/delivered-result';
import * as hostLinks from '@saga-a2ui/core/host-links';
import * as a2uiV0_9 from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import {
  checkPackageDirection,
  directionViolations,
  readPackage,
} from '../../../scripts/package-direction.js';

// The package is consumed through its installed subpath exports, the way an application does, and
// the module graph behind the protocol export is bundled to show what a consumer really pulls in.

async function bundledModules(
  specifier: string,
): Promise<{ modules: string[] }> {
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
  return { modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)) };
}

describe('@saga-a2ui/core exports', () => {
  it('expose exactly the supported names for the A2UI v0.9 protocol', () => {
    expect(Object.keys(a2uiV0_9).sort()).toEqual([
      'a2uiV0_9Decoder',
      'createMessageSession',
      'defineSurface',
    ]);
    expect(typeof z.object).toBe('function');
  });

  it('import no renderer, MCP package or DOM runtime', async () => {
    const { modules } = await bundledModules(
      '@saga-a2ui/core/protocols/a2ui/v0_9',
    );
    expect(
      modules.some((id) =>
        id.endsWith('/packages/core/src/protocols/a2ui/v0_9/session.ts'),
      ),
    ).toBe(true); // the graph was really walked
    const forbidden =
      /node_modules\/(lit|lit-html|lit-element|@lit|@lit-labs|react|react-dom|jsdom|happy-dom|@modelcontextprotocol|@a2ui\/lit)\//;
    expect(modules.filter((id) => forbidden.test(id))).toEqual([]);
    expect(
      modules.filter(
        (id) => id.includes('/packages/lit/') || id.includes('/packages/mcp/'),
      ),
    ).toEqual([]);
  });

  it('expose a delivered-result contract that is types only and imports nothing', async () => {
    expect(Object.keys(deliveredResult)).toEqual([]);
    const { modules } = await bundledModules(
      '@saga-a2ui/core/delivered-result',
    );
    expect(modules.some((id) => id.endsWith('/delivered-result.ts'))).toBe(
      true,
    ); // the graph was really walked
    expect(modules.filter((id) => id.includes('node_modules'))).toEqual([]);
  });

  it('lets a delivered result keep every block, opaque ones as supplied, and distinguish absent, null and malformed structured data', () => {
    const image: ContentBlock = {
      type: 'image',
      data: 'AAAA',
      mimeType: 'image/png',
    };
    const text: ContentBlock = { type: 'text', text: '' };
    const absent: DeliveredResult = { isError: false, content: [text, image] };
    const nulled: DeliveredResult = { ...absent, structuredContent: null };
    const malformed: DeliveredResult = { ...absent, structuredContent: 'x' };
    expect('structuredContent' in absent).toBe(false);
    expect('structuredContent' in nulled).toBe(true);
    expect(nulled.structuredContent).toBeNull();
    expect(malformed.structuredContent).toBe('x');
    expect(absent.content[1]).toBe(image);
  });

  it('expose exactly the supported names for the host link contract, which imports nothing', async () => {
    expect(Object.keys(hostLinks).sort()).toEqual([
      'NO_HOST_LINKS',
      'describeLinkOutcome',
    ]);
    const { modules } = await bundledModules('@saga-a2ui/core/host-links');
    expect(modules.filter((id) => id.includes('node_modules'))).toEqual([]);
  });

  it('expose exactly the supported names for the conversation contract, which imports nothing', async () => {
    expect(Object.keys(conversation)).toEqual(['NO_CONVERSATION']);
    const { modules } = await bundledModules('@saga-a2ui/core/conversation');
    expect(modules.some((id) => id.endsWith('/conversation.ts'))).toBe(true); // the graph was really walked
    expect(modules.filter((id) => id.includes('node_modules'))).toEqual([]);
  });

  it('expose exactly the supported names for actions', () => {
    expect(Object.keys(actions).sort()).toEqual([
      'Action',
      'ActionError',
      'InvocationEndedError',
      'componentKind',
      'createInstanceHost',
      'prerequisite',
      'proceed',
      'refuse',
      'snapshotLimits',
    ]);
  });

  it('expose the renderer-neutral ActionButton contract, which refuses an action or a handler name', async () => {
    const contract =
      await import('@saga-a2ui/core/actions/action-button-schema');
    expect(Object.keys(contract)).toEqual(['ActionButtonApi']);
    const { ActionButtonApi } = contract;
    expect(ActionButtonApi.name).toBe('ActionButton');
    expect(ActionButtonApi.schema.safeParse({ child: 'label' }).success).toBe(
      true,
    );
    expect(
      ActionButtonApi.schema.safeParse({
        child: 'label',
        action: { event: { name: 'x' } },
      }).success,
    ).toBe(false);
    expect(
      ActionButtonApi.schema.safeParse({ child: 'label', handler: 'x' })
        .success,
    ).toBe(false);

    // It shares core's protocol dependencies and nothing renderer-shaped.
    const { modules } = await bundledModules(
      '@saga-a2ui/core/actions/action-button-schema',
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
  });

  it('keep the action module free of any renderer, MCP package or DOM runtime', async () => {
    const { modules } = await bundledModules('@saga-a2ui/core/actions');
    expect(
      modules.some((id) =>
        id.endsWith('/packages/core/src/actions/instance-host.ts'),
      ),
    ).toBe(true); // the graph was really walked
    // Server actions reach their server through the application's transport: the module for them is in the
    // graph, and nothing of any MCP package is.
    expect(
      modules.some((id) => id.endsWith('/packages/core/src/actions/server.ts')),
    ).toBe(true);
    const forbidden =
      /node_modules\/(lit|lit-html|lit-element|@lit|@lit-labs|react|react-dom|jsdom|happy-dom|@modelcontextprotocol|@a2ui)\//;
    expect(modules.filter((id) => forbidden.test(id))).toEqual([]);
    expect(
      modules.filter(
        (id) => id.includes('/packages/lit/') || id.includes('/packages/mcp/'),
      ),
    ).toEqual([]);
    expect(modules.filter((id) => id.includes('node_modules'))).toEqual([]); // the module needs no dependency at all
  });
});

describe('dependency direction', () => {
  it('imports no delivery, renderer or DOM, and no other SDK package', () => {
    const { files, violations } = checkPackageDirection('core');
    // The source was really read.
    expect(files).toBeGreaterThan(5);
    expect(violations).toEqual([]);
  });

  it.each([
    [
      "import { runToolResultView } from '@saga-a2ui/mcp/view';",
      'a delivery package',
    ],
    ["import { App } from '@modelcontextprotocol/ext-apps';", 'an MCP module'],
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
      const { manifest, files } = readPackage('core');
      const mutant = { path: 'src/mutant.ts', text: `${line}\n` };
      const found = directionViolations('core', manifest, [...files, mutant]);
      expect(found.map((one) => one.where)).toEqual(['src/mutant.ts']);
    },
  );

  it('allows pure code, and prose or names that only look like a browser object', () => {
    const { manifest } = readPackage('core');
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
    expect(directionViolations('core', manifest, [pure])).toEqual([]);
  });

  it('fails for a wrong-direction dependency declared in the manifest', () => {
    const { manifest, files } = readPackage('core');
    const wrong = 'react';
    const found = directionViolations(
      'core',
      { ...manifest, dependencies: { ...manifest.dependencies, [wrong]: '*' } },
      files,
    );
    expect(found.map((one) => one.where)).toEqual([
      'package.json dependencies',
    ]);
  });
});
