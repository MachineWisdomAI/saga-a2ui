import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteSingleFile } from 'vite-plugin-singlefile';
import {
  buildConsumerApplication,
  bundleConsumerServer,
  createWorkDirectory,
  installPackedSdk,
  installPackedTarballs,
  linkDeclaredDependencies,
  repoRoot,
  type PackedPackage,
  type PackedSdk,
  type SdkPackage,
} from './packed-consumer.js';

// PACK1 and REACT1: builds the installed consumers of examples/pack1-consumer, each in its own
// clean directory outside the repository, from packed SDK tarballs alone (see packed-consumer.ts).
//
//   own   the application's own catalog alone: packs core, lit and mcp. The optional components
//         package is not installed, and the copy of the source does not contain the file that uses it.
//   card  the same catalog and behaviors plus the optional FaithfulCard: packs core, lit,
//         components and mcp.
//   react the same contract, server, actions and controller over a React catalog of the
//         application's own: packs core, react and mcp. Lit is not installed (REACT1).
//
// Each build produces the page an MCP host mounts (a single self-contained HTML document) and the
// consumer's MCP server, bundled against the installed copies. The browser specs then mount the
// page that the server itself serves (apps/lit-host/e2e/pack1-consumers.spec.ts).
//
//   npx tsx scripts/build-pack1-consumers.ts      # writes apps/lit-host/dist/pack1 (ignored)
//
// The packed copies are a local qualification artifact. Producing them is not publishing anything.

export const pack1Source = path.join(repoRoot, 'examples', 'pack1-consumer');
export const pack1Dist = path.join(repoRoot, 'apps', 'lit-host', 'dist', 'pack1');

/** The two Lit consumers: the combinations a release candidate records and rehearses. */
export type Pack1Consumer = 'own' | 'card';
/** Every consumer built from the notes source: the two above and the React consumer (REACT1). */
export type NotesConsumer = Pack1Consumer | 'react';

interface ConsumerRecipe {
  readonly packages: readonly SdkPackage[];
  readonly page: string;
  readonly entry: string;
  /** The files of the other consumers, which this copy of the source must not contain. */
  readonly leaveOut: readonly string[];
  /** The packages this consumer imports itself, besides the SDK packages. */
  readonly ownDependencies: readonly string[];
}

// The files only one renderer's consumers use. Everything else in the source (the contract, server,
// actions, controller, surface messages and the `Line` contract) is shared by all of them.
const LIT_FILES = ['src/notes-view.ts', 'src/notes-catalog.ts'];
const REACT_FILES = ['react.html', 'src/main-react.tsx', 'src/notes-react-view.tsx', 'src/notes-react-catalog.tsx'];

const LIT_DEPENDENCIES = ['@a2ui/lit', '@a2ui/web_core', '@modelcontextprotocol/client', '@modelcontextprotocol/ext-apps', '@modelcontextprotocol/server', 'lit', 'zod'];
const REACT_DEPENDENCIES = ['@a2ui/react', '@a2ui/web_core', '@modelcontextprotocol/client', '@modelcontextprotocol/ext-apps', '@modelcontextprotocol/server', 'react', 'react-dom', 'zod'];

export const PACK1_CONSUMERS: Record<Pack1Consumer, ConsumerRecipe> = {
  own: { packages: ['core', 'lit', 'mcp'], page: 'own.html', entry: 'src/main-own.ts', leaveOut: ['card.html', 'src/main-card.ts', ...REACT_FILES], ownDependencies: LIT_DEPENDENCIES },
  card: { packages: ['core', 'lit', 'components', 'mcp'], page: 'card.html', entry: 'src/main-card.ts', leaveOut: ['own.html', 'src/main-own.ts', ...REACT_FILES], ownDependencies: LIT_DEPENDENCIES },
};

/**
 * The React consumer shares the contract, server, actions, controller and fixtures of the Lit ones
 * and installs `react` instead of `lit`: no Lit element, no components package, no Markdown parser.
 * It is not in `PACK1_CONSUMERS`: a release candidate does not record it as a combination yet.
 */
export const NOTES_CONSUMERS: Record<NotesConsumer, ConsumerRecipe> = {
  ...PACK1_CONSUMERS,
  react: {
    packages: ['core', 'react', 'mcp'],
    page: 'react.html',
    entry: 'src/main-react.tsx',
    leaveOut: ['own.html', 'card.html', 'src/main-own.ts', 'src/main-card.ts', ...LIT_FILES],
    ownDependencies: REACT_DEPENDENCIES,
  },
};

export interface PreparedPack1 {
  readonly consumer: string;
  readonly sdk: PackedSdk;
  readonly recipe: ConsumerRecipe;
}

/** Copies the source for one consumer into `work` and installs exactly that consumer's packed SDK packages beside it. */
export function preparePack1Consumer(work: string, name: NotesConsumer, candidate?: readonly PackedPackage[]): PreparedPack1 {
  const recipe = NOTES_CONSUMERS[name];
  const consumer = path.join(work, 'consumer');
  const skipped = new Set(recipe.leaveOut.map((file) => path.join(pack1Source, file)));
  fs.cpSync(pack1Source, consumer, { recursive: true, filter: (from) => !from.includes('node_modules') && !skipped.has(from) });
  // Without a chosen candidate the packages are packed from this tree; with one (an update or a
  // rollback), exactly that candidate's tarballs for this consumer are installed.
  const sdk =
    candidate === undefined
      ? installPackedSdk(work, consumer, recipe.packages)
      : installPackedTarballs(
          consumer,
          recipe.packages.map((package_) => {
            const one = candidate.find((packed) => packed.name === package_);
            if (one === undefined) throw new Error(`The candidate has no @saga-a2ui/${package_}, which the ${name} consumer installs.`);
            return one;
          }),
        );
  linkDeclaredDependencies(consumer, sdk, recipe.ownDependencies);
  return { consumer, sdk, recipe };
}

/** The installed version of each named package, read from the consumer's own `node_modules`. */
export function installedVersionsOf(consumer: string, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, (JSON.parse(fs.readFileSync(path.join(consumer, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version]));
}

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export interface Pack1ConsumerIdentity {
  readonly installedPackages: readonly string[];
  readonly packedTarballSha256: Record<string, string>;
  /** The version of each third-party package the consumer imports itself, as installed when it was built. */
  readonly installedVersions: Record<string, string>;
  readonly builtPage: { readonly path: string; readonly sha256: string };
  readonly builtServer: { readonly path: string; readonly sha256: string };
}

export interface BuildPack1Options {
  /** Install this candidate's tarballs instead of packing the tree (see `preparePack1Consumer`). */
  readonly candidate?: readonly PackedPackage[];
  /** Called with the installed consumer before anything is built, so a caller can refuse a set it does not accept. */
  readonly beforeBuild?: (prepared: PreparedPack1) => void;
}

/** Builds one consumer into `outDir`: its page and its server. Each consumer gets a work directory of its own. */
export async function buildPack1Consumer(name: NotesConsumer, outDir: string, options: BuildPack1Options = {}): Promise<Pack1ConsumerIdentity> {
  const work = createWorkDirectory(`saga-pack1-${name}-`);
  try {
    const prepared = preparePack1Consumer(work, name, options.candidate);
    options.beforeBuild?.(prepared);
    const { consumer, sdk, recipe } = prepared;
    fs.rmSync(outDir, { recursive: true, force: true });
    await buildConsumerApplication(consumer, outDir, [viteSingleFile()], { page: recipe.page });
    const server = await bundleConsumerServer(consumer, 'server/index.ts');
    fs.copyFileSync(server.file, path.join(outDir, 'server.mjs'));
    const page = path.join(outDir, recipe.page);
    return {
      installedPackages: Object.keys(sdk.manifests).sort(),
      packedTarballSha256: sdk.tarballSha256,
      installedVersions: installedVersionsOf(consumer, recipe.ownDependencies),
      builtPage: { path: path.relative(repoRoot, page), sha256: sha256(page) },
      builtServer: { path: path.relative(repoRoot, path.join(outDir, 'server.mjs')), sha256: sha256(path.join(outDir, 'server.mjs')) },
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Builds every consumer, each from its own install, and returns the identities a review needs. */
export async function buildPack1Consumers(outDir: string): Promise<Record<string, unknown>> {
  const consumers: Record<string, Pack1ConsumerIdentity> = {};
  for (const name of Object.keys(NOTES_CONSUMERS) as NotesConsumer[]) consumers[name] = await buildPack1Consumer(name, path.join(outDir, name));
  return {
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
    sourceDirty: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: repoRoot, encoding: 'utf8' }).trim() !== '',
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    consumers,
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const identity = await buildPack1Consumers(pack1Dist);
  fs.writeFileSync(path.join(pack1Dist, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  console.log(JSON.stringify(identity, null, 2));
}
