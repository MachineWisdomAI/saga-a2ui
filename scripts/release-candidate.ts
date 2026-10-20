import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FAITHFUL_CARD_CONTRACT_VERSION } from '@saga-a2ui/components/faithful-card';
import { viewUriForHtml } from '@saga-a2ui/mcp/server';
import { CATALOG_ID } from '../examples/pack1-consumer/src/notes-surface.js';
import { sha256Hex, summarizeReceipt } from './candidate-identity.js';
import {
  candidateVersion,
  createWorkDirectory,
  packSdkPackages,
  repoRoot,
  sourceRevision,
  type PackedManifest,
  type PackedPackage,
  type SdkPackage,
} from './packed-consumer.js';

// PACK2: prepares the release candidate of the owned packages as CI artifacts and says exactly what
// it is. It packs the five packages with the candidate prerelease identity (see `candidateVersion`),
// checks that every consumer build installed exactly those tarballs, installs them with the real
// package manager into a clean directory, records the matched package/resource/catalog set and the
// tested recipe, and can check an installed set against that record. It publishes nothing: the
// tarballs stay `private`, so `npm publish` refuses them, and the files go only to the output
// directory, which CI uploads as a workflow artifact.
//
//   npm run build                                  # builds the consumers whose identities are checked
//   npm run candidate:pack -- --out DIR            # DIR/candidate.json, DIR/CANDIDATE.md, DIR/packages/*.tgz
//   npm run candidate:verify -- --candidate DIR/candidate.json --modules PATH/node_modules --combination own|card [--page FILE]
//   npm run candidate:rehearse -- --candidate DIR/candidate.json   # install, update and roll back as built applications (candidate-rehearsal.ts)

export const SDK_PACKAGES: readonly SdkPackage[] = ['core', 'lit', 'components', 'mcp', 'react'];

// ---------------------------------------------------------------------------------------------
// Checking an installed set against a candidate
// ---------------------------------------------------------------------------------------------

export type FindingCode =
  | 'version-mismatch'
  | 'range-mismatch'
  | 'missing-dependency'
  | 'missing-package'
  | 'modules-missing'
  | 'not-in-candidate'
  | 'resource-mismatch'
  | 'unreadable-package'
  | 'floor-missing';

/** One reason an installed set is not the candidate, with the repair a maintainer can act on. */
export interface Finding {
  readonly code: FindingCode;
  readonly package?: string;
  readonly expected?: string;
  readonly actual?: string;
  readonly guidance: string;
}

/** What a candidate record promises about its packages. */
export interface ExpectedCombination {
  readonly version: string;
  readonly packages: Readonly<Record<string, { readonly tarball: string; readonly sha256: string }>>;
}

const AFTER_REINSTALL = 'Then rebuild the view from that install, restart the server so it serves the rebuilt view, and refresh the host before relying on it.';

function reinstall(expected: ExpectedCombination, name: string): string {
  const one = expected.packages[name];
  return one === undefined
    ? `@saga-a2ui/${name} is not part of candidate ${expected.version}; remove it.`
    : `Reinstall @saga-a2ui/${name} from candidate tarball ${one.tarball} (sha256 ${one.sha256}), together with the other SDK packages of that candidate. ${AFTER_REINSTALL}`;
}

/**
 * Compares the `@saga-a2ui/*` packages installed under `modulesDirectory` with a candidate. An
 * installed set is the candidate only when every package carries the candidate version, names only
 * siblings at that version, has the siblings it requires and contains every package in `required`
 * (the claimed combination's package set; every package of the candidate when not given, so an
 * incomplete set is never accepted by omission). Anything else is reported before the application
 * serves a view or renders data from a mixed set, with the tarball to reinstall.
 */
export function checkInstalledCombination(modulesDirectory: string, expected: ExpectedCombination, required: readonly string[] = Object.keys(expected.packages)): Finding[] {
  const scope = path.join(modulesDirectory, '@saga-a2ui');
  const installed = fs.existsSync(scope) ? fs.readdirSync(scope).sort() : [];
  if (installed.length === 0) {
    return [
      {
        code: 'modules-missing',
        expected: scope,
        guidance: `No @saga-a2ui package is installed at ${scope}${fs.existsSync(modulesDirectory) ? '' : ` (${modulesDirectory} does not exist)`}. Point --modules at the node_modules directory of the application, or install the candidate's tarballs there first (${required.map((name) => expected.packages[name]?.tarball ?? `@saga-a2ui/${name}`).join(', ')}). ${AFTER_REINSTALL}`,
      },
    ];
  }
  const findings: Finding[] = [];
  const present = new Set(installed);
  for (const name of required) {
    if (present.has(name)) continue;
    findings.push({
      code: 'missing-package',
      package: name,
      expected: expected.version,
      guidance:
        expected.packages[name] === undefined
          ? `The combination requires @saga-a2ui/${name}, which candidate ${expected.version} does not contain; the candidate record and the combination disagree.`
          : `@saga-a2ui/${name} is part of this combination but is not installed. ${reinstall(expected, name)}`,
    });
  }
  for (const name of installed) {
    let manifest: PackedManifest & { version?: string };
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(scope, name, 'package.json'), 'utf8')) as PackedManifest & { version?: string };
    } catch {
      findings.push({ code: 'unreadable-package', package: name, guidance: reinstall(expected, name) });
      continue;
    }
    if (expected.packages[name] === undefined) {
      findings.push({ code: 'not-in-candidate', package: name, guidance: reinstall(expected, name) });
      continue;
    }
    if (manifest.version !== expected.version) {
      findings.push({ code: 'version-mismatch', package: name, expected: expected.version, actual: String(manifest.version), guidance: reinstall(expected, name) });
    }
    const optionalPeers = new Set(Object.entries(manifest.peerDependenciesMeta ?? {}).filter(([, meta]) => meta.optional === true).map(([peer]) => peer));
    for (const group of [manifest.dependencies, manifest.peerDependencies]) {
      for (const [dependency, range] of Object.entries(group ?? {})) {
        if (!dependency.startsWith('@saga-a2ui/')) continue;
        const sibling = dependency.slice('@saga-a2ui/'.length);
        if (range !== expected.version) {
          findings.push({ code: 'range-mismatch', package: name, expected: expected.version, actual: `${dependency}@${range}`, guidance: reinstall(expected, name) });
        }
        if (!present.has(sibling) && !optionalPeers.has(dependency)) {
          findings.push({ code: 'missing-dependency', package: name, expected: dependency, guidance: reinstall(expected, sibling) });
        }
      }
    }
  }
  return findings;
}

/** The built view a server serves must be the one the candidate recorded; its URI is the digest of its bytes. */
export function checkPagePairing(html: Uint8Array, expectedUri: string): Finding[] {
  const actual = viewUriForHtml(html);
  if (actual === expectedUri) return [];
  return [
    {
      code: 'resource-mismatch',
      expected: expectedUri,
      actual,
      guidance: `The built view is ${actual}, not the candidate's ${expectedUri}. Rebuild the view from the candidate packages (not a cached build), restart the server so the tool result names the rebuilt view, and refresh the host before relying on it.`,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// The checks every claimed combination carries
// ---------------------------------------------------------------------------------------------

export interface CarriedCase {
  readonly file: string;
  /** The exact title of the test in `file`. */
  readonly title: string;
  readonly obligation: string;
}

export const PACK1_SPEC = 'apps/lit-host/e2e/pack1-consumers.spec.ts';
const LISTENER_TEST = 'scripts/installed-listener.test.ts';

/**
 * The behavior a combination must show before it is claimed, after an update and after a rollback:
 * who may see and change what, how an action is attached to an instance and ends, and that the view
 * and its server are a pair. A candidate record lists the ones it was built and tested with. A
 * rollback target whose record lacks one predates it, so restoring that combination would silently
 * undo the check; `floorFindings` says so. Each title is verified to exist, so renaming or deleting
 * a case is a reviewed change to this list.
 */
export const CARRIED_CASES: readonly CarriedCase[] = [
  { file: PACK1_SPEC, title: 'shows only the public fields, only to the account that owns them', obligation: 'disclosure: private fields and other accounts\' notes never reach the wire or the page' },
  { file: PACK1_SPEC, title: 'the server authorizes every protected request itself, whatever the client checked first', obligation: 'authorization is decided per request by the server, after a withdrawn permission too' },
  { file: PACK1_SPEC, title: 'a failure that may follow an applied archive stays unknown, while a known refusal says nothing changed', obligation: 'known success versus unknown remote effect' },
  { file: PACK1_SPEC, title: 'one archive definition on two rendered rows keeps each row’s pending state, request and result apart', obligation: 'action input and instance attachment: one definition, one binding per rendered instance' },
  { file: PACK1_SPEC, title: 'an asynchronous session prerequisite refuses before the protected request is sent', obligation: 'prerequisites run before the protected request' },
  { file: PACK1_SPEC, title: 'a late result does not present on another item after the item changes', obligation: 'subject freshness' },
  { file: PACK1_SPEC, title: 'disposing the view prevents a late result from presenting anywhere', obligation: 'disposal ends bindings and gives resources back' },
  { file: PACK1_SPEC, title: 'the page going away ends the application bindings and the connection, and a retained button does nothing', obligation: 'disposal when the page goes away' },
  { file: PACK1_SPEC, title: 'a layout that names an action or a handler is refused by the installed catalog, and a press sends nothing', obligation: 'no handler-name routing: a resource that names an action or handler in its layout is refused' },
  { file: PACK1_SPEC, title: 'a result from a server of another build is refused with guidance and renders none of it', obligation: 'a view and a server of different builds show nothing and say how to repair it' },
  { file: LISTENER_TEST, title: 'refuses every request without a user credential before any tool runs, with the documented status and challenge', obligation: 'the installed listener authenticates before any tool' },
  { file: LISTENER_TEST, title: 'shows each signed-in user only their own subscriptions, whatever account the arguments name', obligation: 'browse is scoped to the verified user' },
  { file: LISTENER_TEST, title: 'refuses Play to a user without access with one sentence that does not tell an unknown episode apart, and to any request without a user credential', obligation: 'Play entitlement' },
  { file: LISTENER_TEST, title: 'releases media only for the capability with a fresh proof from the key it was issued to, and refuses every other combination alike', obligation: 'media capability and proof binding' },
  { file: 'apps/lit-host/e2e/installed-listener.spec.ts', title: 'says denied for a user without access, plays nothing and never reaches the media path', obligation: 'a denied user plays nothing in the installed player' },
];

/** The carried cases that are not in their file, so a claim would rest on a test that does not exist. */
export function missingCarriedCases(root: string = repoRoot): CarriedCase[] {
  return CARRIED_CASES.filter((one) => !fs.readFileSync(path.join(root, one.file), 'utf8').includes(`'${one.title}'`));
}

/** Required cases a candidate record does not list: restoring that combination would undo them. */
export function floorFindings(record: { readonly carriedEvidence?: { readonly cases?: readonly { readonly file: string; readonly title: string }[] } }): Finding[] {
  const recorded = new Set((record.carriedEvidence?.cases ?? []).map((one) => `${one.file}\n${one.title}`));
  return CARRIED_CASES.filter((one) => !recorded.has(`${one.file}\n${one.title}`)).map((one) => ({
    code: 'floor-missing' as const,
    expected: one.title,
    guidance: `This candidate's record does not list the check "${one.title}" (${one.obligation}), so it predates it and restoring it would silently undo that fix. Restore a later candidate that lists it, or re-qualify this combination with the current ${one.file}.`,
  }));
}

// ---------------------------------------------------------------------------------------------
// What the candidate contains
// ---------------------------------------------------------------------------------------------

export interface Exclusion {
  readonly package: string;
  readonly reason: string;
  readonly paths: readonly string[];
}

function filesUnder(directory: string, relative = ''): string[] {
  return fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const next = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? filesUnder(directory, next) : [next];
  });
}

const exclusionReason = (file: string): string => {
  if (/\.test(-support)?\.tsx?$|\.test-support\./.test(file)) return 'test or test-support source (excluded by the package "files" list)';
  if (/^tsconfig.*\.json$/.test(file)) return 'type-check configuration of the workspace (not in the "files" list)';
  return 'not listed in the package "files" list';
};

/** The repository files of each package that the tarball leaves out, grouped by the rule that leaves them out. */
export function resolvedExclusions(packed: readonly PackedPackage[]): Exclusion[] {
  return packed.flatMap((one) => {
    const shipped = new Set(one.files.map((file) => file.path));
    const grouped = new Map<string, string[]>();
    for (const file of filesUnder(path.join(repoRoot, 'packages', one.name)).sort()) {
      if (shipped.has(file)) continue;
      grouped.set(exclusionReason(file), [...(grouped.get(exclusionReason(file)) ?? []), file]);
    }
    return [...grouped].map(([reason, paths]) => ({ package: one.name, reason, paths }));
  });
}

/** Consumer identities written by the builds (`identity.json`), narrowed to what the candidate cross-checks. */
export interface ConsumerIdentity {
  readonly sourceCommit: string;
  readonly sourceDirty: boolean;
  readonly packedTarballSha256: Readonly<Record<string, string>>;
}

export interface Pack1Identities extends ConsumerIdentity {
  readonly consumers: Readonly<
    Record<string, { readonly installedPackages: readonly string[]; readonly packedTarballSha256: Readonly<Record<string, string>>; readonly builtPage: { readonly path: string; readonly sha256: string }; readonly builtServer: { readonly path: string; readonly sha256: string } }>
  >;
}

/** Fails with the repair when a consumer was built from another revision than the candidate. */
export function assertSameRevision(label: string, identity: ConsumerIdentity, candidate: { readonly commit: string; readonly dirty: boolean }): void {
  if (identity.sourceCommit !== candidate.commit || identity.sourceDirty !== candidate.dirty) {
    throw new Error(`${label} was built from ${identity.sourceCommit}${identity.sourceDirty ? ' (dirty)' : ''}, not the candidate's ${candidate.commit}${candidate.dirty ? ' (dirty)' : ''}. Run \`npm run build\` on this revision first.`);
  }
}

/** Fails with the repair when a consumer installed other tarballs than the candidate's. */
export function assertInstalledTarballs(label: string, installed: Readonly<Record<string, string>>, packed: Readonly<Record<string, PackedPackage>>): void {
  for (const [name, sha256] of Object.entries(installed)) {
    const one = packed[name];
    if (one === undefined || one.sha256 !== sha256) {
      throw new Error(`${label} installed @saga-a2ui/${name} ${sha256}, which is not the candidate tarball ${one?.sha256 ?? '(none)'}. Run \`npm run build\` on this revision first.`);
    }
  }
}

export interface CombinationRecord {
  readonly id: string;
  readonly description: string;
  readonly packages: readonly string[];
  readonly resources: readonly { readonly role: string; readonly uri: string; readonly sha256: string; readonly file: string }[];
  readonly serverBundleSha256: string | null;
  readonly catalog: Readonly<Record<string, unknown>>;
}

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;
const builtResource = (role: string, file: string): CombinationRecord['resources'][number] => {
  const bytes = fs.readFileSync(path.join(repoRoot, file));
  return { role, uri: viewUriForHtml(bytes), sha256: sha256Hex(bytes), file };
};

const A2UI_PROTOCOL = { protocol: 'A2UI', version: 'v0.9', upstream: '@a2ui/web_core 0.13.0' } as const;

/** The claimed combinations: each is a package set with the resources and catalogs built from exactly that set. */
export function combinationRecords(pack1: Pack1Identities, installedHost: ConsumerIdentity & { readonly server: { readonly sha256: string } }): CombinationRecord[] {
  const pack = (id: 'own' | 'card'): CombinationRecord => {
    const consumer = pack1.consumers[id];
    if (consumer === undefined) throw new Error(`The PACK1 identity has no ${id} consumer.`);
    return {
      id: `notes-${id}`,
      description:
        id === 'own'
          ? 'The notes application with its own catalog alone (no optional components package installed), with the non-playback server action (archive).'
          : 'The same application with the optional FaithfulCard rendering each note body, with the same server action.',
      packages: [...consumer.installedPackages].sort(),
      resources: [builtResource('notes view', consumer.builtPage.path)],
      serverBundleSha256: consumer.builtServer.sha256,
      catalog: {
        ...A2UI_PROTOCOL,
        catalogId: CATALOG_ID,
        entries: id === 'own' ? ['Line', 'Column', 'Row', 'List', 'ActionButton'] : ['Line', 'Column', 'Row', 'List', 'ActionButton', 'FaithfulCard'],
        ...(id === 'card' ? { faithfulCard: { contractVersion: FAITHFUL_CARD_CONTRACT_VERSION } } : {}),
      },
    };
  };
  const installedViews = [
    builtResource('subscriptions view', 'apps/lit-host/dist-installed/subscriptions-view/subscriptions.html'),
    builtResource('playback view', 'apps/lit-host/dist-installed/playback-view/playback.html'),
  ];
  return [
    pack('own'),
    pack('card'),
    {
      id: 'browse-and-play-application',
      description: 'The synthetic browse and Play application, its listener and its views installed from the candidate packages (the episode view is served through the content policy, so its URI depends on the configured policy).',
      packages: Object.keys(installedHost.packedTarballSha256).sort(),
      resources: installedViews,
      serverBundleSha256: installedHost.server.sha256,
      catalog: { ...A2UI_PROTOCOL, faithfulCard: { contractVersion: FAITHFUL_CARD_CONTRACT_VERSION } },
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Installing with the real package manager
// ---------------------------------------------------------------------------------------------

export interface InstallResult {
  readonly ok: boolean;
  readonly output: string;
}

const NPM_FLAGS = ['--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'];

/** The third-party version the repository's lockfile resolved, which the clean consumer pins so the recipe is the tested one. */
function lockedVersion(name: string): string {
  const lock = readJson<{ packages: Record<string, { version?: string }> }>(path.join(repoRoot, 'package-lock.json'));
  const version = lock.packages[`node_modules/${name}`]?.version;
  if (version === undefined) throw new Error(`The lockfile has no ${name}.`);
  return version;
}

/** The dependencies a consumer of the packed packages declares itself: those of the PACK1 example, plus the React peers. */
export function consumerDependencies(): Record<string, string> {
  const example = readJson<{ dependencies: Record<string, string> }>(path.join(repoRoot, 'examples', 'pack1-consumer', 'package.json')).dependencies;
  const own = Object.fromEntries(Object.entries(example).filter(([name]) => !name.startsWith('@saga-a2ui/')));
  return { ...own, lit: lockedVersion('lit'), react: '19.3.1', 'react-dom': '19.3.1' };
}

/**
 * The overrides an application must carry, taken from the workspace root that the packages are
 * qualified with. Without `@a2ui/markdown-it` 0.2.1, a fresh install resolves 0.2.2, whose peer
 * `@a2ui/web_core ^0.14.0` conflicts with the pinned 0.13.0 and npm stops with ERESOLVE. npm
 * honors overrides of the root project only, so a package cannot carry this for its consumers.
 */
export function consumerOverrides(): Record<string, string> {
  return readJson<{ overrides: Record<string, string> }>(path.join(repoRoot, 'package.json')).overrides;
}

/** Runs the real `npm install` of the given tarballs into `directory` and reports whether it was accepted. */
export function installTarballs(directory: string, tarballs: readonly PackedPackage[], overrides: Readonly<Record<string, string>> = consumerOverrides()): InstallResult {
  fs.mkdirSync(directory, { recursive: true });
  const dependencies = { ...consumerDependencies(), ...Object.fromEntries(tarballs.map((one) => [`@saga-a2ui/${one.name}`, `file:${one.tarball}`])) };
  fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify({ name: 'candidate-install-check', private: true, type: 'module', dependencies, overrides }, null, 2)}\n`);
  const result = spawnSync('npm', ['install', ...NPM_FLAGS], { cwd: directory, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

/** Whether npm finds every declared dependency and peer of the installed tree satisfied. */
export function installedTreeIsValid(directory: string): InstallResult {
  const result = spawnSync('npm', ['ls', '--all', '--loglevel=error'], { cwd: directory, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

// ---------------------------------------------------------------------------------------------
// The candidate record
// ---------------------------------------------------------------------------------------------

const EVIDENCE_FILES = [
  'apps/lit-host/e2e/pack1-consumers.spec.ts',
  'scripts/pack1.test.ts',
  'scripts/release-candidate.test.ts',
  'apps/lit-host/e2e/installed-listener.spec.ts',
  'scripts/installed-listener.test.ts',
] as const;

function tarballRecord(one: PackedPackage) {
  const manifest = one.manifest as PackedManifest & { exports?: Record<string, string>; license?: string };
  return {
    name: `@saga-a2ui/${one.name}`,
    version: one.version,
    tarball: path.basename(one.tarball),
    sha256: one.sha256,
    integrity: one.integrity,
    bytes: one.bytes,
    license: manifest.license ?? null,
    private: (one.manifest as { private?: boolean }).private === true,
    exports: manifest.exports ?? {},
    dependencies: manifest.dependencies ?? {},
    peerDependencies: manifest.peerDependencies ?? {},
    optionalPeers: Object.entries(manifest.peerDependenciesMeta ?? {}).filter(([, meta]) => meta.optional === true).map(([name]) => name),
    files: one.files,
  };
}

/** Everything the record is built from; tests and the command line both supply it. */
export interface CandidateInputs {
  readonly revision: { readonly commit: string; readonly dirty: boolean };
  readonly packed: readonly PackedPackage[];
  readonly pack1: Pack1Identities;
  readonly installedHost: ConsumerIdentity & { readonly server: { readonly sha256: string } };
  readonly otherConsumers: readonly { readonly label: string; readonly identity: ConsumerIdentity }[];
  readonly install: { readonly ok: boolean; readonly treeValid: boolean; readonly verifyFindings: readonly Finding[]; readonly lockfileSha256: string | null; readonly resolved: Readonly<Record<string, string>> };
  readonly mismatchProbe: { readonly refused: boolean; readonly message: string };
  readonly localResult: Record<string, unknown> | null;
  readonly generatedAt: string;
}

export function candidateRecord(inputs: CandidateInputs): Record<string, unknown> {
  const byName = Object.fromEntries(inputs.packed.map((one) => [one.name, one]));
  const version = inputs.packed[0]?.version;
  if (version === undefined) throw new Error('A candidate needs packages.');
  assertSameRevision('The PACK1 consumers', inputs.pack1, inputs.revision);
  for (const [id, consumer] of Object.entries(inputs.pack1.consumers)) assertInstalledTarballs(`The PACK1 ${id} consumer`, consumer.packedTarballSha256, byName);
  assertSameRevision('The installed application', inputs.installedHost, inputs.revision);
  assertInstalledTarballs('The installed application', inputs.installedHost.packedTarballSha256, byName);
  for (const other of inputs.otherConsumers) {
    assertSameRevision(other.label, other.identity, inputs.revision);
    assertInstalledTarballs(other.label, other.identity.packedTarballSha256, byName);
  }
  const absent = missingCarriedCases();
  if (absent.length > 0) throw new Error(`The carried cases are not in their files: ${absent.map((one) => `"${one.title}" in ${one.file}`).join('; ')}. Update CARRIED_CASES with the change.`);
  const node = fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim();
  const rootManifest = readJson<{ engines: { node: string } }>(path.join(repoRoot, 'package.json'));
  return {
    format: 1,
    status: 'unreleased candidate',
    statement:
      'A candidate is a build of one revision for qualification. It is not a release: nothing is published, tagged or deployed, the packages remain private, and the version below exists only in these artifacts.',
    generatedAt: inputs.generatedAt,
    source: inputs.revision,
    version,
    predecessor: {
      published: null,
      statement:
        'This is the first candidate. No SAGA package has ever been published, so no earlier release exists and no upgrade from one was tested. The update and rollback sequence is rehearsed between two candidate builds only (scripts/release-candidate.test.ts).',
    },
    recipe: {
      node: { testedHere: process.version, minimum: rootManifest.engines.node, ciPinned: node },
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
      platform: `${process.platform}-${process.arch}`,
      lockfile: { file: 'package-lock.json', sha256: sha256Hex(fs.readFileSync(path.join(repoRoot, 'package-lock.json'))) },
      upstream: {
        a2ui: '@a2ui/web_core 0.13.0, @a2ui/lit 0.13.0, @a2ui/react 0.13.0',
        mcp: '@modelcontextprotocol/client, core, server 2.3.1; ext-apps 2.0.3',
        zod: 'zod 4.6.7 (MCP seam and components); zod 3.25.76 only as core\'s zod3 alias',
        react: 'react and react-dom 19.3.1 (exact peers of @saga-a2ui/react only)',
      },
      consumerOverrides: consumerOverrides(),
      consumerInstall: inputs.install,
    },
    packages: inputs.packed.map(tarballRecord),
    exclusions: resolvedExclusions(inputs.packed),
    combinations: combinationRecords(inputs.pack1, inputs.installedHost),
    versionMismatch: {
      siblingRanges: 'Every SDK-to-SDK dependency and peer is the exact candidate version, so the package manager refuses a sibling from another build.',
      installProbe: inputs.mismatchProbe,
      check: 'npm run candidate:verify reports each mismatched package and the tarball to reinstall before a view is served.',
    },
    carriedEvidence: {
      localResult: inputs.localResult,
      cases: CARRIED_CASES,
      files: EVIDENCE_FILES.map((file) => ({ file, sha256: sha256Hex(fs.readFileSync(path.join(repoRoot, file))) })),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The maintainer-readable summary
// ---------------------------------------------------------------------------------------------

export function candidateSummary(record: Record<string, unknown>): string {
  const packages = record.packages as ReturnType<typeof tarballRecord>[];
  const combinations = record.combinations as CombinationRecord[];
  const exclusions = record.exclusions as Exclusion[];
  const recipe = record.recipe as { node: { testedHere: string; minimum: string; ciPinned: string }; npm: string; platform: string };
  const source = record.source as { commit: string; dirty: boolean };
  const probe = (record.versionMismatch as { installProbe: { refused: boolean } }).installProbe;
  const local = (record.carriedEvidence as { localResult: { commit: string; validationLabel: string; exitCode: number; commands: { name: string; exitCode: number | null }[] } | null }).localResult;
  const lines = [
    `# SAGA A2UI candidate ${String(record.version)}`,
    '',
    `Status: ${String(record.status)}. ${String(record.statement)}`,
    '',
    `Source: ${source.commit}${source.dirty ? ' (tracked files modified)' : ''}. Node ${recipe.node.testedHere} (CI pins ${recipe.node.ciPinned}; minimum ${recipe.node.minimum}), npm ${recipe.npm}, ${recipe.platform}.`,
    '',
    `Predecessor: ${(record.predecessor as { statement: string }).statement}`,
    '',
    '## Packages',
    '',
    '| Package | Version | Tarball | SHA-256 | Files | Optional peers |',
    '| --- | --- | --- | --- | --- | --- |',
    ...packages.map((one) => `| ${one.name} | ${one.version} | ${one.tarball} | ${one.sha256} | ${one.files.length} | ${one.optionalPeers.join(', ') || 'none'} |`),
    '',
    'Each tarball stays `private` and names a registry that cannot resolve in `publishConfig`; npm 12.0.2 accepted the private manifest in `publish --dry-run`, so neither is relied on alone, and no CI job holds a publish credential. Every SDK-to-SDK dependency and peer is the exact candidate version.',
    '',
    '## Combinations',
    '',
    ...combinations.flatMap((one) => [
      `### ${one.id}`,
      '',
      one.description,
      '',
      `Packages: ${one.packages.join(', ')}. Server bundle SHA-256: ${one.serverBundleSha256 ?? 'none'}.`,
      '',
      ...one.resources.map((resource) => `- ${resource.role}: \`${resource.uri}\` (${resource.file})`),
      `- Catalog: ${JSON.stringify(one.catalog)}`,
      '',
    ]),
    '## Left out of the tarballs',
    '',
    ...exclusions.map((one) => `- @saga-a2ui/${one.package}: ${one.paths.length} file(s), ${one.reason}`),
    '',
    '## Install and version checks',
    '',
    `- Clean-directory \`npm install\` of the tarballs: ${(record.recipe as { consumerInstall: { ok: boolean; treeValid: boolean } }).consumerInstall.ok ? 'accepted' : 'FAILED'}; \`npm ls --all\` ${(record.recipe as { consumerInstall: { treeValid: boolean } }).consumerInstall.treeValid ? 'reports no missing or invalid dependency or peer' : 'REPORTS A PROBLEM'}.`,
    `- A set mixing two builds: ${probe.refused ? 'refused by npm' : 'NOT REFUSED'}.`,
    `- An application needs these root overrides, or a fresh install stops with ERESOLVE: ${JSON.stringify((record.recipe as { consumerOverrides: unknown }).consumerOverrides)}.`,
    local === null
      ? '- No `npm run verify` receipt was found on this tree, so this record carries no local result.'
      : `- Last \`npm run verify\` on this tree: ${local.validationLabel} at ${local.commit}, exit ${local.exitCode}${local.commands.filter((one) => one.exitCode !== 0).length > 0 ? `; failing: ${local.commands.filter((one) => one.exitCode !== 0).map((one) => one.name).join(', ')}` : ''}.`,
    '- Check an installed set with `npm run candidate:verify`; see docs/candidate-update-and-rollback.md for the update and rollback sequence, the obligations the candidate implements and what stays open.',
    '',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------

function option(argv: readonly string[], name: string): string | undefined {
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  const value = argv[at + 1];
  if (value === undefined) throw new Error(`${name} requires a value`);
  return value;
}

const required = (argv: readonly string[], name: string): string => {
  const value = option(argv, name);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
};

const dist = (...parts: string[]): string => path.join(repoRoot, 'apps', 'lit-host', ...parts);

/** Packs the candidate into `outDirectory`, runs the install checks and writes the record and summary. */
export function writeCandidate(outDirectory: string): Record<string, unknown> {
  const revision = sourceRevision();
  const version = candidateVersion(revision.commit, revision.dirty);
  const work = createWorkDirectory('saga-candidate-');
  try {
    const packages = path.join(outDirectory, 'packages');
    fs.rmSync(packages, { recursive: true, force: true });
    const packed = packSdkPackages(work, SDK_PACKAGES, packages, version);

    const clean = path.join(work, 'consumer');
    const installed = installTarballs(clean, packed);
    const lockfile = path.join(clean, 'package-lock.json');
    const tree = installed.ok ? installedTreeIsValid(clean) : { ok: false, output: installed.output };
    // The checker must agree with the package manager about the tree npm actually installed.
    const verifyFindings = installed.ok
      ? checkInstalledCombination(path.join(clean, 'node_modules'), { version, packages: Object.fromEntries(packed.map((one) => [one.name, { tarball: path.basename(one.tarball), sha256: one.sha256 }])) })
      : [];
    if (installed.ok) fs.copyFileSync(lockfile, path.join(outDirectory, 'consumer-package-lock.json'));
    const resolved = installed.ok
      ? Object.fromEntries(
          Object.entries(readJson<{ packages: Record<string, { version?: string }> }>(lockfile).packages)
            .filter(([key, entry]) => key.startsWith('node_modules/') && !key.slice('node_modules/'.length).includes('node_modules/') && entry.version !== undefined)
            .map(([key, entry]) => [key.slice('node_modules/'.length), entry.version as string]),
        )
      : {};

    // A set that mixes two builds must be refused by the package manager itself.
    const other = packSdkPackages(path.join(work, 'other'), SDK_PACKAGES, path.join(work, 'other', 'packages'), `${version}.probe`);
    const mixed = installTarballs(
      path.join(work, 'mixed'),
      packed.map((one) => (one.name === 'core' ? (other.find((candidate) => candidate.name === 'core') as PackedPackage) : one)),
    );

    const receipt = path.join(repoRoot, '.wise-agents', 'verify-receipts', 'latest.json');
    const record = candidateRecord({
      revision,
      packed,
      pack1: readJson<Pack1Identities>(dist('dist', 'pack1', 'identity.json')),
      installedHost: readJson(dist('dist-installed', 'identity.json')),
      otherConsumers: [
        { label: 'The answer consumer', identity: readJson<ConsumerIdentity>(dist('dist', 'answer-consumer', 'identity.json')) },
        { label: 'The React card consumer', identity: readJson<ConsumerIdentity>(dist('dist', 'react-card-consumer', 'identity.json')) },
      ],
      install: { ok: installed.ok, treeValid: tree.ok, verifyFindings, lockfileSha256: installed.ok ? sha256Hex(fs.readFileSync(lockfile)) : null, resolved },
      mismatchProbe: { refused: !mixed.ok, message: mixed.output.split('\n').slice(0, 6).join('\n') },
      localResult: fs.existsSync(receipt) ? summarizeReceipt(fs.readFileSync(receipt, 'utf8')) : null,
      generatedAt: new Date().toISOString(),
    });
    fs.mkdirSync(outDirectory, { recursive: true });
    fs.writeFileSync(path.join(outDirectory, 'candidate.json'), `${JSON.stringify(record, null, 2)}\n`);
    fs.writeFileSync(path.join(outDirectory, 'CANDIDATE.md'), candidateSummary(record));
    return record;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function expectedFrom(record: { version: string; packages: { name: string; tarball: string; sha256: string }[] }): ExpectedCombination {
  return { version: record.version, packages: Object.fromEntries(record.packages.map((one) => [one.name.replace('@saga-a2ui/', ''), { tarball: one.tarball, sha256: one.sha256 }])) };
}

const USAGE = 'usage: release-candidate.ts pack --out DIR | verify --candidate FILE --modules DIR --combination own|card|browse-and-play-application [--page FILE]';

interface VerifiedRecord {
  readonly version: string;
  readonly packages: { name: string; tarball: string; sha256: string }[];
  readonly combinations: CombinationRecord[];
  readonly carriedEvidence?: { cases?: { file: string; title: string }[] };
}

/** The combination a maintainer names: `own` and `card` are the notes application's, anything else must be an exact id. */
export function resolveCombination(record: Pick<VerifiedRecord, 'combinations'>, selector: string): CombinationRecord {
  const found = record.combinations.find((one) => one.id === selector || one.id === `notes-${selector}`);
  if (found === undefined) throw new Error(`The candidate has no combination "${selector}". It records: ${record.combinations.map((one) => one.id).join(', ')}.`);
  return found;
}

export interface VerifyOutcome {
  readonly exitCode: number;
  readonly summary: string;
  readonly errors: readonly string[];
}

/**
 * `candidate:verify`: whether the installed set under `--modules` is the claimed combination of the
 * candidate in `--candidate`. The combination is named (`--combination`), and its recorded package set
 * must be installed, at the candidate version, beside the siblings they require; an optional package
 * the combination does not record (for example the FaithfulCard components under `own`) is not
 * required. A usage problem (no such combination, an unreadable record) is exit 2.
 */
export function verifyCommand(argv: readonly string[]): VerifyOutcome {
  try {
    const record = readJson<VerifiedRecord>(path.resolve(required(argv, '--candidate')));
    const combination = resolveCombination(record, required(argv, '--combination'));
    const findings = checkInstalledCombination(path.resolve(required(argv, '--modules')), expectedFrom(record), combination.packages);
    findings.push(...floorFindings(record));
    const page = option(argv, '--page');
    if (page !== undefined) {
      const [resource, ...others] = combination.resources;
      if (resource === undefined || others.length > 0) throw new Error(`--page compares one built view, and ${combination.id} records ${combination.resources.length}; check its views with their own builds.`);
      findings.push(...checkPagePairing(fs.readFileSync(path.resolve(page)), resource.uri));
    }
    return {
      exitCode: findings.length === 0 ? 0 : 1,
      summary: findings.length === 0 ? `installed set matches candidate ${record.version} (${combination.id}: ${combination.packages.join(', ')})` : `${findings.length} mismatch(es) against candidate ${record.version} (${combination.id})`,
      errors: findings.map((finding) => `${finding.code}${finding.package ? ` @saga-a2ui/${finding.package}` : ''}: ${finding.guidance}`),
    };
  } catch (error) {
    return { exitCode: 2, summary: USAGE, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  if (command === 'pack') {
    const record = writeCandidate(path.resolve(required(rest, '--out')));
    const install = (record.recipe as { consumerInstall: { ok: boolean; treeValid: boolean; verifyFindings: unknown[] } }).consumerInstall;
    const probe = (record.versionMismatch as { installProbe: { refused: boolean } }).installProbe;
    console.log(`candidate ${String(record.version)} written`);
    if (!install.ok || !install.treeValid || install.verifyFindings.length > 0 || !probe.refused) {
      console.error('The candidate install checks failed; see candidate.json (recipe.consumerInstall, versionMismatch.installProbe).');
      return 1;
    }
    return 0;
  }
  if (command === 'verify') {
    const result = verifyCommand(rest);
    for (const line of result.errors) console.error(line);
    console.log(result.summary);
    return result.exitCode;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
