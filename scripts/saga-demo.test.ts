import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDemoInto, startDownload } from './build-demo.js';
import { candidateVersion, repoRoot, sourceRevision } from './packed-consumer.js';
import { DEMO_TEMPLATE } from './qualified-starters.js';
import { templateDirectory } from './starter-template.js';
import { DEV_TOKENS } from '../apps/lit-host/src/mcp/dev-auth.js';

// `saga demo` as a developer runs it: the real command as its own process, building the real
// standalone demonstration (DEMO1) and writing it to a new directory. The command line, the
// refusals and the failure paths are covered with a stand-in build in saga.test.ts; here the
// contents are compared with what DEMO1's own exporter writes, the process is watched for anything
// it must not run, and real signals are sent while it builds and while it copies.

const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-demo-cli-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Every file below a directory, relative with forward slashes, sorted. */
const filesBelow = (directory: string): string[] =>
  fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort();

/** The first `npm` on the PATH, which the stand-in hands over to. */
function realNpm(): string {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    const candidate = path.join(directory, 'npm');
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('npm is not on the PATH');
}

interface Process {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Every package-manager invocation the run made, as `npm <arguments>`. */
  readonly invoked: string[];
  /** The demonstration build's scratch directories the run left in its private temporary directory (tools' own caches are not counted). */
  readonly leftover: string[];
}

/**
 * Runs `scripts/saga.ts` as a process with stand-ins for the package managers on the PATH. The
 * stand-in `npm` records its arguments and then runs the real one, because the build packs the
 * repository's own packages with it; the others only record, so any use of them shows. `onPack` is
 * shell run when `npm pack` is called, with `$PPID` the saga process.
 */
function runSaga(cwd: string, args: readonly string[], options: { readonly onPack?: string; readonly env?: Record<string, string> } = {}): Process {
  const bin = fs.mkdtempSync(path.join(root, 'bin-'));
  const scratch = fs.mkdtempSync(path.join(root, 'tmp-'));
  const marks = path.join(bin, 'invoked.log');
  fs.writeFileSync(
    path.join(bin, 'npm'),
    ['#!/bin/sh', `echo npm "$@" >> '${marks}'`, `if [ "$1" = pack ]; then ${options.onPack ?? 'true'}; fi`, `exec '${realNpm()}' "$@"`, ''].join('\n'),
    { mode: 0o755 },
  );
  for (const name of ['npx', 'pnpm', 'yarn']) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho ${name} "$@" >> '${marks}'\n`, { mode: 0o755 });
  const result = spawnSync(tsx, [path.join(repoRoot, 'scripts', 'saga.ts'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, TMPDIR: scratch, ...options.env },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    invoked: fs.existsSync(marks) ? fs.readFileSync(marks, 'utf8').split('\n').filter(Boolean) : [],
    leftover: fs.readdirSync(scratch).filter((name) => name.startsWith('saga-demo-')),
  };
}

/** Only packing and asking the version: never an install, an `npx` or another package manager. */
const onlyPacking = (invoked: readonly string[]): boolean => invoked.every((line) => /^npm (pack |--version$)/.test(line));

let cwd: string;
let created: string;
let run: Process;
let reference: string;
let referenceManifest: Record<string, any>;

beforeAll(async () => {
  cwd = fs.mkdtempSync(path.join(root, 'case-'));
  run = runSaga(cwd, ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'my-demo']);
  created = path.join(cwd, 'my-demo');
  // What DEMO1's own exporter writes for this checkout, to compare with.
  reference = path.join(root, 'reference');
  referenceManifest = (await buildDemoInto(reference)) as Record<string, any>;
}, 300_000);

describe('the created demonstration', () => {
  it('is made by one run that installs and executes nothing of its own, and says what it is', () => {
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(onlyPacking(run.invoked), run.invoked.join('\n')).toBe(true);
    expect(run.invoked.length).toBeGreaterThan(0);
    expect(run.stdout).toMatch(/local-only/i);
    for (const step of ['cd my-demo', 'npm install --omit=dev', 'npm start']) expect(run.stdout).toContain(step);
    // The scratch directory the build used is given up again.
    expect(run.leftover).toEqual([]);
  });

  // The bundle locates the scratch directory it was built in (a path relative to the working
  // directory) inside its `//#region` comments, so two builds of one revision differ in those comments,
  // in the digest of that file and nowhere else.
  const withoutScratchName = (text: string): string => text.replaceAll(/^\/\/#region \S*saga-demo-[A-Za-z0-9]{6}\//gm, '//#region SCRATCH/');

  it('is exactly the DEMO1 download: the same files, the same bytes but for the scratch directory the bundle names', () => {
    expect(filesBelow(created)).toEqual(filesBelow(reference));
    expect(filesBelow(created)).toEqual(
      ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'release.json', 'server.mjs', 'views/episode.html', 'views/host.html', 'views/notes.html', 'views/playback.html', 'views/subscriptions.html'].sort(),
    );
    for (const file of filesBelow(created).filter((one) => one !== 'server.mjs' && one !== 'release.json')) {
      expect(sha256(path.join(created, file)), file).toBe(sha256(path.join(reference, file)));
    }
    const text = (directory: string, file: string): string => withoutScratchName(fs.readFileSync(path.join(directory, file), 'utf8'));
    expect(text(created, 'server.mjs')).toBe(text(reference, 'server.mjs'));
    const release = (directory: string): Record<string, any> => {
      const { files, ...rest } = JSON.parse(fs.readFileSync(path.join(directory, 'release.json'), 'utf8')) as Record<string, any>;
      const { 'server.mjs': _server, ...others } = files as Record<string, string>;
      return { ...rest, files: others };
    };
    expect(release(created)).toEqual(release(reference));
  });

  it('matches the release it names: this checkout, the qualified pair and the digest of every file', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(created, 'release.json'), 'utf8')) as Record<string, any>;
    const { commit, dirty } = sourceRevision();

    expect(manifest.sourceCommit).toBe(commit);
    expect(manifest.candidate.version).toBe(candidateVersion(commit, dirty));
    expect(manifest.candidate.packedTarballSha256).toEqual(referenceManifest.candidate.packedTarballSha256);
    expect(manifest.pair).toMatchObject({ template: `templates/${DEMO_TEMPLATE}`, stack: 'lit-mcp', server: 'node' });
    expect(Object.keys(manifest.files).sort()).toEqual(filesBelow(created).filter((file) => file === 'server.mjs' || file.startsWith('views/')));
    for (const [file, digest] of Object.entries<string>(manifest.files)) expect(sha256(path.join(created, file)), file).toBe(digest);
    expect(run.stdout).toContain(manifest.candidate.version);
  });

  it('carries no installed dependency, lockfile or lifecycle hook, and declares only registry packages', () => {
    expect(filesBelow(created).filter((file) => /node_modules|package-lock/.test(file))).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(path.join(created, 'package.json'), 'utf8')) as { scripts: Record<string, string>; dependencies: Record<string, string> };
    expect(manifest.scripts).toEqual({ start: 'node server.mjs' });
    for (const range of Object.values(manifest.dependencies)) expect(range).not.toMatch(/^(file|link|workspace|git|https?):|^[./~]/);
  });

  it('keeps its synthetic identity and data inside itself, out of a starter made beside it', () => {
    expect(fs.readFileSync(path.join(created, 'server.mjs'), 'utf8')).toContain('Synthetic Creator');

    const starter = runSaga(cwd, ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'my-starter']);
    expect(starter.status).toBe(0);
    expect(starter.invoked).toEqual([]);
    for (const file of filesBelow(path.join(cwd, 'my-starter'))) {
      const text = fs.readFileSync(path.join(cwd, 'my-starter', file), 'utf8');
      expect(text, `${file} must not carry a demonstration credential`).not.toContain(DEV_TOKENS.alice);
      expect(text, `${file} must not carry demonstration data`).not.toContain('Synthetic Creator');
    }
    // And the maintained template, the source of the starter, is as it was.
    for (const file of filesBelow(templateDirectory(DEMO_TEMPLATE))) expect(fs.readFileSync(path.join(templateDirectory(DEMO_TEMPLATE), file), 'utf8'), file).not.toContain('Synthetic Creator');
  });
});

describe('refusals and interruptions of the real command', () => {
  it('refuses an unsupported pair, an existing target and a symbolic link without building or running anything', () => {
    const workspace = fs.mkdtempSync(path.join(root, 'case-'));
    fs.mkdirSync(path.join(workspace, 'taken'));
    fs.writeFileSync(path.join(workspace, 'taken', 'mine.txt'), 'mine');
    fs.symlinkSync(path.join(workspace, 'nothing-here'), path.join(workspace, 'dangling'));

    const unsupported = runSaga(workspace, ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'hapi', 'fresh']);
    const taken = runSaga(workspace, ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'taken']);
    const link = runSaga(workspace, ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'dangling']);

    expect(unsupported.status).toBe(1);
    expect(unsupported.stderr).toContain('--a2ui-stack lit-mcp --server node');
    expect(taken.status).toBe(1);
    expect(taken.stderr).toMatch(/already exists/);
    expect(link.status).toBe(1);
    expect([...unsupported.invoked, ...taken.invoked, ...link.invoked]).toEqual([]);
    expect(fs.readdirSync(workspace).sort()).toEqual(['dangling', 'taken']);
    expect(fs.readdirSync(path.join(workspace, 'taken'))).toEqual(['mine.txt']);
    expect(fs.existsSync(path.join(workspace, 'nothing-here'))).toBe(false);
  }, 60_000);

  // A real signal, as a terminal or a supervisor sends it; not SIGKILL, which no process can handle.
  it.each(['SIGINT', 'SIGTERM'] as const)('exits as interrupted, leaves no scratch directory and creates nothing when a real %s arrives while it builds', (name) => {
    const workspace = fs.mkdtempSync(path.join(root, 'case-'));
    fs.mkdirSync(path.join(workspace, 'neighbour'));
    fs.writeFileSync(path.join(workspace, 'neighbour', 'keep.txt'), 'mine');

    const interrupted = runSaga(workspace, ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'], { onPack: `kill -${name.slice(3)} $PPID` });

    expect(interrupted.status).toBe(130);
    expect(interrupted.stdout).toBe('');
    expect(interrupted.stderr).toMatch(/interrupted before anything was written/);
    expect(onlyPacking(interrupted.invoked)).toBe(true);
    expect(interrupted.leftover).toEqual([]);
    expect(fs.readdirSync(workspace)).toEqual(['neighbour']);
    expect(fs.readdirSync(path.join(workspace, 'neighbour'))).toEqual(['keep.txt']);
  }, 120_000);

  it.each(['SIGINT', 'SIGTERM'] as const)('exits as interrupted and removes its own directory when a real %s arrives during the copy, leaving the neighbours alone', (name) => {
    const workspace = fs.mkdtempSync(path.join(root, 'case-'));
    fs.mkdirSync(path.join(workspace, 'neighbour'));
    fs.writeFileSync(path.join(workspace, 'neighbour', 'keep.txt'), 'mine');
    // The process signals itself on its third write into the new directory, so the timing is exact.
    const preload = path.join(fs.mkdtempSync(path.join(root, 'preload-')), 'signal-on-nth-write.mjs');
    fs.writeFileSync(
      preload,
      [
        "import fs from 'node:fs';",
        'const write = fs.writeFileSync;',
        'let writes = 0;',
        'fs.writeFileSync = function (file, ...rest) {',
        '  const result = write.call(this, file, ...rest);',
        "  if (typeof file === 'string' && file.includes(process.env.SAGA_TEST_UNDER) && ++writes === Number(process.env.SAGA_TEST_NTH)) process.kill(process.pid, process.env.SAGA_TEST_SIGNAL);",
        '  return result;',
        '};',
        '',
      ].join('\n'),
    );

    const interrupted = runSaga(workspace, ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'], {
      env: { NODE_OPTIONS: `--import ${pathToFileURL(preload).href}`, SAGA_TEST_UNDER: path.join(fs.realpathSync(workspace), 'app', path.sep), SAGA_TEST_NTH: '3', SAGA_TEST_SIGNAL: name },
    });

    expect(interrupted.status).toBe(130);
    expect(interrupted.stdout).toBe('');
    expect(interrupted.stderr).toMatch(/interrupted/);
    expect(onlyPacking(interrupted.invoked)).toBe(true);
    expect(interrupted.leftover).toEqual([]);
    expect(fs.readdirSync(workspace)).toEqual(['neighbour']);
    expect(fs.readdirSync(path.join(workspace, 'neighbour'))).toEqual(['keep.txt']);
  }, 120_000);
});

describe('the created demonstration, run', () => {
  it('starts from the created files alone and announces that it is local-only', async () => {
    // Last, because starting it links the installed packages into the directory, as an install would.
    const running = await startDownload(created);
    try {
      expect(running.output()).toContain('LOCAL DEMONSTRATION ONLY');
      expect(await (await fetch(running.hostUrl)).text()).toContain('LOCAL DEMONSTRATION ONLY');
    } finally {
      await running.stop();
    }
  }, 60_000);
});
