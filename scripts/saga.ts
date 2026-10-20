import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { candidateVersion, sourceRevision } from './packed-consumer.js';
import type { StagedDemo } from './build-demo.js';
import type { FetchLike } from '@modelcontextprotocol/client';
import type { ValidatorLoad } from './publish/chatgpt.js';
import type { PluginValidator } from './publish/claude-plugin.js';
import type { HandoffAction, HandoffRequest } from './publish/handoff.js';
import type { PublicationTool, PublishRequest } from './publish/publish.js';
import { DEMO_TEMPLATE } from './qualified-starters.js';
import { ExportInterrupted, TemplateError, createDirectoryInterruptibly, exportTemplateInterruptibly, readTemplateMetadata, refuseExisting, templateDirectory } from './starter-template.js';

// The `saga` command (CLI1, CLI2). It owns the command line, the lists of pairs it offers and what
// it prints; the files it writes are `exportTemplate`'s for a starter, and the DEMO1 download's for
// the demonstration, both through the one destination handling of starter-template.ts.
//
//   npx tsx scripts/saga.ts init --a2ui-stack lit-mcp --server node ./my-app
//   npx tsx scripts/saga.ts demo --a2ui-stack lit-mcp --server node ./my-demo
//   npx tsx scripts/saga.ts publish prepare --target chatgpt --release saga-publication.json --out ./publication
//   npx tsx scripts/saga.ts publish prepare --target claude --release saga-publication.json --out ./publication
//   npx tsx scripts/saga.ts publish handoff begin --handoff ./handoff --prepared ./publication --authority-ref 'owner agreement, ticket 12'
//
// `init` and `demo` each create one new directory. Neither installs anything, runs a package manager,
// hook or script of the output, or changes anything that already exists. `publish` (CLI3, CLI4) is the
// optional publication tooling: it is loaded only when that command runs (scripts/publish/), checks a
// built application and its deployed endpoint, and prepares a host package and findings record; its
// `handoff` commands (CLI5) keep the resumable record of the manual submission that follows. It
// deploys, uploads and submits nothing.

/** A stack and server target together with the maintained template that implements them. */
export interface QualifiedPair {
  readonly stack: string;
  readonly server: string;
  readonly template: string;
}

/**
 * The pairs `init` offers: those CI qualifies, and no others. A template directory existing does not
 * add a pair. Each owner of a further pair adds one row here when its qualification passes, and
 * removes it while that qualification fails. The rows follow `QUALIFIED_STARTERS`
 * (scripts/qualified-starters.ts), whose templates CI qualifies from packed artifacts: Node
 * (scripts/starter.test.ts), Express (starter-express.test.ts), Fastify (starter-fastify.test.ts) and
 * Hono (starter-hono.test.ts), each also in apps/lit-host/e2e/starter.spec.ts. No other pair is
 * offered: React and Hapi have no qualified template.
 */
export const SUPPORTED_PAIRS: readonly QualifiedPair[] = [
  { stack: 'lit-mcp', server: 'node', template: 'lit-node' },
  { stack: 'lit-mcp', server: 'express', template: 'lit-express' },
  { stack: 'lit-mcp', server: 'fastify', template: 'lit-fastify' },
  { stack: 'lit-mcp', server: 'hono', template: 'lit-hono' },
];

/**
 * The pairs `demo` offers: those offered by `init` whose qualified template the standalone
 * demonstration (DEMO1) is built on. A qualified starter alone does not add a demonstration.
 */
export const SUPPORTED_DEMO_PAIRS: readonly QualifiedPair[] = SUPPORTED_PAIRS.filter((pair) => pair.template === DEMO_TEMPLATE);

/** The optional publication tooling (CLI3): loaded only when a `publish` command runs, so `init` and `demo` never depend on it. */
export interface PublicationSupport {
  readonly load: () => Promise<PublicationTool>;
  /** Where `--bearer-env` reads a credential from. */
  readonly environment: Readonly<Record<string, string | undefined>>;
  /** The network seam for endpoint discovery; the platform's `fetch` when absent. */
  readonly fetch?: FetchLike | undefined;
  /** The ChatGPT manifest validators; the pinned official schemas when absent. */
  readonly validators?: ValidatorLoad | undefined;
  /** The validator of the optional Claude plugin bundle; Claude Code's `claude plugin validate` when absent. */
  readonly pluginValidator?: PluginValidator | undefined;
  /** The clock of a handoff record; the system clock when absent. */
  readonly now?: (() => Date) | undefined;
}

export interface Environment {
  /** Where a relative directory is resolved from. */
  readonly cwd: string;
  /** The SDK build a created project is pinned to; only asked for when a project is about to be written. */
  readonly sdkVersion: () => string;
  /**
   * Builds the demonstration (DEMO1) outside any destination; only asked for when `demo` has a
   * destination it may write. An aborted `signal` ends the build early with the abort error.
   */
  readonly stageDemo: (signal?: AbortSignal) => Promise<StagedDemo>;
  /** The publication tooling for `saga publish`; a command line that asks for it without one is refused. */
  readonly publication?: PublicationSupport | undefined;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Aborted by an interrupt. The command then leaves nothing behind that it created. */
  readonly signal?: AbortSignal | undefined;
}

const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const EXIT_INTERRUPTED = 130;

const pairLines = (pairs: readonly QualifiedPair[]): string => pairs.map((pair) => `  --a2ui-stack ${pair.stack} --server ${pair.server}`).join('\n');

const USAGE = `Usage: saga init --a2ui-stack <renderer>-mcp --server <target> <directory>
       saga demo --a2ui-stack <renderer>-mcp --server <target> <directory>
       saga publish check --target <chatgpt|claude> --release <saga-publication.json> [--against <directory>] [--invoke-fixture] [--bearer-env <name>]
       saga publish prepare --target <chatgpt|claude> --release <saga-publication.json> --out <directory> [--against <directory>] [--invoke-fixture] [--bearer-env <name>]
       saga publish handoff <begin|status|attempt|confirm-submission|void-attempt|record-review|record-listing> --handoff <directory> [options]

init creates <directory>, which must not exist yet, from the maintained starter for the pair.
demo creates it from the standalone demonstration of the pair: a local-only application with
synthetic data, not a starter. Nothing is installed or run, and nothing that exists is changed.

Supported pairs for init:
${pairLines(SUPPORTED_PAIRS)}

Supported pairs for demo:
${pairLines(SUPPORTED_DEMO_PAIRS)}

publish checks a built application, its deployed HTTPS MCP endpoint and the release input, then
(prepare) writes the host's materials and a findings record into <directory>: the ChatGPT plugin
package, or the Claude connector dossier (a plugin bundle only when the release input supplies its
scope). It reads the endpoint without calling any tool unless --invoke-fixture is given, and it
deploys, uploads and submits nothing. check writes nothing. A verdict other than ready exits 1.

publish handoff keeps the resumable record of the manual submission that follows prepare, in
<directory> (scripts/publish/README.md): begin pins a ready prepared release (--prepared) and the
references to the intended publisher's authority (--authority-ref, at least once); attempt records
that you are about to submit by hand and is refused while an earlier attempt is unsettled;
confirm-submission (--reference) or void-attempt (--inspected) settles it; record-review (--state)
and record-listing (--state, --host, --evidence, --prepared) record what the host reported and what
you observed on a named host; status shows preparation, submission, review and the live listing
apart, and with --prepared whether the release has changed. Times default to now; --observed-at
gives the time the host showed it. These commands read local files only: they call no host and
submit nothing.
`;

type Creation = 'init' | 'demo';
interface CreateRequest {
  readonly kind: Creation;
  readonly stack: string;
  readonly server: string;
  readonly directory: string;
}
type Command = { readonly kind: 'help' } | CreateRequest | { readonly kind: 'publish'; readonly request: PublishRequest } | { readonly kind: 'handoff'; readonly request: HandoffRequest } | { readonly kind: 'usage'; readonly message: string };

/** The options only `publish handoff` takes. */
const HANDOFF_OPTIONS = ['handoff', 'prepared', 'authority-ref', 'reference', 'observed-at', 'inspected', 'state', 'host', 'evidence'] as const;

/** The options only `publish` takes; `init` and `demo` refuse them instead of ignoring them. */
const PUBLISH_OPTIONS = ['target', 'release', 'out', 'against', 'invoke-fixture', 'bearer-env', ...HANDOFF_OPTIONS] as const;

function parseCommandLine(argv: readonly string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        'a2ui-stack': { type: 'string' },
        server: { type: 'string' },
        help: { type: 'boolean' },
        target: { type: 'string' },
        release: { type: 'string' },
        out: { type: 'string' },
        against: { type: 'string' },
        'invoke-fixture': { type: 'boolean' },
        'bearer-env': { type: 'string' },
        handoff: { type: 'string' },
        prepared: { type: 'string' },
        'authority-ref': { type: 'string', multiple: true },
        reference: { type: 'string' },
        'observed-at': { type: 'string' },
        inspected: { type: 'string' },
        state: { type: 'string' },
        host: { type: 'string' },
        evidence: { type: 'string' },
      },
    });
  } catch (error) {
    return { kind: 'usage', message: (error as Error).message };
  }
  if (parsed.values.help) return { kind: 'help' };
  const [command, ...rest] = parsed.positionals;
  if (command === 'publish') return parsePublish(parsed.values, rest);
  if (command !== 'init' && command !== 'demo') return { kind: 'usage', message: command === undefined ? 'Say what to do: init, demo or publish.' : `Unknown command "${command}"; the commands are init, demo and publish.` };
  const publishOnly = PUBLISH_OPTIONS.find((name) => parsed.values[name] !== undefined);
  if (publishOnly !== undefined) return { kind: 'usage', message: `--${publishOnly} belongs to saga publish, not saga ${command}.` };
  const stack = parsed.values['a2ui-stack'];
  const server = parsed.values.server;
  if (stack === undefined) return { kind: 'usage', message: '--a2ui-stack is required.' };
  if (server === undefined) return { kind: 'usage', message: '--server is required.' };
  if (rest.length !== 1) return { kind: 'usage', message: rest.length === 0 ? 'Name the new directory.' : 'Name one new directory.' };
  return { kind: command, stack, server, directory: rest[0] as string };
}

interface ParsedValues {
  readonly 'a2ui-stack'?: string | undefined;
  readonly server?: string | undefined;
  readonly target?: string | undefined;
  readonly release?: string | undefined;
  readonly out?: string | undefined;
  readonly against?: string | undefined;
  readonly 'invoke-fixture'?: boolean | undefined;
  readonly 'bearer-env'?: string | undefined;
  readonly handoff?: string | undefined;
  readonly prepared?: string | undefined;
  readonly 'authority-ref'?: readonly string[] | undefined;
  readonly reference?: string | undefined;
  readonly 'observed-at'?: string | undefined;
  readonly inspected?: string | undefined;
  readonly state?: string | undefined;
  readonly host?: string | undefined;
  readonly evidence?: string | undefined;
}

function parsePublish(values: ParsedValues, rest: readonly string[]): Command {
  const [action, ...extra] = rest;
  if (action === 'handoff') return parseHandoff(values, extra);
  if (action !== 'check' && action !== 'prepare') return { kind: 'usage', message: action === undefined ? 'Say what to publish: check, prepare or handoff.' : `Unknown publish command "${action}"; the commands are check, prepare and handoff.` };
  const handoffOnly = HANDOFF_OPTIONS.find((name) => values[name] !== undefined);
  if (handoffOnly !== undefined) return { kind: 'usage', message: `--${handoffOnly} belongs to saga publish handoff, not saga publish ${action}.` };
  if (extra.length > 0) return { kind: 'usage', message: `saga publish ${action} takes options only, not "${extra[0]}".` };
  if (values['a2ui-stack'] !== undefined || values.server !== undefined) return { kind: 'usage', message: '--a2ui-stack and --server belong to saga init and saga demo.' };
  if (values.target === undefined) return { kind: 'usage', message: '--target is required (chatgpt or claude).' };
  if (values.release === undefined) return { kind: 'usage', message: '--release is required: the release input file.' };
  if (action === 'prepare' && values.out === undefined) return { kind: 'usage', message: 'prepare needs --out, the directory to write.' };
  if (action === 'check' && values.out !== undefined) return { kind: 'usage', message: 'check writes nothing; --out belongs to prepare.' };
  return { kind: 'publish', request: { command: action, target: values.target, release: values.release, out: values.out, against: values.against, invokeFixture: values['invoke-fixture'] === true, bearerEnv: values['bearer-env'] } };
}

const HANDOFF_ACTION_NAMES: readonly string[] = ['begin', 'status', 'attempt', 'confirm-submission', 'void-attempt', 'record-review', 'record-listing'] satisfies readonly HandoffAction[];

/** `publish handoff`: the options as given. Which of them an action needs is checked by the handoff itself, which names what is missing. */
function parseHandoff(values: ParsedValues, rest: readonly string[]): Command {
  const [action, ...extra] = rest;
  if (action === undefined || !HANDOFF_ACTION_NAMES.includes(action)) return { kind: 'usage', message: action === undefined ? `Say what to do with the handoff: ${HANDOFF_ACTION_NAMES.join(', ')}.` : `Unknown handoff command "${action}"; the commands are ${HANDOFF_ACTION_NAMES.join(', ')}.` };
  if (extra.length > 0) return { kind: 'usage', message: `saga publish handoff ${action} takes options only, not "${extra[0]}".` };
  if (values['a2ui-stack'] !== undefined || values.server !== undefined) return { kind: 'usage', message: '--a2ui-stack and --server belong to saga init and saga demo.' };
  const prepareOnly = (['target', 'release', 'out', 'against', 'bearer-env'] as const).find((name) => values[name] !== undefined) ?? (values['invoke-fixture'] === true ? 'invoke-fixture' : undefined);
  if (prepareOnly !== undefined) return { kind: 'usage', message: `--${prepareOnly} belongs to saga publish check and prepare; a handoff takes its host and release from its record.` };
  return {
    kind: 'handoff',
    request: {
      action: action as HandoffAction,
      handoff: values.handoff,
      prepared: values.prepared,
      authorityRefs: values['authority-ref'] ?? [],
      reference: values.reference,
      observedAt: values['observed-at'],
      inspected: values.inspected,
      state: values.state,
      host: values.host,
      evidence: values.evidence,
    },
  };
}

/** What a shell needs to read the path back as one word. */
const shellWord = (text: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);

/**
 * Where the new directory goes: a name inside a parent that already exists, resolved to the parent's
 * real location so the copy writes where the path leads now. A missing parent is refused, not created.
 * The name itself is left to the creation of the directory, which refuses anything already there, a symbolic link included.
 */
function newDirectoryTarget(cwd: string, directory: string): string {
  const requested = path.resolve(cwd, directory);
  const parent = path.dirname(requested);
  let realParent: string;
  try {
    realParent = fs.realpathSync(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new TemplateError(`The parent directory ${parent} does not exist; create it first or choose a path inside an existing directory.`);
    throw error;
  }
  if (!fs.statSync(realParent).isDirectory()) throw new TemplateError(`The parent ${parent} is not a directory.`);
  return path.join(realParent, path.basename(requested));
}

function nextSteps(directory: string, sdkVersion: string): string {
  const steps = [`cd ${shellWord(directory)}`, 'npm install', 'npm run build', 'npm start'];
  const note = sdkVersion.startsWith('0.0.0-candidate.')
    ? `\nThe SDK build ${sdkVersion} is a private candidate and is not published. Install its packages from that build's tarballs\n(docs/candidate-update-and-rollback.md), not from a registry.\n`
    : '';
  return `Next:\n${steps.map((step) => `  ${step}`).join('\n')}\n${note}`;
}

/** The pair is offered only while its template still says it is that stack on that server. */
function requireTemplateFor(pair: QualifiedPair): string {
  const template = templateDirectory(pair.template);
  const declared = readTemplateMetadata(template);
  if (declared.stack !== pair.stack || declared.server !== pair.server) {
    throw new TemplateError(`The ${pair.template} template is for ${declared.stack} on ${declared.server}, not ${pair.stack} on ${pair.server}; the pair is not offered until they agree.`);
  }
  return template;
}

/** `init`: the maintained starter, pinned to this checkout's SDK build. Returns what to tell the developer. */
async function createStarter(pair: QualifiedPair, target: string, directory: string, environment: Environment): Promise<string> {
  const template = requireTemplateFor(pair);
  const sdkVersion = environment.sdkVersion();
  // The copy hands control back to the event loop between files, so a real SIGINT or SIGTERM is
  // seen before the next write or before success is reported; the export removes what it created.
  await exportTemplateInterruptibly(template, target, { sdkVersion, signal: environment.signal });
  return `Created a ${pair.stack} starter on ${pair.server} in ${directory} (SDK build ${sdkVersion}).\nNothing was installed and no command was run.\n\n${nextSteps(directory, sdkVersion)}`;
}

/**
 * `demo`: the standalone demonstration (DEMO1) of the pair, built outside the destination and then
 * written through the same destination handling as `init`. A taken path is refused before the build
 * is spent, and again when the copy starts, because the path may have been taken meanwhile. The
 * build is given up whether the copy finishes or not.
 */
async function createDemonstration(pair: QualifiedPair, target: string, directory: string, environment: Environment): Promise<string> {
  requireTemplateFor(pair);
  refuseExisting(target);
  const staged = await environment.stageDemo(environment.signal);
  try {
    await createDirectoryInterruptibly(target, staged.files, { signal: environment.signal });
    return `Created the ${pair.stack} on ${pair.server} demonstration in ${directory} (SDK build ${staged.sdkVersion}).
It is a local-only application with synthetic data and fixed, public development credentials, not a starter;
\`saga init\` creates a project of your own. Nothing was installed and no command was run.

Next:
  cd ${shellWord(directory)}
  npm install --omit=dev
  npm start
`;
  } finally {
    staged.dispose();
  }
}

async function create(request: CreateRequest, environment: Environment): Promise<number> {
  const { kind, stack, server, directory } = request;
  const offered = kind === 'init' ? SUPPORTED_PAIRS : SUPPORTED_DEMO_PAIRS;
  const pair = offered.find((one) => one.stack === stack && one.server === server);
  if (pair === undefined) {
    environment.stderr(`saga ${kind}: ${stack} on ${server} is not a supported pair.\n\nSupported pairs:\n${pairLines(offered)}\n`);
    return EXIT_REFUSED;
  }
  if (environment.signal?.aborted) {
    environment.stderr(`saga ${kind}: interrupted before anything was written.\n`);
    return EXIT_INTERRUPTED;
  }
  try {
    const target = newDirectoryTarget(environment.cwd, directory);
    environment.stdout(await (kind === 'init' ? createStarter : createDemonstration)(pair, target, directory, environment));
    return 0;
  } catch (error) {
    if (error instanceof ExportInterrupted) {
      environment.stderr(`saga ${kind}: interrupted; ${error.removed ? 'the directory this run created was removed' : 'the output path had been replaced during the copy, so nothing there was removed'}.\n`);
      return EXIT_INTERRUPTED;
    }
    // The demonstration's build ended because the interrupt arrived: the destination was never created.
    if (environment.signal?.aborted && error === environment.signal.reason) {
      environment.stderr(`saga ${kind}: interrupted before anything was written.\n`);
      return EXIT_INTERRUPTED;
    }
    environment.stderr(`saga ${kind}: ${(error as Error).message}\n`);
    return EXIT_REFUSED;
  }
}

/**
 * The optional publication tooling, loaded here and not at start, so a missing or broken tool
 * affects only a `publish` command. A tool that cannot be loaded is refused, never treated as a pass.
 */
async function loadPublicationTool(support: PublicationSupport | undefined, environment: Environment, what: string): Promise<PublicationTool | undefined> {
  if (support === undefined) {
    environment.stderr(`saga publish: the publication tooling is not available here, so nothing was ${what}.\n`);
    return undefined;
  }
  try {
    return await support.load();
  } catch (error) {
    environment.stderr(`saga publish: the publication tooling could not be loaded (${(error as Error).message}), so nothing was ${what}.\n`);
    return undefined;
  }
}

/** What the tooling is given besides the request: the working directory, the output channels and the seams a test replaces. */
const publishIo = (support: PublicationSupport, environment: Environment) => ({
  cwd: environment.cwd,
  stdout: environment.stdout,
  stderr: environment.stderr,
  signal: environment.signal,
  environment: support.environment,
  fetch: support.fetch,
  validators: support.validators,
  pluginValidator: support.pluginValidator,
  now: support.now,
});

/** `publish check` and `publish prepare`. */
async function publish(request: PublishRequest, environment: Environment): Promise<number> {
  const tool = await loadPublicationTool(environment.publication, environment, 'checked or prepared');
  if (tool === undefined) return EXIT_REFUSED;
  try {
    return await tool.run(request, publishIo(environment.publication as PublicationSupport, environment));
  } catch (error) {
    environment.stderr(`saga publish: ${(error as Error).message}\n`);
    return EXIT_REFUSED;
  }
}

/** `publish handoff`: the resumable record of a manual submission. It reads and writes local files only. */
async function handoff(request: HandoffRequest, environment: Environment): Promise<number> {
  const tool = await loadPublicationTool(environment.publication, environment, 'read or recorded');
  if (tool === undefined) return EXIT_REFUSED;
  try {
    return await tool.handoff(request, publishIo(environment.publication as PublicationSupport, environment));
  } catch (error) {
    environment.stderr(`saga publish handoff: ${(error as Error).message}\n`);
    return EXIT_REFUSED;
  }
}

/** Runs one command line and returns the process exit code: 0 done (a publish verdict of ready), 1 refused, failed or not ready, 2 not understood, 130 interrupted. */
export async function runCli(argv: readonly string[], environment: Environment): Promise<number> {
  const command = parseCommandLine(argv);
  switch (command.kind) {
    case 'help':
      environment.stdout(USAGE);
      return 0;
    case 'usage':
      environment.stderr(`saga: ${command.message}\n\n${USAGE}`);
      return EXIT_USAGE;
    case 'init':
    case 'demo':
      return create(command, environment);
    case 'publish':
      return publish(command.request, environment);
    case 'handoff':
      return handoff(command.request, environment);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const interrupt = new AbortController();
  // `on`, not `once`: a second Ctrl-C while the cleanup runs must not fall back to killing the process.
  for (const name of ['SIGINT', 'SIGTERM'] as const) process.on(name, () => interrupt.abort());
  void runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    sdkVersion: () => {
      const { commit, dirty } = sourceRevision();
      return candidateVersion(commit, dirty);
    },
    // The build tooling loads only for a command that builds the demonstration.
    stageDemo: async (signal) => (await import('./build-demo.js')).stageDemo(signal),
    // The publication tooling loads only for `saga publish`.
    publication: { load: async () => (await import('./publish/publish.js')).publicationTool, environment: process.env },
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    signal: interrupt.signal,
  }).then((code) => {
    process.exitCode = code;
  });
}
