import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  NOTES_CONSUMERS,
  installedVersionsOf,
  preparePack1Consumer,
  type NotesConsumer,
} from './build-pack1-consumers.js';
import {
  bundleConsumerEntry,
  bundleConsumerServer,
  createWorkDirectory,
  installPackedSdk,
  linkDeclaredDependencies,
  repoRoot,
  unexpectedPackageFiles,
  type PackedManifest,
  type PackedSdk,
  type SdkPackage,
} from './packed-consumer.js';

// PACK1: what installing the SDK from its packed artifacts consists of, checked from the tarballs
// and from builds outside the repository. The browser behavior of the installed consumers (two Lit, one React) is
// qualified by apps/lit-host/e2e/pack1-consumers.spec.ts; this file checks the packages
// themselves: what they declare, what they ship, what each entry point may load, and that the
// consumers differ only where their renderer or the optional components are installed.
//
// Everything is local: tarballs are made with `npm pack` from a copy that carries the candidate
// prerelease identity (scripts/release-candidate.ts), and nothing is published, uploaded or
// installed from a registry.

/** A Node built-in imported by a browser bundle. A property that merely happens to be named `node` is not one. */
const NODE_IMPORT = /(?:from|import|require)\s*\(?\s*["']node:/;
const ALL_PACKAGES: readonly SdkPackage[] = [
  'core',
  'lit',
  'components',
  'mcp',
  'react',
  'lit-mcp-stack',
  'react-mcp-stack',
];
const work = createWorkDirectory('saga-pack1-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const installedDir = (consumer: string, name: string): string =>
  path.join(consumer, 'node_modules', '@saga-a2ui', name);

function filesUnder(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
}

/** The module specifiers a source file imports or re-exports, comments aside. */
function specifiersOf(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return [
    ...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g),
  ].map((match) => match[1] as string);
}

const packageNameOf = (specifier: string): string =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : (specifier.split('/')[0] as string);
const isBuiltin = (specifier: string): boolean =>
  specifier.startsWith('node:') ||
  builtinModules.includes(specifier.split('/')[0] as string);

describe('the seven owned packages, packed', () => {
  // One install of every owned package: the same copy `npm pack` produces for each, unpacked beside each other.
  const consumer = path.join(work, 'all');
  fs.mkdirSync(consumer);
  const sdk: PackedSdk = installPackedSdk(work, consumer, ALL_PACKAGES);
  const repoManifest = (name: string) =>
    JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, 'packages', name, 'package.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

  it('packs exactly the owned packages as private candidates with source, metadata and license obligations', () => {
    expect(
      fs
        .readdirSync(path.join(repoRoot, 'packages'))
        .filter((name) =>
          fs.existsSync(path.join(repoRoot, 'packages', name, 'package.json')),
        )
        .sort(),
    ).toEqual([...ALL_PACKAGES].sort());
    for (const name of ALL_PACKAGES) {
      if (name === 'lit' || name === 'lit-mcp-stack') {
        expect(repoManifest(name).private, name).toBe(true);
        expect(repoManifest(name).version, name).toBeUndefined();
      } else {
        expect(repoManifest(name).private, name).toBe(false);
        expect(repoManifest(name).version, name).toMatch(/^\d+\.\d+\.\d+/);
      }
      expect(sdk.manifests[name]?.name).toBe(`@saga-a2ui/${name}`);
      expect((sdk.manifests[name] as { license?: string }).license, name).toBe(
        'Apache-2.0',
      );
      // The staged copy carries the candidate prerelease identity (an unreleased build of one revision), never a release version.
      expect((sdk.manifests[name] as { version?: string }).version, name).toBe(
        sdk.version,
      );
      expect(sdk.version).toMatch(
        /^0\.0\.0-candidate\.g[0-9a-f]{12}(\.dirty)?$/,
      );
      expect(
        (sdk.manifests[name] as { private?: boolean }).private,
        `${name} stays unpublishable`,
      ).toBe(true);
      const shipped = sdk.files[name] ?? [];
      // Source, the manifest and the license obligations; the notices travel with the package that brings markdown-it into a consumer's view.
      expect(unexpectedPackageFiles(name, shipped), name).toEqual([]);
      expect(shipped, name).toContain('LICENSE');
      expect(shipped.includes('THIRD_PARTY_NOTICES.md'), name).toBe(
        name === 'components',
      );
      expect(
        shipped.filter((file) =>
          /\.test(-support)?\.tsx?$|\.test-support\./.test(file),
        ),
        name,
      ).toEqual([]);
    }
  });

  it('declares no workspace, file, link, git or relative dependency, and every SDK-to-SDK range is the exact candidate version of an installed copy', () => {
    const LEAK =
      /^(workspace:|file:|link:|portal:|git[+:]|github:|https?:|\.{1,2}\/|\/|~\/)/;
    for (const [name, manifest] of Object.entries(sdk.manifests)) {
      const m = manifest as PackedManifest & {
        optionalDependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const group of [
        m.dependencies,
        m.peerDependencies,
        m.optionalDependencies,
      ]) {
        for (const [dependency, range] of Object.entries(group ?? {})) {
          expect(range, `${name} -> ${dependency}`).not.toMatch(LEAK);
          // Exactly the candidate version: a sibling from any other build is refused by the package manager before anything renders.
          if (dependency.startsWith('@saga-a2ui/'))
            expect(range, `${name} -> ${dependency}`).toBe(sdk.version);
        }
      }
      // A packed manifest carries no development dependencies a consumer would need to resolve.
      expect(
        Object.keys(m.dependencies ?? {}).filter(
          (dependency) =>
            dependency.startsWith('@saga-a2ui/') &&
            !ALL_PACKAGES.includes(dependency.split('/')[1] as SdkPackage),
        ),
        name,
      ).toEqual([]);
    }
  });

  it('every export names a file that is in the tarball, and every relative import and resource in the shipped source resolves inside it', () => {
    for (const name of ALL_PACKAGES) {
      const root = installedDir(consumer, name);
      const exportsMap =
        (sdk.manifests[name] as { exports?: Record<string, string> }).exports ??
        {};
      expect(Object.keys(exportsMap).length, name).toBeGreaterThan(0);
      for (const [subpath, target] of Object.entries(exportsMap)) {
        expect(target, `${name} ${subpath}`).toMatch(/^\.\/src\//);
        expect(sdk.files[name], `${name} ${subpath} -> ${target}`).toContain(
          target.slice(2),
        );
        expect(
          fs.existsSync(path.join(root, target)),
          `${name} ${subpath}`,
        ).toBe(true);
      }
      const shipped = new Set(sdk.files[name]);
      for (const file of filesUnder(root).filter((one) =>
        /\.tsx?$/.test(one),
      )) {
        for (const specifier of specifiersOf(
          fs.readFileSync(file, 'utf8'),
        ).filter((one) => one.startsWith('.'))) {
          const resolved = path
            .relative(root, path.resolve(path.dirname(file), specifier))
            .split(path.sep)
            .join('/');
          const candidates = [
            resolved,
            resolved.replace(/\.js$/, '.ts'),
            resolved.replace(/\.js$/, '.tsx'),
          ];
          expect(
            candidates.some((one) => shipped.has(one)),
            `${name}: ${path.relative(root, file)} imports ${specifier}`,
          ).toBe(true);
        }
      }
    }
  });

  it('every bare import in the shipped source is a declared dependency or peer, or a public export of an owned package', () => {
    for (const name of ALL_PACKAGES) {
      const manifest = sdk.manifests[name] as PackedManifest;
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
      ]);
      for (const file of filesUnder(installedDir(consumer, name)).filter(
        (one) => /\.tsx?$/.test(one),
      )) {
        for (const specifier of specifiersOf(
          fs.readFileSync(file, 'utf8'),
        ).filter((one) => !one.startsWith('.') && !isBuiltin(one))) {
          const where = `${name}: ${path.relative(installedDir(consumer, name), file)} imports ${specifier}`;
          const dependency = packageNameOf(specifier);
          expect(declared.has(dependency), where).toBe(true);
          if (dependency.startsWith('@saga-a2ui/')) {
            // A public export of the package it names, not one of its files.
            const owner = sdk.manifests[dependency.split('/')[1] as string] as {
              exports?: Record<string, string>;
            };
            const subpath = `.${specifier.slice(dependency.length)}`;
            expect(Object.keys(owner.exports ?? {}), where).toContain(subpath);
          }
        }
      }
    }
  });

  it('keeps the version, peer, resource and catalog relationships explicit', () => {
    const range = (
      name: SdkPackage,
      kind: 'dependencies' | 'peerDependencies',
      dependency: string,
    ) =>
      (sdk.manifests[name]?.[kind] as Record<string, string> | undefined)?.[
        dependency
      ];
    // One upstream A2UI version, one MCP set, one Zod 4 and one Zod 3 alias, wherever they appear.
    for (const name of ['core', 'lit', 'components', 'react'] as const)
      expect(range(name, 'dependencies', '@a2ui/web_core'), name).toBe(
        '0.13.0',
      );
    expect(range('lit', 'dependencies', '@a2ui/lit')).toBe('0.13.0');
    expect(range('react', 'dependencies', '@a2ui/react')).toBe('0.13.0');
    expect(range('core', 'dependencies', 'zod3')).toBe('npm:zod@3.25.76');
    for (const name of ['components', 'mcp'] as const)
      expect(range(name, 'dependencies', 'zod'), name).toBe('4.6.7');
    for (const dependency of [
      '@modelcontextprotocol/client',
      '@modelcontextprotocol/core',
      '@modelcontextprotocol/server',
    ])
      expect(range('mcp', 'dependencies', dependency), dependency).toBe(
        '2.3.1',
      );
    expect(range('mcp', 'dependencies', '@modelcontextprotocol/ext-apps')).toBe(
      '2.0.3',
    );
    expect(range('components', 'dependencies', 'markdown-it')).toBe('15.0.3');
    // The optional component package is reachable from a renderer package only as an optional peer.
    for (const name of ['lit', 'react'] as const) {
      expect(
        range(name, 'peerDependencies', '@saga-a2ui/components'),
        name,
      ).toBe(sdk.version);
      expect(
        sdk.manifests[name]?.peerDependenciesMeta?.['@saga-a2ui/components'],
        name,
      ).toEqual({ optional: true });
      expect(
        range(name, 'dependencies', '@saga-a2ui/components'),
        name,
      ).toBeUndefined();
    }
    // The renderer-neutral and delivery packages name no renderer and no optional package at all.
    expect(Object.keys(sdk.manifests.core?.peerDependencies ?? {})).toEqual([]);
    expect(Object.keys(sdk.manifests.mcp?.peerDependencies ?? {})).toEqual([]);
    expect(
      Object.keys(sdk.manifests.components?.peerDependencies ?? {}),
    ).toEqual([]);
    // Delivery names core (the host link contract) and no component, renderer or parser.
    expect(
      Object.keys(sdk.manifests.mcp?.dependencies ?? {}).filter((dependency) =>
        /^@saga-a2ui\/|lit|react|markdown/.test(dependency),
      ),
    ).toEqual(['@saga-a2ui/core']);
    // The React peers are exact, and the Lit package has none.
    expect(sdk.manifests.react?.peerDependencies).toMatchObject({
      react: '19.3.1',
      'react-dom': '19.3.1',
    });
    expect(Object.keys(sdk.manifests.lit?.peerDependencies ?? {})).toEqual([
      '@saga-a2ui/components',
    ]);
    // Resources a consumer imports by name are exports, not file paths.
    expect(
      Object.keys(
        (sdk.manifests.react as { exports?: Record<string, string> }).exports ??
          {},
      ),
    ).toContain('./faithful-card.css');
    expect(sdk.files.react).toContain('src/faithful-card/faithful-card.css');
  });

  it('brings in none of the stacks this SDK does not use', () => {
    const forbidden = /(^|\/)(@?mcp-ui|@?copilotkit|@?ag-ui|@?ora)(\/|$)/;
    for (const [name, manifest] of Object.entries(sdk.manifests)) {
      const m = manifest as PackedManifest;
      for (const dependency of [
        ...Object.keys(m.dependencies ?? {}),
        ...Object.keys(m.peerDependencies ?? {}),
      ])
        expect(dependency, name).not.toMatch(forbidden);
    }
  });
});

describe('what an entry point may load, from the installed copies', () => {
  /** Third-party and SDK modules a bundle contains, by package. */
  const packagesIn = (modules: readonly string[]): string[] => {
    const found = new Set<string>();
    for (const id of modules) {
      const marker = `${path.sep}node_modules${path.sep}`;
      const at = id.lastIndexOf(marker);
      if (at < 0) continue;
      const parts = id.slice(at + marker.length).split(path.sep);
      found.add(
        parts[0]!.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!,
      );
    }
    return [...found].sort();
  };
  const RENDERER =
    /^(lit|lit-html|lit-element|@lit\/.*|@a2ui\/lit|@a2ui\/react|react|react-dom|@saga-a2ui\/lit|@saga-a2ui\/react)$/;
  const MCP = /^(@modelcontextprotocol\/.*|@saga-a2ui\/mcp)$/;

  /** A fresh consumer directory outside the repository with the named packed packages installed. */
  function install(
    label: string,
    packages: readonly SdkPackage[],
    own: readonly string[],
  ) {
    const directory = path.join(work, label);
    fs.mkdirSync(directory, { recursive: true });
    const sdk = installPackedSdk(work, directory, packages);
    linkDeclaredDependencies(directory, sdk, own);
    return { directory, sdk };
  }

  it('runs the server imports in plain Node without any renderer, and without a DOM', async () => {
    const { directory } = install(
      'server-only',
      ['mcp', 'core'],
      ['@modelcontextprotocol/server', 'zod'],
    );
    fs.writeFileSync(
      path.join(directory, 'entry.ts'),
      [
        "import { McpServer } from '@modelcontextprotocol/server';",
        "import { Action } from '@saga-a2ui/core/actions';",
        "import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';",
        "import { registerPublicOperation, viewUriForHtml } from '@saga-a2ui/mcp/server';",
        "import { z } from 'zod';",
        'export async function run() {',
        "  const server = new McpServer({ name: 'server-only', version: '0.0.0' });",
        "  registerPublicOperation(server, { name: 'read', title: 'Read', description: 'Reads.', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, input: z.object({}), output: z.strictObject({ ok: z.boolean() }), view: { uri: viewUriForHtml('<p></p>', 'test.html'), title: 'v', html: '<p></p>', csp: CLOSED_VIEW_CSP }, failures: { absent: 'a', unavailable: 'u', invalidOutput: 'i' }, handle: () => ({ kind: 'record', record: true }), project: () => ({ text: 'ok', data: { ok: true } }) });",
        "  const noDom = typeof document === 'undefined' && typeof window === 'undefined' && typeof HTMLElement === 'undefined';",
        '  return { noDom, action: typeof Action.local, csp: CLOSED_VIEW_CSP.connectDomains.length };',
        '}',
      ].join('\n'),
    );
    const { file, modules } = await bundleConsumerServer(directory, 'entry.ts');
    const found = packagesIn(modules);
    expect(
      found.filter(
        (name) => RENDERER.test(name) || /markdown|components/.test(name),
      ),
    ).toEqual([]);
    expect(
      modules.filter((id) => id.startsWith(path.join(repoRoot, 'packages'))),
    ).toEqual([]);
    const { run } = (await import(pathToFileURL(file).href)) as {
      run: () => Promise<{ noDom: boolean; action: string; csp: number }>;
    };
    expect(await run()).toEqual({ noDom: true, action: 'function', csp: 0 });
  }, 180_000);

  it('runs the neutral components and the action runtime in plain Node: no MCP, no renderer, no DOM', async () => {
    const { directory } = install('neutral', ['core', 'components'], ['zod']);
    fs.writeFileSync(
      path.join(directory, 'entry.ts'),
      [
        "import { Action, componentKind, createInstanceHost } from '@saga-a2ui/core/actions';",
        "import { createContentPolicy, createFaithfulCardReader, createImageConsentScope } from '@saga-a2ui/components/faithful-card';",
        'export async function run() {',
        "  const reader = createFaithfulCardReader({ dialect: 'commonmark', maxLength: 1000 });",
        "  const policy = createContentPolicy({ level: 'strict', imageHosts: [] });",
        "  if (!reader.ok || !policy.ok) throw new Error('settings were refused');",
        '  const read = reader.reader.read({ contractVersion: 1, markdown: "**bold** and [a link](https://example.com)" });',
        '  const refused = reader.reader.read({ contractVersion: 2, markdown: "x" });',
        '  const scope = createImageConsentScope();',
        "  const Kind = componentKind<{ readonly go: { readonly value: number } }>('Neutral');",
        '  const host = createInstanceHost({ onSetupError: (error) => { throw error; } });',
        '  const ran: number[] = [];',
        "  const action = Action.local<{ readonly value: number }>('go').input(() => 7).run(({ params }) => void ran.push(params)).build();",
        "  const instance = host.open({ kind: Kind, componentId: 'a', dataPath: '/', events: ['go'], isLive: () => true, read: () => undefined });",
        "  host.register((view) => view.watchById('a', Kind, (handle) => void handle.bindAction('go', action)));",
        "  const started = instance.activate('go', { value: 7 });",
        '  await new Promise((resolve) => setTimeout(resolve, 10));',
        "  const noDom = typeof document === 'undefined' && typeof window === 'undefined' && typeof HTMLElement === 'undefined';",
        '  host.close();',
        '  return { noDom, readOk: read.ok, refused: refused.ok === false ? refused.failure.kind : "accepted", scope: typeof scope.revokeAll, started, ran };',
        '}',
      ].join('\n'),
    );
    const { file, modules } = await bundleConsumerServer(directory, 'entry.ts');
    const found = packagesIn(modules);
    expect(
      found.filter((name) => RENDERER.test(name) || MCP.test(name)),
    ).toEqual([]);
    // markdown-it stays external to a Node bundle: it is the components package's declared dependency.
    expect(found).toEqual(['@saga-a2ui/components', '@saga-a2ui/core']);
    expect(
      modules.filter((id) => id.startsWith(path.join(repoRoot, 'packages'))),
    ).toEqual([]);
    const { run } = (await import(pathToFileURL(file).href)) as {
      run: () => Promise<Record<string, unknown>>;
    };
    expect(await run()).toEqual({
      noDom: true,
      readOk: true,
      refused: 'unsupported-version',
      scope: 'function',
      started: 'started',
      ran: [7],
    });
  }, 180_000);

  it('builds the browser side of an MCP view without Node or server code', async () => {
    const prepared = preparePack1Consumer(
      path.join(work, 'browser-side'),
      'own',
    );
    const { modules, code } = await bundleConsumerEntry(
      prepared.consumer,
      'src/main-own.ts',
    );
    const found = packagesIn(modules);
    expect(found).toEqual(
      expect.arrayContaining([
        '@saga-a2ui/core',
        '@saga-a2ui/lit',
        '@saga-a2ui/mcp',
        '@modelcontextprotocol/ext-apps',
        'lit',
      ]),
    );
    // The view connection only: no server, policy or listener module, no Node-only MCP package, no backend.
    expect(
      modules.filter((id) =>
        /\/@saga-a2ui\/mcp\/src\/(server|policy)\//.test(id),
      ),
    ).toEqual([]);
    expect(
      found.filter((name) =>
        /^@modelcontextprotocol\/(server|node)$/.test(name),
      ),
    ).toEqual([]);
    expect(modules.filter((id) => /\/consumer\/server\//.test(id))).toEqual([]);
    expect(code).not.toMatch(NODE_IMPORT);
    for (const marker of [
      'StreamableHTTP',
      'process.env',
      'registerProtectedOperation',
      'createFixtureBackend',
      'PRIVATE-FIELD-CANARY',
    ])
      expect(code, marker).not.toContain(marker);
  }, 180_000);
});

describe('the installed consumers', () => {
  const prepared = {} as Record<
    NotesConsumer,
    ReturnType<typeof preparePack1Consumer>
  >;
  for (const name of Object.keys(NOTES_CONSUMERS) as NotesConsumer[])
    prepared[name] = preparePack1Consumer(
      path.join(work, `consumer-${name}`),
      name,
    );
  const built: Partial<
    Record<
      NotesConsumer,
      {
        modules: string[];
        code: string;
        server: { file: string; modules: string[] };
      }
    >
  > = {};

  async function buildOf(name: NotesConsumer) {
    const consumer = prepared[name].consumer;
    built[name] ??= {
      ...(await bundleConsumerEntry(consumer, NOTES_CONSUMERS[name].entry)),
      server: await bundleConsumerServer(consumer, 'server/index.ts'),
    };
    return built[name]!;
  }

  it('are installed apart, each from its own tarballs; each stack brings the components package along, and the React consumer has no Lit', () => {
    const litSet = ['components', 'core', 'lit', 'lit-mcp-stack', 'mcp'];
    expect(Object.keys(prepared.own.sdk.manifests).sort()).toEqual(litSet);
    expect(Object.keys(prepared.card.sdk.manifests).sort()).toEqual(litSet);
    expect(Object.keys(prepared.react.sdk.manifests).sort()).toEqual([
      'components',
      'core',
      'mcp',
      'react',
      'react-mcp-stack',
    ]);
    expect(prepared.own.consumer).not.toBe(prepared.card.consumer);
    expect(prepared.react.consumer).not.toBe(prepared.own.consumer);
    // A stack declares the components package so its card entry works after one install; the own
    // catalog's emitted bundle and runtime graph still exclude it (checked on the built pages below).
    for (const name of ['own', 'card', 'react'] as const)
      expect(
        fs.existsSync(installedDir(prepared[name].consumer, 'components')),
        name,
      ).toBe(true);
    expect(fs.existsSync(installedDir(prepared.react.consumer, 'lit'))).toBe(
      false,
    );
    for (const lit of ['lit', '@lit', '@a2ui/lit'])
      expect(
        fs.existsSync(path.join(prepared.react.consumer, 'node_modules', lit)),
        lit,
      ).toBe(false);
    // The same bytes for the packages they install in common.
    for (const shared of ['core', 'lit', 'mcp'])
      expect(prepared.own.sdk.tarballSha256[shared], shared).toBe(
        prepared.card.sdk.tarballSha256[shared],
      );
    for (const shared of ['core', 'mcp'])
      expect(prepared.react.sdk.tarballSha256[shared], shared).toBe(
        prepared.own.sdk.tarballSha256[shared],
      );
    // Each copy of the source holds only the files its own build uses.
    expect(
      fs.existsSync(path.join(prepared.own.consumer, 'src', 'main-card.ts')),
    ).toBe(false);
    expect(fs.existsSync(path.join(prepared.own.consumer, 'card.html'))).toBe(
      false,
    );
    expect(
      fs.existsSync(path.join(prepared.card.consumer, 'src', 'main-own.ts')),
    ).toBe(false);
    for (const lit of ['own', 'card'] as const) {
      for (const react of [
        'react.html',
        'src/main-react.tsx',
        'src/notes-react-view.tsx',
        'src/notes-react-catalog.tsx',
      ])
        expect(
          fs.existsSync(path.join(prepared[lit].consumer, react)),
          `${lit}: ${react}`,
        ).toBe(false);
    }
    for (const lit of [
      'own.html',
      'card.html',
      'src/main-own.ts',
      'src/main-card.ts',
      'src/notes-view.ts',
      'src/notes-catalog.ts',
    ])
      expect(
        fs.existsSync(path.join(prepared.react.consumer, lit)),
        `react: ${lit}`,
      ).toBe(false);
    // Only public exports and the consumer's own files are imported, by anything in any copy.
    for (const name of ['own', 'card', 'react'] as const) {
      const consumer = prepared[name].consumer;
      for (const file of filesUnder(consumer).filter(
        (one) =>
          /\.tsx?$/.test(one) &&
          !one.includes(`${path.sep}node_modules${path.sep}`),
      )) {
        for (const specifier of specifiersOf(fs.readFileSync(file, 'utf8'))) {
          if (specifier.startsWith('.')) {
            expect(
              path
                .resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'))
                .startsWith(consumer),
              `${name}: ${specifier}`,
            ).toBe(true);
          } else if (specifier.startsWith('@saga-a2ui/')) {
            const owner = prepared[name].sdk.manifests[
              specifier.split('/')[1] as string
            ] as { exports?: Record<string, string> } | undefined;
            expect(
              owner,
              `${name}: ${specifier} is not installed`,
            ).toBeDefined();
            expect(
              Object.keys(owner?.exports ?? {}),
              `${name}: ${specifier}`,
            ).toContain(`.${specifier.slice(packageNameOf(specifier).length)}`);
          } else {
            expect(
              [...NOTES_CONSUMERS[name].ownDependencies, 'vite'].includes(
                packageNameOf(specifier),
              ),
              `${name}: ${specifier}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it('install the React consumer on the pinned upstream pair: @a2ui/react and @a2ui/web_core 0.13.0, React and React DOM 19.3.1, not the 0.14.0 the proposal inspected', () => {
    const versions = installedVersionsOf(
      prepared.react.consumer,
      NOTES_CONSUMERS.react.ownDependencies,
    );
    expect(versions).toMatchObject({
      '@a2ui/react': '0.13.0',
      '@a2ui/web_core': '0.13.0',
      react: '19.3.1',
      'react-dom': '19.3.1',
    });
    // The packed react package declares the same upstream pair and the same React peers, so a consumer cannot resolve another.
    const manifest = prepared.react.sdk.manifests.react!;
    expect(manifest.dependencies).toMatchObject({
      '@a2ui/react': '0.13.0',
      '@a2ui/web_core': '0.13.0',
    });
    expect(manifest.peerDependencies).toMatchObject({
      react: '19.3.1',
      'react-dom': '19.3.1',
    });
    expect(
      manifest.peerDependenciesMeta?.['@saga-a2ui/components']?.optional,
    ).toBe(true);
  });

  it('build from the installed copies alone, and only the second carries the optional parser, catalog entry and element', async () => {
    const own = await buildOf('own');
    const card = await buildOf('card');
    const react = await buildOf('react');
    for (const [name, one] of [
      ['own', own],
      ['card', card],
      ['react', react],
    ] as const) {
      expect(
        one.modules.filter(
          (id) =>
            id.startsWith(path.join(repoRoot, 'packages')) ||
            id.startsWith(path.join(repoRoot, 'apps')),
        ),
        name,
      ).toEqual([]);
      const renderer = name === 'react' ? 'react' : 'lit';
      expect(
        one.modules.some((id) =>
          id.includes(
            `/consumer-${name}/consumer/node_modules/@saga-a2ui/${renderer}/src/actions/`,
          ),
        ),
        name,
      ).toBe(true);
      expect(
        one.modules.some((id) =>
          id.includes(
            `/consumer-${name}/consumer/node_modules/@saga-a2ui/core/src/actions/`,
          ),
        ),
        name,
      ).toBe(true);
      expect(
        one.modules.some((id) => /\/consumer\/src\/row-holds\.ts$/.test(id)),
        name,
      ).toBe(true);
      expect(one.code, name).not.toMatch(NODE_IMPORT);
      // React's own build flag (`process.env.NODE_ENV`) is replaced when an application builds; any other use is Node code.
      const code = one.code.replaceAll('process.env.NODE_ENV', '');
      for (const marker of [
        'StreamableHTTP',
        'process.env',
        'PRIVATE-FIELD-CANARY',
      ])
        expect(code, `${name}: ${marker}`).not.toContain(marker);
    }
    // First consumer: no optional component, no parser, no card element, no catalog entry.
    expect(
      own.modules.filter((id) =>
        /\/@saga-a2ui\/components\/|\/faithful-card\/|node_modules\/(markdown-it|mdurl|uc\.micro|linkify-it|entities|punycode)/.test(
          id,
        ),
      ),
    ).toEqual([]);
    // (`html_block` is the parser's own rule name; the bare package name also appears in upstream's optional-peer wording.)
    for (const marker of ['FaithfulCard', 'saga-faithful-card', 'html_block'])
      expect(own.code, marker).not.toContain(marker);
    // Second consumer: the same application code plus the card, the parser and the components package.
    for (const needle of [
      '/@saga-a2ui/components/src/faithful-card/reader.ts',
      '/@saga-a2ui/lit/src/faithful-card/faithful-card-element.ts',
    ]) {
      expect(
        card.modules.some((id) => id.includes(needle)),
        needle,
      ).toBe(true);
    }
    expect(
      card.modules.some((id) => id.includes('node_modules/markdown-it/')),
    ).toBe(true);
    expect(card.code).toContain('saga-faithful-card');
    // React consumer: the application's React catalog over the installed react package, with the shared
    // contract, controller and actions, and none of the other renderer, the optional components or the parser.
    for (const needle of [
      '/@saga-a2ui/react/src/actions/action-button.tsx',
      '/@saga-a2ui/react/src/actions/instance-host.tsx',
      '/consumer/src/notes-react-view.tsx',
      '/consumer/src/notes-controller.ts',
      'node_modules/react-dom/',
    ]) {
      expect(
        react.modules.some((id) => id.includes(needle)),
        needle,
      ).toBe(true);
    }
    expect(
      react.modules.filter((id) =>
        /node_modules\/(@a2ui\/lit|markdown-it)\/|\/@saga-a2ui\/(lit|components)\/|\/faithful-card\/|\/consumer\/src\/(notes-view|notes-catalog)\.ts$/.test(
          id,
        ),
      ),
    ).toEqual([]);
    for (const marker of ['FaithfulCard', 'saga-faithful-card', 'html_block'])
      expect(react.code, marker).not.toContain(marker);
    // Lit's runtime is in the React graph, but not through SAGA or the application: upstream `@a2ui/react` 0.13.0 imports
    // `@a2ui/web_core/v0_9/basic_catalog`, which loads web_core's Lit-based markdown directive. Nothing owned imports it.
    const litRuntime = react.modules.filter((id) =>
      /node_modules\/(lit|lit-html|@lit)\//.test(id),
    );
    expect(litRuntime.length).toBeGreaterThan(0);
    expect(
      react.modules.some((id) =>
        id.endsWith(
          '/@a2ui/web_core/src/universal/basic_catalog/directives/markdown.js',
        ),
      ),
    ).toBe(true);
    const owned = react.modules.filter(
      (id) =>
        id.includes('/consumer/src/') ||
        id.includes('/node_modules/@saga-a2ui/'),
    );
    expect(owned.length).toBeGreaterThan(0);
    for (const id of owned)
      expect(fs.readFileSync(id, 'utf8'), id).not.toMatch(
        /from\s+['"](?:lit|@lit)[/'"]/,
      );
    // The Lit consumers hold no React.
    for (const one of [own, card])
      expect(
        one.modules.filter((id) =>
          /node_modules\/(react|react-dom)\/|\/@saga-a2ui\/react\/|\/@a2ui\/react\//.test(
            id,
          ),
        ),
      ).toEqual([]);
    // None reaches for the stacks this SDK does not use.
    for (const one of [own, card, react])
      expect(
        one.modules.filter((id) =>
          /node_modules\/(@?mcp-ui|@?copilotkit|@?ag-ui|@?ora)\//.test(id),
        ),
      ).toEqual([]);
  }, 240_000);

  it('serve with the identical server: one authorization and disclosure boundary, and no renderer or optional package in it', async () => {
    const own = await buildOf('own');
    const card = await buildOf('card');
    const react = await buildOf('react');
    // Same application source, same packed mcp tarball: the bundled servers are byte for byte the same,
    // whichever renderer the consumer's view uses. (They differ only in the comment that names each scratch directory.)
    const withoutRegionComments = (file: string) =>
      fs.readFileSync(file, 'utf8').replace(/^\/\/#(?:end)?region.*$/gm, '');
    expect(withoutRegionComments(own.server.file)).toBe(
      withoutRegionComments(card.server.file),
    );
    expect(withoutRegionComments(react.server.file)).toBe(
      withoutRegionComments(own.server.file),
    );
    for (const one of [own, card, react]) {
      expect(
        one.server.modules.filter((id) =>
          /node_modules\/(lit|lit-html|@lit|@a2ui|markdown-it|react)\/|\/@saga-a2ui\/(lit|components|react|core)\//.test(
            id,
          ),
        ),
      ).toEqual([]);
      expect(
        one.server.modules.filter(
          (id) =>
            id.startsWith(path.join(repoRoot, 'packages')) ||
            id.startsWith(path.join(repoRoot, 'apps')),
        ),
      ).toEqual([]);
      for (const needle of [
        '/@saga-a2ui/mcp/src/server/operation.ts',
        '/consumer/server/notes-server.ts',
      ])
        expect(
          one.server.modules.some((id) => id.includes(needle)),
          needle,
        ).toBe(true);
    }
  }, 240_000);
});
