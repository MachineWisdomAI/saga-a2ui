import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { viewUriForHtml } from '@saga-a2ui/mcp/server';
import {
  SDK_PACKAGES,
  assertInstalledTarballs,
  assertSameRevision,
  checkInstalledCombination,
  checkPagePairing,
  CARRIED_CASES,
  floorFindings,
  missingCarriedCases,
  resolvedExclusions,
  type ExpectedCombination,
} from './release-candidate.js';
import { CANDIDATE_REGISTRY, candidateManifest, candidateVersion, createWorkDirectory, packSdkPackages, unpackIntoConsumer, type PackedPackage } from './packed-consumer.js';

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

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('the candidate identity', () => {
  it('is a semver prerelease of 0.0.0 naming the revision, and marks a modified tree', () => {
    expect(VERSION_A).toBe('0.0.0-candidate.gaaaaaaaaaaaa');
    expect(candidateVersion(COMMIT_A, true)).toBe('0.0.0-candidate.gaaaaaaaaaaaa.dirty');
    // An all-digit prefix would be a numeric identifier, and a leading zero makes that invalid semver.
    expect(candidateVersion(`0123456789ab${'c'.repeat(28)}`, false)).toMatch(/^0\.0\.0-candidate\.g0123456789ab$/);
  });

  it('refuses anything that is not a full commit rather than inventing an identity', () => {
    expect(() => candidateVersion('HEAD', false)).toThrow(/full 40-hex commit/);
    expect(() => candidateVersion('abc123', false)).toThrow(/full 40-hex commit/);
  });
});

describe('the candidate manifest', () => {
  const repository = { name: '@saga-a2ui/lit', private: true, files: ['src'], dependencies: { '@saga-a2ui/core': '*', lit: '^3.3.3' }, peerDependencies: { '@saga-a2ui/components': '*' }, devDependencies: { '@saga-a2ui/components': '*', vitest: '^5.0.4' } };

  it('pins every sibling to the candidate version, leaves third-party ranges alone and stays private', () => {
    const pinned = candidateManifest(repository, VERSION_A) as typeof repository & { version: string };
    expect(pinned.version).toBe(VERSION_A);
    expect(pinned.dependencies).toEqual({ '@saga-a2ui/core': VERSION_A, lit: '^3.3.3' });
    expect(pinned.peerDependencies).toEqual({ '@saga-a2ui/components': VERSION_A });
    expect(pinned.devDependencies).toEqual({ '@saga-a2ui/components': VERSION_A, vitest: '^5.0.4' });
    expect(pinned.private).toBe(true);
    expect((pinned as { publishConfig?: unknown }).publishConfig).toEqual({ registry: CANDIDATE_REGISTRY });
  });

  it.each(['workspace:*', 'file:../core', '^1.0.0', 'latest'])('refuses a sibling declared as "%s" rather than rewriting it', (range) => {
    expect(() => candidateManifest({ ...repository, dependencies: { '@saga-a2ui/core': range } }, VERSION_A)).toThrow(/declared as "\*"/);
  });
});

describe('packed candidates', () => {
  let a: PackedPackage[];
  let b: PackedPackage[];

  beforeAll(() => {
    a = packSdkPackages(path.join(work, 'a'), SDK_PACKAGES, path.join(work, 'a', 'packages'), VERSION_A);
    b = packSdkPackages(path.join(work, 'b'), SDK_PACKAGES, path.join(work, 'b', 'packages'), VERSION_B);
  }, 120_000);

  const expectation = (packed: readonly PackedPackage[]): ExpectedCombination => ({
    version: packed[0]!.version,
    packages: Object.fromEntries(packed.map((one) => [one.name, { tarball: path.basename(one.tarball), sha256: one.sha256 }])),
  });
  const named = (packed: readonly PackedPackage[], name: string): PackedPackage => packed.find((one) => one.name === name)!;
  const install = (consumer: string, packed: readonly PackedPackage[], only: readonly string[] = SDK_PACKAGES): void => {
    for (const one of packed) if (only.includes(one.name)) unpackIntoConsumer(consumer, one);
  };
  const modules = (consumer: string): string => path.join(consumer, 'node_modules');

  it('carries the license with the code', () => {
    for (const one of a) {
      expect(one.files.map((file) => file.path), one.name).toContain('LICENSE');
      expect(one.manifest, one.name).toMatchObject({ private: true, license: 'Apache-2.0' });
    }
  });

  it('is aimed at no registry, so passing a tarball to npm publish would reach nothing', () => {
    // npm 12.0.2 accepts a private manifest in `publish --dry-run`, so `private` alone is not the safeguard;
    // the manifest it reads from the tarball names a host that cannot resolve.
    for (const one of a) expect((one.manifest as { publishConfig?: unknown }).publishConfig, one.name).toEqual({ registry: CANDIDATE_REGISTRY });
    expect(new URL(CANDIDATE_REGISTRY).hostname.endsWith('.invalid')).toBe(true);
  });

  it('is byte for byte the same artifact when the same revision is packed again', () => {
    const again = packSdkPackages(path.join(work, 'again'), ['core'], path.join(work, 'again', 'packages'), VERSION_A);
    expect(again[0]!.sha256).toBe(named(a, 'core').sha256);
    expect(sha256(again[0]!.tarball)).toBe(again[0]!.sha256);
  });

  it('names a different artifact for a different revision, so a candidate cannot be mistaken for another', () => {
    for (const name of SDK_PACKAGES) expect(named(a, name).sha256, name).not.toBe(named(b, name).sha256);
  });

  it('records what the tarballs leave out and why', () => {
    const exclusions = resolvedExclusions(a);
    const core = exclusions.filter((one) => one.package === 'core');
    const tests = core.find((one) => /test/.test(one.reason));
    expect(tests?.paths.length).toBeGreaterThan(0);
    expect(tests?.paths.every((file) => /\.test(-support)?\.tsx?$|\.test-support\./.test(file))).toBe(true);
    const shipped = new Set(named(a, 'core').files.map((file) => file.path));
    for (const one of core) for (const file of one.paths) expect(shipped.has(file), file).toBe(false);
  });

  describe('an installed set', () => {
    it('is the candidate when every package is installed from it', () => {
      const consumer = path.join(work, 'whole');
      install(consumer, a);
      expect(checkInstalledCombination(modules(consumer), expectation(a))).toEqual([]);
    });

    it('is the candidate without the optional components package', () => {
      const consumer = path.join(work, 'own-catalog');
      install(consumer, a, ['core', 'lit', 'mcp']);
      expect(checkInstalledCombination(modules(consumer), expectation(a))).toEqual([]);
    });

    it('updates as one complete set, and a half-updated set is reported with the tarball to reinstall', () => {
      const consumer = path.join(work, 'update');
      install(consumer, a);
      const update = (target: readonly PackedPackage[], only?: readonly string[]) => install(consumer, target, only);

      update(b, ['lit']);
      // Against the target, every package still on the old build is named; the updated one is fine.
      const half = checkInstalledCombination(modules(consumer), expectation(b)).filter((finding) => finding.code === 'version-mismatch');
      expect(half.map((finding) => finding.package).sort()).toEqual(['components', 'core', 'mcp', 'react']);
      for (const finding of half) expect(finding.guidance).toContain(path.basename(named(b, finding.package!).tarball));
      // Against the old build, the updated package is the odd one out: wrong version, and siblings from the other build.
      const lit = checkInstalledCombination(modules(consumer), expectation(a)).filter((finding) => finding.package === 'lit');
      expect(lit.map((finding) => finding.code).sort()).toEqual(['range-mismatch', 'range-mismatch', 'version-mismatch']);
      for (const finding of lit) expect(finding.guidance).toContain(path.basename(named(a, 'lit').tarball));

      update(b);
      expect(checkInstalledCombination(modules(consumer), expectation(b))).toEqual([]);
      // The old candidate is now refused for every package, naming its own tarball to restore.
      const stale = checkInstalledCombination(modules(consumer), expectation(a));
      expect(stale.filter((finding) => finding.code === 'version-mismatch').map((finding) => finding.package).sort()).toEqual([...SDK_PACKAGES].sort());
      for (const finding of stale) expect(finding.guidance).toMatch(/rebuild the view/);
    });

    it('rolls back to the exact earlier combination, byte for byte', () => {
      const consumer = path.join(work, 'rollback');
      install(consumer, a);
      const before = SDK_PACKAGES.map((name) => fs.readFileSync(path.join(modules(consumer), '@saga-a2ui', name, 'package.json'), 'utf8'));
      install(consumer, b);
      install(consumer, a);
      expect(checkInstalledCombination(modules(consumer), expectation(a))).toEqual([]);
      expect(SDK_PACKAGES.map((name) => fs.readFileSync(path.join(modules(consumer), '@saga-a2ui', name, 'package.json'), 'utf8'))).toEqual(before);
    });

    it('reports a missing sibling the installed package requires, but not an absent optional peer', () => {
      const consumer = path.join(work, 'missing');
      install(consumer, a, ['lit', 'components']);
      const findings = checkInstalledCombination(modules(consumer), expectation(a));
      expect(findings.map((finding) => `${finding.code}:${finding.package}:${finding.expected}`).sort()).toEqual(['missing-dependency:components:@saga-a2ui/core', 'missing-dependency:lit:@saga-a2ui/core']);
      expect(findings[0]?.guidance).toContain(path.basename(named(a, 'core').tarball));
    });

    it('reports a package the candidate does not contain, and one that cannot be read', () => {
      const consumer = path.join(work, 'foreign');
      install(consumer, a, ['core']);
      fs.mkdirSync(path.join(modules(consumer), '@saga-a2ui', 'lynx'), { recursive: true });
      fs.writeFileSync(path.join(modules(consumer), '@saga-a2ui', 'lynx', 'package.json'), '{}');
      fs.mkdirSync(path.join(modules(consumer), '@saga-a2ui', 'mcp'), { recursive: true });
      const findings = checkInstalledCombination(modules(consumer), expectation(a));
      expect(findings.map((finding) => `${finding.code}:${finding.package}`).sort()).toEqual(['not-in-candidate:lynx', 'unreadable-package:mcp']);
    });
  });

  describe('a built view', () => {
    const html = Buffer.from('<notes-app></notes-app>', 'utf8');

    it('is the resource a candidate recorded when its bytes are the same', () => {
      expect(checkPagePairing(html, viewUriForHtml(html))).toEqual([]);
    });

    it('is refused, with the repair, when the bytes differ in any way', () => {
      const [finding, ...rest] = checkPagePairing(Buffer.from('<notes-app> </notes-app>', 'utf8'), viewUriForHtml(html));
      expect(rest).toEqual([]);
      expect(finding).toMatchObject({ code: 'resource-mismatch', expected: viewUriForHtml(html) });
      expect(finding?.guidance).toMatch(/Rebuild the view from the candidate packages/);
      expect(finding?.guidance).toMatch(/restart the server/);
    });
  });
});

describe('what a consumer build installed', () => {
  const packed = { core: { sha256: 'c0' }, lit: { sha256: 'l1' } } as unknown as Record<string, PackedPackage>;

  it('passes when every tarball is the candidate tarball and the revision is the same', () => {
    expect(() => assertInstalledTarballs('The consumer', { core: 'c0', lit: 'l1' }, packed)).not.toThrow();
    expect(() => assertSameRevision('The consumer', { sourceCommit: COMMIT_A, sourceDirty: false, packedTarballSha256: {} }, { commit: COMMIT_A, dirty: false })).not.toThrow();
  });

  it('refuses a consumer built from another tarball, naming the repair', () => {
    expect(() => assertInstalledTarballs('The consumer', { core: 'other' }, packed)).toThrow(/installed @saga-a2ui\/core other, which is not the candidate tarball c0.*npm run build/);
    expect(() => assertInstalledTarballs('The consumer', { react: 'r' }, packed)).toThrow(/not the candidate tarball \(none\)/);
  });

  it('refuses a consumer built from another revision, or from a modified tree when the candidate is clean', () => {
    const identity = { sourceCommit: COMMIT_B, sourceDirty: false, packedTarballSha256: {} };
    expect(() => assertSameRevision('The consumer', identity, { commit: COMMIT_A, dirty: false })).toThrow(/not the candidate's a{40}/);
    expect(() => assertSameRevision('The consumer', { ...identity, sourceCommit: COMMIT_A, sourceDirty: true }, { commit: COMMIT_A, dirty: false })).toThrow(/\(dirty\), not the candidate's/);
  });
});

describe('the checks a combination carries', () => {
  it('are all present in their files, so a claim never rests on a test that was renamed or removed', () => {
    expect(missingCarriedCases()).toEqual([]);
  });

  it('are reported missing from a record that predates them, naming what restoring it would undo', () => {
    const complete = { carriedEvidence: { cases: CARRIED_CASES.map(({ file, title }) => ({ file, title })) } };
    expect(floorFindings(complete)).toEqual([]);
    const authorization = CARRIED_CASES.find((one) => /authorizes every protected request/.test(one.title))!;
    const older = { carriedEvidence: { cases: complete.carriedEvidence.cases.filter((one) => one.title !== authorization.title) } };
    const [finding, ...rest] = floorFindings(older);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ code: 'floor-missing', expected: authorization.title });
    expect(finding?.guidance).toMatch(/silently undo that fix/);
    // A record with no list at all lacks every case.
    expect(floorFindings({})).toHaveLength(CARRIED_CASES.length);
  });
});
