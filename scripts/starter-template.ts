import fs from 'node:fs';
import path from 'node:path';
import { repoRoot, type SdkPackage } from './packed-consumer.js';

// The maintained starter templates (`templates/<stack>-<server>`), their export, and the snippets
// cut from them. One source serves every use: the starter a developer receives, the attach-to-an-
// existing-backend recipe and the qualification (scripts/starter.test.ts) all read these files.
// Nothing here is a package or a runtime API; the later CLI and the guides call these functions
// instead of copying template text. Every function takes the template's directory.

export const templatesRoot = path.join(repoRoot, 'templates');

/** Where the maintained template of that name lives. */
export const templateDirectory = (name: string): string => path.join(templatesRoot, name);

/** What a template says about itself in `template.json`, which is not part of the starter it exports. */
export interface TemplateMetadata {
  readonly stack: string;
  readonly server: string;
  readonly serverAdapter: { readonly package: string; readonly version: string };
  readonly sdkPackages: readonly SdkPackage[];
  readonly snippets: readonly string[];
}

export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/** Files that belong to the template's maintenance, not to the starter a developer receives. */
const NOT_EXPORTED = new Set(['template.json']);
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist']);

export function readTemplateMetadata(template: string): TemplateMetadata {
  const file = path.join(template, 'template.json');
  if (!fs.existsSync(file)) throw new TemplateError(`${template} is not a template: it has no template.json.`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as TemplateMetadata;
}

/** The template's exported files, relative and sorted. */
export function templateFiles(template: string): string[] {
  const walk = (directory: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : walk(full);
      return [path.relative(template, full).split(path.sep).join('/')];
    });
  return walk(template)
    .filter((file) => !NOT_EXPORTED.has(file))
    .sort();
}

const REGION = /^\s*\/\/ #(region|endregion) saga-snippet:([a-z][a-z0-9-]*)\s*$/;

/** One snippet: the lines between a region's markers, verbatim, and the template file they come from. */
export interface Snippet {
  readonly name: string;
  readonly file: string;
  readonly text: string;
}

/**
 * Cuts every `// #region saga-snippet:<name>` ... `// #endregion saga-snippet:<name>` out of the
 * template's TypeScript files. The text is the template's own lines, unchanged and not dedented,
 * so a guide that shows it shows exactly what the tested starter contains. An unclosed,
 * unopened, mismatched or repeated region is an error: a snippet that silently differs from its
 * source is the failure this exists to prevent.
 */
export function extractSnippets(template: string): Snippet[] {
  const found: Snippet[] = [];
  for (const file of templateFiles(template).filter((one) => one.endsWith('.ts'))) {
    let open: { readonly name: string; readonly lines: string[] } | undefined;
    for (const line of fs.readFileSync(path.join(template, file), 'utf8').split('\n')) {
      const marker = REGION.exec(line);
      if (marker === null) {
        open?.lines.push(line);
        continue;
      }
      const kind = marker[1];
      const name = marker[2] as string;
      if (kind === 'region') {
        if (open) throw new TemplateError(`${file}: snippet "${name}" opens inside "${open.name}".`);
        if (found.some((one) => one.name === name)) throw new TemplateError(`${file}: snippet "${name}" is defined twice.`);
        open = { name, lines: [] };
      } else {
        if (open?.name !== name) throw new TemplateError(`${file}: the end of snippet "${name}" does not match an open snippet.`);
        found.push({ name, file, text: open.lines.join('\n') });
        open = undefined;
      }
    }
    if (open) throw new TemplateError(`${file}: snippet "${open.name}" is never closed.`);
  }
  return found;
}

/**
 * Writes each snippet as `<name>.ts` into a directory that does not exist yet, so a guide or the
 * CLI can include the files rather than retype them. It never overwrites.
 */
export function writeSnippets(template: string, destination: string): string[] {
  const target = path.resolve(destination);
  refuseExisting(target);
  const snippets = extractSnippets(template);
  fs.mkdirSync(target, { recursive: true });
  return snippets.map((snippet) => {
    const out = path.join(target, `${snippet.name}.ts`);
    fs.writeFileSync(out, `${snippet.text}\n`, { flag: 'wx' });
    return out;
  });
}

const stripMarkers = (source: string): string =>
  source
    .split('\n')
    .filter((line) => !REGION.test(line))
    .join('\n');

/**
 * The manifest the starter carries: the template's with every SDK dependency pinned to exactly
 * `sdkVersion`, so the starter is matched to one SDK build and a package manager refuses any other.
 * The template declares `*` for an SDK package; any other form is rejected rather than rewritten.
 */
export function stampSdkVersion(manifest: Record<string, unknown>, sdkVersion: string): Record<string, unknown> {
  const stamped: Record<string, unknown> = { ...manifest };
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const group = manifest[field] as Record<string, string> | undefined;
    if (group === undefined) continue;
    stamped[field] = Object.fromEntries(
      Object.entries(group).map(([dependency, range]) => {
        if (!dependency.startsWith('@saga-a2ui/')) return [dependency, range];
        if (range !== '*') throw new TemplateError(`The template declares ${dependency} as "${range}"; an SDK package is declared as "*" and stamped at export.`);
        return [dependency, sdkVersion];
      }),
    );
  }
  return stamped;
}

export interface ExportedStarter {
  readonly directory: string;
  /** Relative paths of everything written, sorted. */
  readonly files: readonly string[];
}

/** One file of a directory to create: where it goes below that directory (forward slashes) and its content, read only when the file is written. */
export interface OutputFile {
  readonly path: string;
  readonly content: () => string | Uint8Array;
}

const isSymlink = (file: string): boolean => {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Refuses a path that is already taken: a file, a directory or a symbolic link, a dangling one included. Nothing is written or changed. */
export function refuseExisting(target: string): void {
  if (fs.existsSync(target) || isSymlink(target)) throw new TemplateError(`${target} already exists; choose a new directory.`);
}

/** An interrupt was seen during the export. `removed` is whether the directory this call created was taken away again. */
export class ExportInterrupted extends Error {
  constructor(readonly removed: boolean) {
    super(removed ? 'The export was interrupted; the directory it created was removed.' : 'The export was interrupted; the output path had been replaced, so nothing there was removed.');
    this.name = 'ExportInterrupted';
  }
}

const sameDirectory = (a: fs.BigIntStats, b: fs.BigIntStats): boolean => a.isDirectory() && b.isDirectory() && a.dev === b.dev && a.ino === b.ino;

/**
 * Creating a new directory with the given files, as a generator that suspends before each file and
 * once more at the end. A caller that can service interrupts resumes it from the event loop; a
 * caller that cannot just runs it through. Either way the writes, the ownership checks and the
 * cleanup are these lines, for every command that creates a directory (the starter and the demonstration).
 *
 * Only the directory this run creates is ever written into or removed, and "this run's directory"
 * is the directory made by the exclusive `mkdir` below (its device and inode), not the pathname:
 * another process may rename it away and put something else at the path. Before every file, at the
 * end and before any removal, the path is checked to still lead to that directory. Node has no
 * directory-relative file calls, so the check narrows the window between check and write to the
 * instant between two adjacent calls; it does not close it, and docs/development-reference.md (CLI1) documents that limitation.
 */
function* createDirectorySteps(destination: string, files: readonly OutputFile[]): Generator<void, string, void> {
  const target = path.resolve(destination);
  refuseExisting(target);
  for (const file of files) {
    const out = path.resolve(target, file.path);
    if (path.isAbsolute(file.path) || !out.startsWith(`${target}${path.sep}`)) throw new TemplateError(`${file.path} is not inside the new directory; nothing was written.`);
  }
  // The existence check above can be overtaken by another process, so the directory itself is
  // created without `recursive`, which fails if it exists.
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.mkdirSync(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new TemplateError(`${target} already exists; choose a new directory.`);
    throw error;
  }
  const created = fs.lstatSync(target, { bigint: true });
  const stillOurs = (): boolean => {
    try {
      return sameDirectory(fs.lstatSync(target, { bigint: true }), created);
    } catch {
      return false;
    }
  };
  const replaced = new TemplateError(`${target} was replaced while the output was being written; nothing at that path was changed or removed.`);
  const removeIfOurs = (): boolean => {
    if (!stillOurs()) return false;
    fs.rmSync(target, { recursive: true, force: true });
    return true;
  };
  try {
    for (const file of files) {
      yield;
      if (!stillOurs()) throw replaced;
      const out = path.join(target, file.path);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, file.content(), { flag: 'wx' });
    }
    yield;
    if (!stillOurs()) throw replaced;
  } catch (error) {
    const removed = removeIfOurs();
    if (error instanceof ExportInterrupted) throw new ExportInterrupted(removed);
    if (removed || error === replaced) throw error;
    throw new TemplateError(`${(error as Error).message} (${target} was replaced meanwhile, so nothing there was removed.)`);
  }
  return target;
}

function* exportSteps(template: string, destination: string, options: { readonly sdkVersion: string }): Generator<void, ExportedStarter, void> {
  readTemplateMetadata(template); // an unknown template fails before anything is written
  const files = templateFiles(template);
  const outputs = files.map((file): OutputFile => ({
    path: file,
    content: () => {
      const source = fs.readFileSync(path.join(template, file), 'utf8');
      return file === 'package.json' ? `${JSON.stringify(stampSdkVersion(JSON.parse(source) as Record<string, unknown>, options.sdkVersion), null, 2)}\n` : stripMarkers(source);
    },
  }));
  const directory = yield* createDirectorySteps(destination, outputs);
  return { directory, files };
}

/**
 * Writes the starter into a directory that does not exist yet, then returns what it wrote. It
 * never overwrites or merges into an existing path (a symbolic link counts as existing), does not
 * install dependencies and runs no hook. The snippet markers are not part of the starter. If the
 * export fails part-way, the directory this call created is removed again; nothing that existed
 * before is touched, and a path that was replaced meanwhile is left exactly as it is.
 */
export function exportTemplate(template: string, destination: string, options: { readonly sdkVersion: string }): ExportedStarter {
  const steps = exportSteps(template, destination, options);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/** Resumes the event loop twice, which runs a pending signal callback in between. */
const letSignalsRun = (): Promise<void> => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));

/** Runs the steps, handing control back to the event loop before each; an aborted `signal` is then seen before the next write or before the end is reported as done. */
async function runInterruptibly<Result>(steps: Generator<void, Result, void>, signal: AbortSignal | undefined): Promise<Result> {
  let step = steps.next();
  while (!step.done) {
    await letSignalsRun();
    step = signal?.aborted ? steps.throw(new ExportInterrupted(false)) : steps.next();
  }
  return step.value;
}

/**
 * `exportTemplate` for a command that must react to an interrupt. A synchronous copy never lets
 * Node run a signal callback, so this one hands control back to the event loop before each file;
 * an aborted `signal` is then seen before the next write or before the export is reported as done,
 * the directory this call created is removed, and `ExportInterrupted` is thrown.
 */
export function exportTemplateInterruptibly(
  template: string,
  destination: string,
  options: { readonly sdkVersion: string; readonly signal?: AbortSignal | undefined },
): Promise<ExportedStarter> {
  return runInterruptibly(exportSteps(template, destination, options), options.signal);
}

/**
 * The same destination handling for a directory whose files are not a template's: a new directory
 * holding exactly `files`, never over or into anything that exists, removed again (only if it is
 * still the directory this call made) when a write fails or `signal` aborts. Returns the directory.
 */
export function createDirectoryInterruptibly(destination: string, files: readonly OutputFile[], options: { readonly signal?: AbortSignal | undefined } = {}): Promise<string> {
  return runInterruptibly(createDirectorySteps(destination, files), options.signal);
}
