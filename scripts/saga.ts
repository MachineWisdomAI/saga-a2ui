import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { candidateVersion, sourceRevision } from './packed-consumer.js';
import type { StagedDemo } from './build-demo.js';
import { DEMO_TEMPLATE } from './qualified-starters.js';
import { ExportInterrupted, TemplateError, createDirectoryInterruptibly, exportTemplateInterruptibly, readTemplateMetadata, refuseExisting, templateDirectory } from './starter-template.js';

// The `saga` command (CLI1, CLI2). It owns the command line, the lists of pairs it offers and what
// it prints; the files it writes are `exportTemplate`'s for a starter, and the DEMO1 download's for
// the demonstration, both through the one destination handling of starter-template.ts.
//
//   npx tsx scripts/saga.ts init --a2ui-stack lit-mcp --server node ./my-app
//   npx tsx scripts/saga.ts demo --a2ui-stack lit-mcp --server node ./my-demo
//
// Each creates one new directory. Neither installs anything, runs a package manager, hook or script
// of the output, or changes anything that already exists.

/** A stack and server target together with the maintained template that implements them. */
export interface QualifiedPair {
  readonly stack: string;
  readonly server: string;
  readonly template: string;
}

/**
 * The pairs `init` offers: those CI qualifies, and no others. A template directory existing does not
 * add a pair. Each owner of a further pair adds one row here when its qualification passes (the Lit
 * and Node pair: scripts/starter.test.ts and apps/lit-host/e2e/starter.spec.ts), and removes it while
 * that qualification fails.
 */
export const SUPPORTED_PAIRS: readonly QualifiedPair[] = [{ stack: 'lit-mcp', server: 'node', template: 'lit-node' }];

/**
 * The pairs `demo` offers: those offered by `init` whose qualified template the standalone
 * demonstration (DEMO1) is built on. A qualified starter alone does not add a demonstration.
 */
export const SUPPORTED_DEMO_PAIRS: readonly QualifiedPair[] = SUPPORTED_PAIRS.filter((pair) => pair.template === DEMO_TEMPLATE);

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

init creates <directory>, which must not exist yet, from the maintained starter for the pair.
demo creates it from the standalone demonstration of the pair: a local-only application with
synthetic data, not a starter. Nothing is installed or run, and nothing that exists is changed.

Supported pairs for init:
${pairLines(SUPPORTED_PAIRS)}

Supported pairs for demo:
${pairLines(SUPPORTED_DEMO_PAIRS)}
`;

type Creation = 'init' | 'demo';
interface CreateRequest {
  readonly kind: Creation;
  readonly stack: string;
  readonly server: string;
  readonly directory: string;
}
type Command = { readonly kind: 'help' } | CreateRequest | { readonly kind: 'usage'; readonly message: string };

function parseCommandLine(argv: readonly string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: { 'a2ui-stack': { type: 'string' }, server: { type: 'string' }, help: { type: 'boolean' } } });
  } catch (error) {
    return { kind: 'usage', message: (error as Error).message };
  }
  if (parsed.values.help) return { kind: 'help' };
  const [command, ...rest] = parsed.positionals;
  if (command !== 'init' && command !== 'demo') return { kind: 'usage', message: command === undefined ? 'Say what to do: init or demo.' : `Unknown command "${command}"; the commands are init and demo.` };
  const stack = parsed.values['a2ui-stack'];
  const server = parsed.values.server;
  if (stack === undefined) return { kind: 'usage', message: '--a2ui-stack is required.' };
  if (server === undefined) return { kind: 'usage', message: '--server is required.' };
  if (rest.length !== 1) return { kind: 'usage', message: rest.length === 0 ? 'Name the new directory.' : 'Name one new directory.' };
  return { kind: command, stack, server, directory: rest[0] as string };
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

/** Runs one command line and returns the process exit code: 0 done, 1 refused or failed, 2 not understood, 130 interrupted. */
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
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    signal: interrupt.signal,
  }).then((code) => {
    process.exitCode = code;
  });
}
