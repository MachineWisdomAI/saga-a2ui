import { execFileSync, spawnSync } from 'node:child_process';

// Orchestrate established analyzers only; no custom source analysis or automatic fixing.
const args = process.argv.slice(2);
const workflowsOnly = args[0] === '--workflows';
if (workflowsOnly) args.shift();
let files = args;
let allInputs = args.length === 0;
try {
  if (args[0] === '--base') {
    const [, base, head = 'HEAD', ...options] = args;
    if (!base || options.some((option) => option !== '--merge-base'))
      throw new Error('Usage: npm run lint -- --base BASE HEAD [--merge-base]');
    files = execFileSync(
      'git',
      [
        'diff',
        '--no-renames',
        '--diff-filter=ACM',
        '--name-only',
        '-z',
        ...options,
        base,
        head,
        '--',
      ],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    // Analyzer configuration/dependency changes recheck their complete input set.
    if (
      files.some((file) =>
        [
          'eslint.config.mjs',
          'package.json',
          'package-lock.json',
          'scripts/lint.mjs',
        ].includes(file),
      )
    )
      allInputs = true;
  }
  if (allInputs)
    files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  const code = workflowsOnly
    ? []
    : files.filter((file) => /\.(?:[cm]?js|jsx|ts|tsx)$/.test(file));
  const workflows = files.filter(
    (file) =>
      (workflowsOnly || file.startsWith('.github/workflows/')) &&
      /\.ya?ml$/.test(file),
  );
  function analyze(name, command, parameters) {
    const start = performance.now();
    const result = spawnSync(command, parameters, {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    const failed =
      result.error ||
      result.signal ||
      result.status === null ||
      result.status > 1;
    if (failed) {
      const message = `${name} analyzer execution failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`;
      console.error(message);
      if (process.env.GITHUB_ACTIONS === 'true')
        console.log(
          `::warning::${name} analyzer execution failed; inspect the advisory job log.`,
        );
    }
    process.exitCode = Math.max(
      process.exitCode ?? 0,
      failed ? 2 : result.status,
    );
    console.log(
      `${name}: ${(performance.now() - start).toFixed(0)} ms; exit ${failed ? 2 : result.status}. Advisory output only.`,
    );
  }
  if (code.length)
    analyze('ESLint', process.execPath, [
      'node_modules/eslint/bin/eslint.js',
      '--no-warn-ignored',
      ...code,
    ]);
  if (workflows.length)
    analyze('actionlint', process.env.ACTIONLINT || 'actionlint', [
      '-shellcheck=',
      '-pyflakes=',
      ...workflows,
    ]);
  if (!code.length && !workflows.length)
    console.log('No relevant lint inputs; no analyzers started.');
} catch (error) {
  console.error(`Lint analyzer execution failed: ${error.message}`);
  process.exitCode = 2;
}
