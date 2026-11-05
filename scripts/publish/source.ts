import fs from 'node:fs';
import path from 'node:path';
import type { PublicationRecord } from './record.js';

// The application directory comes from the release input, so its repository configuration is
// less trusted than the operator running `saga publish`. Git can execute programs that
// configuration names (a file system monitor, hooks, filter and diff drivers), and no
// environment setting disables the repository's own configuration. This module therefore never
// starts Git: it reads the few plain files that hold the checked-out commit.

/** A commit identifier: SHA-1 or SHA-256 object format. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
/** The longest `ref:` chain followed; Git itself stops at five. */
const MAX_SYMBOLIC_DEPTH = 5;
/** None of the files read here is larger than a few kilobytes except `packed-refs`. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/**
 * The commit the application directory has checked out, found without running Git.
 *
 * `dirty` is always `null`: whether tracked files differ from the commit can only be answered by
 * running Git against the repository's configuration, which this tool does not trust. `revision`
 * is `null` when no repository, an unreadable one, or a layout this reader does not know (for
 * example reftable references) is found.
 */
export function sourceOf(directory: string): PublicationRecord['source'] {
  return { revision: headCommit(directory), dirty: null };
}

function headCommit(directory: string): string | null {
  try {
    const gitDir = findGitDir(path.resolve(directory));
    if (gitDir === null) return null;
    const commonDir = commonDirOf(gitDir);
    let target = 'HEAD';
    for (let depth = 0; depth <= MAX_SYMBOLIC_DEPTH; depth += 1) {
      const text = readReference(target, gitDir, commonDir);
      if (text === null) return null;
      const symbolic = /^ref:\s*(\S+)$/.exec(text);
      if (symbolic === null) return OBJECT_ID.test(text) ? text : null;
      target = symbolic[1] as string;
      if (!isSafeReferenceName(target)) return null;
    }
    return null;
  } catch {
    return null;
  }
}

/** The repository directory for `start` or an ancestor, following a `.git` file's `gitdir:` pointer. */
function findGitDir(start: string): string | null {
  for (let current = start; ; current = path.dirname(current)) {
    const candidate = path.join(current, '.git');
    // A symbolic link in place of `.git` is not something Git creates; do not follow it.
    const stat = lstatOrNull(candidate);
    if (stat?.isSymbolicLink() === true) return null;
    if (stat?.isDirectory() === true) return candidate;
    if (stat?.isFile() === true) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readSmall(candidate));
      if (pointer === null) return null;
      return path.resolve(current, (pointer[1] as string).trim());
    }
    if (path.dirname(current) === current) return null;
  }
}

/** The directory that holds shared references: the repository itself, or the main one for a linked worktree. */
function commonDirOf(gitDir: string): string {
  const pointer = readInside(gitDir, 'commondir');
  return pointer === null ? gitDir : path.resolve(gitDir, pointer.trim());
}

/**
 * The text of the regular file `relative` under `root`, or `null` when it is absent, is not a
 * regular file, or is reached through a symbolic link at any step below `root`. Following a link
 * would let a lower-trust directory make this reader copy an arbitrary local file that merely
 * looks like a commit identifier into publication evidence. Repository metadata that Git itself
 * writes contains no such links.
 */
function readInside(root: string, relative: string): string | null {
  let current = root;
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = lstatOrNull(current);
    if (stat === null || stat.isSymbolicLink()) return null;
    const last = index === parts.length - 1;
    if (last ? !stat.isFile() : !stat.isDirectory()) return null;
  }
  return readSmall(current);
}

/** The text a reference holds: its loose file, or its line in `packed-refs`. */
function readReference(
  name: string,
  gitDir: string,
  commonDir: string,
): string | null {
  // `HEAD` is private to a worktree; every other reference is shared.
  const home = name === 'HEAD' ? gitDir : commonDir;
  const loose = readInside(home, name);
  if (loose !== null) return loose.trim();
  if (name === 'HEAD') return null;
  const packedText = readInside(commonDir, 'packed-refs');
  if (packedText === null) return null;
  for (const line of packedText.split('\n')) {
    const separator = line.indexOf(' ');
    if (
      separator > 0 &&
      line[0] !== '#' &&
      line[0] !== '^' &&
      line.slice(separator + 1).trim() === name
    )
      return line.slice(0, separator);
  }
  return null;
}

/** A reference name that stays inside `refs/`: no parent segment, no absolute path, no NUL. */
function isSafeReferenceName(name: string): boolean {
  return (
    name.startsWith('refs/') &&
    !name.includes('\0') &&
    !name.includes('\\') &&
    name
      .split('/')
      .every((part) => part !== '' && part !== '..' && part !== '.')
  );
}

function lstatOrNull(file: string): fs.Stats | null {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}

function readSmall(file: string): string {
  if (fs.statSync(file).size > MAX_FILE_BYTES)
    throw new Error(`${file} is too large to be a repository file`);
  return fs.readFileSync(file, 'utf8');
}
