import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { candidateVersion, sourceRevision } from './packed-consumer.js';
import { TemplateError, exportTemplate, readTemplateMetadata, templateDirectory } from './starter-template.js';

// The `saga` command (CLI1). It owns the command line, the list of pairs it offers and what it
// prints; the files it writes are `exportTemplate`'s, from the one maintained template.
//
//   npx tsx scripts/saga.ts init --a2ui-stack lit-mcp --server node ./my-app
//
// `init` creates one new directory. It installs nothing, runs no package manager, hook or script,
// and never changes anything that already exists.

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

export interface Environment {
  /** Where a relative directory is resolved from. */
  readonly cwd: string;
  /** The SDK build a created project is pinned to; only asked for when a project is about to be written. */
  readonly sdkVersion: () => string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Aborted by an interrupt. The command then leaves nothing behind that it created. */
  readonly signal?: AbortSignal | undefined;
}

const EXIT_REFUSED = 1;
const EXIT_USAGE = 2;
const EXIT_INTERRUPTED = 130;

const pairLines = (): string => SUPPORTED_PAIRS.map((pair) => `  --a2ui-stack ${pair.stack} --server ${pair.server}`).join('\n');

const USAGE = `Usage: saga init --a2ui-stack <renderer>-mcp --server <target> <directory>

Creates <directory>, which must not exist yet, from the maintained starter for the pair. Nothing is
installed or run, and nothing that exists is changed.

Supported pairs:
${pairLines()}
`;

type Command = { readonly kind: 'help' } | { readonly kind: 'init'; readonly stack: string; readonly server: string; readonly directory: string } | { readonly kind: 'usage'; readonly message: string };

function parseCommandLine(argv: readonly string[]): Command {
  let parsed;
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: { 'a2ui-stack': { type: 'string' }, server: { type: 'string' }, help: { type: 'boolean' } } });
  } catch (error) {
    return { kind: 'usage', message: (error as Error).message };
  }
  if (parsed.values.help) return { kind: 'help' };
  const [command, ...rest] = parsed.positionals;
  if (command !== 'init') return { kind: 'usage', message: command === undefined ? 'Say what to do: init.' : `Unknown command "${command}"; the command is init.` };
  const stack = parsed.values['a2ui-stack'];
  const server = parsed.values.server;
  if (stack === undefined) return { kind: 'usage', message: '--a2ui-stack is required.' };
  if (server === undefined) return { kind: 'usage', message: '--server is required.' };
  if (rest.length !== 1) return { kind: 'usage', message: rest.length === 0 ? 'Name the new directory.' : 'Name one new directory.' };
  return { kind: 'init', stack, server, directory: rest[0] as string };
}

/** What a shell needs to read the path back as one word. */
const shellWord = (text: string): string => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);

/**
 * Where the new directory goes: a name inside a parent that already exists, resolved to the parent's
 * real location so the copy writes where the path leads now. A missing parent is refused, not created.
 * The name itself is left to `exportTemplate`, which refuses anything already there, a symbolic link included.
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

function init(request: { readonly stack: string; readonly server: string; readonly directory: string }, environment: Environment): number {
  const { stack, server, directory } = request;
  const pair = SUPPORTED_PAIRS.find((one) => one.stack === stack && one.server === server);
  if (pair === undefined) {
    environment.stderr(`saga init: ${stack} on ${server} is not a supported pair.\n\nSupported pairs:\n${pairLines()}\n`);
    return EXIT_REFUSED;
  }
  if (environment.signal?.aborted) {
    environment.stderr('saga init: interrupted before anything was written.\n');
    return EXIT_INTERRUPTED;
  }
  try {
    const template = templateDirectory(pair.template);
    const declared = readTemplateMetadata(template);
    if (declared.stack !== pair.stack || declared.server !== pair.server) {
      throw new TemplateError(`The ${pair.template} template is for ${declared.stack} on ${declared.server}, not ${pair.stack} on ${pair.server}; the pair is not offered until they agree.`);
    }
    const sdkVersion = environment.sdkVersion();
    const exported = exportTemplate(template, newDirectoryTarget(environment.cwd, directory), { sdkVersion });
    // The copy is synchronous, so an interrupt is seen when it ends; the directory is this run's own.
    if (environment.signal?.aborted) {
      fs.rmSync(exported.directory, { recursive: true, force: true });
      environment.stderr('saga init: interrupted; the directory this run created was removed.\n');
      return EXIT_INTERRUPTED;
    }
    environment.stdout(`Created a ${pair.stack} starter on ${pair.server} in ${directory} (SDK build ${sdkVersion}).\nNothing was installed and no command was run.\n\n${nextSteps(directory, sdkVersion)}`);
    return 0;
  } catch (error) {
    environment.stderr(`saga init: ${(error as Error).message}\n`);
    return EXIT_REFUSED;
  }
}

/** Runs one command line and returns the process exit code: 0 done, 1 refused or failed, 2 not understood, 130 interrupted. */
export function runCli(argv: readonly string[], environment: Environment): number {
  const command = parseCommandLine(argv);
  switch (command.kind) {
    case 'help':
      environment.stdout(USAGE);
      return 0;
    case 'usage':
      environment.stderr(`saga: ${command.message}\n\n${USAGE}`);
      return EXIT_USAGE;
    case 'init':
      return init(command, environment);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const interrupt = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM'] as const) process.once(name, () => interrupt.abort());
  process.exitCode = runCli(process.argv.slice(2), {
    cwd: process.cwd(),
    sdkVersion: () => {
      const { commit, dirty } = sourceRevision();
      return candidateVersion(commit, dirty);
    },
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    signal: interrupt.signal,
  });
}
