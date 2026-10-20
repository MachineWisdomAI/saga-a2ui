import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FetchLike } from '@modelcontextprotocol/client';
import { viewUriForHtml } from '@saga-a2ui/mcp/server';
import { ExportInterrupted, TemplateError, createDirectoryInterruptibly, sameDirectory, type OutputFile } from '../starter-template.js';
import { DOCUMENTATION_DATE, assemblePackage, checkArchive, endpointUrlProblem, loadOfficialValidators, redactSecrets, secretKinds, type ValidatorLoad } from './chatgpt.js';
import { discoverEndpoint, invokeFixture, toolDigest, type Discovery, type EndpointSnapshot } from './endpoint.js';
import { readPreviousOutput, staleness } from './previous.js';
import {
  ARCHIVE_FILE,
  RECORD_FILE,
  RECORD_FORMAT,
  canonicalDigest,
  fail,
  pass,
  sha256,
  unknown,
  verdictOf,
  type Finding,
  type FixtureInvocation,
  type HandoffItem,
  type PublicationRecord,
} from './record.js';
import { loadReleaseInput, type LoadedReleaseInput } from './release-input.js';
import { writeZip } from './zip.js';

// `saga publish check|prepare` (CLI3 #66): validates a built application, its deployed endpoint and
// the release input, and prepares the ChatGPT plugin package with a digest-bound findings record.
//
// - `check` writes nothing. `prepare` writes `findings.json` and, when nothing failed, the package,
//   into one new directory, or replaces a directory this tool generated earlier, only after the new
//   output is complete (`writeOutput`).
// - Discovery is read-only. Calling application tools is `--invoke-fixture`, explicit, limited to
//   the tools the release input declares and to tools that advertise `readOnlyHint: true`.
// - Nothing is deployed, uploaded or submitted, and a prepared package is never reported as live.
//   What only the owner or the host can do is listed as handoff, whatever the checks say.

const MCP_APP_MIME = 'text/html;profile=mcp-app';
const SUBMISSION_NOTE = 'Preparing a package submits nothing. Submission, the host\'s review and publication are separate acts that only the publisher and the host can perform.';

export interface PublishRequest {
  readonly command: 'check' | 'prepare';
  readonly target: string;
  /** The release input file. */
  readonly release: string;
  /** `prepare`: the directory to create, or a directory this tool generated earlier to replace. */
  readonly out?: string | undefined;
  /** An earlier output directory to compare with; changed inputs make its evidence stale. */
  readonly against?: string | undefined;
  readonly invokeFixture: boolean;
  /** The name of an environment variable holding a bearer credential for read-only discovery of a protected endpoint. */
  readonly bearerEnv?: string | undefined;
}

export interface PublishIo {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly signal?: AbortSignal | undefined;
  /** Where a credential named by `--bearer-env` is read from. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The network seam for the endpoint. Defaults to the platform's `fetch`. */
  readonly fetch?: FetchLike | undefined;
  /** The manifest validators. Defaults to the pinned official schemas; a test supplies an unavailable one. */
  readonly validators?: ValidatorLoad | undefined;
}

/** What `saga.ts` loads, only when a publication command runs. */
export interface PublicationTool {
  run(request: PublishRequest, io: PublishIo): Promise<number>;
}

const EXIT_NOT_READY = 1;
const EXIT_INTERRUPTED = 130;

// ---------------------------------------------------------------------------------------------
// The application's build
// ---------------------------------------------------------------------------------------------

interface BuiltView {
  readonly file: string;
  readonly uri: string | null;
  readonly sha256: string | null;
  readonly bytes: number | null;
  readonly data: Buffer | null;
}

/** Reads the built views named by the release input. A view that is missing, a link or outside the build directory is a finding. */
function readBuild(loaded: LoadedReleaseInput): { readonly views: BuiltView[]; readonly findings: Finding[] } {
  const { build } = loaded.input;
  const buildDirectory = path.resolve(loaded.directory, build.directory);
  const findings: Finding[] = [];
  let realBuild: string;
  try {
    realBuild = fs.realpathSync(buildDirectory);
    if (!fs.statSync(realBuild).isDirectory()) throw new Error('not a directory');
  } catch {
    findings.push(fail('build.directory', `The build directory ${build.directory} does not exist.`, 'Build the application, or correct build.directory in the release input.'));
    return { views: build.views.map((file) => ({ file, uri: null, sha256: null, bytes: null, data: null })), findings };
  }
  const problems: string[] = [];
  const views = build.views.map((file): BuiltView => {
    const missing: BuiltView = { file, uri: null, sha256: null, bytes: null, data: null };
    try {
      const candidate = path.resolve(realBuild, file);
      if (fs.lstatSync(candidate).isSymbolicLink()) throw new Error('is a link');
      const real = fs.realpathSync(candidate);
      if (real !== realBuild && !real.startsWith(`${realBuild}${path.sep}`)) throw new Error('is outside the build directory');
      if (!fs.statSync(real).isFile()) throw new Error('is not a file');
      const data = fs.readFileSync(real);
      if (data.length === 0) throw new Error('is empty');
      return { file, uri: viewUriForHtml(data), sha256: sha256(data), bytes: data.length, data };
    } catch (error) {
      problems.push(`${file} ${(error as NodeJS.ErrnoException).code === 'ENOENT' ? 'does not exist' : (error as Error).message}.`);
      return missing;
    }
  });
  findings.push(
    problems.length === 0
      ? pass('build.views', `${views.length} built view${views.length === 1 ? '' : 's'} read from ${build.directory}.`)
      : fail('build.views', 'A built view cannot be used.', 'Rebuild the application so every file in build.views exists inside build.directory.', problems.join(' ')),
  );
  return { views, findings };
}

/**
 * The `@saga-a2ui/*` packages of the application, kept as two facts: what its `package.json` declares
 * (the build directory's, else the release input's directory) and what is installed in the
 * `node_modules` that serves that directory (the first one found walking up from it), or `null`
 * when a declared package is not installed there.
 */
function sagaPackages(loaded: LoadedReleaseInput): PublicationRecord['application']['sagaPackages'] {
  for (const directory of [path.resolve(loaded.directory, loaded.input.build.directory), loaded.directory]) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const declared = { ...manifest.devDependencies, ...manifest.dependencies };
      const saga = Object.entries(declared).filter(([name]) => name.startsWith('@saga-a2ui/')).sort(([a], [b]) => (a < b ? -1 : 1));
      if (saga.length === 0) continue;
      return { declared: Object.fromEntries(saga), installed: Object.fromEntries(saga.map(([name]) => [name, installedVersion(directory, name)])) };
    } catch {
      // try the next location
    }
  }
  return { declared: {}, installed: {} };
}

/** The version in the nearest `node_modules/<name>/package.json` above `directory`, or `null`. */
function installedVersion(directory: string, name: string): string | null {
  for (let current = directory; ; current = path.dirname(current)) {
    try {
      const version = (JSON.parse(fs.readFileSync(path.join(current, 'node_modules', name, 'package.json'), 'utf8')) as { version?: unknown }).version;
      return typeof version === 'string' ? version : null;
    } catch {
      // not here; look one level up
    }
    if (path.dirname(current) === current) return null;
  }
}

function sourceOf(directory: string): PublicationRecord['source'] {
  const git = (args: string[]): string => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return { revision: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain=v1', '--untracked-files=no']) !== '' };
  } catch {
    return { revision: null, dirty: null };
  }
}

// ---------------------------------------------------------------------------------------------
// The endpoint
// ---------------------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The view URI a tool declares, in either of the keys MCP Apps hosts read. */
function declaredViewUri(tool: Readonly<Record<string, unknown>>): string | undefined {
  const meta = tool._meta;
  if (!isRecord(meta)) return undefined;
  const nested = isRecord(meta.ui) ? meta.ui.resourceUri : undefined;
  const flat = meta['ui/resourceUri'];
  return typeof nested === 'string' ? nested : typeof flat === 'string' ? flat : undefined;
}

function toolFindings(snapshot: EndpointSnapshot): Finding[] {
  if (snapshot.tools.length === 0 && snapshot.truncated.length === 0) return [fail('endpoint.tools', 'The endpoint advertises no tools.', 'Deploy the application so its tools are listed.')];
  const problems: string[] = [];
  for (const tool of snapshot.tools) {
    if (typeof tool.description !== 'string' || tool.description.trim() === '') problems.push(`${tool.name} has no description.`);
    const annotations = isRecord(tool.annotations) ? tool.annotations : {};
    const missing = ['readOnlyHint', 'destructiveHint', 'openWorldHint'].filter((hint) => typeof annotations[hint] !== 'boolean');
    if (missing.length > 0) problems.push(`${tool.name} does not set ${missing.join(', ')} to true or false.`);
  }
  return [
    problems.length === 0 && snapshot.truncated.length > 0
      ? unknown('endpoint.tools', 'Only part of the endpoint was read, so its tool definitions were not fully checked.', 'Reduce the endpoint\'s paging so every tool fits the bounds this tool reads, then rerun.', 'The tools that were read are described and annotated; the ones that were not read cannot be certified.')
      : problems.length === 0
      ? pass('endpoint.tools', `${snapshot.tools.length} tool${snapshot.tools.length === 1 ? '' : 's'} advertised, each with a description and explicit read-only, destructive and open-world annotations.`)
      : fail('endpoint.tools', 'A tool definition breaks the plugin guidelines.', 'Describe every tool and set its three annotation hints explicitly.', problems.join(' ')),
  ];
}

function viewFindings(snapshot: EndpointSnapshot, views: readonly BuiltView[]): Finding[] {
  const problems: string[] = [];
  const built = views.filter((view) => view.uri !== null);
  // When the read was partial, a view that was not seen is not proved absent; the partial read is reported as unknown by the caller.
  const partial = snapshot.truncated.length > 0;
  for (const view of built) {
    const served = snapshot.resources.find((resource) => resource.uri === view.uri);
    if (served === undefined) {
      if (!partial) problems.push(`The endpoint does not serve ${view.file} (${view.uri}); the deployed application is not this build, or this build is not deployed.`);
    } else if (served.sha256 !== view.sha256) problems.push(`The endpoint serves ${served.uri} with different bytes than ${view.file}.`);
  }
  for (const tool of snapshot.tools) {
    const uri = declaredViewUri(tool);
    if (uri !== undefined && !built.some((view) => view.uri === uri)) problems.push(`${tool.name} points to ${uri}, which is not a view of this build.`);
  }
  for (const resource of snapshot.resources) {
    const addressed = /^ui:\/\/sha256\/([0-9a-f]{64})\.html$/.exec(resource.uri);
    if (addressed !== null && addressed[1] !== resource.sha256) problems.push(`${resource.uri} names a digest that is not the digest of the bytes served.`);
    if (resource.mimeType !== MCP_APP_MIME) problems.push(`${resource.uri} is served as ${resource.mimeType ?? 'no type'}, not ${MCP_APP_MIME}.`);
    const ui = isRecord(resource.meta) && isRecord(resource.meta.ui) ? resource.meta.ui : undefined;
    if (!isRecord(ui?.csp)) problems.push(`${resource.uri} declares no content security policy.`);
  }
  for (const missed of snapshot.unreadable) problems.push(`${missed.uri} could not be read: ${missed.reason}`);
  if (snapshot.resources.length === 0 && built.length > 0 && problems.length === 0 && !partial) problems.push('The endpoint serves no view resources.');
  return [
    problems.length === 0 && partial
      ? unknown('endpoint.views', 'Only part of the endpoint was read, so the deployed views were not fully checked.', 'Reduce the endpoint\'s paging so every tool and view fits the bounds this tool reads, then rerun.', 'Nothing seen contradicts the build, but the views and tool definitions that were not read cannot be certified.')
      : problems.length === 0
      ? pass('endpoint.views', `The endpoint serves every built view byte-for-byte as ${MCP_APP_MIME} with a declared content security policy, and each tool points to one of them.`)
      : fail('endpoint.views', 'The deployed views do not match the build.', 'Redeploy the build the release input names (or rebuild), then rerun.', problems.join(' ')),
  ];
}

interface Identity {
  readonly status: 'established' | 'unknown' | 'mismatch';
  readonly basis: string;
}

function deploymentIdentity(loaded: LoadedReleaseInput, discovery: Discovery): { identity: Identity; finding: Finding } {
  const expected = loaded.input.endpoint.expectedServer;
  const server = discovery.kind === 'discovered' ? discovery.snapshot.server : null;
  if (expected === undefined) {
    const basis = server === null ? 'The endpoint reported no server identity and the release input declares none.' : `The endpoint reports ${server.name} ${server.version}, but the release input declares no endpoint.expectedServer to compare it with.`;
    return { identity: { status: 'unknown', basis }, finding: unknown('endpoint.identity', 'The deployment identity is unknown.', 'Declare endpoint.expectedServer (the name and version the deployment reports) in the release input.', basis) };
  }
  if (server === null) {
    const basis = 'The endpoint could not be read, so its identity was not observed.';
    return { identity: { status: 'unknown', basis }, finding: unknown('endpoint.identity', 'The deployment identity is unknown.', 'Make the endpoint readable and rerun.', basis) };
  }
  if (server.name === expected.name && server.version === expected.version) {
    const basis = `The endpoint reports ${server.name} ${server.version}, as the release input declares.`;
    return { identity: { status: 'established', basis }, finding: pass('endpoint.identity', 'The deployment reports the identity the release input declares.', basis) };
  }
  const basis = `The endpoint reports ${server.name} ${server.version}; the release input declares ${expected.name} ${expected.version}.`;
  return { identity: { status: 'mismatch', basis }, finding: fail('endpoint.identity', 'The deployment is not the one the release input declares.', 'Deploy the declared version, or update endpoint.expectedServer.', basis) };
}

// ---------------------------------------------------------------------------------------------
// What only the owner or the host can do
// ---------------------------------------------------------------------------------------------

function handoffFor(loaded: LoadedReleaseInput): HandoffItem[] {
  const items: HandoffItem[] = [
    { id: 'publisher-authority', summary: `Confirm that ${loaded.input.publisher.name} is the intended listing owner and that the submitting OpenAI organization has completed individual or business verification under that name.` },
    { id: 'domain-verification', summary: 'In the submission portal, host the challenge token at /.well-known/openai-apps-challenge on the endpoint host and connect the server.' },
    { id: 'authentication', summary: 'If the endpoint needs sign-in, configure its authentication in the portal connection form and provide a reviewer test account there; credentials never belong in the package.' },
  ];
  const cases = loaded.input.review?.test_cases;
  const positive = cases?.positive?.length ?? 0;
  const negative = cases?.negative?.length ?? 0;
  if (positive !== 5 || negative !== 3) items.push({ id: 'review-test-cases', summary: `Initial review needs exactly five positive and three negative test cases; the release input has ${positive} and ${negative}.` });
  if (loaded.input.review?.demo_recording_url === undefined) items.push({ id: 'review-demo-recording', summary: 'Initial review needs a reviewer-accessible video walkthrough URL (review.demo_recording_url).' });
  items.push({ id: 'host-observation', summary: 'Installation, card rendering and interactions in actual ChatGPT web runs are observed separately; this tool\'s checks, fixture invocations and directory approval do not replace them.' });
  return items;
}

// ---------------------------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------------------------

/** A URL as it may appear in a record: without any credentials it carried. */
function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.href;
  } catch {
    return '(not a URL)';
  }
}

interface Assessment {
  readonly record: PublicationRecord;
  readonly archive: Buffer | null;
}

async function assess(request: PublishRequest, loaded: LoadedReleaseInput, io: PublishIo): Promise<Assessment> {
  const { input } = loaded;
  const findings: Finding[] = [pass('input.release', `The release input conforms to the saga-publication/1 format.`)];

  // The build.
  const build = readBuild(loaded);
  findings.push(...build.findings);

  // The endpoint.
  let bearer = request.bearerEnv === undefined ? undefined : io.environment[request.bearerEnv];
  if (request.bearerEnv !== undefined && (bearer === undefined || bearer === '')) {
    findings.push(fail('endpoint.credential', `The environment variable ${request.bearerEnv} named by --bearer-env is not set.`, 'Export the credential before running, or omit --bearer-env.'));
    bearer = undefined;
  } else if (bearer !== undefined && safeProtocol(input.endpoint.url) !== 'https:') {
    findings.push(fail('endpoint.credential', 'The credential was not sent: the endpoint is not HTTPS.', 'Use the HTTPS endpoint, or omit --bearer-env.'));
    bearer = undefined;
  }
  const urlProblem = endpointUrlProblem(input.endpoint.url);
  findings.push(urlProblem === null ? pass('endpoint.url', 'The endpoint is a public HTTPS URL.') : fail('endpoint.url', 'The endpoint cannot be submitted.', 'Set endpoint.url to the stable public HTTPS endpoint of the deployed application.', urlProblem));

  let discovery: Discovery;
  const discoverable = /^https?:$/.test(safeProtocol(input.endpoint.url));
  if (!discoverable) discovery = { kind: 'not-discovered', reason: 'The endpoint is not an HTTP or HTTPS URL.', authenticationRequired: false };
  else discovery = await discoverEndpoint(input.endpoint.url, { fetch: io.fetch, signal: io.signal, bearer });
  if (discovery.kind === 'discovered') {
    const partial = discovery.snapshot.truncated;
    findings.push(
      partial.length === 0
        ? pass('endpoint.discovery', 'The endpoint was read: initialize, tools/list, resources/list and resources/read. No tool was called.')
        : unknown('endpoint.discovery', 'The endpoint was only partly read: a bound on how much is read was reached.', 'Make the endpoint list its tools and views within the bounds this tool reads (20 pages of each list, 50 views), then rerun.', partial.join(' ')),
    );
    findings.push(...toolFindings(discovery.snapshot), ...viewFindings(discovery.snapshot, build.views));
  } else {
    findings.push(
      unknown(
        'endpoint.discovery',
        discovery.authenticationRequired ? 'The endpoint requires authentication, so its tools and views were not read.' : 'The endpoint could not be read, so its tools and views were not checked.',
        discovery.authenticationRequired ? 'Rerun with --bearer-env NAME naming an environment variable that holds a read-only credential, or check the views and tools in the submission portal scan.' : 'Make the deployed endpoint reachable and rerun.',
        discovery.reason,
      ),
    );
  }
  const { identity, finding: identityFinding } = deploymentIdentity(loaded, discovery);
  findings.push(identityFinding);

  // The package, built and then checked as the bytes that would be uploaded.
  const assembled = assemblePackage(input, loaded.directory);
  if (assembled.unreadableAssets.length > 0) {
    findings.push(fail('package.asset-files', 'An asset file cannot be added to the package.', 'Add or correct the files named in assets in the release input.', assembled.unreadableAssets.map((one) => `${one.source}: ${one.reason}`).join(' ')));
  }
  const archive = writeZip(assembled.entries);
  const validators = io.validators ?? loadOfficialValidators();
  const archiveCheck = checkArchive(archive, { validators, endpointUrl: input.endpoint.url, forbiddenLiterals: bearer === undefined ? [] : [bearer] });
  findings.push(...archiveCheck.findings);

  // Fixture invocation: only when asked, only what the release input declares.
  const declared = input.fixture?.calls ?? [];
  let invocations: FixtureInvocation[] = [];
  if (request.invokeFixture) {
    if (declared.length === 0) {
      findings.push(fail('fixture.invocation', '--invoke-fixture was given but the release input declares no fixture.calls.', 'Declare the fixture calls to make, or omit --invoke-fixture.'));
    } else if (discovery.kind !== 'discovered') {
      findings.push(unknown('fixture.invocation', 'The fixture calls were not made: the endpoint could not be read.', 'Make the endpoint readable and rerun.'));
    } else {
      invocations = await invokeFixture(input.endpoint.url, declared, discovery.snapshot.tools, { fetch: io.fetch, signal: io.signal, bearer });
      const bad = invocations.filter((one) => one.outcome !== 'ok');
      findings.push(
        bad.length === 0
          ? pass('fixture.invocation', `${invocations.length} fixture call${invocations.length === 1 ? '' : 's'} succeeded. This is fixture evidence, not a real-host observation.`)
          : fail('fixture.invocation', 'A fixture call did not succeed.', 'Fix the tool or its declared fixture; a tool must advertise readOnlyHint: true to be called.', bad.map((one) => `${one.tool}: ${one.outcome}`).join(', ')),
      );
    }
  }

  // The record.
  const snapshot = discovery.kind === 'discovered' ? discovery.snapshot : undefined;
  const tools = (snapshot?.tools ?? []).map((tool) => ({ name: tool.name, sha256: toolDigest(tool) })).sort((a, b) => (a.name < b.name ? -1 : 1));
  const resources = (snapshot?.resources ?? []).map((resource) => ({ uri: resource.uri, mimeType: resource.mimeType, sha256: resource.sha256, bytes: resource.bytes.length, metaSha256: resource.meta === null ? null : canonicalDigest(resource.meta) })).sort((a, b) => (a.uri < b.uri ? -1 : 1));
  const instructionsSha256 = snapshot === undefined || snapshot.instructions === null ? null : sha256(snapshot.instructions);
  const contractSha256 = snapshot === undefined ? null : canonicalDigest({ tools: snapshot.tools, instructions: snapshot.instructions, resources: snapshot.resources.map((resource) => ({ uri: resource.uri, mimeType: resource.mimeType, sha256: resource.sha256, meta: resource.meta })).sort((a, b) => (a.uri < b.uri ? -1 : 1)) });

  const source = sourceOf(loaded.directory);
  const draft = (extra: readonly Finding[], artifact: PublicationRecord['artifact']): PublicationRecord => {
    const all = [...findings, ...extra];
    return {
      format: RECORD_FORMAT,
      target: 'chatgpt',
      verdict: verdictOf(all),
      source,
      application: {
        name: input.name,
        version: input.version,
        publisher: { name: input.publisher.name, url: input.publisher.url ?? null },
        contributors: (input.contributors ?? []).map((one) => ({ name: one.name, url: one.url ?? null })),
        sagaPackages: sagaPackages(loaded),
      },
      inputs: { releaseInput: { sha256: loaded.sha256 }, views: build.views.map(({ file, uri, sha256: digest, bytes }) => ({ file, uri, sha256: digest, bytes })) },
      endpoint: {
        url: displayUrl(input.endpoint.url),
        reached: snapshot !== undefined,
        complete: snapshot !== undefined && snapshot.truncated.length === 0,
        server: snapshot?.server ?? null,
        deploymentIdentity: identity,
        contractSha256,
        instructionsSha256,
        tools,
        resources,
        toolCallsDuringDiscovery: 0,
      },
      fixture: { declared: declared.length, invoked: request.invokeFixture && invocations.length > 0, invocations },
      artifact,
      validators: [
        { name: 'chatgpt-plugin-package', identity: validators.ok ? validators.validators.identity : `unavailable: ${validators.problem}`, documentationDate: DOCUMENTATION_DATE },
      ],
      findings: all,
      handoff: handoffFor(loaded),
      submission: { state: 'not-submitted', note: SUBMISSION_NOTE },
    };
  };

  // Stale evidence: compare with an earlier output when asked. The comparison needs the new package digest,
  // so it follows the first pass; its findings join the record without changing the package.
  const failedBeforeArtifact = findings.some((one) => one.status === 'fail');
  const artifact: PublicationRecord['artifact'] = failedBeforeArtifact
    ? null
    : { file: ARCHIVE_FILE, sha256: sha256(archive), bytes: archive.length, files: archiveCheck.entries.map((entry) => ({ path: entry.path, sha256: sha256(entry.data), bytes: entry.data.length })).sort((a, b) => (a.path < b.path ? -1 : 1)) };
  const extra: Finding[] = [];
  if (request.against !== undefined) {
    const previous = readPreviousOutput(path.resolve(io.cwd, request.against));
    if (previous.kind === 'missing') {
      extra.push(fail('record.previous', 'The earlier output cannot be read.', 'Pass the directory a previous prepare created, or omit --against.', previous.problem));
    } else {
      extra.push(previous.intact ? pass('record.integrity', 'The earlier package matches the digest in its record.') : fail('record.integrity', 'The earlier output was altered.', 'Run prepare again to regenerate it.', previous.problem));
      try {
        const changes = staleness(previous.record, draft([], artifact));
        extra.push(changes.length === 0 ? pass('record.fresh', 'Nothing the earlier evidence depends on has changed.') : fail('record.fresh', 'The earlier evidence is stale.', 'Rerun prepare; the checks listed as changed need their host evidence repeated.', `Changed since then: ${changes.join('; ')}.`));
      } catch {
        extra.push(fail('record.previous', 'The earlier record is damaged and cannot be compared.', 'Run prepare again to regenerate it.'));
      }
    }
  }

  // The record must carry no secret either. The package was scanned already; the record is scanned as it will be written.
  const leaks = [...secretKinds(JSON.stringify(draft(extra, artifact))), ...(bearer !== undefined && bearer !== '' && JSON.stringify(draft(extra, artifact)).includes(bearer) ? ['credential supplied for discovery'] : [])];
  if (leaks.length > 0) extra.push(fail('record.secrets', 'The findings record would contain a secret.', 'Remove it from the inputs the record echoes.', `Found: ${[...new Set(leaks)].join(', ')}.`));

  const blocked = [...findings, ...extra].some((one) => one.status === 'fail');
  const record = draft(extra, blocked ? null : artifact);
  return { record, archive: blocked ? null : archive };
}

function safeProtocol(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------------------------
// Writing the output
// ---------------------------------------------------------------------------------------------

const GENERATED_FILES = new Set([RECORD_FILE, ARCHIVE_FILE]);

/** Whether `directory` is something this tool generated: a real directory holding only its own files and a record in its format. */
function isGeneratedOutput(directory: string): boolean {
  try {
    if (!fs.lstatSync(directory).isDirectory()) return false;
    const names = fs.readdirSync(directory);
    if (!names.includes(RECORD_FILE) || names.some((name) => !GENERATED_FILES.has(name))) return false;
    return (JSON.parse(fs.readFileSync(path.join(directory, RECORD_FILE), 'utf8')) as { format?: unknown }).format === RECORD_FORMAT;
  } catch {
    return false;
  }
}

/**
 * Makes `target` hold exactly `files`. A new path is created whole or not at all (the same
 * destination handling as `saga init`). A directory this tool generated earlier is replaced only
 * after the new output has been completely written beside it, so an interruption or a failure leaves
 * the earlier output as it was, and the replacement never leaves an old package next to a new record.
 */
async function writeOutput(target: string, files: readonly OutputFile[], signal: AbortSignal | undefined): Promise<void> {
  if (!fs.existsSync(target) && !isSymlink(target)) {
    await createDirectoryInterruptibly(target, files, { signal });
    return;
  }
  // Ownership is the directory (device and inode) that was verified to be this tool's earlier
  // output, not the pathname: staging is asynchronous, so another process may rename that
  // directory away and put its own at `target` before the swap. Every rename and every removal
  // below is conditional on the directory it is about to act on still being the one verified here,
  // the same rule createDirectoryInterruptibly follows for the directory it creates. Node has no
  // directory-relative calls, so the check narrows the window to the instant between two adjacent
  // calls and does not close it.
  const earlier = statDirectory(target);
  if (earlier === undefined || !isGeneratedOutput(target) || !isSameDirectory(statDirectory(target), earlier)) {
    throw new TemplateError(`${target} exists and is not a directory this command generated; choose a new directory.`);
  }
  const replaced = (): TemplateError => new TemplateError(`${target} was replaced while the output was being written; nothing at that path was changed or removed, and the new output was discarded.`);
  const staging = path.join(path.dirname(target), `.${path.basename(target)}.staging-${randomBytes(6).toString('hex')}`);
  await createDirectoryInterruptibly(staging, files, { signal });
  const staged = statDirectory(staging);
  const discardStaging = (): boolean => {
    if (!isSameDirectory(statDirectory(staging), staged)) return false;
    fs.rmSync(staging, { recursive: true, force: true });
    return true;
  };
  if (signal?.aborted) throw new ExportInterrupted(discardStaging());
  if (staged === undefined || !isSameDirectory(statDirectory(target), earlier) || !isGeneratedOutput(target)) {
    discardStaging();
    throw replaced();
  }
  const previous = path.join(path.dirname(target), `.${path.basename(target)}.previous-${randomBytes(6).toString('hex')}`);
  fs.renameSync(target, previous);
  if (!isSameDirectory(statDirectory(previous), earlier)) {
    // What was moved aside is not what was verified: put it back if the path is free, and leave it named otherwise.
    if (!fs.existsSync(target) && !isSymlink(target)) fs.renameSync(previous, target);
    discardStaging();
    throw replaced();
  }
  try {
    fs.renameSync(staging, target);
  } catch (error) {
    if (!fs.existsSync(target) && !isSymlink(target)) fs.renameSync(previous, target);
    discardStaging();
    throw error;
  }
  if (isSameDirectory(statDirectory(previous), earlier)) fs.rmSync(previous, { recursive: true, force: true });
}

const statDirectory = (directory: string): fs.BigIntStats | undefined => {
  try {
    return fs.lstatSync(directory, { bigint: true });
  } catch {
    return undefined;
  }
};

const isSameDirectory = (a: fs.BigIntStats | undefined, b: fs.BigIntStats | undefined): boolean => a !== undefined && b !== undefined && sameDirectory(a, b);

const isSymlink = (file: string): boolean => {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------

function report(record: PublicationRecord, request: PublishRequest): string {
  const mark = { pass: 'pass   ', fail: 'FAIL   ', unknown: 'unknown' } as const;
  const lines = [`saga publish ${request.command} (chatgpt): ${record.verdict}`, ''];
  for (const finding of record.findings) {
    lines.push(`  ${mark[finding.status]} ${finding.id}: ${finding.summary}`);
    if (finding.status !== 'pass') {
      if (finding.detail !== undefined) lines.push(`          ${finding.detail}`);
      if (finding.repair !== undefined) lines.push(`          Repair: ${finding.repair}`);
    }
  }
  lines.push('', 'Pending handoff (this tool does not do these):');
  for (const item of record.handoff) lines.push(`  - ${item.summary}`);
  lines.push('', `Deployment identity: ${record.endpoint.deploymentIdentity.status}. ${record.endpoint.deploymentIdentity.basis}`);
  return `${lines.join('\n')}\n`;
}

/**
 * The same `io` whose two output channels pass everything through `redactSecrets` first, with the
 * credential supplied for discovery as a literal. Every line this command prints, a finding, an
 * error or a path, goes through it, so no reporting path can disclose a credential that an
 * endpoint echoed or an input carried, whatever wording produced it.
 */
function withRedactedOutput(io: PublishIo, request: PublishRequest): PublishIo {
  const supplied = request.bearerEnv === undefined ? undefined : io.environment[request.bearerEnv];
  const literals = supplied === undefined || supplied === '' ? [] : [supplied];
  return { ...io, stdout: (text) => io.stdout(redactSecrets(text, literals)), stderr: (text) => io.stderr(redactSecrets(text, literals)) };
}

export const publicationTool: PublicationTool = {
  async run(request, unredacted) {
    const io = withRedactedOutput(unredacted, request);
    if (request.target !== 'chatgpt') {
      io.stderr(`saga publish: the ${request.target} target is not supported by this version; the supported target is chatgpt.\n`);
      return 2;
    }
    if (io.signal?.aborted) {
      io.stderr('saga publish: interrupted before anything was read or written.\n');
      return EXIT_INTERRUPTED;
    }
    const loaded = loadReleaseInput(path.resolve(io.cwd, request.release));
    if (!loaded.ok) {
      io.stderr(`saga publish: ${loaded.problem}\nNothing was prepared; fix the release input and rerun.\n`);
      return EXIT_NOT_READY;
    }
    let assessment: Assessment;
    try {
      assessment = await assess(request, loaded.loaded, io);
    } catch (error) {
      if (io.signal?.aborted) {
        io.stderr('saga publish: interrupted; nothing was written.\n');
        return EXIT_INTERRUPTED;
      }
      throw error;
    }
    if (io.signal?.aborted) {
      io.stderr('saga publish: interrupted; nothing was written.\n');
      return EXIT_INTERRUPTED;
    }
    const { record, archive } = assessment;
    io.stdout(report(record, request));

    if (request.command === 'prepare') {
      const leaked = record.findings.some((finding) => finding.id === 'record.secrets');
      if (leaked || request.out === undefined) {
        io.stderr(leaked ? 'saga publish: nothing was written because the record would contain a secret.\n' : 'saga publish: prepare needs --out DIRECTORY.\n');
        return leaked ? EXIT_NOT_READY : 2;
      }
      const target = path.resolve(io.cwd, request.out);
      if (!fs.existsSync(path.dirname(target)) || !fs.statSync(path.dirname(target)).isDirectory()) {
        io.stderr(`saga publish: the parent directory ${path.dirname(target)} does not exist; create it first or choose a path inside an existing directory.\n`);
        return EXIT_NOT_READY;
      }
      const files: OutputFile[] = [{ path: RECORD_FILE, content: () => `${JSON.stringify(record, null, 2)}\n` }];
      if (archive !== null) files.push({ path: ARCHIVE_FILE, content: () => archive });
      try {
        await writeOutput(target, files, io.signal);
      } catch (error) {
        if (error instanceof ExportInterrupted) {
          io.stderr(`saga publish: interrupted; ${error.removed ? 'the output this run was writing was removed and nothing that existed was changed' : 'the output path had been replaced during the write, so nothing there was removed'}.\n`);
          return EXIT_INTERRUPTED;
        }
        io.stderr(`saga publish: ${(error as Error).message}\n`);
        return EXIT_NOT_READY;
      }
      io.stdout(`\nWrote ${request.out}/${RECORD_FILE}${archive === null ? ' (no package: a check failed)' : ` and ${ARCHIVE_FILE} (sha256 ${record.artifact?.sha256 ?? ''})`}.\n`);
    }
    io.stdout('Nothing was deployed, uploaded, submitted or published.\n');
    return record.verdict === 'ready' ? 0 : EXIT_NOT_READY;
  },
};
