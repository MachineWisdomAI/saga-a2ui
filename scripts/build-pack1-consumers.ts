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
  linkDeclaredDependencies,
  repoRoot,
  type PackedSdk,
  type SdkPackage,
} from './packed-consumer.js';

// PACK1: builds the two installed consumers of examples/pack1-consumer, each in its own clean
// directory outside the repository, from packed SDK tarballs alone (see packed-consumer.ts).
//
//   own   the application's own catalog alone: packs core, lit and mcp. The optional components
//         package is not installed, and the copy of the source does not contain the file that uses it.
//   card  the same catalog and behaviors plus the optional FaithfulCard: packs core, lit,
//         components and mcp.
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

export type Pack1Consumer = 'own' | 'card';

interface ConsumerRecipe {
  readonly packages: readonly SdkPackage[];
  readonly page: string;
  readonly entry: string;
  /** The files of the other consumer, which this copy of the source must not contain. */
  readonly leaveOut: readonly string[];
}

export const PACK1_CONSUMERS: Record<Pack1Consumer, ConsumerRecipe> = {
  own: { packages: ['core', 'lit', 'mcp'], page: 'own.html', entry: 'src/main-own.ts', leaveOut: ['card.html', 'src/main-card.ts'] },
  card: { packages: ['core', 'lit', 'components', 'mcp'], page: 'card.html', entry: 'src/main-card.ts', leaveOut: ['own.html', 'src/main-own.ts'] },
};

/** The packages a consumer imports itself, besides the SDK packages. */
export const PACK1_OWN_DEPENDENCIES = [
  '@a2ui/lit',
  '@a2ui/web_core',
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/ext-apps',
  '@modelcontextprotocol/server',
  'lit',
  'zod',
];

export interface PreparedPack1 {
  readonly consumer: string;
  readonly sdk: PackedSdk;
  readonly recipe: ConsumerRecipe;
}

/** Copies the source for one consumer into `work` and installs exactly that consumer's packed SDK packages beside it. */
export function preparePack1Consumer(work: string, name: Pack1Consumer): PreparedPack1 {
  const recipe = PACK1_CONSUMERS[name];
  const consumer = path.join(work, 'consumer');
  const skipped = new Set(recipe.leaveOut.map((file) => path.join(pack1Source, file)));
  fs.cpSync(pack1Source, consumer, { recursive: true, filter: (from) => !from.includes('node_modules') && !skipped.has(from) });
  const sdk = installPackedSdk(work, consumer, recipe.packages);
  linkDeclaredDependencies(consumer, sdk, PACK1_OWN_DEPENDENCIES);
  return { consumer, sdk, recipe };
}

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export interface Pack1ConsumerIdentity {
  readonly installedPackages: readonly string[];
  readonly packedTarballSha256: Record<string, string>;
  readonly builtPage: { readonly path: string; readonly sha256: string };
  readonly builtServer: { readonly path: string; readonly sha256: string };
}

/** Builds one consumer into `outDir`: its page and its server. Each consumer gets a work directory of its own. */
export async function buildPack1Consumer(name: Pack1Consumer, outDir: string): Promise<Pack1ConsumerIdentity> {
  const work = createWorkDirectory(`saga-pack1-${name}-`);
  try {
    const { consumer, sdk, recipe } = preparePack1Consumer(work, name);
    fs.rmSync(outDir, { recursive: true, force: true });
    await buildConsumerApplication(consumer, outDir, [viteSingleFile()], { page: recipe.page });
    const server = await bundleConsumerServer(consumer, 'server/index.ts');
    fs.copyFileSync(server.file, path.join(outDir, 'server.mjs'));
    const page = path.join(outDir, recipe.page);
    return {
      installedPackages: Object.keys(sdk.manifests).sort(),
      packedTarballSha256: sdk.tarballSha256,
      builtPage: { path: path.relative(repoRoot, page), sha256: sha256(page) },
      builtServer: { path: path.relative(repoRoot, path.join(outDir, 'server.mjs')), sha256: sha256(path.join(outDir, 'server.mjs')) },
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Builds both consumers, each from its own install, and returns the identities a review needs. */
export async function buildPack1Consumers(outDir: string): Promise<Record<string, unknown>> {
  const consumers: Record<string, Pack1ConsumerIdentity> = {};
  for (const name of Object.keys(PACK1_CONSUMERS) as Pack1Consumer[]) consumers[name] = await buildPack1Consumer(name, path.join(outDir, name));
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
