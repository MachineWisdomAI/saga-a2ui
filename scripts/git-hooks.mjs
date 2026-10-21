import { execFileSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

// Preserve arbitrary existing executables; Git still selects the effective hooks directory.
// No Git configuration or other hook is changed, including the pre-push guard.
const hookText = `#!/bin/sh
# SAGA staged formatter; installed by npm run hooks:install
original="$(git rev-parse --git-path hooks/pre-commit.saga-original)" || exit 1
if [ -x "$original" ]; then
  "$original" "$@" || exit $?
fi
root="$(git rev-parse --show-toplevel)" || exit 1
# Other linked worktrees can still be on a revision predating formatter adoption.
if [ -f "$root/scripts/format.mjs" ]; then
  cd "$root" || exit 1
  if [ ! -f node_modules/lint-staged/bin/lint-staged.js ]; then
    echo 'SAGA: install root tools with npm ci --workspaces=false --ignore-scripts' >&2
    exit 1
  fi
  exec node node_modules/lint-staged/bin/lint-staged.js
fi
`;

try {
  if (process.argv.slice(2).some((arg) => arg !== '--check'))
    throw new Error('Usage: node scripts/git-hooks.mjs [--check]');
  const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8' }).trim();
  const hooks = resolve(git('rev-parse', '--git-path', 'hooks'));
  const hook = resolve(hooks, 'pre-commit');
  const backup = `${hook}.saga-original`;
  accessSync('node_modules/lint-staged/bin/lint-staged.js', constants.R_OK);
  const current = existsSync(hook) ? readFileSync(hook, 'utf8') : '';
  if (current === hookText) {
    accessSync(hook, constants.X_OK);
    if (existsSync(backup)) accessSync(backup, constants.X_OK);
  } else {
    if (process.argv.includes('--check'))
      throw new Error(
        'Formatter hook absent or changed; run npm run hooks:install.',
      );
    if (existsSync(backup))
      throw new Error(
        `Preserved hook already exists at ${backup}; inspect it and the current hook before reinstalling.`,
      );
    if (
      existsSync(hook) &&
      (lstatSync(hook).isSymbolicLink() || !(lstatSync(hook).mode & 0o111))
    ) {
      throw new Error(
        'Existing pre-commit is a symlink or non-executable; resolve its ownership before installing.',
      );
    }
    mkdirSync(hooks, { recursive: true });
    const temporary = `${hook}.saga-new`;
    writeFileSync(temporary, hookText, { mode: 0o755, flag: 'wx' });
    if (existsSync(hook)) renameSync(hook, backup);
    try {
      renameSync(temporary, hook);
    } catch (error) {
      if (existsSync(backup)) renameSync(backup, hook);
      throw error;
    }
  }
  console.log(`SAGA formatter hook verified: ${hook}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
