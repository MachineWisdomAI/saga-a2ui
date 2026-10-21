import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { locateAll, type LocatedSource } from '../demo/tour/src/source-map.js';
import { NOTES_CONSUMERS } from './build-pack1-consumers.js';
import {
  buildConsumerApplication,
  createWorkDirectory,
  installPackedSdk,
  linkDeclaredDependencies,
  repoRoot,
  sourceRevision,
  type PackedSdk,
} from './packed-consumer.js';

// TOUR1: builds the static source-linked tour (`demo/tour`) the way the demonstration is built. The
// SDK packages are packed as the release candidate's tarballs and unpacked as installed dependencies
// of a clean directory outside the repository (see packed-consumer.ts). There the notes example's
// two views (Lit and React, the very sources PACK1 and REACT1 qualify) and the tour page are built.
// What is written is one self-contained HTML document that embeds both views, and `tour.json`, which
// ties it to the candidate build and source commit its links point at.
//
//   npx tsx scripts/build-tour.ts      # writes apps/lit-host/dist/tour (ignored)
//
// The page has no server: opening the file, or serving the directory from any static host, is all it
// needs. Building the tour is not publishing anything.

export const tourSource = path.join(repoRoot, 'demo', 'tour');
export const tourDist = path.join(repoRoot, 'apps', 'lit-host', 'dist', 'tour');

/** The installed SDK packages the two notes views import. */
export const TOUR_SDK_PACKAGES = ['core', 'lit', 'react', 'mcp'] as const;
/** What the views and the page import besides the SDK packages, plus the build tooling their builds load. */
export const TOUR_OWN_DEPENDENCIES = [
  ...new Set([
    ...NOTES_CONSUMERS.own.ownDependencies,
    ...NOTES_CONSUMERS.react.ownDependencies,
    'vite',
    'vite-plugin-singlefile',
  ]),
];

/** The renderers whose preview the tour builds, each from its own page of the notes example. */
export const TOUR_VIEWS = { lit: 'own.html', react: 'react.html' } as const;
export type TourRenderer = keyof typeof TOUR_VIEWS;

/** The only files of the notes example that import the optional components package, which the tour does not install. */
const NEEDS_COMPONENTS_PACKAGE = ['card.html', 'src/main-card.ts'];

const sha256 = (file: string): string =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const notDependencies = (from: string): boolean =>
  !from.includes('node_modules');

export interface PreparedTour {
  /** The clean directory whose layout mirrors the repository's, so relative imports resolve the same way. */
  readonly root: string;
  readonly sdk: PackedSdk;
}

/** Copies what the tour builds from into `work` and installs the packed SDK packages beside it. */
export function prepareTour(work: string): PreparedTour {
  const root = path.join(work, 'root');
  fs.mkdirSync(root, { recursive: true });
  const sdk = installPackedSdk(work, root, TOUR_SDK_PACKAGES);

  const copy = (
    relative: string,
    filter: (from: string) => boolean = notDependencies,
  ): void => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.cpSync(path.join(repoRoot, relative), path.join(root, relative), {
      recursive: true,
      filter,
    });
  };
  // The notes example without the consumer that needs the optional components package.
  const skipped = new Set(
    NEEDS_COMPONENTS_PACKAGE.map((file) =>
      path.join(repoRoot, 'examples', 'pack1-consumer', file),
    ),
  );
  copy(
    'examples/pack1-consumer',
    (from) => notDependencies(from) && !skipped.has(from),
  );
  // The local stand-in host the repository's browser specifications and the demonstration use. Tests stay out.
  copy(
    'apps/lit-host/e2e/host-fixture',
    (from) =>
      notDependencies(from) &&
      !/\.(test|spec)\.ts$/.test(from) &&
      !from.endsWith('index.html'),
  );
  copy('demo/lit-node/fixtures/notes.ts');
  copy('demo/tour');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' })}\n`,
  );
  linkDeclaredDependencies(root, sdk, TOUR_OWN_DEPENDENCIES);
  return { root, sdk };
}

export interface TourBuildInfo {
  readonly commit: string;
  readonly dirty: boolean;
  readonly candidateVersion: string;
  readonly sources: readonly LocatedSource[];
  readonly views: Readonly<Record<TourRenderer, string>>;
}

/** Supplies `virtual:tour-build` to the page. `<` is escaped so an embedded document can never close the page's own script element. */
function tourBuildInfo(info: TourBuildInfo): Plugin {
  const id = 'virtual:tour-build';
  return {
    name: 'tour-build-info',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load: (source) =>
      source === `\0${id}`
        ? `export default ${JSON.stringify(info).replaceAll('<', '\\u003c')};`
        : undefined,
  };
}

export interface BuiltTour extends PreparedTour {
  /** The built page, `index.html`. */
  readonly page: string;
  readonly info: TourBuildInfo;
  /** The built view of each renderer, as embedded. */
  readonly viewFiles: Readonly<Record<TourRenderer, string>>;
}

/** Builds both views and the page inside `prepared.root`. */
export async function buildTour(prepared: PreparedTour): Promise<BuiltTour> {
  const { root, sdk } = prepared;
  const example = path.join(root, 'examples', 'pack1-consumer');
  const viewsOut = path.join(root, '.views');
  const viewFiles = {} as Record<TourRenderer, string>;
  let first = true;
  for (const [renderer, page] of Object.entries(TOUR_VIEWS) as [
    TourRenderer,
    string,
  ][]) {
    await buildConsumerApplication(example, viewsOut, [viteSingleFile()], {
      page,
      emptyOutDir: first,
    });
    first = false;
    viewFiles[renderer] = path.join(viewsOut, page);
    if (!fs.existsSync(viewFiles[renderer]))
      throw new Error(`the tour build did not write the ${renderer} view`);
  }

  const { commit, dirty } = sourceRevision();
  const info: TourBuildInfo = {
    commit,
    dirty,
    candidateVersion: sdk.version,
    sources: locateAll((file) =>
      fs.readFileSync(path.join(repoRoot, file), 'utf8'),
    ),
    views: {
      lit: fs.readFileSync(viewFiles.lit, 'utf8'),
      react: fs.readFileSync(viewFiles.react, 'utf8'),
    },
  };
  const out = path.join(root, '.tour');
  await build({
    configFile: false,
    root: path.join(root, 'demo', 'tour'),
    base: './',
    logLevel: 'warn',
    plugins: [tourBuildInfo(info), viteSingleFile()],
    build: { outDir: out, emptyOutDir: true, target: 'es2022' }, // the page awaits its first scenario at the top level
  });
  const page = path.join(out, 'index.html');
  if (!fs.existsSync(page))
    throw new Error('the tour build did not write index.html');
  return { ...prepared, page, info, viewFiles };
}

/** Writes the tour into `outDir` and returns its manifest, which is also written as `tour.json`. */
export function writeTour(
  built: BuiltTour,
  outDir: string,
): Record<string, unknown> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(built.page, path.join(outDir, 'index.html'));
  // Apache-2.0 travels with the code, and the notices of the third-party code the page bundles.
  for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
    fs.copyFileSync(path.join(repoRoot, notice), path.join(outDir, notice));
  const { sdk, info } = built;
  const manifest = {
    tour: 'saga-synthetic-notes-tour',
    sourceCommit: info.commit,
    sourceDirty: info.dirty,
    candidate: {
      version: sdk.version,
      packedTarballSha256: sdk.tarballSha256,
      installedPackages: Object.keys(sdk.manifests).sort(),
    },
    files: { 'index.html': sha256(path.join(outDir, 'index.html')) },
    embeddedViews: Object.fromEntries(
      (Object.keys(TOUR_VIEWS) as TourRenderer[]).map((renderer) => [
        renderer,
        {
          page: TOUR_VIEWS[renderer],
          sha256: sha256(built.viewFiles[renderer]),
        },
      ]),
    ),
    sourceLinks: info.sources.map((one) => ({
      id: one.id,
      path: one.path,
      start: one.start,
      end: one.end,
    })),
    backend:
      'none: every server answer is simulated in the page from synthetic data',
    authentication:
      'none: the simulated person authenticates nobody; no credential of any kind is in the page',
    builtWith: {
      node: process.version,
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      platform: `${process.platform}-${process.arch}`,
    },
  };
  fs.writeFileSync(
    path.join(outDir, 'tour.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/** Builds the tour from packed candidate tarballs into `outDir` and returns the manifest of what was written. */
export async function buildTourInto(
  outDir: string,
): Promise<Record<string, unknown>> {
  const work = createWorkDirectory('saga-tour-');
  try {
    return writeTour(await buildTour(prepareTour(work)), outDir);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  console.log(JSON.stringify(await buildTourInto(tourDist), null, 2));
}
