import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildStarter, prepareStarter, typecheckStarter } from './build-starter.js';
import { createWorkDirectory, repoRoot } from './packed-consumer.js';
import { templateDirectory } from './starter-template.js';

// Qualification build of the Hono starter (templates/lit-hono) for the browser specification. It
// only calls the shared starter harness (scripts/build-starter.ts): the template is exported as a
// developer receives it, installed from packed candidate tarballs, type-checked and built with its
// own configuration; this file chooses the template and where the artifacts go.
//
//   npx tsx scripts/build-starter-hono.ts     # writes apps/lit-host/dist/starter-hono (ignored)
//
// Building the candidate is not publishing anything.

export const HONO_STARTER = 'lit-hono';
export const honoStarterDist = path.join(repoRoot, 'apps', 'lit-host', 'dist', 'starter-hono');

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Builds the Hono starter into `outDir` and returns the identities a review needs. */
export async function buildHonoStarterInto(outDir: string): Promise<Record<string, unknown>> {
  const work = createWorkDirectory('saga-starter-hono-');
  try {
    const prepared = prepareStarter(work, HONO_STARTER);
    typecheckStarter(prepared.consumer);
    const built = await buildStarter(prepared);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(built.view, path.join(outDir, 'index.html'));
    fs.copyFileSync(built.qualificationServer, path.join(outDir, 'qualification-server.mjs'));
    return {
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
      sourceDirty: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: repoRoot, encoding: 'utf8' }).trim() !== '',
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      template: { name: HONO_STARTER, files: built.exported.files.length, stack: built.metadata.stack, server: built.metadata.server, adapter: built.metadata.serverAdapter },
      installedPackages: Object.keys(built.sdk.manifests).sort(),
      packedTarballSha256: built.sdk.tarballSha256,
      builtView: { sha256: sha256(built.view) },
      builtServer: { sha256: sha256(built.server) },
      templateSource: path.relative(repoRoot, templateDirectory(HONO_STARTER)),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const identity = await buildHonoStarterInto(honoStarterDist);
  fs.writeFileSync(path.join(honoStarterDist, 'identity.json'), `${JSON.stringify(identity, null, 2)}\n`);
  console.log(JSON.stringify(identity, null, 2));
}
