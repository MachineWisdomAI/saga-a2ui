import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type InlineConfig, type PluginOption } from 'vite';

// Installs the SDK packages the way an application receives them, without a registry: each package
// is packed with `npm pack`, the tarball is unpacked into the node_modules of a clean directory
// outside the repository, and only the third-party dependencies the packed manifests declare (plus
// the consumer's own) are linked in from the repository's installed copies. A missing declaration,
// a workspace alias or a file left out of a package therefore fails the build instead of passing.
// The same code serves the headless packed-consumer tests and the browser consumer build.

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type SdkPackage = 'core' | 'lit' | 'components' | 'mcp' | 'react';

export interface PackedManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
}

interface PackedTarball {
  readonly filename: string;
  readonly files: readonly { readonly path: string }[];
}

export interface PackedSdk {
  /** The manifest of each installed package, as packed. */
  readonly manifests: Record<string, PackedManifest>;
  /** The files each tarball contains. */
  readonly files: Record<string, string[]>;
  /** The SHA-256 of each tarball, for recording exactly which artifacts were installed. */
  readonly tarballSha256: Record<string, string>;
}

/** A fresh scratch directory outside the repository. Remove it with `fs.rmSync(dir, { recursive: true, force: true })`. */
export function createWorkDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function link(name: string, into: string): void {
  const target = path.join(into, 'node_modules', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(path.join(repoRoot, 'node_modules', name), target, 'dir');
}

/**
 * Packs each SDK package and unpacks it as an installed dependency of `consumer`. The packages are
 * private and unversioned (see docs/version-policy.md), and `npm pack` refuses a manifest without a
 * version, so a copy carrying a throwaway version is packed; its `files` list and dependencies are the
 * package's own, and nothing in the repository is changed.
 */
export function installPackedSdk(work: string, consumer: string, packages: readonly SdkPackage[]): PackedSdk {
  const manifests: Record<string, PackedManifest> = {};
  const files: Record<string, string[]> = {};
  const tarballSha256: Record<string, string> = {};
  for (const name of packages) {
    const staged = path.join(work, 'staged', name);
    fs.cpSync(path.join(repoRoot, 'packages', name), staged, { recursive: true, filter: (from) => !from.includes('node_modules') });
    const manifestPath = path.join(staged, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '0.0.0-packed-test' }));
    // npm 12 reports the result keyed by package name; older releases report an array.
    const report = JSON.parse(
      execFileSync('npm', ['pack', '--json', '--silent', '--pack-destination', work], { cwd: staged, encoding: 'utf8' }),
    ) as Record<string, PackedTarball> | PackedTarball[];
    const packed = Object.values(report)[0]!;
    const target = path.join(consumer, 'node_modules', '@saga-a2ui', name);
    fs.mkdirSync(target, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(work, packed.filename), '-C', target, '--strip-components=1']);
    manifests[name] = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')) as PackedManifest;
    files[name] = packed.files.map((file) => file.path);
    tarballSha256[name] = createHash('sha256').update(fs.readFileSync(path.join(work, packed.filename))).digest('hex');
  }
  return { manifests, files, tarballSha256 };
}

/**
 * Links into the consumer every third-party package the installed manifests declare (hard
 * dependencies; an optional peer is the consumer's own choice) plus `own`, the packages the consumer
 * itself imports. SDK packages are never linked: only their packed copies are present.
 */
export function linkDeclaredDependencies(consumer: string, sdk: PackedSdk, own: readonly string[]): void {
  const declared = new Set<string>(own);
  for (const manifest of Object.values(sdk.manifests)) {
    for (const name of Object.keys(manifest.dependencies ?? {})) if (!name.startsWith('@saga-a2ui/')) declared.add(name);
  }
  for (const name of declared) if (!fs.existsSync(path.join(consumer, 'node_modules', name))) link(name, consumer);
}

/** Builds one consumer entry as a library and reports every module in its graph and the code produced. */
export async function bundleConsumerEntry(consumer: string, entry: string): Promise<{ modules: string[]; code: string }> {
  const result = await build({
    configFile: false,
    root: consumer,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: { entry: path.join(consumer, entry), formats: ['es'], fileName: 'consumer' },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) => ('output' in one ? one.output : []));
  const chunks = outputs.flatMap((output) => (output.type === 'chunk' ? [output] : []));
  return { modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)), code: chunks.map((chunk) => chunk.code).join('\n') };
}

/**
 * Builds one consumer server entry for Node and reports every module in its graph. The installed
 * SDK packages are bundled in (their sources are TypeScript, which Node cannot load from
 * node_modules); every other dependency stays external and resolves from the consumer's links.
 */
export async function bundleConsumerServer(consumer: string, entry: string): Promise<{ file: string; modules: string[] }> {
  const outDir = path.join(consumer, '.server');
  const result = await build({
    configFile: false,
    root: consumer,
    logLevel: 'silent',
    ssr: { noExternal: [/^@saga-a2ui\//] },
    build: {
      write: true,
      outDir,
      emptyOutDir: true,
      minify: false,
      ssr: path.join(consumer, entry),
      target: 'es2022',
      rollupOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) => ('output' in one ? one.output : []));
  const chunks = outputs.flatMap((output) => (output.type === 'chunk' ? [output] : []));
  return { file: path.join(outDir, 'server.mjs'), modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)) };
}

/**
 * Builds one of the consumer's HTML pages into `outDir`; the built file keeps the page's name
 * (`index.html` unless `page` names another). Plugins come from the repository's own tooling. A
 * consumer with several pages builds each in its own call, and `emptyOutDir: false` keeps what an
 * earlier call wrote there.
 */
export async function buildConsumerApplication(
  consumer: string,
  outDir: string,
  plugins: PluginOption[],
  options: { readonly page?: string; readonly emptyOutDir?: boolean } = {},
): Promise<void> {
  const config: InlineConfig = {
    configFile: false,
    root: consumer,
    base: './',
    logLevel: 'warn',
    plugins,
    build: {
      outDir,
      emptyOutDir: options.emptyOutDir ?? true,
      target: 'es2022',
      ...(options.page === undefined ? {} : { rollupOptions: { input: path.join(consumer, options.page) } }),
    },
  };
  await build(config);
}
