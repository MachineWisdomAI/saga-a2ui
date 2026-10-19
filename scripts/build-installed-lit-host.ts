import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildConsumerFromConfig,
  createWorkDirectory,
  installPackedSdk,
  linkDeclaredDependencies,
  repoRoot,
  type PackedSdk,
} from './packed-consumer.js';

// Builds the browser pages of apps/lit-host (the representative application, its MCP views and the
// synthetic action consumer) the way an application outside this repository would receive SAGA
// (VIEW2). The core, Lit, optional components and MCP packages are packed, unpacked into a clean
// directory outside the repository as installed dependencies, a copy of the application is built
// there with its own Vite configurations, and nothing in the workspace is on the resolution path
// (see packed-consumer.ts). The existing Playwright specs then run against this build through
// `SAGA_BUILT_DIR=dist-installed` (apps/lit-host/e2e/built-artifacts.ts).
//
//   npx tsx scripts/build-installed-lit-host.ts   # writes apps/lit-host/dist-installed (ignored)
//
// The packed copies are a local qualification artifact: this is neither a registry installation
// nor a publication.

export const litHostSource = path.join(repoRoot, 'apps', 'lit-host');
export const installedLitHostDist = path.join(litHostSource, 'dist-installed');

/** The SDK packages the application and its pages import (`apps/lit-host/package.json` also names React, which no page built here uses). */
export const INSTALLED_SDK_PACKAGES = ['core', 'lit', 'components', 'mcp'] as const;

/** The packages the application itself imports, besides the SDK packages, plus the build tooling its Vite configurations load. */
export const LIT_HOST_OWN_DEPENDENCIES = [
  '@a2ui/lit',
  '@a2ui/web_core',
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/core',
  '@modelcontextprotocol/ext-apps',
  'jose',
  'lit',
  'vite',
  'vite-plugin-singlefile',
  'zod',
];

/** The application's own Vite configurations that build a browser page, in the order `npm run build` runs them (the first empties `dist`). */
export const INSTALLED_PAGE_CONFIGS = [
  'vite.config.ts',
  'vite.view.config.ts',
  'vite.subscriptions-view.config.ts',
  'vite.answer-view.config.ts',
  'vite.playback-view.config.ts',
  'vite.host-fixture.config.ts',
  'vite.catalog-isolation.config.ts',
  'vite.action-consumer.config.ts',
] as const;

const COPIED_ENTRIES = ['src', 'e2e/action-consumer', 'e2e/archive-fixture', 'e2e/catalog-isolation', 'e2e/host-fixture', 'tsconfig.json', ...INSTALLED_PAGE_CONFIGS];

export interface PreparedLitHost {
  readonly consumer: string;
  readonly sdk: PackedSdk;
}

/** Copies the application's page sources into `work` and installs the packed SDK packages beside them. */
export function prepareInstalledLitHost(work: string): PreparedLitHost {
  const consumer = path.join(work, 'consumer');
  const isTest = (from: string): boolean => /\.(test|spec)\.ts$/.test(from);
  for (const entry of [...COPIED_ENTRIES, ...fs.readdirSync(litHostSource).filter((name) => name.endsWith('.html'))]) {
    const target = path.join(consumer, entry);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(litHostSource, entry), target, { recursive: true, filter: (from) => !from.includes('node_modules') && !isTest(from) });
  }
  // The application is an ES module package, so its Vite configurations load as such.
  fs.writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({ private: true, type: 'module' })}\n`);
  const sdk = installPackedSdk(work, consumer, INSTALLED_SDK_PACKAGES);
  linkDeclaredDependencies(consumer, sdk, LIT_HOST_OWN_DEPENDENCIES);
  return { consumer, sdk };
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function filesUnder(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesUnder(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))
    .sort();
}

export interface ModuleProvenance {
  /** The installed SDK modules in the page's graph, as `@saga-a2ui/<package>/src/...`. */
  readonly installedSdkFiles: readonly string[];
  /** Modules from the application's own copied sources. */
  readonly applicationModules: number;
  /** The third-party packages (from the repository's installed copies, linked in, never SDK) the page's graph loads modules from. */
  readonly thirdPartyPackages: readonly string[];
  /** Anything else: a workspace SDK source, a workspace application file or an unexpected location. Must be empty. */
  readonly unexpected: readonly string[];
}

function thirdPartyPackageName(file: string): string {
  const marker = `${path.sep}node_modules${path.sep}`;
  const parts = file.slice(file.lastIndexOf(marker) + marker.length).split(path.sep);
  return parts[0]!.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

/** Classifies every module of one build against where an installed consumer may legitimately load it from. */
export function classifyModules(consumer: string, modules: readonly string[]): ModuleProvenance {
  const installedRoot = path.join(consumer, 'node_modules', '@saga-a2ui') + path.sep;
  const installedSdkFiles: string[] = [];
  const thirdParty = new Set<string>();
  const unexpected: string[] = [];
  let applicationModules = 0;
  for (const id of new Set(modules)) {
    const file = id.split('?')[0]!;
    if (file.startsWith('\0') || !path.isAbsolute(file)) continue; // Vite's virtual helpers
    if (file.startsWith(installedRoot)) {
      installedSdkFiles.push(`@saga-a2ui/${file.slice(installedRoot.length).split(path.sep).join('/')}`);
    } else if (file.startsWith(consumer + path.sep) && !file.includes(`${path.sep}node_modules${path.sep}`)) {
      applicationModules += 1;
    } else if (file.startsWith(path.join(repoRoot, 'node_modules') + path.sep) && !file.includes(`${path.sep}@saga-a2ui${path.sep}`)) {
      thirdParty.add(thirdPartyPackageName(file));
    } else {
      unexpected.push(file);
    }
  }
  return { installedSdkFiles: installedSdkFiles.sort(), applicationModules, thirdPartyPackages: [...thirdParty].sort(), unexpected: unexpected.sort() };
}

export interface BuiltPage {
  readonly config: string;
  readonly provenance: ModuleProvenance;
}

export interface InstalledLitHostIdentity {
  readonly sourceCommit: string;
  readonly sourceDirty: boolean;
  readonly node: string;
  readonly npm: string;
  /** SHA-256 of each packed SDK tarball the build installed. */
  readonly packedTarballSha256: Record<string, string>;
  /** SHA-256 of each file written under the output directory, keyed by its path there. */
  readonly builtFilesSha256: Record<string, string>;
  readonly pages: readonly BuiltPage[];
}

/**
 * Builds every page into `outDir` and returns the identities a review needs: the source commit, the
 * runtime, the packed tarball digests, each built file's digest and, per page build, where its
 * modules came from. A module loaded from the workspace instead of an installed copy fails the
 * build rather than being reported.
 */
export async function buildInstalledLitHost(outDir: string): Promise<InstalledLitHostIdentity> {
  const work = createWorkDirectory('saga-installed-lit-host-');
  try {
    const { consumer, sdk } = prepareInstalledLitHost(work);
    const pages: BuiltPage[] = [];
    for (const config of INSTALLED_PAGE_CONFIGS) {
      const provenance = classifyModules(consumer, await buildConsumerFromConfig(consumer, config));
      if (provenance.unexpected.length > 0) throw new Error(`${config} loaded modules from outside the installed packages: ${provenance.unexpected.join(', ')}`);
      pages.push({ config, provenance });
    }
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.cpSync(path.join(consumer, 'dist'), outDir, { recursive: true });
    return {
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
      sourceDirty: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: repoRoot, encoding: 'utf8' }).trim() !== '',
      node: process.version,
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      packedTarballSha256: sdk.tarballSha256,
      builtFilesSha256: Object.fromEntries(filesUnder(outDir).map((file) => [path.relative(outDir, file).split(path.sep).join('/'), sha256(file)])),
      pages,
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const identity = await buildInstalledLitHost(installedLitHostDist);
  fs.writeFileSync(path.join(installedLitHostDist, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  console.log(JSON.stringify(identity, null, 2));
}
