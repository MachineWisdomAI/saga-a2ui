import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// The formatter reads and rewrites only regular files inside the checkout (SECURITY.md invariant 5):
// lint-staged and an operator both hand it paths, and a link among them must not make it read or
// rewrite whatever the link points at.

const source = resolve('.');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'saga-format-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  cpSync(
    join(source, 'scripts', 'format.mjs'),
    join(root, 'scripts', 'format.mjs'),
  );
  for (const name of ['package.json', '.prettierrc.json', '.prettierignore'])
    cpSync(join(source, name), join(root, name));
  symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
  const outside = mkdtempSync(join(tmpdir(), 'saga-format-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const run = (...args) =>
    spawnSync(process.execPath, ['scripts/format.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  return { root, outside, run };
}

const UNFORMATTED = 'export const value={answer:42}\n';
const FORMATTED = 'export const value = { answer: 42 };\n';

test('write mode formats a regular file in place, keeping its mode', (t) => {
  const { root, run } = fixture(t);
  writeFileSync(join(root, 'sample.ts'), UNFORMATTED, { mode: 0o640 });
  const result = run('--write', 'sample.ts');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'sample.ts'), 'utf8'), FORMATTED);
  assert.equal(lstatSync(join(root, 'sample.ts')).mode & 0o777, 0o640);
  assert.equal(result.stdout.trim(), 'Prettier formatted 1 selected files.');
});

test('write mode refuses a symbolic link and leaves its target untouched', (t) => {
  const { root, outside, run } = fixture(t);
  const target = join(outside, 'target.ts');
  writeFileSync(target, UNFORMATTED);
  symlinkSync(target, join(root, 'linked.ts'));
  writeFileSync(join(root, 'sample.ts'), UNFORMATTED);
  const result = run('--write', 'linked.ts', 'sample.ts');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /linked\.ts: not a regular file/);
  assert.equal(readFileSync(target, 'utf8'), UNFORMATTED);
  assert.equal(lstatSync(join(root, 'linked.ts')).isSymbolicLink(), true);
  // The other selected file is still formatted.
  assert.equal(readFileSync(join(root, 'sample.ts'), 'utf8'), FORMATTED);
});

test('write mode refuses a path that reaches outside the checkout through a linked directory', (t) => {
  const { root, outside, run } = fixture(t);
  writeFileSync(join(outside, 'inner.ts'), UNFORMATTED);
  symlinkSync(outside, join(root, 'shared'), 'dir');
  const result = run('--write', 'shared/inner.ts');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the checkout/);
  assert.equal(readFileSync(join(outside, 'inner.ts'), 'utf8'), UNFORMATTED);
});

test('check mode refuses a link too, and does not read what it points at', (t) => {
  const { root, outside, run } = fixture(t);
  const git = (...args) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-qb', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Fixture');
  writeFileSync(join(root, 'base.txt'), 'base');
  git('add', 'base.txt');
  git('commit', '-qm', 'base');
  const target = join(outside, 'target.ts');
  writeFileSync(target, UNFORMATTED);
  symlinkSync(target, join(root, 'linked.ts'));
  git('add', 'linked.ts');
  git('commit', '-qm', 'link');
  const result = run('--check', 'HEAD~1', 'HEAD');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /linked\.ts: not a regular file/);
  assert.doesNotMatch(result.stderr, /formatting differs/);
});

test('a path outside the checkout is refused before any Prettier configuration beside it is loaded', (t) => {
  const { root, outside, run } = fixture(t);
  const marker = join(outside, 'config-ran');
  // A configuration file is code: loading one beside a selected path executes it.
  writeFileSync(
    join(outside, '.prettierrc.mjs'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\nexport default {};\n`,
  );
  writeFileSync(join(outside, 'test.ts'), UNFORMATTED);
  symlinkSync(outside, join(root, 'link'), 'dir');
  const result = run('--write', 'link/test.ts');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /link\/test\.ts: outside the checkout/);
  assert.equal(existsSync(marker), false, 'outside configuration was loaded');
  assert.equal(readFileSync(join(outside, 'test.ts'), 'utf8'), UNFORMATTED);
});
