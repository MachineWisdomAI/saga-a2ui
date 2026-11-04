import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// The one place that decides which files maintained tooling may read as source and which
// directories it may clear or write as its own output (SECURITY.md invariant 5). Three rules:
//
// - A source file is read only when the path below its root is made of real directories and a
//   regular file: no link, no special file, nothing that leaves the root. The check and the
//   `O_NOFOLLOW` open sit next to each other, immediately before the read.
// - An output directory is either created by this run (an exclusive `mkdir`) or authenticated
//   (a real directory, not a link, owned by the running user). Its device and inode are kept, and
//   every later removal or write first checks that the path still leads to that directory.
// - A fixed output file is written to a temporary name and renamed over its leaf, so a link or a
//   file somebody left at the leaf is replaced and never written through.
//
// Node has no directory-relative file calls, so the identity check narrows the window between a
// check and the following call to the instant between two adjacent calls; it does not close it.
// Ancestors of a path the operator named are the operator's own and are not examined. Repair
// path: change the call site to one of these functions; nothing else decides ownership.

/** A path the tooling refuses to read or write. The text is safe to show. */
export class UnsafePath extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePath';
  }
}

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** One name below a directory: letters, digits, `.`, `_` and `-`, starting with a letter or digit, with no `..`. */
export function assertSafeSegment(value: unknown, what: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ||
    value.includes('..')
  )
    throw new UnsafePath(
      `${what} ${JSON.stringify(value)} is not a single safe path segment (letters, digits, ".", "_" and "-", starting with a letter or digit).`,
    );
  return value;
}

function lstatOrNull(file: string): fs.Stats | null {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** A root the tooling reads below: a real directory, not a link. Returns its canonical path. */
function realRoot(root: string): string {
  const stat = lstatOrNull(root);
  if (stat === null) throw new UnsafePath(`${root} does not exist.`);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new UnsafePath(`${root} is not a real directory.`);
  return fs.realpathSync(root);
}

function segmentsOf(relative: string): string[] {
  const segments = relative.split(/[\\/]/);
  if (
    relative === '' ||
    path.isAbsolute(relative) ||
    segments.some(
      (segment) => segment === '' || segment === '.' || segment === '..',
    )
  )
    throw new UnsafePath(
      `${JSON.stringify(relative)} is not a relative path inside its root.`,
    );
  return segments;
}

/**
 * The bytes of the regular file `relative` below `root`. Every step below `root` must be a real
 * directory and the last a regular file; a link, a special file or a path that leaves `root` is
 * refused, and the file is opened without following a link at its leaf and measured through that
 * handle. A source read belongs here, not to `fs.readFileSync(path.join(root, relative))`.
 */
export function readContainedFile(root: string, relative: string): Buffer {
  let current = realRoot(root);
  const segments = segmentsOf(relative);
  segments.forEach((segment, index) => {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    if (stat === null)
      throw Object.assign(new Error(`${relative} does not exist.`), {
        code: 'ENOENT',
      });
    if (stat.isSymbolicLink())
      throw new UnsafePath(`${relative} passes through a symbolic link.`);
    const last = index === segments.length - 1;
    if (last ? !stat.isFile() : !stat.isDirectory())
      throw new UnsafePath(
        `${relative} is ${last ? 'not a regular file' : 'reached through something that is not a directory'}.`,
      );
  });
  const handle = fs.openSync(current, fs.constants.O_RDONLY | NOFOLLOW);
  try {
    if (!fs.fstatSync(handle).isFile())
      throw new UnsafePath(`${relative} is not a regular file.`);
    return fs.readFileSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Every regular file below `root`, relative with forward slashes and sorted. A symbolic link or a
 * special file anywhere in the tree stops the listing: a source tree that holds one is not one this
 * tooling exports. Directories named in `skip` are not entered.
 */
export function listContainedFiles(
  root: string,
  skip: ReadonlySet<string> = new Set(),
): string[] {
  const base = realRoot(root);
  const walk = (directory: string, prefix: string): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new UnsafePath(`${relative} is a symbolic link.`);
      if (entry.isDirectory())
        return skip.has(entry.name) ? [] : walk(full, relative);
      if (!entry.isFile())
        throw new UnsafePath(`${relative} is not a regular file.`);
      return [relative];
    });
  return walk(base, '').sort();
}

export const sameDirectory = (a: fs.BigIntStats, b: fs.BigIntStats): boolean =>
  a.isDirectory() && b.isDirectory() && a.dev === b.dev && a.ino === b.ino;

/**
 * A directory this run owns: created by this run, or authenticated as a real directory that is
 * not a link and belongs to the running user. Its removals and writes check that the path still
 * leads to it.
 */
export class OwnedDirectory {
  readonly path: string;
  readonly #identity: fs.BigIntStats;

  private constructor(directory: string, identity: fs.BigIntStats) {
    this.path = directory;
    this.#identity = identity;
  }

  /**
   * The directory `requested`, made now when absent. `fresh` refuses an existing path. An existing
   * path is accepted only as a real directory, never a link, owned by the running user (or by
   * anyone when the tool runs as root).
   */
  static create(
    requested: string,
    options: { readonly fresh?: boolean } = {},
  ): OwnedDirectory {
    const wanted = path.resolve(requested);
    fs.mkdirSync(path.dirname(wanted), { recursive: true });
    const target = path.join(
      fs.realpathSync(path.dirname(wanted)),
      path.basename(wanted),
    );
    try {
      fs.mkdirSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (options.fresh === true)
        throw new UnsafePath(
          `${target} already exists; choose a new directory.`,
        );
      const stat = fs.lstatSync(target, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new UnsafePath(
          `${target} exists and is not a real directory (a link is never followed); choose another output directory.`,
        );
      const user = process.getuid?.();
      if (user !== undefined && user !== 0 && stat.uid !== BigInt(user))
        throw new UnsafePath(
          `${target} belongs to another user; choose an output directory you own.`,
        );
      return new OwnedDirectory(target, stat);
    }
    return new OwnedDirectory(target, fs.lstatSync(target, { bigint: true }));
  }

  /** Throws unless the path still leads to the directory this object owns. */
  assertCurrent(): void {
    let now: fs.BigIntStats | undefined;
    try {
      now = fs.lstatSync(this.path, { bigint: true });
    } catch {
      now = undefined;
    }
    if (now === undefined || !sameDirectory(now, this.#identity))
      throw new UnsafePath(
        `${this.path} was replaced while the output was being written; nothing at that path was changed.`,
      );
  }

  /** Empties and recreates the child directory `name`; a child that is a link or a file is refused, not followed. */
  resetChild(name: string): OwnedDirectory {
    assertSafeSegment(name, 'The output name');
    this.assertCurrent();
    const child = path.join(this.path, name);
    const existing = lstatOrNull(child);
    if (existing !== null) {
      if (existing.isSymbolicLink() || !existing.isDirectory())
        throw new UnsafePath(
          `${child} exists and is not a real directory; move it away or choose another output directory.`,
        );
      this.assertCurrent();
      fs.rmSync(child, { recursive: true, force: true });
    }
    fs.mkdirSync(child);
    return new OwnedDirectory(child, fs.lstatSync(child, { bigint: true }));
  }

  /** The child directory `name`: created when absent, kept as it is when it is a real directory, refused when it is a link or a file. */
  ensureChild(name: string): OwnedDirectory {
    assertSafeSegment(name, 'The output name');
    this.assertCurrent();
    const child = path.join(this.path, name);
    const existing = lstatOrNull(child);
    if (existing === null) fs.mkdirSync(child);
    else if (existing.isSymbolicLink() || !existing.isDirectory())
      throw new UnsafePath(
        `${child} exists and is not a real directory; move it away or choose another output directory.`,
      );
    return new OwnedDirectory(child, fs.lstatSync(child, { bigint: true }));
  }

  /** Writes the fixed leaf `name` through a temporary file renamed over it, so a link at the leaf is replaced and never written through. */
  writeFile(name: string, data: string | Uint8Array): void {
    assertSafeSegment(name, 'The output name');
    this.assertCurrent();
    const temporary = path.join(
      this.path,
      `.${name}.${randomBytes(6).toString('hex')}.tmp`,
    );
    fs.writeFileSync(temporary, data, { flag: 'wx' });
    try {
      this.assertCurrent();
      fs.renameSync(temporary, path.join(this.path, name));
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      throw error;
    }
  }
}

/**
 * Writes `data` to the file `relative` below `root`, creating missing directories one at a time.
 * Every existing step must be a real directory (a link is refused, not followed), `relative` may
 * not leave `root`, and the leaf is replaced through a temporary file rather than written through.
 */
export function writeContainedFile(
  root: string,
  relative: string,
  data: string | Uint8Array,
): void {
  let current = realRoot(root);
  const segments = segmentsOf(relative);
  const leaf = segments.pop() as string;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = lstatOrNull(current);
    if (stat === null) fs.mkdirSync(current);
    else if (stat.isSymbolicLink() || !stat.isDirectory())
      throw new UnsafePath(
        `${relative} passes through ${current}, which is not a real directory.`,
      );
  }
  const target = path.join(current, leaf);
  const existing = lstatOrNull(target);
  if (existing !== null && !existing.isFile() && !existing.isSymbolicLink())
    throw new UnsafePath(`${relative} exists and is not a file.`);
  const temporary = path.join(
    current,
    `.${leaf}.${randomBytes(6).toString('hex')}.tmp`,
  );
  fs.writeFileSync(temporary, data, { flag: 'wx' });
  try {
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}
