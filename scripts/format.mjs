import { execFileSync } from 'node:child_process';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve, sep } from 'node:path';
import * as prettier from 'prettier';

// A selected path is read and replaced only as a regular file inside the checkout. A symbolic link
// or special file is refused (formatting through one would read and rewrite whatever it points
// at, possibly outside the checkout), the file is opened without following a link and must be the
// file that was inspected, and the formatted text replaces it through a temporary file in the same
// directory, so a link put in its place is replaced and never written through. SECURITY.md
// invariant 5. Node has no directory-relative file calls: the checks narrow the window between
// inspection and replacement to adjacent calls and do not close it.
function readSelected(file, root) {
  const absolute = resolve(file);
  const inspected = lstatSync(absolute);
  if (inspected.isSymbolicLink() || !inspected.isFile())
    throw new Error(
      `${file}: not a regular file; the formatter does not follow links or format special files`,
    );
  const parent = realpathSync(dirname(absolute));
  if (parent !== root && !parent.startsWith(`${root}${sep}`))
    throw new Error(`${file}: outside the checkout`);
  const handle = openSync(
    absolute,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fstatSync(handle);
    if (
      !opened.isFile() ||
      opened.dev !== inspected.dev ||
      opened.ino !== inspected.ino
    )
      throw new Error(`${file}: changed while it was being read`);
    return { text: readFileSync(handle, 'utf8'), identity: opened };
  } finally {
    closeSync(handle);
  }
}

function replaceSelected(file, text, identity) {
  const absolute = resolve(file);
  const temporary = join(
    dirname(absolute),
    `.${basename(absolute)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  writeFileSync(temporary, text, { flag: 'wx', mode: identity.mode & 0o777 });
  try {
    const now = lstatSync(absolute);
    if (
      now.isSymbolicLink() ||
      now.dev !== identity.dev ||
      now.ino !== identity.ino
    )
      throw new Error(`${file}: replaced while it was being formatted`);
    renameSync(temporary, absolute);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

// Both lint-staged and the CI backstop use this selection and Prettier configuration.
async function formattingFiles(files) {
  const selected = [];
  for (const file of files) {
    if (!/\.(?:[cm]?js|jsx|ts|tsx|json|css|ya?ml)$/.test(file)) continue;
    const info = await prettier.getFileInfo(file, {
      ignorePath: ['.gitignore', '.prettierignore'],
    });
    if (!info.ignored && info.inferredParser) selected.push(file);
  }
  return selected;
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.shift() === '--write';
  let files = args;
  if (!write) {
    const base = args.shift();
    const head = args.shift() ?? 'HEAD';
    if (!base || args.some((arg) => arg !== '--merge-base'))
      throw new Error(
        'Usage: npm run format:check -- BASE [HEAD] [--merge-base]',
      );
    files = execFileSync(
      'git',
      [
        'diff',
        '--name-only',
        '--diff-filter=ACM',
        '--no-renames',
        '-z',
        ...args,
        base,
        head,
        '--',
      ],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
  }
  const selected = await formattingFiles(files);
  const root = realpathSync(process.cwd());
  for (const file of selected) {
    let input;
    let identity;
    try {
      ({ text: input, identity } = readSelected(file, root));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
      continue;
    }
    const options = { ...(await prettier.resolveConfig(file)), filepath: file };
    if (write) {
      const formatted = await prettier.format(input, options);
      if (formatted !== input) {
        try {
          replaceSelected(file, formatted, identity);
        } catch (error) {
          console.error(error.message);
          process.exitCode = 1;
        }
      }
    } else if (!(await prettier.check(input, options))) {
      console.error(
        `${file}: formatting differs; run npm run format -- ${JSON.stringify(file)}`,
      );
      process.exitCode = 1;
    }
  }
  console.log(
    `Prettier ${write ? 'formatted' : 'checked'} ${selected.length} selected files.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
