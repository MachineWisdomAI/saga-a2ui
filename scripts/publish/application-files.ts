import fs from 'node:fs';
import path from 'node:path';
import {
  FileBudget,
  InputRefused,
  MAX_APPLICATION_FILE_BYTES,
  readBounded,
} from './bounded-read.js';

// Reading the application's own files into something that will be published (CLI3 #66, CLI4 #67). A
// listing asset, a screenshot, a README or a skill is copied into an archive people receive, so it must
// be a regular file that lies inside the directory of the release input: never a link, and never
// something a link or a `..` reaches outside it. The reason is returned as words, never thrown raw.

export type FileRead =
  | { readonly ok: true; readonly data: Buffer }
  | { readonly ok: false; readonly reason: string };

const reasonOf = (error: unknown): string =>
  error instanceof InputRefused
    ? error.message
    : (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'It does not exist.'
      : (error as Error).message;

/** One file named relative to `directory`. */
export function readApplicationFile(
  directory: string,
  source: string,
  budget: FileBudget,
): FileRead {
  try {
    const file = path.resolve(directory, source);
    if (fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile())
      throw new Error('It is not a regular file.');
    const root = fs.realpathSync(directory);
    const real = fs.realpathSync(file);
    if (!real.startsWith(`${root}${path.sep}`))
      throw new Error('It is outside the directory of the release input.');
    return {
      ok: true,
      data: readBounded(real, MAX_APPLICATION_FILE_BYTES, budget),
    };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

export type TreeRead =
  | {
      readonly ok: true;
      readonly files: readonly {
        readonly path: string;
        readonly data: Buffer;
      }[];
    }
  | { readonly ok: false; readonly reason: string };

const MAX_TREE_FILES = 200;
const MAX_TREE_BYTES = 5 * 1024 * 1024;

/** Every file under one directory named relative to `directory`, with paths relative to it, sorted. Links are refused; the size is bounded. */
export function readApplicationTree(
  directory: string,
  source: string,
  budget: FileBudget,
): TreeRead {
  try {
    const root = fs.realpathSync(directory);
    const top = path.resolve(directory, source);
    if (fs.lstatSync(top).isSymbolicLink() || !fs.statSync(top).isDirectory())
      throw new Error('It is not a directory.');
    const realTop = fs.realpathSync(top);
    if (!realTop.startsWith(`${root}${path.sep}`))
      throw new Error('It is outside the directory of the release input.');
    const files: { path: string; data: Buffer }[] = [];
    const treeBudget = new FileBudget(MAX_TREE_BYTES);
    const walk = (current: string, prefix: string): void => {
      for (const entry of fs
        .readdirSync(current, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        const full = path.join(current, entry.name);
        if (entry.isSymbolicLink()) throw new Error(`${relative} is a link.`);
        if (entry.isDirectory()) walk(full, relative);
        else if (entry.isFile()) {
          if (files.length + 1 > MAX_TREE_FILES)
            throw new Error(
              `It holds more than ${MAX_TREE_FILES} files or ${MAX_TREE_BYTES} bytes.`,
            );
          // The allowance is taken before a file is allocated, so a large file is never read.
          let data: Buffer;
          try {
            data = readBounded(full, MAX_TREE_BYTES, treeBudget, budget);
          } catch (error) {
            if (error instanceof InputRefused)
              throw new Error(
                `It holds more than ${MAX_TREE_FILES} files or ${MAX_TREE_BYTES} bytes.`,
              );
            throw error;
          }
          files.push({ path: relative, data });
        } else throw new Error(`${relative} is not a regular file.`);
      }
    };
    walk(realTop, '');
    return { ok: true, files };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}
