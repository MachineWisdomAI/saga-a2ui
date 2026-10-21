import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import * as prettier from 'prettier';

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
  for (const file of selected) {
    const input = await readFile(file, 'utf8');
    const options = { ...(await prettier.resolveConfig(file)), filepath: file };
    if (write) {
      const formatted = await prettier.format(input, options);
      if (formatted !== input) await writeFile(file, formatted);
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
