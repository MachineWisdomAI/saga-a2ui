import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
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

// Builds the browser pages of apps/lit-host (the representative application, its MCP views and the
// synthetic action consumer, and the test pages that show the optional FaithfulCard) the way an application outside this repository would receive SAGA
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

/** The SDK packages the application and its pages import (`apps/lit-host/package.json` also names React; the only page built here that uses it, the React player, needs only the core and MCP packages, so `react` is a third-party dependency of the application, not an installed SDK package; the React card stack probe has its own install, see `REACT_CARD_SDK_PACKAGES`). */
export const INSTALLED_SDK_PACKAGES = [
  'lit-mcp-stack',
  'core',
  'lit',
  'components',
  'mcp',
] as const;

/** The packages the application itself imports, besides the SDK packages, plus the build tooling its Vite configurations load. */
export const LIT_HOST_OWN_DEPENDENCIES = [
  '@a2ui/lit',
  '@a2ui/web_core',
  '@modelcontextprotocol/client',
  '@modelcontextprotocol/core',
  '@modelcontextprotocol/ext-apps',
  '@modelcontextprotocol/node',
  'jose',
  'lit',
  'react',
  'react-dom',
  'vite',
  'vite-plugin-singlefile',
  'zod',
];

/**
 * The two card application stack probes, built from `vite.card-app-stack.config.ts` once per stack
 * (`STACK=<name>`, as `npm run build` does) after the other pages; that configuration does not empty
 * `dist`. `e2e/card-app-stack.spec.ts` runs its result matrix against both documents.
 */
export const INSTALLED_CARD_STACKS = ['lit', 'react'] as const;
export const CARD_STACK_CONFIG = 'vite.card-app-stack.config.ts';

/**
 * The Lit probe builds in the application's own install above, which already holds `lit-mcp-stack`.
 * The React probe installs the React stack beside its own packages in a second, separate install:
 * the React adapter declares `zod` 3.25.76 and the React stack 4.6.7, and the one flat set of
 * linked third-party packages of an install can hold only one version of each.
 */
export const REACT_CARD_SDK_PACKAGES = [
  'react-mcp-stack',
  'react',
  'core',
  'components',
  'mcp',
] as const;

/** The packages the React probe imports itself, besides the SDK packages, plus the build tooling its Vite configuration loads. */
export const REACT_CARD_OWN_DEPENDENCIES = [
  'react',
  'react-dom',
  'vite',
  'vite-plugin-singlefile',
];

/** The application's own Vite configurations that build a browser page, in the order `npm run build` runs them (the first empties `dist`). */
export const INSTALLED_PAGE_CONFIGS = [
  'vite.config.ts',
  'vite.view.config.ts',
  'vite.subscriptions-view.config.ts',
  'vite.answer-view.config.ts',
  'vite.playback-view.config.ts',
  'vite.playback-react-view.config.ts',
  'vite.host-fixture.config.ts',
  'vite.catalog-isolation.config.ts',
  'vite.action-consumer.config.ts',
  'vite.faithful-card.config.ts',
  'vite.card-workflow.config.ts',
] as const;

const COPIED_ENTRIES = [
  'src',
  'e2e/action-consumer',
  'e2e/archive-fixture',
  'e2e/card-app-stack',
  // The stack probe's branded page reads the application's stylesheet the card-styling pages share.
  'e2e/card-styling/branded.ts',
  'e2e/card-workflow',
  'e2e/catalog-isolation',
  'e2e/faithful-card',
  'e2e/host-fixture',
  'tsconfig.json',
  ...INSTALLED_PAGE_CONFIGS,
  CARD_STACK_CONFIG,
];

export interface PreparedLitHost {
  readonly consumer: string;
  readonly sdk: PackedSdk;
}

/** Copies the named files and directories of the application, without tests, into `consumer`, which becomes an ES module package so its Vite configurations load as such. */
function copyApplication(consumer: string, entries: readonly string[]): void {
  const isTest = (from: string): boolean => /\.(test|spec)\.ts$/.test(from);
  for (const entry of entries) {
    const target = path.join(consumer, entry);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(litHostSource, entry), target, {
      recursive: true,
      filter: (from) => !from.includes('node_modules') && !isTest(from),
    });
  }
  // The application is an ES module package, so its Vite configurations load as such.
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' })}\n`,
  );
}

/** Copies the application's page sources into `work` and installs the packed SDK packages beside them. */
export function prepareInstalledLitHost(work: string): PreparedLitHost {
  const consumer = path.join(work, 'consumer');
  copyApplication(consumer, [
    ...COPIED_ENTRIES,
    ...fs.readdirSync(litHostSource).filter((name) => name.endsWith('.html')),
  ]);
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
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesUnder(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    )
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
  const parts = file
    .slice(file.lastIndexOf(marker) + marker.length)
    .split(path.sep);
  return parts[0]!.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

/** The canonical form of an absolute path, so spellings of one location (a symlinked temporary root such as macOS's /var -> /private/var) compare equal. A path that does not exist is returned as given. */
function canonical(file: string): string {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return file;
  }
}

/**
 * Classifies every module of one build against where an installed consumer may legitimately load it from.
 * Locations are compared by canonical filesystem path: Vite reports resolved module paths while the
 * consumer directory is named through the platform's temporary root, and the two can spell one
 * location differently. A workspace alias still resolves into `packages/` or the application's
 * workspace sources and so is still unexpected.
 */
export function classifyModules(
  consumer: string,
  modules: readonly string[],
): ModuleProvenance {
  const consumerRoot = canonical(consumer);
  const installedRoot =
    path.join(consumerRoot, 'node_modules', '@saga-a2ui') + path.sep;
  const repoModules = canonical(path.join(repoRoot, 'node_modules')) + path.sep;
  const installedSdkFiles: string[] = [];
  const thirdParty = new Set<string>();
  const unexpected: string[] = [];
  let applicationModules = 0;
  for (const id of new Set(modules)) {
    const reported = id.split('?')[0]!;
    if (reported.startsWith('\0') || !path.isAbsolute(reported)) continue; // Vite's virtual helpers
    const file = canonical(reported);
    if (file.startsWith(installedRoot)) {
      installedSdkFiles.push(
        `@saga-a2ui/${file.slice(installedRoot.length).split(path.sep).join('/')}`,
      );
    } else if (
      file.startsWith(consumerRoot + path.sep) &&
      !file.includes(`${path.sep}node_modules${path.sep}`)
    ) {
      applicationModules += 1;
    } else if (
      file.startsWith(repoModules) &&
      !file.includes(`${path.sep}@saga-a2ui${path.sep}`)
    ) {
      thirdParty.add(thirdPartyPackageName(file));
    } else {
      unexpected.push(file);
    }
  }
  return {
    installedSdkFiles: installedSdkFiles.sort(),
    applicationModules,
    thirdPartyPackages: [...thirdParty].sort(),
    unexpected: unexpected.sort(),
  };
}

export interface BuiltPage {
  readonly config: string;
  /** The card stack probe the build selected (`STACK`), for `vite.card-app-stack.config.ts`. */
  readonly stack?: (typeof INSTALLED_CARD_STACKS)[number];
  readonly provenance: ModuleProvenance;
}

/** The application's own listener, bundled in the same installed consumer as its pages (PACK1, #154). */
export interface BuiltServer {
  /** The bundled entry, `<consumer>/.server/server.mjs`. */
  readonly file: string;
  readonly sha256: string;
  /** Where every bundled module came from; the SDK is bundled in, so only installed copies may appear. */
  readonly provenance: ModuleProvenance;
  /** The packages the bundle still imports at run time, which resolve from the consumer's `node_modules`. */
  readonly externalImports: readonly string[];
}

export interface InstalledLitHostIdentity {
  readonly sourceCommit: string;
  readonly sourceDirty: boolean;
  readonly node: string;
  readonly npm: string;
  /** SHA-256 of each packed SDK tarball the build installed. */
  readonly packedTarballSha256: Record<string, string>;
  /** SHA-256 of each packed tarball the React card stack probe's separate install used. */
  readonly reactCardStackTarballSha256: Record<string, string>;
  /** SHA-256 of each file written under the output directory, keyed by its path there. */
  readonly builtFilesSha256: Record<string, string>;
  /** Every page build: the application's pages, then the Lit and the React card stack probe. */
  readonly pages: readonly BuiltPage[];
  /** The listener built from the same install as the pages. Its bytes are not written under the output directory. */
  readonly server: Omit<BuiltServer, 'file'>;
  /** The served playback view against the accepted CARD2 production hash; recorded, not asserted (see CARD2_PLAYBACK_SHA256). */
  readonly playbackView: {
    readonly sha256: string;
    readonly cardTwoSha256: string;
    readonly matchesCardTwo: boolean;
  };
}

/** The installed playback document CARD2 accepted ("reviewed installed playback HTML", issue #20 comment 6280435005). A different value names a changed view, for the coordinator to assess. */
export const CARD2_PLAYBACK_SHA256 =
  '7ea1d8d0d696a20921896d1df45905cd22455f5f17fa20cd1d41243591224afd';

/** The application entry the external listener is bundled from: the same one `npm run serve:mcp` runs. */
export const INSTALLED_SERVER_ENTRY = 'src/mcp/serve.ts';

/** The bare package names a bundle imports at run time. */
export function externalImportsOf(file: string): string[] {
  const code = fs.readFileSync(file, 'utf8');
  const found = new Set<string>();
  for (const match of code.matchAll(
    /(?:^|\n)\s*import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  )) {
    const specifier = match[1] as string;
    if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
    found.add(
      specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] as string),
    );
  }
  return [...found].sort();
}

/** Builds one card stack probe in `consumer`, failing rather than reporting a module from outside the installed packages. */
async function buildCardStackProbe(
  consumer: string,
  stack: (typeof INSTALLED_CARD_STACKS)[number],
): Promise<BuiltPage> {
  const previous = process.env.STACK;
  process.env.STACK = stack; // read by the configuration when the build loads it
  try {
    const provenance = classifyModules(
      consumer,
      await buildConsumerFromConfig(consumer, CARD_STACK_CONFIG),
    );
    if (provenance.unexpected.length > 0)
      throw new Error(
        `${CARD_STACK_CONFIG} (${stack}) loaded modules from outside the installed packages: ${provenance.unexpected.join(', ')}`,
      );
    return { config: CARD_STACK_CONFIG, stack, provenance };
  } finally {
    if (previous === undefined) delete process.env.STACK;
    else process.env.STACK = previous;
  }
}

export interface BuiltReactCardProbe {
  readonly consumer: string;
  readonly sdk: PackedSdk;
  readonly page: BuiltPage;
}

/**
 * Builds the React card stack probe in its own install inside `work` (see `REACT_CARD_SDK_PACKAGES`):
 * the application's probe sources and its own Vite configuration are copied beside the installed
 * React stack, and the document ends up at `<consumer>/dist/card-app-stack/react.html`.
 */
export async function buildInstalledReactCardProbe(
  work: string,
): Promise<BuiltReactCardProbe> {
  const consumer = path.join(work, 'react-card-consumer');
  copyApplication(consumer, [
    'e2e/card-app-stack',
    'e2e/card-styling/branded.ts',
    'tsconfig.json',
    CARD_STACK_CONFIG,
  ]);
  const packed = path.join(work, 'react-card-packed');
  fs.mkdirSync(packed);
  const sdk = installPackedSdk(packed, consumer, [...REACT_CARD_SDK_PACKAGES]);
  linkDeclaredDependencies(consumer, sdk, REACT_CARD_OWN_DEPENDENCIES);
  return { consumer, sdk, page: await buildCardStackProbe(consumer, 'react') };
}

export interface BuiltInstalledHost {
  readonly consumer: string;
  readonly sdk: PackedSdk;
  readonly pages: readonly BuiltPage[];
  readonly server: BuiltServer;
}

/**
 * Builds every page and the application's listener in one installed consumer inside `work`, which the
 * caller owns and removes. The pages end up in `<consumer>/dist`, the listener in `<consumer>/.server`.
 * The listener is bundled against the same installed copies the pages were: a module loaded from the
 * workspace instead fails the build rather than being reported.
 */
export async function buildInstalledHost(
  work: string,
): Promise<BuiltInstalledHost> {
  const { consumer, sdk } = prepareInstalledLitHost(work);
  const pages: BuiltPage[] = [];
  for (const config of INSTALLED_PAGE_CONFIGS) {
    const provenance = classifyModules(
      consumer,
      await buildConsumerFromConfig(consumer, config),
    );
    if (provenance.unexpected.length > 0)
      throw new Error(
        `${config} loaded modules from outside the installed packages: ${provenance.unexpected.join(', ')}`,
      );
    pages.push({ config, provenance });
  }
  pages.push(await buildCardStackProbe(consumer, 'lit'));
  const bundled = await bundleConsumerServer(consumer, INSTALLED_SERVER_ENTRY);
  const provenance = classifyModules(consumer, bundled.modules);
  if (provenance.unexpected.length > 0)
    throw new Error(
      `the listener loaded modules from outside the installed packages: ${provenance.unexpected.join(', ')}`,
    );
  const externalImports = externalImportsOf(bundled.file);
  const sdkImports = externalImports.filter((name) =>
    name.startsWith('@saga-a2ui/'),
  );
  if (sdkImports.length > 0)
    throw new Error(
      `the listener bundle still imports ${sdkImports.join(', ')} at run time instead of carrying the installed copies`,
    );
  return {
    consumer,
    sdk,
    pages,
    server: {
      file: bundled.file,
      sha256: sha256(bundled.file),
      provenance,
      externalImports,
    },
  };
}

export interface RunningInstalledListener {
  /** `http://127.0.0.1:<port>`, as the process reported it. */
  readonly origin: string;
  readonly mcpUrl: string;
  readonly subscriptionsUrl: string;
  readonly playbackUrl: string;
  readonly answerUrl: string;
  /** What the process wrote to standard output and error so far. */
  output(): string;
  stop(): Promise<void>;
}

/** How long a listener may take to report that it is ready. */
const LISTENER_READY_MS = 30_000;

/**
 * Starts the bundled listener as its own Node process with the consumer (outside the repository) as
 * its working directory and `viewsDirectory` (default: the views built beside it) as the only place
 * it reads its views from. The environment carries no credential: the process gets `PATH`, an
 * ephemeral port and the views directory, so the application's synthetic verifier is its only
 * authentication. It is ready only when it printed its URL, which it does after reading every view;
 * a missing view ends the process before that and rejects here with what it wrote.
 */
export async function startInstalledListener(
  built: BuiltInstalledHost,
  viewsDirectory = path.join(built.consumer, 'dist'),
): Promise<RunningInstalledListener> {
  const child = spawn(process.execPath, [built.server.file], {
    cwd: built.consumer,
    env: {
      PATH: process.env.PATH ?? '',
      PORT: '0',
      SAGA_VIEWS_DIR: viewsDirectory,
    },
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
  const urlOf = (label: string): string | undefined =>
    new RegExp(`${label}[^\\n]*?(http://127\\.0\\.0\\.1:\\d+/\\S+)`).exec(
      written,
    )?.[1];
  const deadline = Date.now() + LISTENER_READY_MS;
  while (Date.now() < deadline) {
    const mcp = /MCP server listening at (http:\/\/127\.0\.0\.1:\d+)\/mcp/.exec(
      written,
    );
    const subscriptions = urlOf('subscriptions endpoint');
    const playback = urlOf('playback endpoint');
    const answer = urlOf('answer endpoint');
    if (mcp?.[1] && subscriptions && playback && answer) {
      return {
        origin: mcp[1],
        mcpUrl: `${mcp[1]}/mcp`,
        subscriptionsUrl: subscriptions,
        playbackUrl: playback,
        answerUrl: answer,
        output: () => written,
        stop,
      };
    }
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        `the installed listener ended before it was ready (exit ${child.exitCode ?? child.signalCode}):\n${written}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stop();
  throw new Error(
    `the installed listener was not ready within ${LISTENER_READY_MS} ms:\n${written}`,
  );
}

/**
 * Builds every page into `outDir` and returns the identities a review needs: the source commit, the
 * runtime, the packed tarball digests, each built file's digest and, per page build and for the
 * listener, where its modules came from. A module loaded from the workspace instead of an installed
 * copy fails the build rather than being reported.
 */
export async function buildInstalledLitHost(
  outDir: string,
): Promise<InstalledLitHostIdentity> {
  const work = createWorkDirectory('saga-installed-lit-host-');
  try {
    const { consumer, sdk, pages, server } = await buildInstalledHost(work);
    const reactCard = await buildInstalledReactCardProbe(work);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.cpSync(path.join(consumer, 'dist'), outDir, { recursive: true });
    fs.copyFileSync(
      path.join(reactCard.consumer, 'dist', 'card-app-stack', 'react.html'),
      path.join(outDir, 'card-app-stack', 'react.html'),
    );
    const playbackSha256 = sha256(
      path.join(outDir, 'playback-view', 'playback.html'),
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
      node: process.version,
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      packedTarballSha256: sdk.tarballSha256,
      reactCardStackTarballSha256: reactCard.sdk.tarballSha256,
      builtFilesSha256: Object.fromEntries(
        filesUnder(outDir).map((file) => [
          path.relative(outDir, file).split(path.sep).join('/'),
          sha256(file),
        ]),
      ),
      pages: [...pages, reactCard.page],
      server: {
        sha256: server.sha256,
        provenance: server.provenance,
        externalImports: server.externalImports,
      },
      playbackView: {
        sha256: playbackSha256,
        cardTwoSha256: CARD2_PLAYBACK_SHA256,
        matchesCardTwo: playbackSha256 === CARD2_PLAYBACK_SHA256,
      },
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const identity = await buildInstalledLitHost(installedLitHostDist);
  fs.writeFileSync(
    path.join(installedLitHostDist, 'identity.json'),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
  console.log(JSON.stringify(identity, null, 2));
}
