import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACK1_CONSUMERS } from './build-pack1-consumers.js';
import {
  externalImportsOf,
  classifyModules,
} from './build-installed-lit-host.js';
import {
  buildConsumerFromConfig,
  bundleConsumerServer,
  createWorkDirectory,
  installPackedSdk,
  linkDeclaredDependencies,
  repoRoot,
  type PackedSdk,
} from './packed-consumer.js';
import { DEMO_TEMPLATE } from './qualified-starters.js';
import { DOWNLOAD_SCRIPTS } from '../demo/lit-node/download-scripts.js';
import {
  exportTemplate,
  readTemplateMetadata,
  templateDirectory,
  type OutputFile,
} from './starter-template.js';

// DEMO1: builds the standalone synthetic demonstration (`demo/lit-node`) the way a download of it is
// made. The SDK packages are packed as the release candidate's tarballs and unpacked as installed
// dependencies of a clean directory outside the repository (see packed-consumer.ts); the demo's
// pages are built there and its server is bundled against those installed copies. What is written to
// the output directory is the download: the bundled server, the six built pages, a manifest of the
// third-party packages the server still needs, the guide and `release.json`, which ties all of it to
// the candidate build it was made from.
//
//   npx tsx scripts/build-demo.ts      # writes apps/lit-host/dist/demo (ignored)
//
// `saga demo` (scripts/saga.ts) gives the same download to a developer: `stageDemo` builds it outside
// the destination and hands its files over, so the command's destination handling writes them.
//
// Building the demonstration is not publishing anything.

export const demoSource = path.join(repoRoot, 'demo', 'lit-node');
export const demoDist = path.join(repoRoot, 'apps', 'lit-host', 'dist', 'demo');

/** The installed SDK packages the demonstration imports. */
export const DEMO_SDK_PACKAGES = [
  'core',
  'lit',
  'components',
  'mcp',
  'lit-mcp-stack',
] as const;
/** Packages the demonstration's own sources import, besides the SDK packages, plus the build tooling its Vite configurations load. */
export const DEMO_OWN_DEPENDENCIES = [
  '@a2ui/lit',
  '@a2ui/web_core',
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/core',
  '@modelcontextprotocol/ext-apps',
  '@modelcontextprotocol/node',
  '@modelcontextprotocol/server',
  'jose',
  'lit',
  'vite',
  'vite-plugin-singlefile',
  'zod',
];
/** The starter files the demonstration imports as its glue. They are used as the starter ships them. */
export const STARTER_GLUE = [
  'server/authenticate.ts',
  'server/identity.ts',
] as const;

/** The application's Vite configurations that build the three views the demonstration serves, and where each writes its page. */
const APPLICATION_PAGES = [
  {
    config: 'vite.view.config.ts',
    built: 'dist/view/view.html',
    as: 'episode.html',
  },
  {
    config: 'vite.subscriptions-view.config.ts',
    built: 'dist/subscriptions-view/subscriptions.html',
    as: 'subscriptions.html',
  },
  {
    config: 'vite.playback-view.config.ts',
    built: 'dist/playback-view/playback.html',
    as: 'playback.html',
  },
] as const;
/** What of `apps/lit-host` the three views and the listener need. Tests are never copied. */
const APPLICATION_ENTRIES = [
  'src',
  'e2e/host-fixture',
  'tsconfig.json',
  'view.html',
  'subscriptions.html',
  'playback.html',
  ...APPLICATION_PAGES.map((page) => page.config),
];

const isTest = (from: string): boolean =>
  /\.(test|spec)\.ts$/.test(from) || /\.test-support\.ts$/.test(from);
const notDependencies = (from: string): boolean =>
  !from.includes('node_modules');
const sha256 = (file: string): string =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export interface PreparedDemo {
  /** The clean directory whose layout mirrors the repository's, so the demo's relative imports resolve the same way. */
  readonly root: string;
  readonly sdk: PackedSdk;
  /** The starter glue as exported, with its digest, so the build can show it is the starter's own text. */
  readonly starterGlue: Record<string, string>;
}

/** Copies the demonstration, the application it reuses, the PACK1 notes example and the starter's glue into `work`, and installs the packed SDK beside them. */
export function prepareDemo(work: string): PreparedDemo {
  const root = path.join(work, 'root');
  fs.mkdirSync(root, { recursive: true });
  // The packages are packed first: the exported starter is stamped with the exact build it runs against.
  const sdk = installPackedSdk(work, root, DEMO_SDK_PACKAGES);

  const application = path.join(root, 'apps', 'lit-host');
  for (const entry of APPLICATION_ENTRIES) {
    fs.mkdirSync(path.dirname(path.join(application, entry)), {
      recursive: true,
    });
    fs.cpSync(
      path.join(repoRoot, 'apps', 'lit-host', entry),
      path.join(application, entry),
      {
        recursive: true,
        filter: (from) => notDependencies(from) && !isTest(from),
      },
    );
  }
  // The example's own-catalog consumer: the card consumer, the file that uses the optional component and the React consumer stay out.
  const example = path.join(root, 'examples', 'pack1-consumer');
  const skipped = PACK1_CONSUMERS.own.leaveOut.map((file) =>
    path.join(repoRoot, 'examples', 'pack1-consumer', file),
  );
  fs.cpSync(path.join(repoRoot, 'examples', 'pack1-consumer'), example, {
    recursive: true,
    filter: (from) => notDependencies(from) && !skipped.includes(from),
  });

  const exported = exportTemplate(
    templateDirectory(DEMO_TEMPLATE),
    path.join(root, 'templates', DEMO_TEMPLATE),
    { sdkVersion: sdk.version },
  );
  const starterGlue: Record<string, string> = {};
  for (const file of STARTER_GLUE) {
    if (!exported.files.includes(file))
      throw new Error(
        `the starter no longer ships ${file}, which the demonstration uses as its glue`,
      );
    const shipped = path.join(exported.directory, file);
    if (
      !fs
        .readFileSync(shipped)
        .equals(
          fs.readFileSync(path.join(templateDirectory(DEMO_TEMPLATE), file)),
        )
    ) {
      throw new Error(
        `${file} was altered on export; the demonstration must use the starter's glue as it ships`,
      );
    }
    starterGlue[file] = sha256(shipped);
  }

  fs.cpSync(demoSource, path.join(root, 'demo', 'lit-node'), {
    recursive: true,
    filter: notDependencies,
  });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' })}\n`,
  );
  linkDeclaredDependencies(root, sdk, DEMO_OWN_DEPENDENCIES);
  return { root, sdk, starterGlue };
}

/** The exact version of an installed third-party package, from the repository's installed copy that was linked in. */
function installedVersion(name: string): string {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, 'node_modules', name, 'package.json'),
      'utf8',
    ),
  ) as { version: string };
  return manifest.version;
}

export interface BuiltDemo extends PreparedDemo {
  /** The bundled server, `<root>/.server/server.mjs`. */
  readonly server: string;
  /** Where every module of the server bundle came from; only installed copies of the SDK may appear. */
  readonly serverProvenance: ReturnType<typeof classifyModules>;
  /** The packages the bundle still imports at run time. */
  readonly externalImports: readonly string[];
  /** The built pages by the name they are served under. */
  readonly pages: Readonly<Record<string, string>>;
}

/**
 * Builds the pages and the server inside `prepared.root`. An aborted `signal` ends the build before
 * its next stage (each page, then the server) with the abort error; what was built stays in `root`
 * for the caller to remove.
 */
export async function buildDemo(
  prepared: PreparedDemo,
  signal?: AbortSignal,
): Promise<BuiltDemo> {
  const { root } = prepared;
  const application = path.join(root, 'apps', 'lit-host');
  const demo = path.join(root, 'demo', 'lit-node');
  const pages: Record<string, string> = {};
  for (const page of APPLICATION_PAGES) {
    signal?.throwIfAborted();
    await buildConsumerFromConfig(application, page.config);
    pages[page.as] = path.join(application, page.built);
  }
  signal?.throwIfAborted();
  await buildConsumerFromConfig(demo, 'vite.notes.config.ts');
  pages['notes.html'] = path.join(demo, 'dist', 'notes', 'own.html');
  signal?.throwIfAborted();
  await buildConsumerFromConfig(demo, 'vite.host.config.ts');
  pages['host.html'] = path.join(demo, 'dist', 'host', 'index.html');
  for (const [name, file] of Object.entries(pages))
    if (!fs.existsSync(file))
      throw new Error(`the demonstration build did not write ${name}`);

  signal?.throwIfAborted();
  const bundled = await bundleConsumerServer(
    root,
    'demo/lit-node/server/main.ts',
  );
  const serverProvenance = classifyModules(root, bundled.modules);
  if (serverProvenance.unexpected.length > 0)
    throw new Error(
      `the demonstration server loaded modules from outside the installed packages: ${serverProvenance.unexpected.join(', ')}`,
    );
  const externalImports = externalImportsOf(bundled.file);
  const sdkImports = externalImports.filter((name) =>
    name.startsWith('@saga-a2ui/'),
  );
  if (sdkImports.length > 0)
    throw new Error(
      `the demonstration server still imports ${sdkImports.join(', ')} at run time instead of carrying the installed copies`,
    );
  return {
    ...prepared,
    server: bundled.file,
    serverProvenance,
    externalImports,
    pages,
  };
}

const DOWNLOAD_NAME = 'saga-lit-node-demo';

/** Writes the download into `outDir` and returns its manifest, which is also written as `release.json`. */
export function writeDownload(
  built: BuiltDemo,
  outDir: string,
): Record<string, unknown> {
  const { sdk } = built;
  const metadata = readTemplateMetadata(templateDirectory(DEMO_TEMPLATE));
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'views'), { recursive: true });
  fs.copyFileSync(built.server, path.join(outDir, 'server.mjs'));
  for (const [name, file] of Object.entries(built.pages))
    fs.copyFileSync(file, path.join(outDir, 'views', name));
  fs.copyFileSync(
    path.join(demoSource, 'README.md'),
    path.join(outDir, 'README.md'),
  );
  // Apache-2.0 travels with the code, and the notices of the Markdown parser the views bundle.
  for (const notice of ['LICENSE', 'THIRD_PARTY_NOTICES.md'])
    fs.copyFileSync(path.join(repoRoot, notice), path.join(outDir, notice));

  // The packages the server still imports at run time. An installed SDK package's own declaration
  // wins (it may be an alias such as `zod3`); any other is pinned to the version this build was linked against.
  const declared = (name: string): string | undefined =>
    Object.values(sdk.manifests).find(
      (manifest) => manifest.dependencies?.[name] !== undefined,
    )?.dependencies?.[name];
  const dependencies = Object.fromEntries(
    built.externalImports.map((name) => [
      name,
      declared(name) ?? installedVersion(name),
    ]),
  );
  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    `${JSON.stringify(
      {
        name: DOWNLOAD_NAME,
        private: true,
        description:
          'A synthetic, local-only demonstration of a SAGA A2UI application: browse, descriptions at both content levels, protected Play, notes actions, expiry and recovery.',
        license: 'Apache-2.0',
        type: 'module',
        scripts: DOWNLOAD_SCRIPTS,
        engines: { node: '>=22.12.0' },
        dependencies,
        overrides: JSON.parse(
          fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
        ).overrides,
      },
      null,
      2,
    )}\n`,
  );

  const files = Object.fromEntries(
    [
      'server.mjs',
      ...Object.keys(built.pages).map((name) => `views/${name}`),
    ].map((name) => [name, sha256(path.join(outDir, name))]),
  );
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const manifest = {
    download: DOWNLOAD_NAME,
    sourceCommit: git(['rev-parse', 'HEAD']),
    sourceDirty:
      git(['status', '--porcelain=v1', '--untracked-files=no']) !== '',
    // The qualified pair the demonstration runs on, and the starter files it uses as its glue.
    pair: {
      template: `templates/${DEMO_TEMPLATE}`,
      stack: metadata.stack,
      server: metadata.server,
      serverAdapter: metadata.serverAdapter,
    },
    starterGlue: built.starterGlue,
    // The candidate build the installed SDK packages came from: the same version and tarballs `npm run candidate:pack` makes for this revision.
    candidate: {
      version: sdk.version,
      packedTarballSha256: sdk.tarballSha256,
      installedPackages: Object.keys(sdk.manifests).sort(),
    },
    files,
    runtimeDependencies: dependencies,
    serverModules: {
      installedSdkFiles: built.serverProvenance.installedSdkFiles.length,
      applicationModules: built.serverProvenance.applicationModules,
      thirdPartyPackages: built.serverProvenance.thirdPartyPackages,
    },
    builtWith: {
      node: process.version,
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      platform: `${process.platform}-${process.arch}`,
    },
    authentication:
      'local-only: fixed, public development credentials; no OAuth flow, no real account',
  };
  fs.writeFileSync(
    path.join(outDir, 'release.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

/** Builds the demonstration from packed candidate tarballs into `outDir` and returns the manifest of what was written. */
export async function buildDemoInto(
  outDir: string,
): Promise<Record<string, unknown>> {
  const work = createWorkDirectory('saga-demo-');
  try {
    const built = await buildDemo(prepareDemo(work));
    return writeDownload(built, outDir);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** A built download held in a scratch directory outside the repository and outside any destination, until `dispose`. */
export interface StagedDemo {
  /** The SDK build the download was made from (`release.json` says the same). */
  readonly sdkVersion: string;
  /** Every file of the download, relative, in a fixed order; a file is read when it is written. */
  readonly files: readonly OutputFile[];
  /** Removes the scratch directory. */
  dispose(): void;
}

/** Everything below `directory` as output files, sorted. A symbolic link or anything but a file or directory is an error: the download holds neither. */
function filesBelow(directory: string): OutputFile[] {
  const walk = (current: string): string[] =>
    fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!entry.isFile())
        throw new Error(
          `the demonstration download contains ${path.relative(directory, full)}, which is neither a file nor a directory`,
        );
      return [path.relative(directory, full).split(path.sep).join('/')];
    });
  return walk(directory)
    .sort()
    .map((file) => ({
      path: file,
      content: () => fs.readFileSync(path.join(directory, file)),
    }));
}

/**
 * Builds the download exactly as `buildDemoInto` does, but keeps it in a scratch directory and returns
 * its files instead of writing them anywhere a person chose. Nothing is installed from a registry and
 * no script of the output runs; the build packs the repository's own packages and bundles them. An
 * aborted `signal` stops it at the next stage and the scratch directory is removed.
 */
export async function stageDemo(signal?: AbortSignal): Promise<StagedDemo> {
  const work = createWorkDirectory('saga-demo-');
  const dispose = (): void => fs.rmSync(work, { recursive: true, force: true });
  try {
    const built = await buildDemo(prepareDemo(work), signal);
    const download = path.join(work, 'download');
    writeDownload(built, download);
    return {
      sdkVersion: built.sdk.version,
      files: filesBelow(download),
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export interface RunningDemoProcess {
  /** The host page, as the process reported it. */
  readonly hostUrl: string;
  /** What the process wrote to standard output and error so far. */
  output(): string;
  stop(): Promise<void>;
}

/** How long the process may take to report that it is ready. */
const READY_MS = 30_000;

/**
 * Starts a built download as its own Node process the way a person would (`node server.mjs`), with the
 * download as its working directory. Its third-party packages come from `node_modules` links to the
 * repository's installed copies (a download would `npm install` them), the environment carries no
 * credential, and the process is ready only when it printed the host page's address.
 */
export async function startDownload(
  dir: string,
  env: Record<string, string> = {},
): Promise<RunningDemoProcess> {
  const dependencies = JSON.parse(
    fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
  ) as { dependencies: Record<string, string> };
  for (const name of Object.keys(dependencies.dependencies)) {
    const target = path.join(dir, 'node_modules', name);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(path.join(repoRoot, 'node_modules', name), target, 'dir');
  }
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let written = '';
  child.stdout
    .setEncoding('utf8')
    .on('data', (chunk: string) => void (written += chunk));
  child.stderr
    .setEncoding('utf8')
    .on('data', (chunk: string) => void (written += chunk));
  const exited = new Promise<number | null>((resolve) =>
    child.once('exit', resolve),
  );
  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGTERM');
    await exited;
  };
  const deadline = Date.now() + READY_MS;
  while (Date.now() < deadline) {
    const host = /Open the demo host page: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(
      written,
    );
    if (host?.[1] && /MCP endpoint notes: /.test(written))
      return { hostUrl: host[1], output: () => written, stop };
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `the demonstration ended before it was ready (exit ${child.exitCode ?? child.signalCode}):\n${written}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stop();
  throw new Error(
    `the demonstration was not ready within ${READY_MS} ms:\n${written}`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const manifest = await buildDemoInto(demoDist);
  console.log(JSON.stringify(manifest, null, 2));
}
