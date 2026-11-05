import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildConsumerFromConfig,
  bundleConsumerServer,
  createWorkDirectory,
  installPackedSdk,
  linkDeclaredDependencies,
  repoRoot,
  type PackedSdk,
} from './packed-consumer.js';
import { QUALIFIED_STARTERS } from './qualified-starters.js';
import {
  exportTemplate,
  readTemplateMetadata,
  templateDirectory,
  type ExportedStarter,
  type TemplateMetadata,
} from './starter-template.js';

// Qualification build of a maintained starter template (templates/<name>). The template is
// exported exactly as a developer would receive it, the SDK packages are installed into it from
// packed candidate tarballs (the artifact PACK2 prepares, with no registry), and the starter's own
// scripts and configuration build it. Only what the starter declares is linked in; a missing
// declaration, a workspace alias or a file left out of a package fails here instead of passing.
//
//   npx tsx scripts/build-starter.ts                      # every qualified template into apps/lit-host/dist/starters/<name> (ignored)
//   npx tsx scripts/build-starter.ts --template lit-node  # one of them
//
// Building the candidate is not publishing anything.

/** Where the browser specification reads the built template `name` from. */
export const starterDist = (name: string): string =>
  path.join(repoRoot, 'apps', 'lit-host', 'dist', 'starters', name);

/**
 * What the qualification harness adds around the starter, outside its output: the entry through
 * which a test supplies its own verifier and policy. The starter's own `server/main.ts` supplies
 * neither (it refuses every credential), so a test identity never has to exist in the starter.
 */
const QUALIFICATION_ENTRY = `export { startListener } from './server/listener.js';
export { ACCOUNT_SCOPE } from './server/authenticate.js';
export { ViewArtifactMissing } from './server/operations.js';
export { VIEW_MARKER } from './src/contract.js';
`;

export interface PreparedStarter {
  readonly consumer: string;
  readonly metadata: TemplateMetadata;
  readonly exported: ExportedStarter;
  readonly sdk: PackedSdk;
}

/** Everything a package manager would put beside the starter's own files, except what the starter declares nowhere. */
function declaredThirdParty(consumer: string): string[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(consumer, 'package.json'), 'utf8'),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  }).filter((name) => !name.startsWith('@saga-a2ui/'));
}

/** Exports the starter into `work` and installs exactly the SDK packages its metadata names. */
export function prepareStarter(work: string, name: string): PreparedStarter {
  const template = templateDirectory(name);
  const metadata = readTemplateMetadata(template);
  const consumer = path.join(work, 'starter');
  // The packages are packed first: the starter is stamped with the exact build it will be installed from.
  fs.mkdirSync(consumer);
  const sdk = installPackedSdk(work, consumer, metadata.sdkPackages);
  const exported = exportTemplate(template, path.join(work, 'exported'), {
    sdkVersion: sdk.version,
  });
  for (const file of exported.files) {
    fs.mkdirSync(path.dirname(path.join(consumer, file)), { recursive: true });
    fs.copyFileSync(
      path.join(exported.directory, file),
      path.join(consumer, file),
    );
  }
  linkDeclaredDependencies(consumer, sdk, declaredThirdParty(consumer));
  return { consumer, metadata, exported, sdk };
}

export interface BuiltStarter extends PreparedStarter {
  /** The one self-contained page, as the starter's own `build:view` writes it. */
  readonly view: string;
  /** The starter's own server bundle (`build:server`), whose entry is `server/main.ts`. */
  readonly server: string;
  /** The server bundle with the qualification entry, which lets a test supply its own verifier. */
  readonly qualificationServer: string;
}

/** Type-checks the starter with the compiler it declares, the way `npm run typecheck` does. */
export function typecheckStarter(consumer: string): void {
  const tsc = path.join(consumer, 'node_modules', 'typescript', 'bin', 'tsc');
  for (const project of ['tsconfig.json', 'tsconfig.server.json'])
    execFileSync(process.execPath, [tsc, '-p', path.join(consumer, project)], {
      cwd: consumer,
      stdio: 'pipe',
    });
}

/** Builds the starter with its own Vite configuration files, then adds the qualification bundle. */
export async function buildStarter(
  prepared: PreparedStarter,
): Promise<BuiltStarter> {
  const { consumer } = prepared;
  await buildConsumerFromConfig(consumer, 'vite.config.ts');
  await buildConsumerFromConfig(consumer, 'vite.server.config.ts');
  fs.writeFileSync(
    path.join(consumer, 'qualification-entry.ts'),
    QUALIFICATION_ENTRY,
  );
  const qualification = await bundleConsumerServer(
    consumer,
    'qualification-entry.ts',
  );
  const view = path.join(consumer, 'dist', 'index.html');
  const server = path.join(consumer, 'dist', 'server.mjs');
  for (const file of [view, server])
    if (!fs.existsSync(file))
      throw new Error(
        `The starter's build did not write ${path.relative(consumer, file)}.`,
      );
  return { ...prepared, view, server, qualificationServer: qualification.file };
}

const sha256 = (file: string): string =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Builds the template `name` into `outDir` for the browser specification and returns the identities a review needs. */
export async function buildStarterInto(
  name: string,
  outDir: string,
): Promise<Record<string, unknown>> {
  const work = createWorkDirectory('saga-starter-');
  try {
    const prepared = prepareStarter(work, name);
    typecheckStarter(prepared.consumer);
    const built = await buildStarter(prepared);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.copyFileSync(built.view, path.join(outDir, 'index.html'));
    fs.copyFileSync(
      built.qualificationServer,
      path.join(outDir, 'qualification-server.mjs'),
    );
    return {
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim(),
      sourceDirty:
        execFileSync(
          'git',
          ['status', '--porcelain=v1', '--untracked-files=no'],
          { cwd: repoRoot, encoding: 'utf8' },
        ).trim() !== '',
      platform: `${process.platform}-${process.arch}`,
      node: process.version,
      template: {
        name,
        files: built.exported.files.length,
        stack: built.metadata.stack,
        server: built.metadata.server,
      },
      installedPackages: Object.keys(built.sdk.manifests).sort(),
      packedTarballSha256: built.sdk.tarballSha256,
      builtView: { sha256: sha256(built.view) },
      builtServer: { sha256: sha256(built.server) },
      templateSource: path.relative(repoRoot, templateDirectory(name)),
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--template');
  const requested = at < 0 ? undefined : argv[at + 1];
  if (at >= 0 && (requested === undefined || requested.startsWith('--')))
    throw new Error('--template requires a template name');
  const names =
    requested === undefined
      ? QUALIFIED_STARTERS
      : QUALIFIED_STARTERS.filter((name) => name === requested);
  if (names.length === 0)
    throw new Error(
      `${String(requested)} is not a qualified starter template (${QUALIFIED_STARTERS.join(', ')}).`,
    );
  for (const name of names) {
    const identity = await buildStarterInto(name, starterDist(name));
    fs.writeFileSync(
      path.join(starterDist(name), 'identity.json'),
      `${JSON.stringify(identity, null, 2)}\n`,
    );
    console.log(JSON.stringify(identity, null, 2));
  }
}
