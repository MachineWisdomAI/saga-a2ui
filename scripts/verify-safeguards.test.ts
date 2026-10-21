import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const disposables: string[] = [];

afterEach(() => {
  for (const dir of disposables.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function disposable(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  disposables.push(dir);
  return dir;
}

function ignoredFixture(name: string): string {
  const dir = path.join(
    repoRoot,
    '.wise-agents',
    `${name}-${randomBytes(4).toString('hex')}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  disposables.push(dir);
  return dir;
}

function runScript(
  script: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    tsx,
    [path.join(repoRoot, 'scripts', script), ...args],
    {
      cwd: options?.cwd ?? repoRoot,
      env: options?.env ?? process.env,
      encoding: 'utf8',
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function writeSource(dir: string, name: string, source: string): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, source);
  return file;
}

function commandVersion(bin: string, args: string[]): string {
  const result = spawnSync(bin, args, { encoding: 'utf8' });
  expect(result.status).toBe(0);
  return (result.stdout ?? '').trim();
}

type GuardCase = { name: string; source: string; fails: boolean };

// Expected outcomes are specified here. They are not derived from the guard.
const guardCases: GuardCase[] = [
  {
    name: 'original trimmed template fallback',
    source:
      'const resources = "";\nconst policy = `img-src ${resources}`.trim() || "img-src \'none\'";\n',
    fails: true,
  },
  {
    name: 'parentheses around the trim call',
    source:
      'const resources = "";\n(`img-src ${resources}`.trim()) || "img-src \'none\'";\n',
    fails: true,
  },
  {
    name: 'trim of a parenthesized template',
    source:
      'const resources = "";\n(`img-src ${resources}`).trim() || "img-src \'none\'";\n',
    fails: true,
  },
  {
    name: 'nested parentheses around trim',
    source:
      'const resources = "";\n((`img-src ${resources}`).trim()) || "img-src \'none\'";\n',
    fails: true,
  },
  {
    name: 'fixed string fallback',
    source: '"img-src" || "img-src \'none\'";\n',
    fails: true,
  },
  {
    name: 'parenthesized fixed string',
    source: '("img-src") || "img-src \'none\'";\n',
    fails: true,
  },
  {
    name: 'trimmed fixed string',
    source: '"img-src ".trim() || "img-src \'none\'";\n',
    fails: true,
  },
  {
    name: 'identifier trim may be empty',
    source:
      'const resources = "";\nconst fallback = "x";\nresources.trim() || fallback;\n',
    fails: false,
  },
  {
    name: 'interpolation-only template trim may be empty',
    source:
      'const resources = "";\nconst fallback = "x";\n`${resources}`.trim() || fallback;\n',
    fails: false,
  },
  {
    name: 'whitespace-only fixed template text',
    source:
      'const resources = "";\nconst fallback = "x";\n`  ${resources}  `.trim() || fallback;\n',
    fails: false,
  },
  {
    name: 'whitespace-only template with no interpolation',
    source: 'const fallback = "x";\n`   `.trim() || fallback;\n',
    fails: false,
  },
  {
    name: 'fallback inside the interpolation',
    source: 'const resources = "";\n`img-src ${resources || "\'none\'"}`;\n',
    fails: false,
  },
  {
    name: 'whitespace-only string is outside this check',
    source: '"   " || "img-src \'none\'";\n',
    fails: false,
  },
];

describe('fixed-text || guard', () => {
  for (const example of guardCases) {
    it(example.name, () => {
      const dir = disposable('guard-');
      const file = writeSource(dir, 'case.ts', example.source);
      const result = runScript('guard-fixed-or.ts', [file]);
      if (example.fails) {
        expect(result.status, result.stdout + result.stderr).not.toBe(0);
        expect(result.stdout + result.stderr).toContain(`${file}:`);
      } else {
        expect(result.status, result.stdout + result.stderr).toBe(0);
      }
    });
  }

  it('reports the file and line of the original expression', () => {
    const dir = disposable('guard-line-');
    const file = writeSource(
      dir,
      'policy.ts',
      [
        'const resources = "";',
        'const fallback = "img-src \'none\'";',
        'const policy = `img-src ${resources}`.trim() || fallback;',
        '',
      ].join('\n'),
    );
    const result = runScript('guard-fixed-or.ts', [file]);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain(`${file}:3:`);
  });

  it('does not scan dependencies or generated output', () => {
    const dir = disposable('guard-skip-');
    writeSource(
      dir,
      'src/ok.ts',
      'const resources = "";\nresources.trim() || "x";\n',
    );
    writeSource(
      dir,
      'node_modules/bad.ts',
      'const resources = "";\n`img-src ${resources}`.trim() || "img-src \'none\'";\n',
    );
    writeSource(dir, 'dist/bad.ts', '"img-src" || "img-src \'none\'";\n');
    const result = runScript('guard-fixed-or.ts', ['--root', dir]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('accepts the host fixture policy module', () => {
    const file = path.join(repoRoot, 'apps/lit-host/e2e/host-fixture/csp.ts');
    const result = runScript('guard-fixed-or.ts', [file]);
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

describe('test discovery', () => {
  it('fails when Vitest omits an authored headless test', () => {
    const root = ignoredFixture('omitted-headless');
    writeSource(
      root,
      'vitest.config.ts',
      [
        "import { defineConfig } from 'vitest/config';",
        'export default defineConfig({',
        "  test: { environment: 'node', include: ['src/**/*.test.ts'] },",
        '});',
        '',
      ].join('\n'),
    );
    writeSource(
      root,
      'src/included.test.ts',
      "import { it } from 'vitest';\nit('included', () => {});\n",
    );
    writeSource(
      root,
      'e2e/host-fixture/csp.test.ts',
      "import { it } from 'vitest';\nit('omitted', () => {});\n",
    );
    const result = runScript('check-test-discovery.ts', [
      '--root',
      root,
      '--config',
      path.join(root, 'vitest.config.ts'),
    ]);
    const output = result.stdout + result.stderr;
    expect(result.status, output).not.toBe(0);
    expect(output).toContain(
      'omitted headless test: e2e/host-fixture/csp.test.ts',
    );
    expect(output).not.toContain('omitted headless test: src/included.test.ts');
  });

  it('passes when Vitest discovers every authored headless test', () => {
    const root = ignoredFixture('complete-headless');
    writeSource(
      root,
      'vitest.config.ts',
      [
        "import { defineConfig } from 'vitest/config';",
        'export default defineConfig({',
        "  test: { environment: 'node', include: ['**/*.test.ts'] },",
        '});',
        '',
      ].join('\n'),
    );
    writeSource(
      root,
      'src/included.test.ts',
      "import { it } from 'vitest';\nit('included', () => {});\n",
    );
    writeSource(
      root,
      'e2e/host-fixture/csp.test.ts',
      "import { it } from 'vitest';\nit('fixture', () => {});\n",
    );
    const result = runScript('check-test-discovery.ts', [
      '--root',
      root,
      '--config',
      path.join(root, 'vitest.config.ts'),
    ]);
    const output = result.stdout + result.stderr;
    expect(result.status, output).toBe(0);
    expect(output).toContain('headless e2e/host-fixture/csp.test.ts');
    expect(output).toContain('headless src/included.test.ts');
  });

  it('discovers the repository CSP unit test and keeps Playwright specs separate', () => {
    const result = runScript('check-test-discovery.ts', []);
    const output = result.stdout + result.stderr;
    expect(result.status, output).toBe(0);
    expect(output).toContain(
      'headless apps/lit-host/e2e/host-fixture/csp.test.ts',
    );
    expect(output).toContain('browser apps/lit-host/e2e/csp-image.spec.ts');
    expect(output).not.toContain(
      'headless apps/lit-host/e2e/csp-image.spec.ts',
    );
    expect(output).not.toContain(
      'browser apps/lit-host/e2e/host-fixture/csp.test.ts',
    );
  });
});

type Receipt = {
  startedAt: string;
  endedAt: string;
  cwd: string;
  argv: string[];
  node: string;
  npm: string;
  commitAtStart: string | null;
  commitAtEnd: string | null;
  revisionChanged: boolean;
  trackedStatusAtStart: string[];
  trackedStatusAtEnd: string[];
  trackedStateChanged: boolean;
  pristineHead: boolean;
  validationLabel: string;
  invocation: string;
  commands: Array<{
    name: string;
    argv: string[];
    startedAt: string;
    endedAt: string;
    exitCode: number | null;
  }>;
  exitCode: number;
};

function readReceipt(dir: string): Receipt {
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name !== 'latest.json');
  expect(files).toHaveLength(1);
  return JSON.parse(
    fs.readFileSync(path.join(dir, files[0]), 'utf8'),
  ) as Receipt;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  expect(result.status, result.stderr ?? '').toBe(0);
  return result.stdout ?? '';
}

function initRepo(): string {
  const dir = disposable('verify-repo-');
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'verify-test@example.com']);
  git(dir, ['config', 'user.name', 'verify-test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'initial\n');
  git(dir, ['add', 'tracked.txt']);
  git(dir, ['commit', '-m', 'initial']);
  return dir;
}

function execArg(name: string, argv: string[]): string {
  return JSON.stringify({ name, argv });
}

describe('verify receipts', () => {
  it('records a failed subprocess and exits nonzero', () => {
    const repo = initRepo();
    const receipts = disposable('verify-receipts-');
    const failScript = writeSource(repo, 'fail.cjs', 'process.exit(3);\n');
    const laterScript = writeSource(repo, 'later.cjs', 'process.exit(0);\n');
    const result = runScript('verify.ts', [
      '--cwd',
      repo,
      '--receipt-dir',
      receipts,
      '--exec',
      execArg('fail', ['node', failScript]),
      '--exec',
      execArg('later', ['node', laterScript]),
    ]);
    expect(result.status).toBe(3);
    const receipt = readReceipt(receipts);
    expect(receipt.exitCode).toBe(3);
    expect(receipt.invocation).toBe('exec');
    expect(receipt.commands).toHaveLength(1);
    expect(receipt.commands[0].name).toBe('fail');
    expect(receipt.commands[0].argv).toEqual(['node', failScript]);
    expect(receipt.commands[0].exitCode).toBe(3);
    expect(receipt.pristineHead).toBe(true);
    expect(receipt.validationLabel).toBe('pristine-head');
  });

  it('records dirty tracked files and does not label the run pristine-head', () => {
    const repo = initRepo();
    fs.appendFileSync(path.join(repo, 'tracked.txt'), 'local edit\n');
    const expectedStatus = git(repo, [
      'status',
      '--porcelain=v1',
      '--untracked-files=no',
    ])
      .split('\n')
      .filter(Boolean)
      .sort();
    const receipts = disposable('verify-receipts-');
    const okScript = writeSource(repo, 'ok.cjs', 'process.exit(0);\n');
    const result = runScript('verify.ts', [
      '--cwd',
      repo,
      '--receipt-dir',
      receipts,
      '--exec',
      execArg('ok', ['node', okScript]),
    ]);
    expect(result.status).toBe(0);
    const receipt = readReceipt(receipts);
    expect(receipt.trackedStatusAtStart).toEqual(expectedStatus);
    expect(receipt.trackedStatusAtStart.join('\n')).toContain('tracked.txt');
    expect(receipt.pristineHead).toBe(false);
    expect(receipt.validationLabel).toBe('not-pristine-head');
    expect(receipt.cwd).toBe(repo);
  });

  it('records a revision that changes during verification', () => {
    const repo = initRepo();
    const before = git(repo, ['rev-parse', 'HEAD']).trim();
    const receipts = disposable('verify-receipts-');
    const mutate = writeSource(
      repo,
      'mutate.cjs',
      [
        "const { execFileSync } = require('node:child_process');",
        "execFileSync('git', ['commit', '--allow-empty', '-m', 'during verify'], { stdio: 'inherit' });",
        '',
      ].join('\n'),
    );
    const result = runScript('verify.ts', [
      '--cwd',
      repo,
      '--receipt-dir',
      receipts,
      '--exec',
      execArg('mutate', ['node', mutate]),
    ]);
    expect(result.status).toBe(0);
    const after = git(repo, ['rev-parse', 'HEAD']).trim();
    const receipt = readReceipt(receipts);
    expect(receipt.commitAtStart).toBe(before);
    expect(receipt.commitAtEnd).toBe(after);
    expect(receipt.commitAtStart).not.toBe(receipt.commitAtEnd);
    expect(receipt.revisionChanged).toBe(true);
    expect(receipt.pristineHead).toBe(false);
    expect(receipt.validationLabel).not.toBe('pristine-head');
  });

  it('identifies the exact head and runtime of a clean run without recording secrets', () => {
    const repo = initRepo();
    const head = git(repo, ['rev-parse', 'HEAD']).trim();
    const node = commandVersion(process.execPath, ['--version']);
    const npm = commandVersion('npm', ['--version']);
    const receipts = disposable('verify-receipts-');
    const okScript = writeSource(
      repo,
      'print-secret.cjs',
      'console.log(process.env.SUPER_SECRET_TOKEN || "");\n',
    );
    const secret = 's3cret-value-xyz';
    const result = runScript(
      'verify.ts',
      [
        '--cwd',
        repo,
        '--receipt-dir',
        receipts,
        '--exec',
        execArg('ok', ['node', okScript]),
      ],
      { env: { ...process.env, SUPER_SECRET_TOKEN: secret } },
    );
    expect(result.status).toBe(0);
    const receipt = readReceipt(receipts);
    const saved = JSON.stringify(receipt);
    expect(saved).not.toContain(secret);
    expect(receipt).not.toHaveProperty('env');
    expect(receipt).not.toHaveProperty('environment');
    expect(receipt.pristineHead).toBe(true);
    expect(receipt.validationLabel).toBe('pristine-head');
    expect(receipt.commitAtStart).toBe(head);
    expect(receipt.commitAtEnd).toBe(head);
    expect(receipt.revisionChanged).toBe(false);
    expect(receipt.trackedStateChanged).toBe(false);
    expect(receipt.trackedStatusAtStart).toEqual([]);
    expect(receipt.trackedStatusAtEnd).toEqual([]);
    expect(receipt.node).toBe(node);
    expect(receipt.npm).toBe(npm);
    expect(receipt.cwd).toBe(repo);
    expect(receipt.argv.some((arg) => arg.endsWith('verify.ts'))).toBe(true);
    expect(receipt.commands[0].argv).toEqual(['node', okScript]);
    expect(Number.isNaN(Date.parse(receipt.startedAt))).toBe(false);
    expect(Date.parse(receipt.endedAt)).toBeGreaterThanOrEqual(
      Date.parse(receipt.startedAt),
    );
    expect(Number.isNaN(Date.parse(receipt.commands[0].startedAt))).toBe(false);
    expect(Date.parse(receipt.commands[0].endedAt)).toBeGreaterThanOrEqual(
      Date.parse(receipt.commands[0].startedAt),
    );
  });
});
