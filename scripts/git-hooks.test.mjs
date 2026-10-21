import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = resolve('.');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'saga-hooks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (cmd, args) =>
    spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });
  const git = (...args) => {
    const r = run('git', args);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-qb', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Tooling fixture');
  mkdirSync(join(root, 'scripts'));
  for (const name of ['git-hooks.mjs', 'format.mjs']) {
    try {
      cpSync(join(source, 'scripts', name), join(root, 'scripts', name));
    } catch {
      /* missing implementation is diagnosed by setup */
    }
  }
  for (const name of [
    'package.json',
    '.prettierrc.json',
    '.prettierignore',
    'lint-staged.config.mjs',
  ]) {
    try {
      cpSync(join(source, name), join(root, name));
    } catch {
      /* initial red run */
    }
  }
  symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'), 'dir');
  writeFileSync(join(root, 'sample.ts'), 'export const value = 1;\n');
  git('add', 'sample.ts');
  git('commit', '-qm', 'initial');
  git('checkout', '-qb', 'topic');
  return {
    root,
    run,
    git,
    setup: (...args) =>
      run(process.execPath, ['scripts/git-hooks.mjs', ...args]),
  };
}

test('setup is repeatable and a real commit formats staged content while preserving unstaged edits and exclusions', (t) => {
  const { root, git, setup } = fixture(t);
  const first = setup();
  assert.equal(first.status, 0, first.stderr);
  const hook = readFileSync(join(root, '.git/hooks/pre-commit'), 'utf8');
  assert.equal(setup().status, 0);
  assert.equal(readFileSync(join(root, '.git/hooks/pre-commit'), 'utf8'), hook);
  assert.equal(setup('--check').status, 0);
  writeFileSync(join(root, 'sample.ts'), 'export const value={answer:42}\n');
  git('add', 'sample.ts');
  writeFileSync(
    join(root, 'sample.ts'),
    'export const value={answer:42}\n// unstaged only\n',
  );
  for (const name of [
    'README.md',
    'dist/generated.ts',
    'docs/evidence/receipt.json',
    'package-lock.json',
  ]) {
    mkdirSync(join(root, name, '..'), { recursive: true });
    writeFileSync(
      join(root, name),
      name.endsWith('.json') ? '{"a":1}' : 'const   excluded=1',
    );
    git('add', '-f', '--', name);
  }
  git('commit', '-qm', 'formatted');
  assert.equal(
    git('show', 'HEAD:sample.ts'),
    'export const value = { answer: 42 };',
  );
  assert.match(
    readFileSync(join(root, 'sample.ts'), 'utf8'),
    /\/\/ unstaged only/,
  );
  assert.doesNotMatch(git('show', 'HEAD:sample.ts'), /unstaged/);
  assert.equal(git('show', 'HEAD:dist/generated.ts'), 'const   excluded=1');
  assert.equal(git('show', 'HEAD:docs/evidence/receipt.json'), '{"a":1}');
  assert.equal(git('show', 'HEAD:README.md'), 'const   excluded=1');
  assert.equal(git('show', 'HEAD:package-lock.json'), '{"a":1}');
});

test('existing executable guards and custom hooksPath survive setup, and a rejecting guard still blocks commits', (t) => {
  const { root, run, git, setup } = fixture(t);
  mkdirSync(join(root, 'local-hooks'));
  git('config', 'core.hooksPath', 'local-hooks');
  const guard = '#!/bin/sh\necho original-guard >&2\nexit 1\n';
  writeFileSync(join(root, 'local-hooks/pre-commit'), guard, { mode: 0o755 });
  const push = '#!/bin/sh\nexit 19\n';
  writeFileSync(join(root, 'local-hooks/pre-push'), push, { mode: 0o755 });
  assert.equal(setup().status, 0);
  assert.equal(git('config', 'core.hooksPath'), 'local-hooks');
  assert.equal(
    readFileSync(join(root, 'local-hooks/pre-commit.saga-original'), 'utf8'),
    guard,
  );
  assert.equal(readFileSync(join(root, 'local-hooks/pre-push'), 'utf8'), push);
  writeFileSync(join(root, 'sample.ts'), 'export const value=2');
  git('add', 'sample.ts');
  const commit = run('git', ['commit', '-qm', 'rejected']);
  assert.notEqual(commit.status, 0);
  assert.match(commit.stderr, /original-guard/);
});

test('linked worktrees share the installed hook but use their own source, index and dependencies', (t) => {
  const { root, git, setup } = fixture(t);
  git(
    'add',
    'scripts/git-hooks.mjs',
    'scripts/format.mjs',
    'package.json',
    '.prettierrc.json',
    '.prettierignore',
    'lint-staged.config.mjs',
  );
  git('commit', '-qm', 'tooling');
  assert.equal(setup().status, 0);
  const linked = join(root, 'linked');
  git('worktree', 'add', '-qb', 'linked-topic', linked);
  symlinkSync(
    join(source, 'node_modules'),
    join(linked, 'node_modules'),
    'dir',
  );
  const run = (cmd, args) =>
    spawnSync(cmd, args, { cwd: linked, encoding: 'utf8' });
  assert.equal(run(process.execPath, ['scripts/git-hooks.mjs']).status, 0);
  assert.equal(
    run(process.execPath, ['scripts/git-hooks.mjs', '--check']).status,
    0,
  );
  writeFileSync(join(linked, 'sample.ts'), 'export const linked={ok:true}');
  assert.equal(run('git', ['add', 'sample.ts']).status, 0);
  const commit = run('git', ['commit', '-qm', 'linked formatting']);
  assert.equal(commit.status, 0, commit.stderr);
  assert.equal(
    run('git', ['show', 'HEAD:sample.ts']).stdout,
    'export const linked = { ok: true };\n',
  );
  assert.equal(
    readFileSync(join(root, 'sample.ts'), 'utf8'),
    'export const value = 1;\n',
  );
});

test('changed-file backstop detects formatting without changing files and skips Markdown-only changes', (t) => {
  const { root, git, run } = fixture(t);
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'sample.ts'), 'export const value={bad:true}');
  git('add', 'sample.ts');
  git('commit', '-qm', 'unformatted');
  const check = run(process.execPath, ['scripts/format.mjs', '--check', base]);
  assert.equal(check.status, 1);
  assert.match(check.stderr, /sample.ts: formatting differs/);
  assert.equal(
    readFileSync(join(root, 'sample.ts'), 'utf8'),
    'export const value={bad:true}',
  );
  const docsBase = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'README.md'), 'unformatted markdown');
  git('add', 'README.md');
  git('commit', '-qm', 'documentation');
  const docs = run(process.execPath, [
    'scripts/format.mjs',
    '--check',
    docsBase,
  ]);
  assert.equal(docs.status, 0, docs.stderr);
  assert.match(docs.stdout, /checked 0 selected files/);
});
