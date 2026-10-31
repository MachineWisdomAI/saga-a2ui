import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { viewUriForHtml } from '@saga-a2ui/mcp/server';
import {
  SDK_PACKAGES,
  assertInstalledTarballs,
  assertSameRevision,
  candidateProvenance,
  candidateSummary,
  checkInstalledCombination,
  checkPagePairing,
  CARRIED_CASES,
  floorFindings,
  missingCarriedCases,
  resolvedExclusions,
  type ExpectedCombination,
} from './release-candidate.js';
import {
  CANDIDATE_REGISTRY,
  candidateManifest,
  candidateVersion,
  createWorkDirectory,
  packSdkPackages,
  packReleasePackages,
  repoRoot,
  unpackIntoConsumer,
  type PackedPackage,
} from './packed-consumer.js';

// PACK2: what a release candidate is, what it refuses, and how an installed set is updated and
// restored. Everything is local and offline: the tarballs are real `npm pack` output, but nothing is
// installed from or sent to a registry. The clean-directory `npm install` of the tarballs and the
// refusal of a mixed set by the package manager run in `npm run candidate:pack` (CI), which needs
// the registry for the third-party packages.

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const VERSION_A = candidateVersion(COMMIT_A, false);
const VERSION_B = candidateVersion(COMMIT_B, false);

const work = createWorkDirectory('saga-candidate-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const sha256 = (file: string): string =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');

it('exports unpublished tarballs and npm overrides without requiring built applications', () => {
  const output = path.join(work, 'local-development');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/release-candidate.ts',
      'tarballs',
      '--out',
      output,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const recipe = JSON.parse(
    fs.readFileSync(path.join(output, 'npm-overrides.json'), 'utf8'),
  );
  for (const name of SDK_PACKAGES) {
    const spec = recipe.overrides[`@saga-a2ui/${name}`];
    expect(spec).toMatch(/^file:/);
    expect(fs.existsSync(spec.slice(5))).toBe(true);
    const manifest = JSON.parse(
      spawnSync('tar', ['-xOf', spec.slice(5), 'package/package.json'], {
        encoding: 'utf8',
      }).stdout,
    );
    expect(manifest.private).toBe(true);
    expect(manifest.publishConfig.registry).toBe(CANDIDATE_REGISTRY);
  }
  expect(recipe.overrides).toMatchObject({
    '@a2ui/markdown-it': '0.2.1',
    dompurify: '3.4.17',
    '@hono/node-server': '2.1.5',
  });
  // Packing alone must not claim the installed-application qualification record.
  expect(fs.existsSync(path.join(output, 'candidate.json'))).toBe(false);
}, 120_000);

it('packs all seven SDK releases, preserving exact sibling pins, exports and license files', () => {
  const releases = packReleasePackages(
    path.join(work, 'release'),
    path.join(work, 'release-tarballs'),
  );
  expect(releases.map((one) => one.name)).toEqual([
    'core',
    'components',
    'mcp',
    'react',
    'react-mcp-stack',
    'lit',
    'lit-mcp-stack',
  ]);
  const versions = Object.fromEntries(
    releases.map((one) => [`@saga-a2ui/${one.name}`, one.version]),
  );
  for (const one of releases) {
    const source = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, 'packages', one.name, 'package.json'),
        'utf8',
      ),
    );
    expect(one.manifest).toMatchObject({
      version: source.version,
      private: false,
      exports: source.exports,
      publishConfig: { access: 'public', tag: 'next' },
    });
    const files = one.files.map((file) => file.path);
    expect(files).toContain('LICENSE');
    expect(files).toContain('README.md');
    if (one.name === 'components')
      expect(files).toContain('THIRD_PARTY_NOTICES.md');
    for (const [name, range] of Object.entries({
      ...one.manifest.dependencies,
      ...one.manifest.peerDependencies,
    })) {
      if (name.startsWith('@saga-a2ui/')) expect(range).toBe(versions[name]);
    }
    for (const file of Object.values(source.exports) as string[])
      expect(files).toContain(file.replace(/^\.\//, ''));
  }
}, 120_000);

describe('the candidate identity', () => {
  it('is a semver prerelease of 0.0.0 naming the revision, and marks a modified tree', () => {
    expect(VERSION_A).toBe('0.0.0-candidate.gaaaaaaaaaaaa');
    expect(candidateVersion(COMMIT_A, true)).toBe(
      '0.0.0-candidate.gaaaaaaaaaaaa.dirty',
    );
    // An all-digit prefix would be a numeric identifier, and a leading zero makes that invalid semver.
    expect(candidateVersion(`0123456789ab${'c'.repeat(28)}`, false)).toMatch(
      /^0\.0\.0-candidate\.g0123456789ab$/,
    );
  });

  it('refuses anything that is not a full commit rather than inventing an identity', () => {
    expect(() => candidateVersion('HEAD', false)).toThrow(/full 40-hex commit/);
    expect(() => candidateVersion('abc123', false)).toThrow(
      /full 40-hex commit/,
    );
  });
});

describe('the candidate manifest', () => {
  const repository = {
    name: '@saga-a2ui/lit',
    private: true,
    files: ['src'],
    dependencies: { '@saga-a2ui/core': '*', lit: '^3.3.3' },
    peerDependencies: { '@saga-a2ui/components': '*' },
    devDependencies: { '@saga-a2ui/components': '*', vitest: '^5.0.4' },
  };

  it('pins every sibling to the candidate version, leaves third-party ranges alone and stays private', () => {
    const pinned = candidateManifest(
      repository,
      VERSION_A,
    ) as typeof repository & { version: string };
    expect(pinned.version).toBe(VERSION_A);
    expect(pinned.dependencies).toEqual({
      '@saga-a2ui/core': VERSION_A,
      lit: '^3.3.3',
    });
    expect(pinned.peerDependencies).toEqual({
      '@saga-a2ui/components': VERSION_A,
    });
    expect(pinned.devDependencies).toEqual({
      '@saga-a2ui/components': VERSION_A,
      vitest: '^5.0.4',
    });
    expect(pinned.private).toBe(true);
    expect((pinned as { publishConfig?: unknown }).publishConfig).toEqual({
      registry: CANDIDATE_REGISTRY,
    });
  });

  it.each(['workspace:*', 'file:../core', '^1.0.0', 'latest'])(
    'refuses a sibling declared as "%s" rather than rewriting it',
    (range) => {
      expect(() =>
        candidateManifest(
          { ...repository, dependencies: { '@saga-a2ui/core': range } },
          VERSION_A,
        ),
      ).toThrow(/declared as "\*"/);
    },
  );

  it('keeps candidates private after release enrollment and rewrites only a matching enrolled sibling', () => {
    const enrolled = {
      ...repository,
      private: false,
      version: '0.1.0-rc.1',
      dependencies: { '@saga-a2ui/core': '0.1.0-rc.1' },
    };
    const pinned = candidateManifest(enrolled, VERSION_A, [], {
      '@saga-a2ui/core': '0.1.0-rc.1',
    });
    expect(pinned.private).toBe(true);
    expect(pinned.dependencies).toEqual({ '@saga-a2ui/core': VERSION_A });
    expect(pinned.publishConfig).toEqual({ registry: CANDIDATE_REGISTRY });
    expect(() =>
      candidateManifest(enrolled, VERSION_A, [], {
        '@saga-a2ui/core': '0.2.0',
      }),
    ).toThrow(/enrolled sibling/);
  });
});

describe('packed candidates', () => {
  let a: PackedPackage[];
  let b: PackedPackage[];

  beforeAll(() => {
    a = packSdkPackages(
      path.join(work, 'a'),
      SDK_PACKAGES,
      path.join(work, 'a', 'packages'),
      VERSION_A,
    );
    b = packSdkPackages(
      path.join(work, 'b'),
      SDK_PACKAGES,
      path.join(work, 'b', 'packages'),
      VERSION_B,
    );
  }, 120_000);

  const expectation = (
    packed: readonly PackedPackage[],
  ): ExpectedCombination => ({
    version: packed[0]!.version,
    packages: Object.fromEntries(
      packed.map((one) => [
        one.name,
        { tarball: path.basename(one.tarball), sha256: one.sha256 },
      ]),
    ),
  });
  const named = (
    packed: readonly PackedPackage[],
    name: string,
  ): PackedPackage => packed.find((one) => one.name === name)!;
  const install = (
    consumer: string,
    packed: readonly PackedPackage[],
    only: readonly string[] = SDK_PACKAGES,
  ): void => {
    for (const one of packed)
      if (only.includes(one.name)) unpackIntoConsumer(consumer, one);
  };
  const modules = (consumer: string): string =>
    path.join(consumer, 'node_modules');

  it('carries the license with the code', () => {
    for (const one of a) {
      expect(
        one.files.map((file) => file.path),
        one.name,
      ).toContain('LICENSE');
      expect(one.manifest, one.name).toMatchObject({
        private: true,
        license: 'Apache-2.0',
      });
    }
  });

  it('is aimed at no registry, so passing a tarball to npm publish would reach nothing', () => {
    // npm 12.0.2 accepts a private manifest in `publish --dry-run`, so `private` alone is not the safeguard;
    // the manifest it reads from the tarball names a host that cannot resolve.
    for (const one of a)
      expect(
        (one.manifest as { publishConfig?: unknown }).publishConfig,
        one.name,
      ).toEqual({ registry: CANDIDATE_REGISTRY });
    expect(new URL(CANDIDATE_REGISTRY).hostname.endsWith('.invalid')).toBe(
      true,
    );
  });

  it('is byte for byte the same artifact when the same revision is packed again', () => {
    const again = packSdkPackages(
      path.join(work, 'again'),
      ['core'],
      path.join(work, 'again', 'packages'),
      VERSION_A,
    );
    expect(again[0]!.sha256).toBe(named(a, 'core').sha256);
    expect(sha256(again[0]!.tarball)).toBe(again[0]!.sha256);
  });

  it('names a different artifact for a different revision, so a candidate cannot be mistaken for another', () => {
    for (const name of SDK_PACKAGES)
      expect(named(a, name).sha256, name).not.toBe(named(b, name).sha256);
  });

  it('records what the tarballs leave out and why', () => {
    const exclusions = resolvedExclusions(a);
    const core = exclusions.filter((one) => one.package === 'core');
    const tests = core.find((one) => /test/.test(one.reason));
    expect(tests?.paths.length).toBeGreaterThan(0);
    expect(
      tests?.paths.every((file) =>
        /\.test(-support)?\.tsx?$|\.test-support\./.test(file),
      ),
    ).toBe(true);
    const shipped = new Set(named(a, 'core').files.map((file) => file.path));
    for (const one of core)
      for (const file of one.paths) expect(shipped.has(file), file).toBe(false);
  });

  describe('an installed set', () => {
    it('is the candidate when every package is installed from it', () => {
      const consumer = path.join(work, 'whole');
      install(consumer, a);
      expect(
        checkInstalledCombination(modules(consumer), expectation(a)),
      ).toEqual([]);
    });

    it('is the candidate without the optional components package, when the combination does not include it', () => {
      const consumer = path.join(work, 'own-catalog');
      install(consumer, a, ['core', 'lit', 'mcp']);
      expect(
        checkInstalledCombination(modules(consumer), expectation(a), [
          'core',
          'lit',
          'mcp',
        ]),
      ).toEqual([]);
    });

    it('is incomplete, and says which package to reinstall, when a package the combination requires is absent', () => {
      const consumer = path.join(work, 'no-components');
      install(consumer, a, ['core', 'lit', 'mcp']);
      const findings = checkInstalledCombination(
        modules(consumer),
        expectation(a),
        ['core', 'lit', 'components', 'mcp'],
      );
      expect(
        findings.map((finding) => `${finding.code}:${finding.package}`),
      ).toEqual(['missing-package:components']);
      expect(findings[0]?.guidance).toContain(
        path.basename(named(a, 'components').tarball),
      );
      // With no combination named, the whole candidate is required: a set is never accepted by omission.
      expect(
        checkInstalledCombination(modules(consumer), expectation(a)).map(
          (finding) => finding.package,
        ),
      ).toEqual(['components', 'react', 'lit-mcp-stack', 'react-mcp-stack']);
    });

    it('reports a modules location that does not exist or holds no SDK package, with where to install', () => {
      const missing = checkInstalledCombination(
        path.join(work, 'nowhere', 'node_modules'),
        expectation(a),
        ['core'],
      );
      expect(missing.map((finding) => finding.code)).toEqual([
        'modules-missing',
      ]);
      expect(missing[0]?.guidance).toMatch(
        /does not exist.*--modules.*install the candidate's tarballs/,
      );
      fs.mkdirSync(path.join(work, 'empty', 'node_modules', '@saga-a2ui'), {
        recursive: true,
      });
      expect(
        checkInstalledCombination(
          path.join(work, 'empty', 'node_modules'),
          expectation(a),
          ['core'],
        ).map((finding) => finding.code),
      ).toEqual(['modules-missing']);
    });

    it('updates as one complete set, and a half-updated set is reported with the tarball to reinstall', () => {
      const consumer = path.join(work, 'update');
      install(consumer, a);
      const update = (
        target: readonly PackedPackage[],
        only?: readonly string[],
      ) => install(consumer, target, only);

      update(b, ['lit']);
      // Against the target, every package still on the old build is named; the updated one is fine.
      const half = checkInstalledCombination(
        modules(consumer),
        expectation(b),
      ).filter((finding) => finding.code === 'version-mismatch');
      expect(half.map((finding) => finding.package).sort()).toEqual([
        'components',
        'core',
        'lit-mcp-stack',
        'mcp',
        'react',
        'react-mcp-stack',
      ]);
      for (const finding of half)
        expect(finding.guidance).toContain(
          path.basename(named(b, finding.package!).tarball),
        );
      // Against the old build, the updated package is the odd one out: wrong version, and siblings from the other build.
      const lit = checkInstalledCombination(
        modules(consumer),
        expectation(a),
      ).filter((finding) => finding.package === 'lit');
      expect(lit.map((finding) => finding.code).sort()).toEqual([
        'range-mismatch',
        'range-mismatch',
        'version-mismatch',
      ]);
      for (const finding of lit)
        expect(finding.guidance).toContain(
          path.basename(named(a, 'lit').tarball),
        );

      update(b);
      expect(
        checkInstalledCombination(modules(consumer), expectation(b)),
      ).toEqual([]);
      // The old candidate is now refused for every package, naming its own tarball to restore.
      const stale = checkInstalledCombination(
        modules(consumer),
        expectation(a),
      );
      expect(
        stale
          .filter((finding) => finding.code === 'version-mismatch')
          .map((finding) => finding.package)
          .sort(),
      ).toEqual([...SDK_PACKAGES].sort());
      for (const finding of stale)
        expect(finding.guidance).toMatch(/rebuild the view/);
    });

    it('rolls back to the exact earlier combination, byte for byte', () => {
      const consumer = path.join(work, 'rollback');
      install(consumer, a);
      const before = SDK_PACKAGES.map((name) =>
        fs.readFileSync(
          path.join(modules(consumer), '@saga-a2ui', name, 'package.json'),
          'utf8',
        ),
      );
      install(consumer, b);
      install(consumer, a);
      expect(
        checkInstalledCombination(modules(consumer), expectation(a)),
      ).toEqual([]);
      expect(
        SDK_PACKAGES.map((name) =>
          fs.readFileSync(
            path.join(modules(consumer), '@saga-a2ui', name, 'package.json'),
            'utf8',
          ),
        ),
      ).toEqual(before);
    });

    it('reports a missing sibling the installed package requires, but not an absent optional peer', () => {
      const consumer = path.join(work, 'missing');
      install(consumer, a, ['lit', 'components']);
      const findings = checkInstalledCombination(
        modules(consumer),
        expectation(a),
        ['lit', 'components'],
      );
      expect(
        findings
          .map(
            (finding) =>
              `${finding.code}:${finding.package}:${finding.expected}`,
          )
          .sort(),
      ).toEqual([
        'missing-dependency:components:@saga-a2ui/core',
        'missing-dependency:lit:@saga-a2ui/core',
      ]);
      expect(findings[0]?.guidance).toContain(
        path.basename(named(a, 'core').tarball),
      );
    });

    it('reports a package the candidate does not contain, and one that cannot be read', () => {
      const consumer = path.join(work, 'foreign');
      install(consumer, a, ['core']);
      fs.mkdirSync(path.join(modules(consumer), '@saga-a2ui', 'lynx'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(modules(consumer), '@saga-a2ui', 'lynx', 'package.json'),
        '{}',
      );
      fs.mkdirSync(path.join(modules(consumer), '@saga-a2ui', 'mcp'), {
        recursive: true,
      });
      const findings = checkInstalledCombination(
        modules(consumer),
        expectation(a),
        ['core'],
      );
      expect(
        findings.map((finding) => `${finding.code}:${finding.package}`).sort(),
      ).toEqual(['not-in-candidate:lynx', 'unreadable-package:mcp']);
    });
  });

  // The command a maintainer runs, through its real entry point: argument parsing, the combination
  // it names, the findings it prints and the exit code a script would act on.
  // Each case starts the command in a new process (a TypeScript runtime start-up, twice for some).
  describe('candidate:verify', { timeout: 60_000 }, () => {
    const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
    const record = (packed: readonly PackedPackage[]) => ({
      version: packed[0]!.version,
      packages: packed.map((one) => ({
        name: `@saga-a2ui/${one.name}`,
        tarball: path.basename(one.tarball),
        sha256: one.sha256,
      })),
      combinations: [
        {
          id: 'notes-own',
          packages: ['core', 'lit', 'mcp'],
          resources: [
            {
              role: 'notes view',
              uri: 'ui://views/own.00000000000000000000000000000000.html',
              file: 'own.html',
            },
          ],
        },
        {
          id: 'notes-card',
          packages: ['components', 'core', 'lit', 'mcp'],
          resources: [
            {
              role: 'notes view',
              uri: 'ui://views/card.00000000000000000000000000000000.html',
              file: 'card.html',
            },
          ],
        },
      ],
      carriedEvidence: {
        cases: CARRIED_CASES.map(({ file, title }) => ({ file, title })),
      },
    });
    const run = (...args: string[]) => {
      const result = spawnSync(
        tsx,
        [
          path.join(repoRoot, 'scripts', 'release-candidate.ts'),
          'verify',
          ...args,
        ],
        { encoding: 'utf8' },
      );
      return { code: result.status, out: result.stdout, err: result.stderr };
    };
    const candidateFile = (): string => {
      const file = path.join(work, 'verify-candidate.json');
      fs.writeFileSync(file, JSON.stringify(record(a)));
      return file;
    };

    it('accepts the installed set that is exactly the named combination, without the optional package for own', () => {
      const consumer = path.join(work, 'cli-own');
      install(consumer, a, ['core', 'lit', 'mcp']);
      const result = run(
        '--candidate',
        candidateFile(),
        '--modules',
        modules(consumer),
        '--combination',
        'own',
      );
      expect(result).toMatchObject({ code: 0, err: '' });
      expect(result.out).toContain(
        `installed set matches candidate ${VERSION_A}`,
      );
    });

    it('refuses an incomplete set for the card combination, whichever page is passed', () => {
      const consumer = path.join(work, 'cli-incomplete');
      install(consumer, a, ['core', 'lit', 'mcp']);
      const page = path.join(work, 'cli-card.html');
      fs.writeFileSync(page, '<card-app></card-app>');
      const result = run(
        '--candidate',
        candidateFile(),
        '--modules',
        modules(consumer),
        '--combination',
        'card',
        '--page',
        page,
      );
      expect(result.code).toBe(1);
      expect(result.out).not.toContain('matches candidate');
      expect(result.err).toMatch(
        /missing-package @saga-a2ui\/components: .*not installed.*Reinstall @saga-a2ui\/components from candidate tarball saga-a2ui-components-/,
      );
      // The page is reported too, rather than being the only thing checked.
      expect(result.err).toMatch(/resource-mismatch/);
    });

    it('refuses a modules location that does not exist or holds no SDK package, and says where to install', () => {
      const nowhere = run(
        '--candidate',
        candidateFile(),
        '--modules',
        path.join(work, 'no-such', 'node_modules'),
        '--combination',
        'own',
      );
      expect(nowhere.code).toBe(1);
      expect(nowhere.out).not.toContain('matches candidate');
      expect(nowhere.err).toMatch(
        /modules-missing: No @saga-a2ui package is installed .*does not exist.*--modules/,
      );
      fs.mkdirSync(path.join(work, 'cli-empty', 'node_modules'), {
        recursive: true,
      });
      expect(
        run(
          '--candidate',
          candidateFile(),
          '--modules',
          modules(path.join(work, 'cli-empty')),
          '--combination',
          'own',
        ).code,
      ).toBe(1);
    });

    it('does not guess a combination: a missing or unknown one is a usage error that lists what the candidate records', () => {
      const consumer = path.join(work, 'cli-usage');
      install(consumer, a, ['core', 'lit', 'mcp']);
      const none = run(
        '--candidate',
        candidateFile(),
        '--modules',
        modules(consumer),
      );
      expect(none).toMatchObject({ code: 2 });
      expect(none.err).toMatch(/--combination is required/);
      const unknown = run(
        '--candidate',
        candidateFile(),
        '--modules',
        modules(consumer),
        '--combination',
        'react',
      );
      expect(unknown.code).toBe(2);
      expect(unknown.err).toMatch(
        /no combination "react".*notes-own, notes-card/,
      );
    });
  });

  describe('a built view', () => {
    const html = Buffer.from('<notes-app></notes-app>', 'utf8');

    it('is the resource a candidate recorded when its bytes are the same', () => {
      expect(
        checkPagePairing(
          html,
          viewUriForHtml(html, 'notes.html'),
          'notes.html',
        ),
      ).toEqual([]);
    });

    it('is refused, with the repair, when the bytes differ in any way', () => {
      const [finding, ...rest] = checkPagePairing(
        Buffer.from('<notes-app> </notes-app>', 'utf8'),
        viewUriForHtml(html, 'notes.html'),
        'notes.html',
      );
      expect(rest).toEqual([]);
      expect(finding).toMatchObject({
        code: 'resource-mismatch',
        expected: viewUriForHtml(html, 'notes.html'),
      });
      expect(finding?.guidance).toMatch(
        /Rebuild the view from the candidate packages/,
      );
      expect(finding?.guidance).toMatch(/restart the server/);
    });
  });
});

describe('the provenance a candidate states', () => {
  // `candidate.json` serializes the provenance fields and `CANDIDATE.md` prints the same text, so
  // both are read here from one record. The summary needs only the fields it prints.
  const record = {
    ...candidateProvenance(),
    version: VERSION_A,
    source: { commit: COMMIT_A, dirty: false },
    packages: [],
    combinations: [],
    exclusions: [],
    recipe: {
      node: { testedHere: 'v22', minimum: '22', ciPinned: '22' },
      npm: '11',
      platform: 'linux-x64',
      consumerInstall: { ok: true, treeValid: true },
      consumerOverrides: {},
    },
    versionMismatch: { installProbe: { refused: true } },
    carriedEvidence: { localResult: null },
  };
  const statements = (): string[] => [
    JSON.stringify(record),
    candidateSummary(record),
  ];

  it('does not claim a first candidate or that nothing was ever published', () => {
    for (const text of statements()) {
      expect(text).not.toMatch(/first candidate/i);
      expect(text).not.toMatch(/ever been published/i);
      expect(text).not.toMatch(/no earlier release/i);
      expect(text).not.toMatch(/nothing is published/i);
      expect(text).not.toMatch(/no SAGA package/i);
    }
    expect(record.predecessor).not.toHaveProperty('published', null);
  });

  it('acknowledges the public registry history without inventorying it', () => {
    for (const text of statements()) {
      expect(text).toMatch(/public npm releases/i);
      expect(text).toContain('0.1.0-rc.1');
      expect(text).toMatch(/does not (list|inventory)/i);
    }
  });

  it('limits what was rehearsed to candidate builds, with no registry upgrade', () => {
    expect(record.predecessor.registryUpgradeExercised).toBe(false);
    for (const text of statements()) {
      expect(text).toMatch(/candidate builds only/i);
      expect(text).toMatch(/no upgrade from a registry release/i);
      expect(text).toMatch(/local source rehearsal/i);
      expect(text).toMatch(/anonymous registry install/i);
      expect(text).toMatch(/real host/i);
    }
    expect(record.status).toBe('unreleased candidate');
  });
});

describe('what a consumer build installed', () => {
  const packed = {
    core: { sha256: 'c0' },
    lit: { sha256: 'l1' },
  } as unknown as Record<string, PackedPackage>;

  it('passes when every tarball is the candidate tarball and the revision is the same', () => {
    expect(() =>
      assertInstalledTarballs(
        'The consumer',
        { core: 'c0', lit: 'l1' },
        packed,
      ),
    ).not.toThrow();
    expect(() =>
      assertSameRevision(
        'The consumer',
        { sourceCommit: COMMIT_A, sourceDirty: false, packedTarballSha256: {} },
        { commit: COMMIT_A, dirty: false },
      ),
    ).not.toThrow();
  });

  it('refuses a consumer built from another tarball, naming the repair', () => {
    expect(() =>
      assertInstalledTarballs('The consumer', { core: 'other' }, packed),
    ).toThrow(
      /installed @saga-a2ui\/core other, which is not the candidate tarball c0.*npm run build/,
    );
    expect(() =>
      assertInstalledTarballs('The consumer', { react: 'r' }, packed),
    ).toThrow(/not the candidate tarball \(none\)/);
  });

  it('refuses a consumer built from another revision, or from a modified tree when the candidate is clean', () => {
    const identity = {
      sourceCommit: COMMIT_B,
      sourceDirty: false,
      packedTarballSha256: {},
    };
    expect(() =>
      assertSameRevision('The consumer', identity, {
        commit: COMMIT_A,
        dirty: false,
      }),
    ).toThrow(/not the candidate's a{40}/);
    expect(() =>
      assertSameRevision(
        'The consumer',
        { ...identity, sourceCommit: COMMIT_A, sourceDirty: true },
        { commit: COMMIT_A, dirty: false },
      ),
    ).toThrow(/\(dirty\), not the candidate's/);
  });
});

describe('the checks a combination carries', () => {
  it('are all present in their files, so a claim never rests on a test that was renamed or removed', () => {
    expect(missingCarriedCases()).toEqual([]);
  });

  it('are reported missing from a record that predates them, naming what restoring it would undo', () => {
    const complete = {
      carriedEvidence: {
        cases: CARRIED_CASES.map(({ file, title }) => ({ file, title })),
      },
    };
    expect(floorFindings(complete)).toEqual([]);
    const authorization = CARRIED_CASES.find((one) =>
      /authorizes every protected request/.test(one.title),
    )!;
    const older = {
      carriedEvidence: {
        cases: complete.carriedEvidence.cases.filter(
          (one) => one.title !== authorization.title,
        ),
      },
    };
    const [finding, ...rest] = floorFindings(older);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      code: 'floor-missing',
      expected: authorization.title,
    });
    expect(finding?.guidance).toMatch(/silently undo that fix/);
    // A record with no list at all lacks every case.
    expect(floorFindings({})).toHaveLength(CARRIED_CASES.length);
  });
});
