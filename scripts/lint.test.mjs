import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve('.');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'saga-lint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (args, env = {}) =>
    spawnSync(process.execPath, [join(source, 'scripts/lint.mjs'), ...args], {
      cwd: source,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
  return { root, run };
}

test('configured correctness mistakes produce warning diagnostics, while permitted TypeScript stays quiet', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({
    overrideConfigFile: join(source, 'eslint.config.mjs'),
  });
  const [bad] = await eslint.lintText(
    'async function f() { new Promise(async () => { await f(); }); return; console.log("unreachable"); }\n',
    { filePath: 'scripts/probe.ts' },
  );
  assert.equal(bad.errorCount, 0);
  assert.ok(bad.warningCount >= 2);
  assert.ok(
    bad.messages.some((message) => message.ruleId === 'no-unreachable'),
  );
  assert.ok(
    bad.messages.some(
      (message) => message.ruleId === 'no-async-promise-executor',
    ),
  );
  const [good] = await eslint.lintText(
    'export async function f(values: number[]) { for (const value of values) { await Promise.resolve(value); } }\n',
    { filePath: 'scripts/probe.ts' },
  );
  assert.equal(good.messages.length, 0);
  const [jsx] = await eslint.lintText('export const view = <div />;\n', {
    filePath: 'scripts/probe.jsx',
  });
  assert.equal(jsx.messages.length, 0);
  const [unsafe] = await eslint.lintText(
    'export const value = maybe?.field!;\n',
    { filePath: 'scripts/probe.ts' },
  );
  assert.ok(
    unsafe.messages.some(
      (message) =>
        message.ruleId ===
          '@typescript-eslint/no-non-null-asserted-optional-chain' &&
        message.severity === 1,
    ),
  );
});

test('workflow analyzer findings and execution failures remain visible and distinguishable', (t) => {
  const { root, run } = fixture(t);
  const workflow = join(root, 'workflow.yml');
  writeFileSync(
    workflow,
    'name: probe\non: push\njobs:\n  probe:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ needs.missing.outputs.value }}\n',
  );
  const finding = run(['--workflows', workflow]);
  assert.equal(finding.status, 1, finding.stdout + finding.stderr);
  assert.match(finding.stdout + finding.stderr, /workflow.yml:\d+:\d+:/);
  assert.match(finding.stdout + finding.stderr, /needs|missing/);
  const failure = run(['--workflows', workflow], {
    ACTIONLINT: join(root, 'missing-actionlint'),
  });
  assert.equal(failure.status, 2);
  assert.match(failure.stdout + failure.stderr, /analyzer execution failed/i);
});

test('documentation-only changes do not invoke analyzers', (t) => {
  const { run } = fixture(t);
  const result = run(['README.md', 'docs/guide.md'], {
    ACTIONLINT: '/missing/actionlint',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No relevant lint inputs/);
});

test('an empty changed-file set does not fall back to a repository scan', (t) => {
  const { run } = fixture(t);
  const result = run(['--base', 'HEAD', 'HEAD'], {
    ACTIONLINT: '/missing/actionlint',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No relevant lint inputs/);
});
