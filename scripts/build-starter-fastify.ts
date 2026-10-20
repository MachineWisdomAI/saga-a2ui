import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildStarter, prepareStarter, typecheckStarter } from './build-starter.js';
import { createWorkDirectory, repoRoot } from './packed-consumer.js';
import { templateDirectory } from './starter-template.js';

// Qualification build of the `lit-fastify` starter (templates/lit-fastify): the Fastify pair of the
// `lit-mcp` stack. It reuses the starter harness unchanged (scripts/build-starter.ts: export,
// install of the packed candidate tarballs, type check, the starter's own Vite builds and the
// qualification entry) and only chooses this template and its output directory, for the browser
// specification apps/lit-host/e2e/starter-fastify.spec.ts.
//
//   npx tsx scripts/build-starter-fastify.ts     # writes apps/lit-host/dist/starter-fastify (ignored)
//
// Building the candidate is not publishing anything.

export const STARTER_FASTIFY = 'lit-fastify';
export const starterFastifyDist = path.join(repoRoot, 'apps', 'lit-host', 'dist', 'starter-fastify');

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Builds the Fastify starter into `outDir` and returns the identities a review needs. */
export async function buildStarterFastifyInto(outDir: string): Promise<Record<string, unknown>> {
  const work = createWorkDirectory('saga-starter-fastify-');
  try {
    const prepared = prepareStarter(work, STARTER_FASTIFY);
    typecheckStarter(prepared.consumer);
    const built = await buildStarter(prepared);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(built.view, path.join(outDir, 'index.html'));
    fs.copyFileSync(built.qualificationServer, path.join(outDir, 'qualification-server.mjs'));
    const installedVersion = (name: string): string => (JSON.parse(fs.readFileSync(path.join(built.consumer, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;
    return {
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
      sourceDirty: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: repoRoot, encoding: 'utf8' }).trim() !== '',
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      template: { name: STARTER_FASTIFY, files: built.exported.files.length, stack: built.metadata.stack, server: built.metadata.server },
      serverAdapter: built.metadata.serverAdapter,
      installedThirdParty: Object.fromEntries(['fastify', '@modelcontextprotocol/fastify', '@modelcontextprotocol/node', '@modelcontextprotocol/server'].map((name) => [name, installedVersion(name)])),
      installedPackages: Object.keys(built.sdk.manifests).sort(),
      packedTarballSha256: built.sdk.tarballSha256,
      builtView: { sha256: sha256(built.view) },
      builtServer: { sha256: sha256(built.server) },
      templateSource: path.relative(repoRoot, templateDirectory(STARTER_FASTIFY)),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const identity = await buildStarterFastifyInto(starterFastifyDist);
  fs.writeFileSync(path.join(starterFastifyDist, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  console.log(JSON.stringify(identity, null, 2));
}
