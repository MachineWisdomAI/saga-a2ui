import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildRelease,
  checkReleases,
  gitTree,
  readSpec,
  releaseVersions,
  routeInventory,
  withNavigation,
  type ReleaseSpec,
  type SourceTree,
} from './docs-release.js';
import {
  deriveComponent,
  excerpt,
  exportedNames,
} from './docs-release/catalog.js';
import {
  anchorsOf,
  convertGuide,
  fencedBlocks,
  unverifiedAnchorCharacters,
  type ConvertContext,
} from './docs-release/convert.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVISION = 'a'.repeat(40);

// The conversion keeps what the SDK documented and changes only what MDX rejects or what stops
// working outside the repository. These checks use small synthetic sources; the committed
// releases are checked against the real pinned revisions further down.

function context(overrides: Partial<ConvertContext> = {}): ConvertContext {
  return {
    sourcePath: 'docs/guide.md',
    routeOf: (repoPath) =>
      repoPath === 'docs/other.md'
        ? '/docs/releases/1.0.0/guides/other'
        : undefined,
    kindOf: (repoPath) =>
      repoPath === 'packages/README.md' || repoPath === 'docs/other.md'
        ? 'file'
        : repoPath === 'packages'
          ? 'dir'
          : repoPath === 'docs/images/board.png' ||
              repoPath === 'diagrams/a.svg'
            ? 'file'
            : 'missing',
    sourceUrl: (repoPath, kind) => `https://example.test/${kind}/${repoPath}`,
    imageUrl: (repoPath) => `https://img.test/${repoPath}`,
    ...overrides,
  };
}

describe('converting a guide for Mintlify', () => {
  it('keeps fenced code blocks exactly as written, including braces, angle brackets and nested fences', () => {
    const source = [
      '# Title',
      '',
      'Before.',
      '',
      '```ts examples/a.ts',
      'const a = { b: <T>(x: T) => x }; // <!-- not a comment -->',
      '```',
      '',
      '````md',
      '```json',
      '{ "a": 1 }',
      '```',
      '````',
      '',
      '~~~',
      '<div>{x}</div>',
      '~~~',
      '',
    ].join('\n');
    const converted = convertGuide(source, context());
    expect(fencedBlocks(converted.body)).toEqual(fencedBlocks(source));
    expect(converted.body).toContain('<!-- not a comment -->');
  });

  it('takes the first level-one heading as the title and leaves other headings alone', () => {
    const converted = convertGuide(
      '# The `title`\n\nText\n\n## Section\n',
      context(),
    );
    expect(converted.title).toBe('The title');
    expect(converted.body).toBe('Text\n\n## Section\n');
    expect(() => convertGuide('## Only\n', context())).toThrow(/level-one/);
  });

  it('escapes what MDX would read as code or markup, outside code spans', () => {
    const converted = convertGuide(
      '# T\n\nUse {value} and 3 < 4, not `{value}` or `<T>`. Break<br>here.\n',
      context(),
    );
    expect(converted.body).toBe(
      'Use \\{value\\} and 3 &lt; 4, not `{value}` or `<T>`. Break<br />here.\n',
    );
  });

  it('removes HTML comments, including multi-line ones', () => {
    const converted = convertGuide(
      '# T\n\n<!-- one -->\nKept <!-- two --> text\n<!--\nthree\n-->\nEnd\n',
      context(),
    );
    expect(converted.body).toBe('Kept  text\nEnd\n');
  });

  it('turns autolinks into links', () => {
    const converted = convertGuide(
      '# T\n\nSee <https://example.test/a?b=1>.\n',
      context(),
    );
    expect(converted.body).toContain(
      '[https://example.test/a?b=1](https://example.test/a?b=1)',
    );
  });

  it('points links at the release page, the pinned source or the pinned image', () => {
    const converted = convertGuide(
      [
        '# T',
        '',
        '[page](other.md#part) [file](../packages/README.md#x) [dir](../packages) [ext](https://x.test/y#z) [here](#local)',
        '',
        '![board](images/board.png) ![diagram](../diagrams/a.svg)',
      ].join('\n'),
      context({
        kindOf: (repoPath) =>
          repoPath === 'docs/images/board.png' || repoPath === 'diagrams/a.svg'
            ? 'file'
            : context().kindOf(repoPath),
      }),
    );
    expect(converted.body).toContain(
      '[page](/docs/releases/1.0.0/guides/other#part)',
    );
    expect(converted.body).toContain(
      '[file](https://example.test/file/packages/README.md#x)',
    );
    expect(converted.body).toContain(
      '[dir](https://example.test/dir/packages)',
    );
    expect(converted.body).toContain(
      '[ext](https://x.test/y#z) [here](#local)',
    );
    expect(converted.body).toContain(
      '![board](https://img.test/docs/images/board.png)',
    );
    expect(converted.body).toContain(
      '![diagram](https://img.test/diagrams/a.svg)',
    );
    expect(converted.brokenLinks).toEqual([]);
  });

  it('reports a relative link whose target does not exist at the revision', () => {
    const converted = convertGuide('# T\n\n[gone](missing.md)\n', context());
    expect(converted.brokenLinks).toEqual(['missing.md']);
  });

  it('refuses a fence that is never closed', () => {
    expect(() => convertGuide('# T\n\n```ts\ncode\n', context())).toThrow(
      /not closed/,
    );
  });
});

describe('heading anchors as Mintlify renders them', () => {
  it('keeps @ / + and a typographic apostrophe, drops commas and code marks', () => {
    expect(
      anchorsOf([
        '`@saga-a2ui/react/actions`',
        'Alexa+',
        "Replacing selectors that reached into the card's markup",
        'The steps, whichever server you use',
      ]),
    ).toEqual([
      '@saga-a2ui/react/actions',
      'alexa+',
      'replacing-selectors-that-reached-into-the-card\u2019s-markup',
      'the-steps-whichever-server-you-use',
    ]);
  });

  it('numbers a repeated heading from 2 and leaves the first plain', () => {
    expect(anchorsOf(['Same', 'Same', 'Same'])).toEqual([
      'same',
      'same-2',
      'same-3',
    ]);
  });

  it('reports characters whose anchor form has not been observed', () => {
    expect(unverifiedAnchorCharacters('What is `x`?')).toEqual(['?']);
    expect(unverifiedAnchorCharacters('Plain, with `@scope/name`.')).toEqual(
      [],
    );
  });
});

describe('the exported names of an entry point', () => {
  it('separates values from types and honors renames', () => {
    const names = exportedNames(
      [
        '// export { Hidden } from "./hidden.js";',
        "export { A, type B, C as D } from './a.js';",
        "export type { E } from './e.js';",
        'export const F = 1;',
        'export function G() {}',
        'export class H {}',
        'export interface I {}',
        'export type J = string;',
      ].join('\n'),
    );
    expect(names.values).toEqual(['A', 'D', 'F', 'G', 'H']);
    expect(names.types).toEqual(['B', 'E', 'I', 'J']);
  });

  it('refuses a wildcard export, which would hide what is public', () => {
    expect(() => exportedNames("export * from './x.js';")).toThrow(/export \*/);
  });
});

describe('an excerpt of a source file', () => {
  const source = [
    '  {',
    '    id: "a",',
    '    x: 1,',
    '  },',
    '  {',
    '    id: "b",',
  ].join('\n');

  it('copies the matching lines, with enclosing lines on request, without the common indent', () => {
    expect(excerpt(source, 'id: "a",', 'x: 1,', 1, 1)).toBe(
      '{\n  id: "a",\n  x: 1,\n},',
    );
  });

  it('fails when the source no longer contains the lines', () => {
    expect(() => excerpt(source, 'id: "zzz",', 'x: 1,')).toThrow(
      /start not found/,
    );
    expect(() => excerpt(source, 'id: "a",', 'nope')).toThrow(/end not found/);
  });
});

// A synthetic repository at one revision.
function tree(files: Record<string, string>): SourceTree {
  return {
    read: (repoPath) => {
      const text = files[repoPath];
      if (text === undefined) throw new Error(`No ${repoPath}`);
      return text;
    },
    kind: (repoPath) =>
      files[repoPath] !== undefined
        ? 'file'
        : Object.keys(files).some((name) => name.startsWith(`${repoPath}/`))
          ? 'dir'
          : 'missing',
  };
}

const manifest = (name: string, version: string, exportsMap: object) =>
  JSON.stringify({ name, version, exports: exportsMap });

const FILES: Record<string, string> = {
  'docs/one.md':
    '# One\n\nSee [two](two.md#second-part) and [source](../packages/ui/src/index.ts).\n\n```sh\nnpm i\n```\n',
  'docs/two.md': '# Two\n\n## Second part\n\nBack to [one](one.md).\n',
  'packages/ui/package.json': manifest('@saga-a2ui/ui', '1.0.0', {
    './card': './src/card.ts',
  }),
  'packages/ui/src/card.ts':
    "export { Card } from './x.js';\nexport type { CardProps } from './x.js';\n",
  'packages/ui/src/index.ts': 'export const ui = 1;\n',
  'examples/card.ts': 'const card = {\n  id: "c",\n} as const;\n',
};

const SPEC: ReleaseSpec = {
  version: '1.0.0',
  channel: 'stable',
  revision: REVISION,
  packages: { '@saga-a2ui/ui': '1.0.0' },
  authored: [{ page: 'installation', group: 'Start' }],
  guides: [
    {
      source: 'docs/one.md',
      slug: 'one',
      group: 'Guides',
      description: 'One.',
    },
    {
      source: 'docs/two.md',
      slug: 'two',
      group: 'Guides',
      description: "Two's.",
    },
  ],
  exclusions: [],
  components: [
    {
      id: 'card',
      name: 'Card',
      summary: 'A card.',
      entries: [
        { package: '@saga-a2ui/ui', subpath: './card', role: 'Rendering' },
      ],
      preview: {
        caption: 'The card.',
        source: 'examples/card.ts',
        from: 'const card = {',
        to: '} as const;',
        language: 'ts',
      },
      usage: [{ label: 'One', guide: 'one' }],
      qualification: [{ statement: 'No qualification is recorded.' }],
    },
  ],
  componentExclusions: [{ name: 'Other', reason: 'Not a component.' }],
};

describe('building a release', () => {
  const built = buildRelease(SPEC, tree(FILES));

  it('writes one page per guide with the version, revision, license and a rewritten link', () => {
    const one = built.files.get('guides/one.mdx')!;
    expect(one).toContain("title: 'One'");
    expect(one).toContain(REVISION);
    expect(one).toContain('**1.0.0** (stable)');
    expect(one).toContain('Apache-2.0');
    expect(one).toContain('(/docs/releases/1.0.0/guides/two#second-part)');
    expect(one).toContain(
      `(https://github.com/MachineWisdomAI/saga-a2ui/blob/${REVISION}/packages/ui/src/index.ts)`,
    );
    expect(fencedBlocks(one)).toEqual(fencedBlocks(FILES['docs/one.md']!));
    expect(built.files.get('guides/two.mdx')).toContain(
      "description: 'Two''s.'",
    );
  });

  it('derives the catalog from the package manifest and entry point', () => {
    const catalog = JSON.parse(built.files.get('components/catalog.json')!) as {
      release: { version: string; revision: string };
      components: {
        id: string;
        route: string;
        entries: {
          import: string;
          version: string | null;
          exports: { values: string[]; types: string[] };
        }[];
        preview: { code: string };
        qualification: { statement: string; route: string | null }[];
      }[];
    };
    expect(catalog.release).toMatchObject({
      version: '1.0.0',
      revision: REVISION,
    });
    const card = catalog.components[0]!;
    expect(card.route).toBe('/docs/releases/1.0.0/components/card');
    expect(card.entries[0]).toMatchObject({
      import: '@saga-a2ui/ui/card',
      version: '1.0.0',
      exports: { values: ['Card'], types: ['CardProps'] },
    });
    expect(card.preview.code).toBe('const card = {\n  id: "c",\n} as const;');
    expect(card.qualification).toEqual([
      { statement: 'No qualification is recorded.', route: null },
    ]);
    expect(built.files.get('components/index.mdx')).toContain('Other.');
  });

  it('lists authored pages, guides, components and the assistants page in navigation order', () => {
    expect(built.groups).toEqual([
      { group: 'Start', pages: ['docs/releases/1.0.0/installation'] },
      {
        group: 'Guides',
        pages: [
          'docs/releases/1.0.0/guides/one',
          'docs/releases/1.0.0/guides/two',
        ],
      },
      {
        group: 'Components',
        pages: [
          'docs/releases/1.0.0/components/index',
          'docs/releases/1.0.0/components/card',
        ],
      },
      {
        group: 'Use these docs with assistants',
        pages: ['docs/connect/assistants'],
      },
    ]);
  });

  it('marks a package that has no registry release instead of claiming one', () => {
    const unpublished = buildRelease({ ...SPEC, packages: {} }, tree(FILES));
    expect(unpublished.files.get('components/card.mdx')).toContain(
      'Not published to npm at this release',
    );
  });

  it('refuses a link to a file that is not in the pinned source', () => {
    const files = { ...FILES, 'docs/one.md': '# One\n\n[gone](nothing.md)\n' };
    expect(() => buildRelease(SPEC, tree(files))).toThrow(/nothing\.md/);
  });

  it('refuses a catalog entry the package does not export, or a version the source does not have', () => {
    const entry = (subpath: string) => ({
      ...SPEC.components[0]!,
      entries: [{ package: '@saga-a2ui/ui', subpath, role: 'r' }],
    });
    const reader = {
      read: tree(FILES).read,
      exists: () => true,
    };
    const url = (repoPath: string) => repoPath;
    expect(() =>
      deriveComponent(entry('./missing'), SPEC.packages, reader, url),
    ).toThrow(/does not export \.\/missing/);
    expect(() =>
      deriveComponent(
        entry('./card'),
        { '@saga-a2ui/ui': '2.0.0' },
        reader,
        url,
      ),
    ).toThrow(/not 2\.0\.0/);
  });
});

describe('adding a release to the navigation', () => {
  const config = {
    navigation: {
      versions: [
        { version: '0.9.0', tag: 'Stable', default: true, groups: [] },
      ],
    },
  };

  it('appends a new release without making it the default', () => {
    const next = withNavigation(
      config,
      { ...SPEC, version: '1.0.0-rc.1', channel: 'prerelease' },
      [],
    );
    expect(next.navigation.versions[1]).toEqual({
      version: '1.0.0-rc.1',
      tag: 'Prerelease',
      default: false,
      groups: [],
    });
    expect(next.navigation.versions[0]!.default).toBe(true);
  });

  it('replaces the pages of an existing release and keeps its label and default', () => {
    const next = withNavigation(config, { ...SPEC, version: '0.9.0' }, [
      { group: 'G', pages: ['p'] },
    ]);
    expect(next.navigation.versions).toEqual([
      {
        version: '0.9.0',
        tag: 'Stable',
        default: true,
        groups: [{ group: 'G', pages: ['p'] }],
      },
    ]);
  });
});

// A scratch copy of a minimal published site, for the offline check.
function site(
  edit: (parts: {
    config: any;
    spec: ReleaseSpec;
    pages: Map<string, string>;
  }) => void = () => undefined,
): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-release-'));
  const built = buildRelease(SPEC, tree(FILES));
  const pages = new Map<string, string>();
  for (const [relative, content] of built.files)
    pages.set(`docs/releases/1.0.0/${relative}`, content);
  pages.set(
    'docs/releases/1.0.0/installation.mdx',
    "---\ntitle: 'Install'\ndescription: 'Install.'\n---\n\nInstall 1.0.0.\n",
  );
  pages.set(
    'docs/connect/assistants.mdx',
    "---\ntitle: 'Assistants'\ndescription: 'Assistants.'\n---\n\nConnect.\n",
  );
  const config = {
    navigation: {
      versions: [
        {
          version: '1.0.0',
          tag: 'Stable',
          default: true,
          groups: [...built.groups],
        },
      ],
    },
  };
  const spec = structuredClone(SPEC);
  edit({ config, spec, pages });
  for (const [relative, content] of pages) {
    const target = path.join(
      directory,
      relative.endsWith('.mdx') || relative.endsWith('.json')
        ? relative
        : `${relative}.mdx`,
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.writeFileSync(path.join(directory, 'docs.json'), JSON.stringify(config));
  fs.writeFileSync(
    path.join(directory, 'docs/releases/1.0.0/release.json'),
    JSON.stringify(spec),
  );
  return directory;
}

describe('the offline check of committed release content', () => {
  it('accepts a consistent site', () => {
    expect(checkReleases(site()).problems).toEqual([]);
  });

  it('keeps the site indexable and published pages only, with no site-wide robots block', () => {
    const committed = JSON.parse(
      fs.readFileSync(path.join(root, 'docs.json'), 'utf8'),
    ) as { seo?: { indexing?: string; metatags?: Record<string, string> } };
    expect(committed.seo?.indexing).toBe('navigable');
    expect(committed.seo?.metatags?.robots).toBeUndefined();

    const blocked = site(({ config }) => {
      config.seo = { metatags: { robots: 'noindex, nofollow' } };
    });
    expect(checkReleases(blocked).problems.join('\n')).toMatch(
      /seo\.metatags\.robots is "noindex, nofollow"/,
    );
    const nofollow = site(({ config }) => {
      config.seo = { metatags: { Robots: 'index, nofollow' } };
    });
    expect(checkReleases(nofollow).problems.join('\n')).toMatch(/nofollow/);
    const everything = site(({ config }) => {
      config.seo = { indexing: 'all' };
    });
    expect(checkReleases(everything).problems.join('\n')).toMatch(
      /seo\.indexing must be "navigable"/,
    );
    // An explicit allow, other tags and a reviewed folder-scoped block are not the site-wide block.
    const allowed = site(({ config }) => {
      config.seo = {
        indexing: 'navigable',
        metatags: { robots: 'index, follow', 'og:site_name': 'saga a2ui' },
        paths: [
          { path: 'docs/releases/0.1.0', metatags: { robots: 'noindex' } },
        ],
      };
    });
    expect(checkReleases(allowed).problems).toEqual([]);
  });

  it('requires exactly one default and that it is a stable release', () => {
    const noDefault = site(({ config }) => {
      config.navigation.versions[0].default = false;
    });
    expect(checkReleases(noDefault).problems.join('\n')).toMatch(
      /Exactly one version/,
    );
    const prerelease = site(({ config, spec }) => {
      (spec as { channel: string; version: string }).channel = 'prerelease';
      config.navigation.versions[0].tag = 'Prerelease';
    });
    expect(checkReleases(prerelease).problems.join('\n')).toMatch(
      /labeled prerelease/,
    );
  });

  it('rejects a development label such as main as a release', () => {
    const main = site(({ config, spec }) => {
      (spec as { version: string }).version = 'main';
      config.navigation.versions[0].version = 'main';
    });
    fs.renameSync(
      path.join(main, 'docs/releases/1.0.0'),
      path.join(main, 'docs/releases/main'),
    );
    expect(checkReleases(main).problems.join('\n')).toMatch(
      /main is not a released version number/,
    );
  });

  it('rejects a stable label on a prerelease number and a missing Stable tag', () => {
    const wrong = site(({ config }) => {
      config.navigation.versions[0].tag = 'Latest';
    });
    expect(checkReleases(wrong).problems.join('\n')).toMatch(
      /must be tagged Stable/,
    );
  });

  it('finds a page in the navigation that does not exist, and a page that is not in it', () => {
    const missing = site(({ config }) => {
      config.navigation.versions[0].groups[0].pages.push(
        'docs/releases/1.0.0/absent',
      );
    });
    expect(checkReleases(missing).problems.join('\n')).toMatch(
      /absent is in the navigation but missing/,
    );
    const orphan = site(({ pages }) => {
      pages.set(
        'docs/releases/1.0.0/guides/orphan.mdx',
        '---\ntitle: x\n---\n',
      );
    });
    expect(checkReleases(orphan).problems.join('\n')).toMatch(
      /orphan.mdx is not in the navigation/,
    );
  });

  it('finds a link to a missing heading and a link into another release', () => {
    const anchor = site(({ pages }) => {
      pages.set(
        'docs/releases/1.0.0/guides/two.mdx',
        `${pages.get('docs/releases/1.0.0/guides/two.mdx')}\n[x](/docs/releases/1.0.0/guides/one#nothing-here)\n`,
      );
    });
    expect(checkReleases(anchor).problems.join('\n')).toMatch(
      /one#nothing-here has no such heading/,
    );
    const cross = site(({ pages }) => {
      pages.set(
        'docs/releases/1.0.0/guides/two.mdx',
        `${pages.get('docs/releases/1.0.0/guides/two.mdx')}\n[x](/docs/releases/2.0.0/guides/one)\n`,
      );
    });
    expect(checkReleases(cross).problems.join('\n')).toMatch(/has no page/);
  });

  it('finds a generated page that lost its source revision, and a catalog out of step with the release', () => {
    const revision = site(({ pages }) => {
      pages.set(
        'docs/releases/1.0.0/guides/one.mdx',
        pages
          .get('docs/releases/1.0.0/guides/one.mdx')!
          .replaceAll(REVISION, 'unknown'),
      );
    });
    expect(checkReleases(revision).problems.join('\n')).toMatch(
      /does not identify the source revision/,
    );
    const catalog = site(({ spec }) => {
      (spec as { packages: Record<string, string> }).packages = {};
    });
    expect(checkReleases(catalog).problems.join('\n')).toMatch(
      /publishes nothing/,
    );
  });

  it('finds an unbalanced code fence', () => {
    const fence = site(({ pages }) => {
      pages.set(
        'docs/releases/1.0.0/guides/two.mdx',
        `${pages.get('docs/releases/1.0.0/guides/two.mdx')}\n\`\`\`ts\nunclosed\n`,
      );
    });
    expect(checkReleases(fence).problems.join('\n')).toMatch(/not closed/);
  });
});

describe('the committed releases', () => {
  it('are consistent with the navigation, their records and each other', () => {
    expect(checkReleases(root).problems).toEqual([]);
  });

  it('keep the older release when a newer one is added: each has its own directory and record', () => {
    const versions = releaseVersions(root);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    for (const version of versions) {
      const spec = readSpec(root, version);
      expect(spec.version).toBe(version);
      expect(spec.revision).toMatch(/^[0-9a-f]{40}$/);
      for (const guide of spec.guides)
        expect(
          fs.existsSync(
            path.join(
              root,
              `docs/releases/${version}/guides/${guide.slug}.mdx`,
            ),
          ),
        ).toBe(true);
    }
  });

  it('give the website a route for every component, only in the releases that document it', () => {
    const inventory = routeInventory(root);
    expect(inventory.default).toBe(
      inventory.releases.find((release) => release.channel === 'stable')!
        .version,
    );
    const byId = new Map(inventory.components.map((c) => [c.id, c.routes]));
    // SagaAttribution is not an export of the stable packages, so it has no stable route.
    expect(Object.keys(byId.get('saga-attribution')!)).toEqual(['0.11.0-rc.1']);
    expect(Object.keys(byId.get('faithful-card')!).sort()).toEqual(
      inventory.releases.map((release) => release.version).sort(),
    );
    const all = new Set(inventory.releases.flatMap((release) => release.pages));
    for (const component of inventory.components)
      for (const route of Object.values(component.routes))
        expect(all).toContain(route);
  });

  it('publish only versions that exist on npm for the packages they list, with the stable release first', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(root, 'docs.json'), 'utf8'),
    ) as {
      navigation: {
        versions: { version: string; tag: string; default?: boolean }[];
      };
    };
    expect(config.navigation.versions[0]).toMatchObject({
      tag: 'Stable',
      default: true,
    });
    for (const entry of config.navigation.versions) {
      const spec = readSpec(root, entry.version);
      for (const version of Object.values(spec.packages))
        expect(version).toBe(entry.version);
    }
  });
});

// The pinned revisions are real commits. These checks read them and need the repository history,
// which a shallow checkout does not have; they are skipped there and run in a full clone.
function hasRevision(revision: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `${revision}^{commit}`], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

describe.each(releaseVersions(root))(
  'release %s against its pinned revision',
  (version) => {
    const spec = readSpec(root, version);
    const available = hasRevision(spec.revision);

    it.skipIf(!available)(
      'accounts for every guide of the revision as published or excluded',
      () => {
        const listed = execFileSync(
          'git',
          ['ls-tree', '-r', '--name-only', spec.revision, 'docs'],
          {
            cwd: root,
            encoding: 'utf8',
          },
        )
          .split('\n')
          .filter((name) => name.endsWith('.md'));
        const accounted = new Set([
          ...spec.guides.map((guide) => guide.source),
          ...spec.exclusions.map((exclusion) => exclusion.source),
        ]);
        expect(listed.filter((name) => !accounted.has(name))).toEqual([]);
        expect([...accounted].filter((name) => !listed.includes(name))).toEqual(
          [],
        );
        for (const exclusion of spec.exclusions)
          expect(exclusion.reason.length).toBeGreaterThan(20);
      },
    );

    it.skipIf(!available)(
      'is reproduced exactly by the generator from the pinned revision',
      () => {
        const built = buildRelease(spec, gitTree(root, spec.revision));
        for (const [relative, content] of built.files) {
          if (relative === 'components/catalog.json') continue;
          expect(
            fs.readFileSync(
              path.join(root, `docs/releases/${version}/${relative}`),
              'utf8',
            ),
          ).toBe(content);
        }
      },
    );

    it.skipIf(!available)(
      'keeps every code fence of every published guide as the source wrote it',
      () => {
        const source = gitTree(root, spec.revision);
        for (const guide of spec.guides) {
          const page = fs.readFileSync(
            path.join(
              root,
              `docs/releases/${version}/guides/${guide.slug}.mdx`,
            ),
            'utf8',
          );
          expect(fencedBlocks(page), guide.source).toEqual(
            fencedBlocks(source.read(guide.source)),
          );
        }
      },
    );

    it.skipIf(!available)(
      'lists every component export it names in the pinned source',
      () => {
        const catalog = JSON.parse(
          fs.readFileSync(
            path.join(root, `docs/releases/${version}/components/catalog.json`),
            'utf8',
          ),
        ) as {
          components: {
            entries: {
              package: string;
              exports: { values: string[]; types: string[] };
            }[];
          }[];
        };
        expect(catalog.components.length).toBe(spec.components.length);
        for (const component of catalog.components)
          for (const entry of component.entries)
            expect(
              entry.exports.values.length + entry.exports.types.length,
            ).toBeGreaterThan(0);
      },
    );
  },
);
