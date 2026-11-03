import fs from 'node:fs';

// Reading a file the release input names (CLI3 #66, CLI4 #67), with the size known before the bytes
// are allocated. A file is opened once, its size is taken from that handle, and a file over its
// limit is refused without being read; reading `fs.readFileSync` and measuring afterwards would have
// allocated whatever the path happens to hold. Every publication reader of an input file goes
// through this function, so a limit has one place to be repaired. SECURITY.md invariant 1.

/** A file the tool will not read because of its size or kind. The text is safe to show. */
export class InputRefused extends Error {}

/** The most one release input, one built view or one record may be, and what the views of one build may add up to. */
export const MAX_RELEASE_INPUT_BYTES = 1024 * 1024;
export const MAX_VIEW_BYTES = 8 * 1024 * 1024;
export const MAX_VIEWS = 200;
export const MAX_VIEW_TOTAL_BYTES = 64 * 1024 * 1024;
export const MAX_RECORD_BYTES = 8 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
/** The largest single application file: the most any image check accepts. */
export const MAX_APPLICATION_FILE_BYTES = 20 * 1024 * 1024;
/**
 * What every local file of one publication command may add up to: the release input, the fixture
 * calls, the built views, the application files and trees, and an earlier record and archive. One
 * allowance is made at the command's entry and passed to each reader, so categories that are each
 * within their own limit still cannot add up to more than this. The per-file and per-tree limits
 * stay as the narrower bounds.
 */
export const MAX_PREPARATION_BYTES = 256 * 1024 * 1024;

/** A running allowance for files read in one step; `read` takes from it before it allocates. */
export class FileBudget {
  #remaining: number;
  constructor(total: number) {
    this.#remaining = total;
  }
  get remaining(): number {
    return this.#remaining;
  }
  take(bytes: number): void {
    if (bytes > this.#remaining)
      throw new InputRefused('The files together are too large.');
    this.#remaining -= bytes;
  }
}

/** The allowance for the local files of one publication command. */
export const preparationBudget = (): FileBudget =>
  new FileBudget(MAX_PREPARATION_BYTES);

/**
 * The bytes of a regular file of at most `maxBytes`, or an {@link InputRefused}. Every budget given
 * must hold the file's size, and the size is taken from all of them before the file is allocated.
 * Other errors are the filesystem's own.
 */
export function readBounded(
  file: string,
  maxBytes: number,
  ...budgets: readonly (FileBudget | undefined)[]
): Buffer {
  const handle = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) throw new InputRefused('It is not a regular file.');
    if (stat.size > maxBytes)
      throw new InputRefused(`It is larger than ${maxBytes} bytes.`);
    const held = budgets.filter(
      (budget): budget is FileBudget => budget !== undefined,
    );
    if (held.some((budget) => stat.size > budget.remaining))
      throw new InputRefused('The files together are too large.');
    for (const budget of held) budget.take(stat.size);
    const data = Buffer.allocUnsafe(stat.size);
    let read = 0;
    while (read < stat.size) {
      const count = fs.readSync(handle, data, read, stat.size - read, read);
      if (count === 0) break;
      read += count;
    }
    return read === stat.size ? data : data.subarray(0, read);
  } finally {
    fs.closeSync(handle);
  }
}
