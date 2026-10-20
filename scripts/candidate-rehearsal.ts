import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewUriForHtml } from '@saga-a2ui/mcp/server';
import type * as Pack1Server from '../examples/pack1-consumer/server/index.js';
import { startTestHost } from '../packages/mcp/src/server/http-host.test-support.js';
import { sha256Hex } from './candidate-identity.js';
import { PACK1_CONSUMERS, buildPack1Consumer, type Pack1Consumer } from './build-pack1-consumers.js';
import { candidateVersion, createWorkDirectory, packSdkPackages, repoRoot, sourceRevision, type PackedPackage } from './packed-consumer.js';
import { CARRIED_CASES, PACK1_SPEC, SDK_PACKAGES, assertInstalledTarballs, checkInstalledCombination, checkPagePairing, type ExpectedCombination } from './release-candidate.js';

// PACK2: rehearses the update and the rollback of a candidate as built applications, not as manifests.
// Candidate A is installed, then candidate B replaces it, then A is restored. At every stage each
// PACK1 consumer (own and card) is installed from exactly that stage's tarballs, the installed set is
// checked against the candidate, the page and the server are rebuilt from that install, the server is
// connected to and shown to serve the page it was built with, and the representative action and
// lifetime cases of the PACK1 browser spec run against that rebuilt page and server over a real MCP
// connection. The result records which artifacts were installed and built and which cases ran.
//
// A and B are packed from the same source revision and differ only in their version, because this
// repository has no earlier candidate: the rebuilt resources are therefore expected to be identical,
// and the rehearsal shows the procedure and the behavior of each rebuilt application, not a
// difference between two versions of the code. No published release exists, and none is involved.
//
//   npm run build && npm run candidate:pack -- --out candidate-out
//   npm run candidate:rehearse -- --candidate candidate-out/candidate.json
//
// It needs the browser specs' prerequisites (`npm run build`, Playwright Chromium) and publishes nothing.

export type StageName = 'install' | 'update' | 'rollback';
export type CandidateName = 'A' | 'B';

export const STAGES: readonly { readonly name: StageName; readonly candidate: CandidateName }[] = [
  { name: 'install', candidate: 'A' },
  { name: 'update', candidate: 'B' },
  { name: 'rollback', candidate: 'A' },
];

/** The browser cases run against each rebuilt application: those of the PACK1 spec that the combinations carry. */
export const REHEARSED_TITLES: readonly string[] = CARRIED_CASES.filter((one) => one.file === PACK1_SPEC).map((one) => one.title);

export interface ObservedCase {
  readonly consumer: string;
  readonly title: string;
  /** `passed`, `failed`, `flaky` or `skipped`. */
  readonly status: string;
}

/** Runs the named cases of the PACK1 browser spec against the consumers built under `stageRoot`. */
export type BrowserRunner = (stageRoot: string, titles: readonly string[]) => readonly ObservedCase[];

export interface BuiltConsumer {
  readonly installedPackages: readonly string[];
  readonly installedTarballSha256: Readonly<Record<string, string>>;
  readonly page: { readonly uri: string; readonly sha256: string };
  /**
   * `sha256` is of the file as written. A bundle names, in its region comments, the scratch directory
   * it was built in, so two builds of one install differ in those comments; `normalizedSha256` is the
   * digest with that directory name replaced, which is what a rollback must restore.
   */
  readonly server: { readonly sha256: string; readonly normalizedSha256: string };
  /** The resource URI the rebuilt server's tool names, and whether it serves the rebuilt page's exact bytes. */
  readonly served: { readonly uri: string; readonly isTheBuiltPage: boolean };
}

export interface StageRecord {
  readonly name: StageName;
  readonly candidate: CandidateName;
  readonly version: string;
  readonly tarballSha256: Readonly<Record<string, string>>;
  readonly consumers: Readonly<Record<string, BuiltConsumer>>;
  readonly observed: readonly ObservedCase[];
}

export interface RehearsalRecord {
  readonly format: 1;
  readonly statement: string;
  readonly candidates: Readonly<Record<CandidateName, string>>;
  readonly stages: readonly StageRecord[];
  /** Per consumer: what the update changed and whether the rollback restored the first install. */
  readonly transitions: Readonly<Record<string, { readonly pageChangedByUpdate: boolean; readonly pageRestoredByRollback: boolean; readonly serverRestoredByRollback: boolean }>>;
}

const STATEMENT =
  'Candidates A and B are packed from one source revision and differ only in version, so the rebuilt resources are expected to be identical. This rehearses installing, updating and restoring built applications and the behavior of each rebuilt application over a real MCP connection; it is not a difference between two versions of the code, and no published release exists or was involved.';

const expectation = (packed: readonly PackedPackage[]): ExpectedCombination => ({
  version: packed[0]!.version,
  packages: Object.fromEntries(packed.map((one) => [one.name, { tarball: path.basename(one.tarball), sha256: one.sha256 }])),
});

function serverDigests(bytes: Buffer): BuiltConsumer['server'] {
  const normalized = bytes.toString('utf8').replace(/saga-pack1-(own|card)-[A-Za-z0-9]+/g, 'saga-pack1-$1-scratch');
  return { sha256: sha256Hex(bytes), normalizedSha256: sha256Hex(Buffer.from(normalized, 'utf8')) };
}

type ServerModule = typeof Pack1Server;
const ALICE = { token: 't', clientId: 'c', scopes: [], expiresAt: 9_999_999_999, extra: { accountId: 'acct-alice' } };

/** Connects to the rebuilt server, as an application's listener would, and reads the view its tool names. */
async function servedView(serverFile: string, html: string): Promise<{ uri: string; html: string }> {
  const server = (await import(pathToFileURL(serverFile).href)) as ServerModule;
  const host = await startTestHost({
    jsonResponse: true,
    buildServer: () => server.createNotesServer({ html, backend: server.createFixtureBackend() }),
    authenticate: (credential) => (credential === undefined ? undefined : ALICE),
  });
  try {
    const client = await host.connect('alice');
    const { tools } = await client.listTools();
    const uri = (tools.find((tool) => tool.name === 'list_notes')?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri;
    if (uri === undefined) throw new Error('The rebuilt server\'s list_notes is not linked to a view.');
    const { contents } = await client.readResource({ uri });
    const [content] = contents;
    if (!content || !('text' in content)) throw new Error('The rebuilt server returned no view text.');
    return { uri, html: content.text };
  } finally {
    await host.close();
  }
}

/** Fails, naming the stage and case, unless every rehearsed case ran for every consumer and passed. */
function assertAllRan(stage: StageName, consumers: readonly string[], observed: readonly ObservedCase[]): void {
  for (const consumer of consumers) {
    for (const title of REHEARSED_TITLES) {
      const runs = observed.filter((one) => one.consumer === consumer && one.title === title);
      if (runs.length !== 1) throw new Error(`The ${stage} stage did not run "${title}" once for the ${consumer} consumer (it ran ${runs.length} time(s)).`);
      if (runs[0]!.status !== 'passed') throw new Error(`The ${stage} stage: "${title}" ${runs[0]!.status} for the ${consumer} consumer.`);
    }
  }
}

export interface RehearsalOptions {
  readonly a: readonly PackedPackage[];
  readonly b: readonly PackedPackage[];
  /** Where each stage's rebuilt consumers are written (`<outDir>/1-install/own/…`). */
  readonly outDir: string;
  readonly browser: BrowserRunner;
  readonly consumers?: readonly Pack1Consumer[];
}

/**
 * Installs A, updates to B and restores A, each time rebuilding and qualifying the applications from
 * that stage's tarballs alone. Throws, with the repair, at the first stage whose installed set is not
 * the stage's candidate, whose rebuilt server does not serve its rebuilt page, whose rollback does
 * not restore the first install, or in which a rehearsed case did not run and pass.
 */
export async function rehearseTransition(options: RehearsalOptions): Promise<RehearsalRecord> {
  const consumers = options.consumers ?? (Object.keys(PACK1_CONSUMERS) as Pack1Consumer[]);
  const sets: Record<CandidateName, readonly PackedPackage[]> = { A: options.a, B: options.b };
  fs.rmSync(options.outDir, { recursive: true, force: true });
  const stages: StageRecord[] = [];
  for (const [index, stage] of STAGES.entries()) {
    const set = sets[stage.candidate];
    const byName = Object.fromEntries(set.map((one) => [one.name, one]));
    const root = path.join(options.outDir, `${index + 1}-${stage.name}`);
    const built: Record<string, BuiltConsumer> = {};
    for (const consumer of consumers) {
      const recipe = PACK1_CONSUMERS[consumer];
      const identity = await buildPack1Consumer(consumer, path.join(root, consumer), {
        candidate: set,
        beforeBuild: (prepared) => {
          const findings = checkInstalledCombination(path.join(prepared.consumer, 'node_modules'), expectation(set), recipe.packages);
          if (findings.length > 0) throw new Error(`The ${stage.name} install of the ${consumer} consumer is not candidate ${stage.candidate}:\n${findings.map((finding) => `${finding.code}: ${finding.guidance}`).join('\n')}`);
        },
      });
      assertInstalledTarballs(`The ${stage.name} build of the ${consumer} consumer`, identity.packedTarballSha256, byName);
      const pageBytes = fs.readFileSync(path.join(root, consumer, recipe.page));
      const serverFile = path.join(root, consumer, 'server.mjs');
      const served = await servedView(serverFile, pageBytes.toString('utf8'));
      const isTheBuiltPage = served.uri === viewUriForHtml(pageBytes) && Buffer.from(served.html, 'utf8').equals(pageBytes);
      if (!isTheBuiltPage) throw new Error(`The ${stage.name} stage's ${consumer} server serves ${served.uri}, not the view it was rebuilt with (${viewUriForHtml(pageBytes)}). Rebuild the view from this install and restart the server so it serves that view.`);
      built[consumer] = {
        installedPackages: identity.installedPackages,
        installedTarballSha256: identity.packedTarballSha256,
        page: { uri: viewUriForHtml(pageBytes), sha256: sha256Hex(pageBytes) },
        server: serverDigests(fs.readFileSync(serverFile)),
        served: { uri: served.uri, isTheBuiltPage },
      };
    }
    const observed = options.browser(root, REHEARSED_TITLES);
    assertAllRan(stage.name, consumers, observed);
    stages.push({ name: stage.name, candidate: stage.candidate, version: set[0]!.version, tarballSha256: Object.fromEntries(set.map((one) => [one.name, one.sha256])), consumers: built, observed });
  }

  const [install, update, rollback] = stages as [StageRecord, StageRecord, StageRecord];
  const transitions: Record<string, RehearsalRecord['transitions'][string]> = {};
  for (const consumer of consumers) {
    const first = install.consumers[consumer]!;
    const restored = rollback.consumers[consumer]!;
    const pageRestoredByRollback = restored.page.uri === first.page.uri && restored.page.sha256 === first.page.sha256;
    const serverRestoredByRollback = restored.server.normalizedSha256 === first.server.normalizedSha256;
    if (!pageRestoredByRollback) {
      throw new Error(`Rolling back did not restore the ${consumer} view: it is ${restored.page.uri}, not the installed ${first.page.uri}. Rebuild the view from the restored candidate's tarballs (not a cached build) and restart the server.`);
    }
    if (!serverRestoredByRollback) throw new Error(`Rolling back did not restore the ${consumer} server bundle (${restored.server.normalizedSha256}, not ${first.server.normalizedSha256}). Rebuild it from the restored candidate's tarballs.`);
    transitions[consumer] = { pageChangedByUpdate: update.consumers[consumer]!.page.sha256 !== first.page.sha256, pageRestoredByRollback, serverRestoredByRollback };
  }
  return { format: 1, statement: STATEMENT, candidates: { A: install.version, B: update.version }, stages, transitions };
}

// ---------------------------------------------------------------------------------------------
// Running the browser cases
// ---------------------------------------------------------------------------------------------

interface PlaywrightSuite {
  readonly title: string;
  readonly specs?: readonly { readonly title: string; readonly tests: readonly { readonly status: string }[] }[];
  readonly suites?: readonly PlaywrightSuite[];
}

const STATUS: Record<string, string> = { expected: 'passed', unexpected: 'failed', flaky: 'flaky', skipped: 'skipped' };

/** The cases a Playwright JSON report ran, with the consumer each ran for (named by its describe block). */
export function observedCases(report: { readonly suites?: readonly PlaywrightSuite[] }): ObservedCase[] {
  const found: ObservedCase[] = [];
  const walk = (suite: PlaywrightSuite, consumer: string | undefined): void => {
    const own = /^(\w+) consumer, installed from packed artifacts$/.exec(suite.title)?.[1] ?? consumer;
    for (const spec of suite.specs ?? []) for (const test of spec.tests) if (own !== undefined) found.push({ consumer: own, title: spec.title, status: STATUS[test.status] ?? test.status });
    for (const child of suite.suites ?? []) walk(child, own);
  };
  for (const suite of report.suites ?? []) walk(suite, undefined);
  return found;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runs the cases with the repository's Playwright against `SAGA_PACK1_DIR=stageRoot` (see the spec). */
export const playwrightRunner: BrowserRunner = (stageRoot, titles) => {
  const result = spawnSync('npx', ['playwright', 'test', 'e2e/pack1-consumers.spec.ts', '--grep', titles.map(escapeRegExp).join('|'), '--reporter=json'], {
    cwd: path.join(repoRoot, 'apps', 'lit-host'),
    env: { ...process.env, SAGA_PACK1_DIR: stageRoot },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  try {
    return observedCases(JSON.parse(result.stdout) as { suites?: PlaywrightSuite[] });
  } catch {
    throw new Error(`Playwright produced no report (exit ${result.status}). Run \`npm run build\` first. ${result.stderr.split('\n').slice(-12).join('\n')}`);
  }
};

// ---------------------------------------------------------------------------------------------
// The record next to the candidate, and the command line
// ---------------------------------------------------------------------------------------------

const SECTION = '<!-- rehearsal -->';

/** The maintainer-readable account of what the rehearsal installed, built and ran. */
export function rehearsalSummary(record: RehearsalRecord): string {
  const lines = [
    SECTION,
    '## Update and rollback rehearsal',
    '',
    record.statement,
    '',
    `Candidate A: ${record.candidates.A}. Candidate B: ${record.candidates.B}.`,
    '',
    ...record.stages.flatMap((stage) => [
      `### ${stage.name}: candidate ${stage.candidate}`,
      '',
      ...Object.entries(stage.consumers).map(
        ([consumer, one]) =>
          `- ${consumer}: installed ${one.installedPackages.join(', ')} from tarballs ${Object.entries(one.installedTarballSha256).map(([name, sha]) => `${name} ${sha.slice(0, 12)}`).join(', ')}; rebuilt view ${one.page.uri}; server ${one.server.sha256.slice(0, 12)}; its tool serves that view: ${one.served.isTheBuiltPage ? 'yes' : 'NO'}.`,
      ),
      `- Browser cases run against these rebuilt applications (${stage.observed.length}): ${stage.observed.filter((one) => one.status === 'passed').length} passed.`,
      '',
    ]),
    '### Transitions',
    '',
    ...Object.entries(record.transitions).map(([consumer, one]) => `- ${consumer}: update ${one.pageChangedByUpdate ? 'changed' : 'did not change'} the rebuilt view; rollback restored the view ${one.pageRestoredByRollback ? 'exactly' : 'NOT'} and the server bundle ${one.serverRestoredByRollback ? 'exactly' : 'NOT'}.`),
    '',
    `Cases run at each stage, for both consumers: ${REHEARSED_TITLES.map((title) => `"${title}"`).join('; ')}.`,
    '',
  ];
  return lines.join('\n');
}

/** Writes `rehearsal.json` beside the candidate record and replaces the rehearsal section of its summary. */
export function writeRehearsal(candidateFile: string, record: RehearsalRecord): void {
  const directory = path.dirname(candidateFile);
  fs.writeFileSync(path.join(directory, 'rehearsal.json'), `${JSON.stringify(record, null, 2)}\n`);
  const summaryFile = path.join(directory, 'CANDIDATE.md');
  if (!fs.existsSync(summaryFile)) return;
  const summary = fs.readFileSync(summaryFile, 'utf8');
  const kept = summary.includes(SECTION) ? summary.slice(0, summary.indexOf(SECTION)) : `${summary}\n`;
  fs.writeFileSync(summaryFile, `${kept}${rehearsalSummary(record)}`);
}

async function main(argv: string[]): Promise<number> {
  const at = argv.indexOf('--candidate');
  const candidateArgument = at === -1 ? undefined : argv[at + 1];
  if (candidateArgument === undefined) {
    console.error('usage: candidate-rehearsal.ts --candidate DIR/candidate.json   (after `npm run build` and `npm run candidate:pack -- --out DIR`)');
    return 2;
  }
  const candidateFile = path.resolve(candidateArgument);
  const recorded = JSON.parse(fs.readFileSync(candidateFile, 'utf8')) as { version: string; packages: { name: string; sha256: string }[] };
  const revision = sourceRevision();
  const version = candidateVersion(revision.commit, revision.dirty);
  if (recorded.version !== version) throw new Error(`The candidate record is ${recorded.version}, but this tree is ${version}. Rehearse the candidate of the revision you have checked out (run candidate:pack again).`);
  const work = createWorkDirectory('saga-rehearsal-');
  try {
    const a = packSdkPackages(path.join(work, 'a'), SDK_PACKAGES, path.join(work, 'a', 'packages'), version);
    for (const one of a) {
      const named = recorded.packages.find((entry) => entry.name === `@saga-a2ui/${one.name}`);
      if (named?.sha256 !== one.sha256) throw new Error(`@saga-a2ui/${one.name} packs to ${one.sha256}, not the recorded ${named?.sha256 ?? '(none)'}: the record was not made from this tree.`);
    }
    const b = packSdkPackages(path.join(work, 'b'), SDK_PACKAGES, path.join(work, 'b', 'packages'), `${version}.update`);
    const record = await rehearseTransition({ a, b, outDir: path.join(repoRoot, 'apps', 'lit-host', 'dist', 'rehearsal'), browser: playwrightRunner });
    writeRehearsal(candidateFile, record);
    console.log(`rehearsed ${record.candidates.A} -> ${record.candidates.B} -> ${record.candidates.A}: ${record.stages.map((stage) => `${stage.name} ${stage.observed.length} cases`).join(', ')}`);
    return 0;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
