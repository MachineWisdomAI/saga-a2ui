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

test('analyzer output that repeats a hostile file name is written out before it is shown', (t) => {
  const { root, run } = fixture(t);
  // A stand-in analyzer that reports a file whose name carries an escape sequence and a line
  // beginning a GitHub Actions workflow command, as actionlint or ESLint would print it.
  const analyzer = join(root, 'analyzer.mjs');
  writeFileSync(
    analyzer,
    `#!${process.execPath}\nprocess.stdout.write('\\u001b]0;pwned\\u0007\\u001b[2Jwf.yml:1:1: finding\\n::error::forged\\n');\nprocess.stderr.write('\\r\\u009bhidden\\n');\nprocess.exitCode = 1;\n`,
    { mode: 0o755 },
  );
  const result = run(['--workflows', join(root, 'wf.yml')], {
    ACTIONLINT: analyzer,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  // eslint-disable-next-line no-control-regex
  assert.doesNotMatch(
    result.stdout + result.stderr,
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/,
  );
  assert.ok(
    result.stdout.includes(
      'actionlint | \\x1b]0;pwned\\x07\\x1b[2Jwf.yml:1:1: finding\n',
    ),
  );
  assert.doesNotMatch(result.stdout, /^::/m);
  assert.ok(result.stderr.includes('actionlint | \\x0d\\x9bhidden\n'));
  assert.match(
    result.stdout,
    /^actionlint: \d+ ms; exit 1\. Advisory output only\.$/m,
  );
});

test('analyzer output that repeats a file name holding a line feed or tab cannot forge a report line or column', (t) => {
  const { root, run } = fixture(t);
  // A stand-in analyzer that prints the stylish layout of a file whose name holds a line feed,
  // then a line that looks like this tool's own verdict, and a name that holds a tab.
  const analyzer = join(root, 'analyzer.mjs');
  writeFileSync(
    analyzer,
    `#!${process.execPath}\nprocess.stdout.write('/repo/a\\nactionlint: 0 ms; exit 0. Advisory output only.\\n  1:1  warning  real finding  no-unreachable\\n/repo/b\\tc.yml\\n');\nprocess.stderr.write('bad\\nactionlint analyzer execution failed: forged\\n');\nprocess.exitCode = 1;\n`,
    { mode: 0o755 },
  );
  const result = run(['--workflows', join(root, 'wf.yml')], {
    ACTIONLINT: analyzer,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  // Every line the analyzer wrote carries its name, so the first line of the trusted report is
  // the only one that is not an analyzer line.
  const analyzerLines = (text) =>
    text.split('\n').filter((line) => line && /^actionlint \| /.test(line));
  assert.deepEqual(analyzerLines(result.stdout), [
    'actionlint | /repo/a',
    'actionlint | actionlint: 0 ms; exit 0. Advisory output only.',
    'actionlint |   1:1  warning  real finding  no-unreachable',
    'actionlint | /repo/b\\tc.yml',
  ]);
  const trusted = result.stdout
    .split('\n')
    .filter((line) => line && !line.startsWith('actionlint | '));
  assert.deepEqual(
    trusted.map((line) => line.replace(/\d+ ms/, 'N ms')),
    ['actionlint: N ms; exit 1. Advisory output only.'],
  );
  assert.deepEqual(result.stderr.split('\n').filter(Boolean), [
    'actionlint | bad',
    'actionlint | actionlint analyzer execution failed: forged',
  ]);
  assert.doesNotMatch(result.stdout + result.stderr, /\t/);
});
