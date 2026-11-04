import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type InlineConfig, type PluginOption } from 'vite';
import {
  OwnedDirectory,
  UnsafePath,
  readContainedFile,
} from './owned-filesystem.js';

// Installs the SDK packages the way an application receives them, without a registry: each package
// is packed with `npm pack`, the tarball is unpacked into the node_modules of a clean directory
// outside the repository, and only the third-party dependencies the packed manifests declare (plus
// the consumer's own) are linked in from the repository's installed copies. A missing declaration,
// a workspace alias or a file left out of a package therefore fails the build instead of passing.
// The same code serves the headless packed-consumer tests and the browser consumer build.

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export type SdkPackage =
  | 'core'
  | 'lit'
  | 'components'
  | 'mcp'
  | 'react'
  | 'react-mcp-stack'
  | 'lit-mcp-stack';

export interface PackedManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<
    string,
    { readonly optional?: boolean }
  >;
}

interface PackedTarball {
  readonly filename: string;
  readonly integrity: string;
  readonly files: readonly { readonly path: string; readonly size: number }[];
}

export interface PackedSdk {
  /** The candidate version every installed package carries (see `candidateVersion`). */
  readonly version: string;
  /** The manifest of each installed package, as packed. */
  readonly manifests: Record<string, PackedManifest>;
  /** The files each tarball contains. */
  readonly files: Record<string, string[]>;
  /** The SHA-256 of each tarball, for recording exactly which artifacts were installed. */
  readonly tarballSha256: Record<string, string>;
}

/** One packed candidate artifact: the tarball on disk and what it contains. */
export interface PackedPackage {
  readonly name: SdkPackage;
  readonly version: string;
  /** Absolute path of the `.tgz`. */
  readonly tarball: string;
  readonly sha256: string;
  /** npm's own `sha512-…` integrity string for the tarball. */
  readonly integrity: string;
  readonly bytes: number;
  readonly files: readonly { readonly path: string; readonly bytes: number }[];
  readonly manifest: PackedManifest;
  /** SHA-256 over the Git-tracked package files (path and content) the tarball was built from. */
  readonly sourceSha256: string;
  /** Files below the package directory that Git does not track (untracked and ignored alike) and that were left out of the tarball. */
  readonly excludedUntracked: readonly string[];
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
 * The prerelease version a candidate build carries: `0.0.0-candidate.g<first 12 hex of the commit>`,
 * with `.dirty` appended when tracked files differ from that commit. This identity exists only in
 * the staged candidate copy, independently of enrolled release versions (docs/version-policy.md),
 * so it names a build of one revision and is never a release, a tag or an npm availability claim.
 * The leading `g` keeps an all-digit commit prefix a valid semver identifier.
 */
export function candidateVersion(commit: string, dirty: boolean): string {
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(
      `A candidate version needs a full 40-hex commit, got "${commit}".`,
    );
  return `0.0.0-candidate.g${commit.slice(0, 12)}${dirty ? '.dirty' : ''}`;
}

/** The commit and tracked-file state of the repository this script runs from. Untracked files never enter an artifact (see `stageTrackedFiles`), so they do not make a build dirty; the packages that left some out say so. */
export function sourceRevision(): {
  readonly commit: string;
  readonly dirty: boolean;
} {
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: git(['status', '--porcelain=v1', '--untracked-files=no']) !== '',
  };
}

/** Where an accidental `npm publish` of a candidate tarball would go: nowhere. */
export const CANDIDATE_REGISTRY = 'https://candidate-artifact.invalid/';

/** Packages whose tarball also carries the repository's third-party notices, because their dependency is bundled into a consumer's view. */
const SHIPS_THIRD_PARTY_NOTICES: readonly SdkPackage[] = ['components'];

/** The files of a candidate tarball that are neither source, the manifest nor a license obligation: expected to be none. */
export function unexpectedPackageFiles(
  name: SdkPackage | string,
  files: readonly string[],
): string[] {
  const obligations = [
    'package.json',
    'README.md',
    'LICENSE',
    ...(SHIPS_THIRD_PARTY_NOTICES.includes(name as SdkPackage)
      ? ['THIRD_PARTY_NOTICES.md']
      : []),
  ];
  return files.filter(
    (file) => !obligations.includes(file) && !file.startsWith('src/'),
  );
}

/**
 * The manifest a candidate tarball carries: the repository manifest with the candidate version, every
 * SDK-to-SDK dependency and peer range pinned to exactly that version, and the notice files listed.
 * Repository ranges must be `*` or the sibling
 * package's enrolled version; other forms are rejected. `private` is forced true, and `publishConfig.registry` names
 * a host that cannot resolve (`.invalid`, RFC 6761), so passing the artifact to `npm publish` aims
 * it at nothing instead of the public registry. npm 12.0.2 accepts a private manifest in
 * `publish --dry-run`, so neither field is relied on alone: publication is a separate, authorized
 * act, and no CI job holds a publish credential.
 */
export function candidateManifest(
  manifest: Record<string, unknown>,
  version: string,
  extraFiles: readonly string[] = [],
  siblingVersions: Readonly<Record<string, string>> = {},
): Record<string, unknown> {
  const pinned: Record<string, unknown> = {
    ...manifest,
    private: true,
    version,
    publishConfig: { registry: CANDIDATE_REGISTRY },
  };
  for (const field of [
    'dependencies',
    'peerDependencies',
    'devDependencies',
  ] as const) {
    const group = manifest[field] as Record<string, string> | undefined;
    if (group === undefined) continue;
    pinned[field] = Object.fromEntries(
      Object.entries(group).map(([name, range]) => {
        if (!name.startsWith('@saga-a2ui/')) return [name, range];
        if (range !== '*' && range !== siblingVersions[name])
          throw new Error(
            `${String(manifest.name)} ${field}.${name} is "${range}"; an SDK package is declared as "*" or its enrolled sibling version in the repository.`,
          );
        return [name, version];
      }),
    );
  }
  if (extraFiles.length > 0)
    pinned.files = [
      ...((manifest.files as string[] | undefined) ?? []),
      ...extraFiles,
    ];
  return pinned;
}

/**
 * Packs each SDK package into `destination` as a candidate artifact. A staged copy carries the
 * candidate manifest and the repository LICENSE (Apache-2.0 requires the license to travel with the
 * code), and the third-party notices where a package brings in code that a consumer bundles; the
 * repository is not changed. npm 12 reports the result keyed by package name; older releases
 * report an array.
 */
export function packSdkPackages(
  work: string,
  packages: readonly SdkPackage[],
  destination: string | OwnedDirectory,
  version: string,
): PackedPackage[] {
  const siblingVersions = Object.fromEntries(
    fs.readdirSync(path.join(repoRoot, 'packages')).flatMap((name) => {
      const file = path.join(repoRoot, 'packages', name, 'package.json');
      if (!fs.existsSync(file)) return [];
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        name: string;
        version?: string;
      };
      return manifest.version === undefined
        ? []
        : [[manifest.name, manifest.version]];
    }),
  );
  return packPackages(work, packages, destination, (manifest, notices) =>
    candidateManifest(manifest, version, notices, siblingVersions),
  );
}

/** Pack enrolled release manifests unchanged except for license-file inclusion. Never publishes. */
export function packReleasePackages(
  work: string,
  destination: string | OwnedDirectory,
): PackedPackage[] {
  const packages: readonly SdkPackage[] = [
    'core',
    'components',
    'mcp',
    'react',
    'react-mcp-stack',
    'lit',
    'lit-mcp-stack',
  ];
  const versions = Object.fromEntries(
    packages.map((name) => {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(repoRoot, 'packages', name, 'package.json'),
          'utf8',
        ),
      ) as Record<string, unknown>;
      if (manifest.private !== false || typeof manifest.version !== 'string')
        throw new Error(
          `${name} must have an enrolled public release manifest.`,
        );
      return [`@saga-a2ui/${name}`, manifest.version];
    }),
  );
  return packPackages(work, packages, destination, (manifest, notices) => {
    for (const field of ['dependencies', 'peerDependencies'] as const) {
      for (const [name, range] of Object.entries(
        (manifest[field] ?? {}) as Record<string, string>,
      )) {
        if (name.startsWith('@saga-a2ui/') && range !== versions[name])
          throw new Error(
            `${String(manifest.name)} must pin ${name} to its release version.`,
          );
      }
    }
    return {
      ...manifest,
      files: [...((manifest.files as string[] | undefined) ?? []), ...notices],
    };
  });
}

interface TrackedEntry {
  readonly mode: string;
  readonly path: string;
}

const gitIn = (root: string, args: string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });

/** What Git tracks at `pathspec`: regular files only. A link, a submodule or an unmerged path is refused. */
function trackedEntries(root: string, pathspec: string): TrackedEntry[] {
  return gitIn(root, ['ls-files', '-s', '-z', '--', pathspec])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta = '', file = ''] = line.split('\t');
      const [mode = '', , stage = ''] = meta.split(' ');
      if (stage !== '0' || (mode !== '100644' && mode !== '100755'))
        throw new UnsafePath(
          `${file} is not a plain tracked file (mode ${mode}, stage ${stage}); a release artifact is built from regular tracked files only.`,
        );
      return { mode, path: file };
    });
}

/**
 * Copies the files Git tracks below `subdirectory` of `root` into `destination`, and nothing else:
 * an untracked file, an ignored one or a stray build output cannot reach the artifact, whatever the
 * package's `files` list selects. Each file is read from the working tree through the contained
 * reader (so a file replaced by a link is refused); a tracked file the working tree has changed or
 * deleted is what `sourceRevision` reports as dirty. Returns the identity of what was staged and
 * the files below `subdirectory` that Git does not track, ignored ones included, left out. Git LFS content is the working tree's, exactly as a clean checkout
 * of the commit smudges it.
 *
 * `auxiliary` names repository files (the license, the notices) staged at the root of
 * `destination`. Each must be exactly one regular tracked entry at that path (an untracked or
 * index-deleted file, a link or an unmerged path is refused), and its path and content are bound
 * into the returned identity, so the identity covers everything the artifact was built from.
 */
export function stageTrackedFiles(
  root: string,
  subdirectory: string,
  destination: string,
  auxiliary: readonly string[] = [],
): { readonly sourceSha256: string; readonly excludedUntracked: string[] } {
  const entries = trackedEntries(root, subdirectory);
  if (entries.length === 0)
    throw new UnsafePath(`Git tracks no files below ${subdirectory}.`);
  const identity = createHash('sha256');
  for (const entry of entries) {
    const relative = entry.path.slice(subdirectory.length + 1);
    const data = readContainedFile(root, entry.path);
    const out = path.join(destination, relative);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data, {
      mode: entry.mode === '100755' ? 0o755 : 0o644,
    });
    identity
      .update(`${relative}\0`)
      .update(createHash('sha256').update(data).digest())
      .update('\n');
  }
  for (const file of auxiliary) {
    const [entry, ...rest] = trackedEntries(root, file);
    if (entry === undefined || rest.length > 0 || entry.path !== file)
      throw new UnsafePath(
        `${file} is not tracked by Git as one regular file; a release artifact ships only tracked auxiliary files.`,
      );
    const data = readContainedFile(root, file);
    fs.writeFileSync(path.join(destination, file), data);
    identity
      .update(`auxiliary:${file}\0`)
      .update(createHash('sha256').update(data).digest())
      .update('\n');
  }
  // No `--exclude-standard`: an ignored file is left out of the tarball too, so it is named too.
  const excludedUntracked = gitIn(root, [
    'ls-files',
    '-z',
    '--others',
    '--',
    subdirectory,
  ])
    .split('\0')
    .filter(Boolean)
    .map((file) => file.slice(subdirectory.length + 1))
    .sort();
  return { sourceSha256: identity.digest('hex'), excludedUntracked };
}

function packPackages(
  work: string,
  packages: readonly SdkPackage[],
  destination: string | OwnedDirectory,
  prepare: (
    manifest: Record<string, unknown>,
    notices: string[],
  ) => Record<string, unknown>,
): PackedPackage[] {
  // The output directory keeps its identity through every write. `npm pack` never touches it: it
  // packs into a private scratch directory, and each tarball then replaces its fixed leaf through
  // a temporary file and a rename, so a link or file already at that leaf is replaced, never
  // written through.
  const output =
    destination instanceof OwnedDirectory
      ? destination
      : OwnedDirectory.create(destination);
  return packages.map((name) => {
    const staged = path.join(work, 'staged', name);
    const notices = SHIPS_THIRD_PARTY_NOTICES.includes(name)
      ? ['THIRD_PARTY_NOTICES.md']
      : [];
    const { sourceSha256, excludedUntracked } = stageTrackedFiles(
      repoRoot,
      `packages/${name}`,
      staged,
      ['LICENSE', ...notices],
    );
    const manifestPath = path.join(staged, 'package.json');
    const manifest = JSON.parse(
      fs.readFileSync(manifestPath, 'utf8'),
    ) as Record<string, unknown>;
    const prepared = prepare(manifest, notices);
    fs.writeFileSync(manifestPath, JSON.stringify(prepared));
    const scratch = fs.mkdtempSync(path.join(work, 'tarball-'));
    const report = JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--json', '--silent', '--pack-destination', scratch],
        { cwd: staged, encoding: 'utf8' },
      ),
    ) as Record<string, PackedTarball> | PackedTarball[];
    const packed = Object.values(report)[0]!;
    const bytes = readContainedFile(scratch, packed.filename);
    output.writeFile(packed.filename, bytes);
    const tarball = path.join(output.path, packed.filename);
    return {
      name,
      version: prepared.version as string,
      tarball,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      integrity: packed.integrity,
      bytes: bytes.length,
      files: packed.files.map((file) => ({
        path: file.path,
        bytes: file.size,
      })),
      manifest: JSON.parse(
        fs.readFileSync(manifestPath, 'utf8'),
      ) as PackedManifest,
      sourceSha256,
      excludedUntracked,
    };
  });
}

/** Unpacks one candidate tarball as an installed dependency of `consumer`. */
export function unpackIntoConsumer(
  consumer: string,
  packed: PackedPackage,
): void {
  const target = path.join(consumer, 'node_modules', '@saga-a2ui', packed.name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    packed.tarball,
    '-C',
    target,
    '--strip-components=1',
  ]);
}

/**
 * Packs each SDK package as a candidate artifact (see `packSdkPackages`) and unpacks it as an
 * installed dependency of `consumer`. Every consumer of this repository's packages therefore builds
 * from the artifact a candidate publishes, not from a differently prepared copy.
 */
export function installPackedSdk(
  work: string,
  consumer: string,
  packages: readonly SdkPackage[],
): PackedSdk {
  const { commit, dirty } = sourceRevision();
  return installPackedTarballs(
    consumer,
    packSdkPackages(work, packages, work, candidateVersion(commit, dirty)),
  );
}

/** Unpacks already packed candidate artifacts as the installed dependencies of `consumer` (an update or a rollback installs a chosen set this way). */
export function installPackedTarballs(
  consumer: string,
  packed: readonly PackedPackage[],
): PackedSdk {
  const version = packed[0]?.version;
  if (version === undefined)
    throw new Error('Installing a candidate needs packages.');
  const manifests: Record<string, PackedManifest> = {};
  const files: Record<string, string[]> = {};
  const tarballSha256: Record<string, string> = {};
  for (const one of packed) {
    unpackIntoConsumer(consumer, one);
    manifests[one.name] = JSON.parse(
      fs.readFileSync(
        path.join(
          consumer,
          'node_modules',
          '@saga-a2ui',
          one.name,
          'package.json',
        ),
        'utf8',
      ),
    ) as PackedManifest;
    files[one.name] = one.files.map((file) => file.path);
    tarballSha256[one.name] = one.sha256;
  }
  return { version, manifests, files, tarballSha256 };
}

/**
 * Links into the consumer every third-party package the installed manifests declare (hard
 * dependencies; an optional peer is the consumer's own choice) plus `own`, the packages the consumer
 * itself imports. SDK packages are never linked: only their packed copies are present.
 */
export function linkDeclaredDependencies(
  consumer: string,
  sdk: PackedSdk,
  own: readonly string[],
): void {
  const declared = new Set<string>(own);
  for (const manifest of Object.values(sdk.manifests)) {
    for (const name of Object.keys(manifest.dependencies ?? {}))
      if (!name.startsWith('@saga-a2ui/')) declared.add(name);
  }
  for (const name of declared)
    if (!fs.existsSync(path.join(consumer, 'node_modules', name)))
      link(name, consumer);
}

/** Builds one consumer entry as a library and reports every module in its graph and the code produced. */
export async function bundleConsumerEntry(
  consumer: string,
  entry: string,
): Promise<{ modules: string[]; code: string }> {
  const result = await build({
    configFile: false,
    root: consumer,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      target: 'es2022',
      lib: {
        entry: path.join(consumer, entry),
        formats: ['es'],
        fileName: 'consumer',
      },
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
    code: chunks.map((chunk) => chunk.code).join('\n'),
  };
}

/**
 * Builds one consumer server entry for Node and reports every module in its graph. The installed
 * SDK packages are bundled in (their sources are TypeScript, which Node cannot load from
 * node_modules); every other dependency stays external and resolves from the consumer's links.
 */
export async function bundleConsumerServer(
  consumer: string,
  entry: string,
): Promise<{ file: string; modules: string[] }> {
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
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((one) =>
    'output' in one ? one.output : [],
  );
  const chunks = outputs.flatMap((output) =>
    output.type === 'chunk' ? [output] : [],
  );
  return {
    file: path.join(outDir, 'server.mjs'),
    modules: chunks.flatMap((chunk) => Object.keys(chunk.modules)),
  };
}

/**
 * Builds a page with one of the consumer's own Vite configuration files (copied beside it, so the
 * application's plugins, root and output directory are what an application outside this
 * repository would use) and returns every module in the build's graph. The configuration's
 * relative `outDir` resolves inside `consumer`.
 */
export async function buildConsumerFromConfig(
  consumer: string,
  configFile: string,
): Promise<string[]> {
  const modules: string[] = [];
  const collect: PluginOption = {
    name: 'record-module-graph',
    enforce: 'pre',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle))
        if (output.type === 'chunk')
          modules.push(...Object.keys(output.modules));
    },
  };
  // Vite resolves a configuration's relative `root` from the working directory, as `npm run build` runs it.
  const previous = process.cwd();
  process.chdir(consumer);
  try {
    await build({
      configFile: path.join(consumer, configFile),
      logLevel: 'warn',
      plugins: [collect],
    });
  } finally {
    process.chdir(previous);
  }
  return modules;
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
      ...(options.page === undefined
        ? {}
        : { rollupOptions: { input: path.join(consumer, options.page) } }),
    },
  };
  await build(config);
}
