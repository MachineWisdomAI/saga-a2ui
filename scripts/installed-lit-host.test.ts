import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildInstalledLitHost, INSTALLED_PAGE_CONFIGS, INSTALLED_SDK_PACKAGES, type BuiltPage, type InstalledLitHostIdentity } from './build-installed-lit-host.js';
import { createWorkDirectory } from './packed-consumer.js';

// The application's browser pages (apps/lit-host) built outside the repository from the packed SDK
// packages. This checks what that build consists of: where every module came from, what each page
// does not carry, and the identities that name the result. The pages themselves are exercised in a
// browser by the existing specs, run against this build with SAGA_BUILT_DIR=dist-installed.

const work = createWorkDirectory('saga-installed-lit-host-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('the application pages built from the packed SDK packages', () => {
  const out = path.join(work, 'dist-installed');
  let identity: InstalledLitHostIdentity;
  const page = (config: string): BuiltPage => {
    const found = identity.pages.find((one) => one.config === config);
    if (found === undefined) throw new Error(`no build of ${config}`);
    return found;
  };
  const sdkPackagesOf = (config: string): string[] => [...new Set(page(config).provenance.installedSdkFiles.map((file) => file.split('/').slice(0, 2).join('/')))];

  beforeAll(async () => {
    identity = await buildInstalledLitHost(out);
  }, 300_000);

  it('builds every page with the application\'s own configurations, loading SDK code only from the installed copies', () => {
    expect(identity.pages.map((one) => one.config)).toEqual([...INSTALLED_PAGE_CONFIGS]);
    for (const { config, provenance } of identity.pages) {
      // Nothing came from a workspace package or application file; every SDK module is a packed `src/` file.
      expect(provenance.unexpected, config).toEqual([]);
      expect(provenance.applicationModules, config).toBeGreaterThan(0);
      for (const file of provenance.installedSdkFiles) {
        expect(file, config).toMatch(new RegExp(`^@saga-a2ui/(${INSTALLED_SDK_PACKAGES.join('|')})/src/`));
      }
    }
    // The pages that use the SDK reach its public entry points through the installed copies.
    expect(page('vite.config.ts').provenance.installedSdkFiles).toContain('@saga-a2ui/lit/src/a2ui/app-element.ts');
    expect(page('vite.action-consumer.config.ts').provenance.installedSdkFiles).toEqual(
      expect.arrayContaining(['@saga-a2ui/lit/src/a2ui/app-element.ts', '@saga-a2ui/lit/src/actions/lit-actions.ts', '@saga-a2ui/core/src/actions/server.ts']),
    );
    expect(page('vite.answer-view.config.ts').provenance.installedSdkFiles).toEqual(
      expect.arrayContaining(['@saga-a2ui/lit/src/a2ui/app-element.ts', '@saga-a2ui/mcp/src/view/index.ts']),
    );
    expect(page('vite.playback-view.config.ts').provenance.installedSdkFiles).toContain('@saga-a2ui/mcp/src/policy/timer.ts');
  });

  it('keeps the optional FaithfulCard, its Markdown parser and React out of every page that does not use them', () => {
    for (const config of ['vite.action-consumer.config.ts', 'vite.answer-view.config.ts', 'vite.subscriptions-view.config.ts', 'vite.playback-view.config.ts', 'vite.host-fixture.config.ts']) {
      const { installedSdkFiles, thirdPartyPackages } = page(config).provenance;
      expect(installedSdkFiles.filter((file) => /^@saga-a2ui\/components\/|\/faithful-card\//.test(file)), config).toEqual([]);
      expect(thirdPartyPackages.filter((name) => /markdown-it|^react/.test(name)), config).toEqual([]);
    }
    // The own-catalog and action route needs only core and Lit.
    expect(sdkPackagesOf('vite.action-consumer.config.ts').sort()).toEqual(['@saga-a2ui/core', '@saga-a2ui/lit']);
    for (const { config, provenance } of identity.pages) {
      expect(provenance.thirdPartyPackages.filter((name) => /^react/.test(name)), config).toEqual([]);
    }
  });

  it('puts no server module of the delivery package or the MCP server libraries in any browser page', () => {
    for (const { config, provenance } of identity.pages) {
      expect(provenance.installedSdkFiles.filter((file) => /^@saga-a2ui\/mcp\/src\/server\//.test(file)), config).toEqual([]);
      expect(provenance.thirdPartyPackages.filter((name) => /^@modelcontextprotocol\/(server|node)$/.test(name)), config).toEqual([]);
    }
  });

  it('names the result: the packed tarballs and every built file by SHA-256, matching the bytes written', () => {
    expect(Object.keys(identity.packedTarballSha256).sort()).toEqual([...INSTALLED_SDK_PACKAGES].sort());
    for (const hash of Object.values(identity.packedTarballSha256)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    const listed = Object.keys(identity.builtFilesSha256);
    for (const required of [
      'index.html',
      'view/view.html',
      'answer-view/answer.html',
      'subscriptions-view/subscriptions.html',
      'playback-view/playback.html',
      'host-fixture/index.html',
      'catalog-isolation/index.html',
      'action-consumer/index.html',
    ]) {
      expect(listed, required).toContain(required);
    }
    for (const [file, hash] of Object.entries(identity.builtFilesSha256)) {
      // Derived here from the bytes on disk (the requirement), not from the builder's own function.
      expect(createHash('sha256').update(fs.readFileSync(path.join(out, file))).digest('hex'), file).toBe(hash);
    }
  });
});
