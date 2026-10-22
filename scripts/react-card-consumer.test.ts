import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/server';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { woff2Bytes } from '../apps/lit-host/e2e/asset-fixtures.js';
import {
  startTestHost,
  type TestHost,
} from '../packages/mcp/src/server/http-host.test-support.js';
import {
  prepareReactCardConsumer,
  REACT_CARD_BRANDS,
  reactCardConsumerSource,
} from './build-react-card-consumer.js';
import {
  buildConsumerApplication,
  bundleConsumerEntry,
  bundleConsumerServer,
  createWorkDirectory,
  linkDeclaredDependencies,
  repoRoot,
  unexpectedPackageFiles,
} from './packed-consumer.js';

// An application outside this repository installs the packed core, components, mcp and react
// packages and shows tool-result answers in the optional React FaithfulCard, as one self-contained
// resource per brand. This checks what that installation consists of, what the built artifacts hold
// and what the consumer's own MCP server serves; the built resource itself is exercised in a browser
// by apps/lit-host/e2e/react-card-consumer.spec.ts. Package installation is packed-tarball evidence:
// these commit-versioned candidate copies are private; this is not a registry install or release.

const work = createWorkDirectory('saga-react-card-consumer-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const ownCatalogSource = fileURLToPath(
  new URL(
    '../apps/lit-host/e2e/react-own-catalog-consumer/consumer.tsx',
    import.meta.url,
  ),
);
const insideRepository = (id: string): boolean =>
  id.startsWith(path.join(repoRoot, 'packages')) ||
  id.startsWith(path.join(repoRoot, 'apps'));
const sha256 = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

describe('the React card consumer built from the packed SDK packages', () => {
  const { consumer, sdk } = prepareReactCardConsumer(work);

  /** Every `from '…'` specifier of the consumer's authored files. */
  const specifiersOf = (directory: string): string[] =>
    fs
      .readdirSync(path.join(reactCardConsumerSource, directory))
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts'))
      .flatMap((name) =>
        [
          ...fs
            .readFileSync(
              path.join(reactCardConsumerSource, directory, name),
              'utf8',
            )
            .matchAll(/(?:from|import) '([^']+)'/g),
        ].map((match) => match[1] as string),
      );

  it('imports only public package exports and its own files: no source path, alias or copied SDK module', () => {
    const specifiers = [...specifiersOf('src'), ...specifiersOf('server')];
    const own = specifiers.filter((specifier) => specifier.startsWith('.'));
    // Siblings, the brand stylesheets and the assets next to the source: never a path into a package.
    expect(
      own.every((specifier) =>
        /^\.\/[a-z-]+\.js$|^\.\/brands\/[a-z]+\.css$|^\.\.\/assets\/[a-z-]+\.svg\?inline$|^\.\.\/src\/[a-z-]+\.js$|^\.\/card-view\.css$/.test(
          specifier,
        ),
      ),
    ).toBe(true);
    expect(
      [
        ...new Set(
          specifiers.filter((specifier) => !specifier.startsWith('.')),
        ),
      ].sort(),
    ).toEqual([
      '@modelcontextprotocol/ext-apps',
      '@modelcontextprotocol/server',
      '@saga-a2ui/components/faithful-card',
      '@saga-a2ui/mcp/server',
      '@saga-a2ui/mcp/view',
      '@saga-a2ui/react/faithful-card',
      '@saga-a2ui/react/faithful-card.css',
      'react',
      'react-dom/client',
      'zod',
    ]);
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(reactCardConsumerSource, 'package.json'),
        'utf8',
      ),
    );
    expect(
      Object.keys(manifest.dependencies).filter((name) =>
        name.startsWith('@a2ui/'),
      ),
    ).toEqual([]);
    expect(
      fs.existsSync(path.join(reactCardConsumerSource, 'node_modules')),
    ).toBe(false);
  });

  it('installs each package as a tarball with source and its manifest only, including the optional card and CSS exports', () => {
    expect(Object.keys(sdk.files).sort()).toEqual([
      'components',
      'core',
      'mcp',
      'react',
    ]);
    for (const [name, packed] of Object.entries(sdk.files)) {
      expect(unexpectedPackageFiles(name, packed), name).toEqual([]);
      expect(
        packed.filter((file) => /\.test(-support)?\.tsx?$/.test(file)),
        name,
      ).toEqual([]);
    }
    // Every public export the manifest names resolves to a file the tarball really carries.
    const exportsMap =
      (sdk.manifests.react as { exports?: Record<string, string> }).exports ??
      {};
    expect(Object.keys(exportsMap).sort()).toEqual([
      './a2ui',
      './actions',
      './faithful-card',
      './faithful-card.css',
    ]);
    for (const [subpath, target] of Object.entries(exportsMap)) {
      expect(sdk.files.react, subpath).toContain(target.replace(/^\.\//, ''));
      expect(
        fs.existsSync(
          path.join(consumer, 'node_modules', '@saga-a2ui', 'react', target),
        ),
        subpath,
      ).toBe(true);
    }
    expect(sdk.files.react).toContain('src/faithful-card/faithful-card.css');
    for (const hash of Object.values(sdk.tarballSha256))
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('declares the card as an optional peer: the React package depends on no components package, parser, Lit or delivery code', () => {
    const react = sdk.manifests.react!;
    expect(Object.keys(react.dependencies ?? {}).sort()).toEqual([
      '@a2ui/react',
      '@a2ui/web_core',
      '@saga-a2ui/core',
      'zod',
    ]);
    expect(react.peerDependencies).toEqual({
      '@saga-a2ui/components': sdk.version,
      react: '19.3.1',
      'react-dom': '19.3.1',
    });
    expect(react.peerDependenciesMeta).toEqual({
      '@saga-a2ui/components': { optional: true },
    });
    const components = sdk.manifests.components!;
    expect(Object.keys(components.dependencies ?? {}).sort()).toEqual([
      '@a2ui/web_core',
      '@saga-a2ui/core',
      'markdown-it',
      'zod',
    ]);
    expect(components.peerDependencies ?? {}).toEqual({});
  });

  // Dependency exclusion is shown on the built graph of an application that really builds, never
  // inferred from its imports.
  it('builds an application with its own catalog and no card, from the installed packages alone', async () => {
    const own = path.join(work, 'own-catalog');
    fs.mkdirSync(own);
    fs.copyFileSync(ownCatalogSource, path.join(own, 'consumer.tsx'));
    fs.cpSync(
      path.join(consumer, 'node_modules', '@saga-a2ui'),
      path.join(own, 'node_modules', '@saga-a2ui'),
      { recursive: true },
    );
    // The own-catalog application installs no components package: the optional peer stays uninstalled.
    fs.rmSync(path.join(own, 'node_modules', '@saga-a2ui', 'components'), {
      recursive: true,
    });
    fs.rmSync(path.join(own, 'node_modules', '@saga-a2ui', 'mcp'), {
      recursive: true,
    });
    linkDeclaredDependencies(
      own,
      {
        ...sdk,
        manifests: { core: sdk.manifests.core!, react: sdk.manifests.react! },
      },
      ['react', 'react-dom', '@a2ui/react', '@a2ui/web_core'],
    );

    const { modules, code } = await bundleConsumerEntry(own, 'consumer.tsx');
    expect(
      modules.some((id) =>
        id.includes(
          '/own-catalog/node_modules/@saga-a2ui/react/src/actions/action-button.tsx',
        ),
      ),
    ).toBe(true);
    expect(
      modules.some((id) =>
        id.includes('/own-catalog/node_modules/@saga-a2ui/core/src/actions/'),
      ),
    ).toBe(true);
    expect(modules.filter(insideRepository)).toEqual([]);
    expect(
      modules.filter((id) =>
        /\/@saga-a2ui\/(components|mcp|lit)\/|\/faithful-card\//.test(id),
      ),
    ).toEqual([]);
    expect(
      modules.filter((id) =>
        /node_modules\/(markdown-it|mdurl|linkify-it|uc\.micro|entities|@modelcontextprotocol)\//.test(
          id,
        ),
      ),
    ).toEqual([]);
    for (const marker of [
      'FaithfulCard',
      'faithful-card',
      'saga-card',
      'StreamableHTTP',
      'node:http',
    ])
      expect(code.includes(marker), marker).toBe(false);
  }, 120_000);

  /** The graph of one brand's entry, with the consumer's and the installed files named relative to the consumer. */
  async function graphOf(
    brand: string,
  ): Promise<{ modules: string[]; own: string[] }> {
    const { modules, code } = await bundleConsumerEntry(
      consumer,
      `src/main-${brand}.tsx`,
    );
    for (const marker of [
      'StreamableHTTP',
      'node:http',
      'registerPublicOperation',
    ])
      expect(code.includes(marker), `${brand} ${marker}`).toBe(false);
    const own = modules.flatMap((id) =>
      id.includes('/consumer/') && !id.includes('/node_modules/')
        ? [id.replace(/.*\/consumer\//, '')]
        : [],
    );
    return { modules, own };
  }

  it('builds both brands from the installed copies: the card, its parser and the shared connection, but no delivery or second renderer', async () => {
    const graphs = await Promise.all(REACT_CARD_BRANDS.map(graphOf));
    for (const { modules } of graphs) {
      const installed = (name: string) =>
        modules.some((id) => id.includes(`/consumer/node_modules/${name}`));
      for (const file of [
        '@saga-a2ui/react/src/faithful-card/card.tsx',
        '@saga-a2ui/react/src/faithful-card/catalog.tsx',
        '@saga-a2ui/react/src/faithful-card/faithful-card.css',
        '@saga-a2ui/components/src/faithful-card/reader.ts',
        '@saga-a2ui/core/src/protocols/a2ui/v0_9/session.ts',
        '@saga-a2ui/mcp/src/view/run-tool-result-view.ts',
      ]) {
        expect(installed(file), file).toBe(true);
      }
      expect(modules.some((id) => /node_modules\/markdown-it\//.test(id))).toBe(
        true,
      );
      expect(
        modules.some((id) =>
          /node_modules\/@modelcontextprotocol\/ext-apps\//.test(id),
        ),
      ).toBe(true);
      // Nothing from the workspace, no server or policy delivery code, no Lit renderer or second parser.
      expect(modules.filter(insideRepository)).toEqual([]);
      expect(
        modules.filter((id) =>
          /\/@saga-a2ui\/mcp\/src\/(server|policy)\//.test(id),
        ),
      ).toEqual([]);
      expect(
        modules.filter((id) =>
          /\/@saga-a2ui\/lit\/|\/@a2ui\/lit\/|node_modules\/@modelcontextprotocol\/(server|node)\//.test(
            id,
          ),
        ),
      ).toEqual([]);
      expect(
        modules.filter((id) =>
          /node_modules\/(marked|remark[^/]*|micromark[^/]*|showdown|dompurify|sanitize-html)\//.test(
            id,
          ),
        ),
      ).toEqual([]);
    }
  }, 180_000);

  it('uses one implementation for every brand: only the composition root, stylesheet and artwork differ', async () => {
    const [neutral, harbor] = await Promise.all(REACT_CARD_BRANDS.map(graphOf));
    const only = (from: string[], other: string[]) =>
      from.filter((id) => !other.includes(id)).sort();
    expect(only(neutral!.own, harbor!.own)).toEqual([
      'assets/neutral-mark.svg?inline',
      'src/brands/neutral.css',
      'src/main-neutral.tsx',
    ]);
    expect(only(harbor!.own, neutral!.own)).toEqual([
      'assets/harbor-mark.svg?inline',
      'src/brands/harbor.css',
      'src/main-harbor.tsx',
    ]);
    // Everything else, the installed SDK and the consumer's own implementation, is the same module list.
    const shared = neutral!.modules.filter((id) =>
      harbor!.modules.includes(id),
    );
    expect(
      shared.some((id) => id.endsWith('/consumer/src/card-view.tsx')),
    ).toBe(true);
    expect(
      shared.some((id) =>
        id.includes(
          '/consumer/node_modules/@saga-a2ui/react/src/faithful-card/card.tsx',
        ),
      ),
    ).toBe(true);
  }, 180_000);

  it('keeps the committed font files byte for byte the faces the specs measure, and the artwork as authored text', () => {
    for (const [file, family] of [
      ['neutral-mark.woff2', 'NeutralMark'],
      ['harbor-mark.woff2', 'HarborMark'],
    ] as const) {
      expect(
        fs
          .readFileSync(path.join(reactCardConsumerSource, 'assets', file))
          .equals(woff2Bytes(family)),
        file,
      ).toBe(true);
    }
    for (const file of ['neutral-mark.svg', 'harbor-mark.svg']) {
      const svg = fs.readFileSync(
        path.join(reactCardConsumerSource, 'assets', file),
        'utf8',
      );
      expect(svg, file).toMatch(
        /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+"/,
      );
      expect(svg, file).not.toMatch(
        /<script|<image|href=|xlink|@import|url\(/i,
      );
    }
  });

  // The built documents and the server the application serves them from.
  describe('built pages served over MCP from the installed mcp package', () => {
    interface Served {
      readonly pages: Record<(typeof REACT_CARD_BRANDS)[number], string>;
      readonly createCardServer: (
        html: string,
        settings: {
          filename: string;
          policyConfiguration: unknown;
          answer: (question: string) => Promise<{ markdown: string }>;
        },
      ) => McpServer;
    }
    let preparing: Promise<Served> | undefined;
    const prepared = (): Promise<Served> =>
      (preparing ??= (async () => {
        const out = path.join(work, 'pages');
        // The pages are production builds, as `npm run build` makes them; the test runner's own NODE_ENV would select development code.
        vi.stubEnv('NODE_ENV', 'production');
        try {
          for (const [index, brand] of REACT_CARD_BRANDS.entries()) {
            await buildConsumerApplication(consumer, out, [viteSingleFile()], {
              page: `${brand}.html`,
              emptyOutDir: index === 0,
            });
          }
        } finally {
          vi.unstubAllEnvs();
        }
        const { file } = await bundleConsumerServer(
          consumer,
          'server/card-server.ts',
        );
        const loaded = (await import(pathToFileURL(file).href)) as Pick<
          Served,
          'createCardServer'
        >;
        const pages = Object.fromEntries(
          REACT_CARD_BRANDS.map((brand) => [
            brand,
            fs.readFileSync(path.join(out, `${brand}.html`), 'utf8'),
          ]),
        ) as Served['pages'];
        return { pages, createCardServer: loaded.createCardServer };
      })());

    it('builds each page as one document: embedded runtime, stylesheet, artwork and font; no chunk, link, script source or external reference', async () => {
      const { pages } = await prepared();
      // Booleans carry the marker as their message, so a failure never prints a whole document.
      const absent = (text: string, pattern: RegExp, why: string): void =>
        expect(pattern.test(text), why).toBe(false);
      for (const brand of REACT_CARD_BRANDS) {
        const html = pages[brand];
        const scripts = [
          ...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g),
        ]
          .map((match) => match[1] as string)
          .join('\n');
        const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
          .map((match) => match[1] as string)
          .join('\n');
        const markup = html
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
        // The document's own markup holds no link, script source, image address or media element; its code and styles are inline.
        absent(markup, /<link\b/i, `${brand}: a <link> element`);
        absent(
          markup,
          /<(script|img|iframe|object|embed|audio|video|source)\b/i,
          `${brand}: an element that loads something`,
        );
        absent(html, /<script[^>]*\ssrc=/i, `${brand}: a script source`);
        absent(styles, /@import/, `${brand}: a stylesheet import`);
        // Every url() in the stylesheet is embedded bytes: the font and the banner artwork.
        const urls = [...styles.matchAll(/url\(\s*["']?([^"')]+)/g)].map(
          (match) => match[1] as string,
        );
        expect(urls.length, brand).toBe(2);
        expect(
          urls.every((url) =>
            /^data:(font\/woff2|image\/svg\+xml)[;,]/.test(url),
          ),
          `${brand}: ${urls.map((url) => url.slice(0, 24)).join()}`,
        ).toBe(true);
        // No static import or relative dynamic import survives for a missing chunk to satisfy.
        absent(
          scripts,
          /(^|[;}\s])import\s*(\{[^}]*\}|\*\s*as\s+\w+|\w+)\s*from\s*["'`]/,
          `${brand}: a static import`,
        );
        absent(
          scripts,
          /import\(\s*["'`]\.{0,2}\//,
          `${brand}: a relative dynamic import`,
        );
        // Production React, no server or delivery code, and no canned answer.
        expect(
          html.includes('Download the React DevTools'),
          `${brand}: React's development build`,
        ).toBe(false);
        for (const marker of [
          'StreamableHTTP',
          'node:http',
          'registerPublicOperation',
          'fixtureAnswers',
          'You asked:',
          'Dates and figs',
        ]) {
          expect(html.includes(marker), `${brand}: ${marker}`).toBe(false);
        }
        expect(
          html.includes('Waiting for the answer'),
          `${brand}: its neutral initial status`,
        ).toBe(true);
      }
      // The font bytes in each document are the committed font's bytes.
      for (const [brand, file] of [
        ['neutral', 'neutral-mark.woff2'],
        ['harbor', 'harbor-mark.woff2'],
      ] as const) {
        const font = fs
          .readFileSync(path.join(reactCardConsumerSource, 'assets', file))
          .toString('base64');
        expect(
          pages[brand].includes(`data:font/woff2;base64,${font}`),
          `${brand}: its font bytes`,
        ).toBe(true);
      }
    }, 180_000);

    // Derived here from the requirement (SHA-256 of the served bytes), not by the package's own function.
    const identityOf = (html: string, filename = 'neutral.html'): string =>
      `ui://views/${filename.slice(0, -5)}.${sha256(html).slice(0, 32)}.html`;
    const open: { host?: TestHost } = {};
    afterEach(async () => {
      await open.host?.close();
      open.host = undefined;
    });

    interface Reading {
      readonly uri: string;
      readonly html: string;
      readonly csp: unknown;
      readonly mimeType: string | undefined;
    }

    /** Serves `html` under `policyConfiguration` and reads back what a host would: the tool's link, the resource and a result. */
    async function serve(
      html: string,
      policyConfiguration: unknown,
      questions: readonly string[] = ['anything'],
      filename = 'neutral.html',
    ): Promise<Reading & { linked: string[] }> {
      const { createCardServer } = await prepared();
      open.host = await startTestHost({
        jsonResponse: true,
        buildServer: () =>
          createCardServer(html, {
            filename,
            policyConfiguration,
            answer: async (question) => ({
              markdown: `Answer to: ${question}`,
            }),
          }),
      });
      const client = await open.host.connect();
      const linked: string[] = [];
      for (const question of questions) {
        const result = await client.callTool({
          name: 'answer_question',
          arguments: { question },
        });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual({
          contractVersion: 1,
          markdown: `Answer to: ${question}`,
        });
        linked.push(
          (result._meta as { ui: { resourceUri: string } }).ui.resourceUri,
        );
      }
      const { tools } = await client.listTools();
      const uri = (tools[0]?._meta as { ui: { resourceUri: string } }).ui
        .resourceUri;
      const { contents } = await client.readResource({ uri });
      const served = contents[0] as {
        text: string;
        mimeType?: string;
        _meta?: { ui: { csp: unknown } };
      };
      await open.host.close();
      open.host = undefined;
      return {
        uri,
        html: served.text,
        csp: served._meta?.ui.csp,
        mimeType: served.mimeType,
        linked,
      };
    }

    const POLICIES = {
      standardEmpty: { level: 'standard' },
      strictEmpty: { level: 'strict' },
      standardListed: {
        level: 'standard',
        imageHosts: ['images.example.com'],
        fontOrigins: [
          'https://fonts.example.com',
          'https://fonts.example.com:8443',
        ],
      },
      strictListed: {
        level: 'strict',
        imageHosts: ['images.example.com'],
        fontOrigins: [
          'https://fonts.example.com',
          'https://fonts.example.com:8443',
        ],
      },
    } as const;
    const directive = (policy: string, name: string): string =>
      policy
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name} `)) ?? '';

    it.each([
      ['standardEmpty', 'img-src data: blob:', 'font-src data: blob:'],
      ['strictEmpty', 'img-src data:', 'font-src data:'],
      [
        'standardListed',
        'img-src data: blob: https://images.example.com',
        'font-src data: blob: https://fonts.example.com https://fonts.example.com:8443',
      ],
      [
        'strictListed',
        'img-src data: https://images.example.com',
        'font-src data: https://fonts.example.com https://fonts.example.com:8443',
      ],
    ] as const)(
      'serves %s with the exact document restrictions, the identity of those bytes and every result linked to it',
      async (name, images, fonts) => {
        const { pages } = await prepared();
        const reading = await serve(
          pages.harbor,
          POLICIES[name],
          ['first question', 'second question', 'a third, different question'],
          'harbor.html',
        );
        expect(reading.mimeType).toBe('text/html;profile=mcp-app');
        expect(reading.uri).toBe(identityOf(reading.html, 'harbor.html'));
        expect(reading.linked).toEqual([reading.uri, reading.uri, reading.uri]); // distinct answers reuse one resource

        const policies = [
          ...reading.html.matchAll(
            /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/g,
          ),
        ].map((match) => match[1] as string);
        expect(policies).toHaveLength(1);
        const documentPolicy = policies[0] as string;
        expect(directive(documentPolicy, 'img-src')).toBe(images);
        expect(directive(documentPolicy, 'font-src')).toBe(fonts);
        for (const closed of [
          'script-src',
          'style-src',
          'media-src',
          'connect-src',
          'frame-src',
          'object-src',
        ]) {
          expect(
            directive(documentPolicy, closed),
            `${name} ${closed}`,
          ).not.toMatch(/https:/);
        }
        // The document restrictions precede every script, and the policy configuration travels in the document.
        expect(
          reading.html.indexOf('http-equiv="Content-Security-Policy"'),
        ).toBeLessThan(reading.html.indexOf('<script type="module"'));
        const configuration = JSON.parse(
          /<script type="application\/json" id="saga-content-policy">([^<]+)<\/script>/.exec(
            reading.html,
          )?.[1] ?? 'null',
        ) as Record<string, unknown>;
        expect(configuration.level).toBe(POLICIES[name].level);
        // Only the configured origins are declared to the host, once each; the baseline needs no declaration.
        const declared = (
          reading.csp as { resourceDomains: string[]; connectDomains: string[] }
        ).resourceDomains;
        const listed =
          'imageHosts' in POLICIES[name]
            ? [
                'https://fonts.example.com',
                'https://fonts.example.com:8443',
                'https://images.example.com',
              ]
            : [];
        expect([...declared].sort()).toEqual(listed);
        expect(
          (reading.csp as { connectDomains: string[] }).connectDomains,
        ).toEqual([]);
      },
      120_000,
    );

    it('gives a document with any change a different resource and an unchanged document the same one', async () => {
      const { pages } = await prepared();
      const standard = await serve(pages.neutral, POLICIES.standardEmpty);
      expect(
        (
          await serve(pages.neutral, POLICIES.standardEmpty, [
            'other',
            'questions',
          ])
        ).uri,
      ).toBe(standard.uri); // an answer is never part of the document
      const identities = new Set([
        standard.uri,
        (await serve(pages.neutral, POLICIES.strictEmpty)).uri, // level
        (await serve(pages.neutral, POLICIES.standardListed)).uri, // origin lists
        (
          await serve(pages.neutral, {
            level: 'standard',
            fontOrigins: ['https://fonts.example.com'],
          })
        ).uri, // a font origin alone
        (
          await serve(
            pages.harbor,
            POLICIES.standardEmpty,
            undefined,
            'harbor.html',
          )
        ).uri, // brand: tokens, artwork and font bytes
        (
          await serve(
            pages.neutral.replace('</body>', '<!-- rebuilt --></body>'),
            POLICIES.standardEmpty,
          )
        ).uri, // one changed byte
      ]);
      expect(identities.size).toBe(6);
      expect(standard.uri).toBe(identityOf(standard.html));
    }, 180_000);

    it('refuses a policy configuration that does not validate, before serving anything', async () => {
      const { pages, createCardServer } = await prepared();
      for (const bad of [
        { level: 'lenient' },
        { fontOrigins: ['http://fonts.example.com'] },
        { fontOrigins: ['https://*.example.com'] },
      ]) {
        expect(() =>
          createCardServer(pages.neutral, {
            filename: 'neutral.html',
            policyConfiguration: bad,
            answer: async () => ({ markdown: '' }),
          }),
        ).toThrow();
      }
    }, 120_000);

    it('gets its server from installed package exports and its own files only: no workspace path, copied SDK code, renderer or card', async () => {
      const { modules } = await bundleConsumerServer(
        consumer,
        'server/card-server.ts',
      );
      for (const name of [
        'operation.ts',
        'operation-view.ts',
        'view-identity.ts',
      ]) {
        expect(
          modules.some((id) =>
            id.includes(
              `/consumer/node_modules/@saga-a2ui/mcp/src/server/${name}`,
            ),
          ),
          name,
        ).toBe(true);
      }
      expect(modules.filter(insideRepository)).toEqual([]);
      // It needs the components package only for the policy and its transport; no renderer, protocol decoder or Markdown parser.
      for (const name of ['policy.ts', 'policy-transport.ts']) {
        expect(
          modules.some((id) =>
            id.includes(
              `/consumer/node_modules/@saga-a2ui/components/src/faithful-card/${name}`,
            ),
          ),
          name,
        ).toBe(true);
      }
      expect(
        modules.filter((id) =>
          /\/@saga-a2ui\/(react|lit)\/|\/@a2ui\/|node_modules\/(react|react-dom|lit|markdown-it)\//.test(
            id,
          ),
        ),
      ).toEqual([]);
    }, 120_000);
  });
});
