import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_PAIRS, runCli } from './saga.js';
import { repoRoot } from './packed-consumer.js';
import { readTemplateMetadata, templateDirectory, templateFiles } from './starter-template.js';

// `saga init` as a developer runs it: the command line in, a new project directory or a refusal
// out. The export itself (stamping, markers, snippets) is covered by starter-template.test.ts and
// the exported starter's behavior by starter.test.ts; these cases cover what only the command owns:
// which pairs it offers, what it refuses without writing, what it prints, and what it leaves behind
// when it is interrupted.

const SDK_VERSION = '0.0.0-candidate.g0123456789ab';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-init-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

/** A fresh working directory that holds whatever a case already has on disk. */
const workspace = (): string => fs.mkdtempSync(path.join(root, 'case-'));

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function saga(cwd: string, args: readonly string[], signal?: AbortSignal): Run {
  let out = '';
  let err = '';
  const code = runCli(args, { cwd, sdkVersion: () => SDK_VERSION, stdout: (text) => (out += text), stderr: (text) => (err += text), signal });
  return { code, out, err };
}

const init = (cwd: string, directory: string, stack = 'lit-mcp', server = 'node'): Run => saga(cwd, ['init', '--a2ui-stack', stack, '--server', server, directory]);

/** Everything under a directory, so a case can show that a refusal left the disk as it was. */
function snapshot(directory: string): Record<string, string | null> {
  const found: Record<string, string | null> = {};
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(directory, full);
      if (entry.isSymbolicLink()) found[relative] = `-> ${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) {
        found[relative] = null;
        walk(full);
      } else found[relative] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(directory);
  return found;
}

const LIFECYCLE_HOOKS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'preprepare', 'postprepare'];

describe('saga init for the qualified pair', () => {
  it('creates the starter in a new directory, pinned to the SDK build, and says what to run next', () => {
    const cwd = workspace();
    const run = init(cwd, 'my-app');

    expect(run.code).toBe(0);
    expect(run.err).toBe('');
    const created = path.join(cwd, 'my-app');
    const template = templateDirectory('lit-node');
    expect(Object.keys(snapshot(created)).filter((file) => fs.statSync(path.join(created, file)).isFile()).sort()).toEqual(templateFiles(template));
    const manifest = JSON.parse(fs.readFileSync(path.join(created, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; scripts: Record<string, string> };
    for (const sdk of readTemplateMetadata(template).sdkPackages) expect(manifest.dependencies[`@saga-a2ui/${sdk}`]).toBe(SDK_VERSION);
    expect(run.out).toContain(SDK_VERSION);
    for (const step of ['cd my-app', 'npm install', 'npm run build', 'npm start']) expect(run.out).toContain(step);
    // The build is a private candidate: the output must not suggest that a registry install will find it.
    expect(run.out).toMatch(/not published/i);
  });

  it('writes no installed dependencies, lockfile, hook, demonstration or maintenance file', () => {
    const cwd = workspace();
    expect(init(cwd, 'clean').code).toBe(0);

    const files = Object.keys(snapshot(path.join(cwd, 'clean')));
    expect(files.filter((file) => /node_modules|package-lock|fixtures|template\.json|^demo/.test(file))).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'clean', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const hook of LIFECYCLE_HOOKS) expect(manifest.scripts[hook], hook).toBeUndefined();
  });

  it('accepts a path with spaces and shows a command that can be pasted', () => {
    const cwd = workspace();
    const run = init(cwd, 'my app');

    expect(run.code).toBe(0);
    expect(fs.existsSync(path.join(cwd, 'my app', 'package.json'))).toBe(true);
    expect(run.out).toContain("cd 'my app'");
  });
});

describe('the pairs it offers', () => {
  it('lists only pairs whose template really is that stack and server', () => {
    expect(SUPPORTED_PAIRS.length).toBeGreaterThan(0);
    for (const pair of SUPPORTED_PAIRS) {
      const metadata = readTemplateMetadata(templateDirectory(pair.template));
      expect({ stack: metadata.stack, server: metadata.server }, pair.template).toEqual({ stack: pair.stack, server: pair.server });
    }
  });

  it.each([
    ['another server for the qualified stack', 'lit-mcp', 'express'],
    ['another stack on the qualified server', 'react-mcp', 'node'],
    ['a stack without its delivery', 'lit', 'node'],
    ['a stack that names no renderer', 'mcp', 'node'],
    ['a server that is only a path', 'lit-mcp', '../node'],
  ])('refuses %s without writing and lists the supported pairs', (_name, stack, server) => {
    const cwd = workspace();
    fs.writeFileSync(path.join(cwd, 'mine.txt'), 'mine');
    const before = snapshot(cwd);

    const run = init(cwd, 'app', stack, server);

    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toContain(`${stack}`);
    for (const pair of SUPPORTED_PAIRS) expect(run.err).toContain(`--a2ui-stack ${pair.stack} --server ${pair.server}`);
    expect(snapshot(cwd)).toEqual(before);
  });

  it('prints the supported pairs for --help and writes nothing', () => {
    const cwd = workspace();
    const run = saga(cwd, ['--help']);

    expect(run.code).toBe(0);
    for (const pair of SUPPORTED_PAIRS) expect(run.out).toContain(`--a2ui-stack ${pair.stack} --server ${pair.server}`);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });
});

describe('a command line it cannot understand', () => {
  it.each([
    ['no command', []],
    ['an unknown command', ['build', 'app']],
    ['no stack', ['init', '--server', 'node', 'app']],
    ['no server', ['init', '--a2ui-stack', 'lit-mcp', 'app']],
    ['no directory', ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node']],
    ['two directories', ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'one', 'two']],
    ['an unknown option', ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', '--install', 'app']],
    ['an option without its value', ['init', '--a2ui-stack', 'lit-mcp', '--server']],
  ])('exits with a usage error for %s, shows the supported pairs and writes nothing', (_name, args) => {
    const cwd = workspace();
    const run = saga(cwd, args);

    expect(run.code).toBe(2);
    expect(run.out).toBe('');
    expect(run.err).toContain('Usage: saga init');
    for (const pair of SUPPORTED_PAIRS) expect(run.err).toContain(`--a2ui-stack ${pair.stack} --server ${pair.server}`);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });
});

describe('a target it must not touch', () => {
  it('refuses a directory that exists and leaves everything in it as it was', () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'app', 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'app', 'package.json'), '{"name":"mine"}');
    fs.writeFileSync(path.join(cwd, 'app', 'src', 'index.ts'), 'mine');
    const before = snapshot(cwd);

    const run = init(cwd, 'app');

    expect(run.code).toBe(1);
    expect(run.err).toMatch(/already exists/);
    expect(snapshot(cwd)).toEqual(before);
  });

  it('refuses an existing file', () => {
    const cwd = workspace();
    fs.writeFileSync(path.join(cwd, 'app'), 'mine');

    expect(init(cwd, 'app').code).toBe(1);
    expect(fs.readFileSync(path.join(cwd, 'app'), 'utf8')).toBe('mine');
  });

  it('refuses a symbolic link, whether it points at a directory, at a file or at nothing, and writes through none of them', () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'elsewhere'));
    fs.writeFileSync(path.join(cwd, 'elsewhere', 'keep.txt'), 'mine');
    fs.writeFileSync(path.join(cwd, 'a-file'), 'mine');
    fs.symlinkSync(path.join(cwd, 'elsewhere'), path.join(cwd, 'to-directory'));
    fs.symlinkSync(path.join(cwd, 'a-file'), path.join(cwd, 'to-file'));
    fs.symlinkSync(path.join(cwd, 'nothing-here'), path.join(cwd, 'dangling'));
    const before = snapshot(cwd);

    for (const link of ['to-directory', 'to-file', 'dangling']) {
      const run = init(cwd, link);
      expect(run.code, link).toBe(1);
      expect(run.err, link).toMatch(/already exists|symbolic link/);
    }
    expect(snapshot(cwd)).toEqual(before);
    expect(fs.existsSync(path.join(cwd, 'nothing-here'))).toBe(false);
  });

  it('creates the new directory where a symbolic-linked parent really is', () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'real'));
    fs.symlinkSync(path.join(cwd, 'real'), path.join(cwd, 'linked'));

    expect(init(cwd, 'linked/app').code).toBe(0);
    expect(fs.existsSync(path.join(cwd, 'real', 'app', 'package.json'))).toBe(true);
  });

  it('does not create missing parent directories, and refuses a parent that is not a directory', () => {
    const cwd = workspace();
    fs.writeFileSync(path.join(cwd, 'file'), 'mine');
    const before = snapshot(cwd);

    const missing = init(cwd, 'no/such/parent/app');
    const notADirectory = init(cwd, 'file/app');

    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/parent directory/);
    expect(notADirectory.code).toBe(1);
    expect(snapshot(cwd)).toEqual(before);
  });
});

describe('a copy that does not finish', () => {
  it('removes what this run created, and nothing beside it, when a write fails part-way', () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'neighbour'));
    fs.writeFileSync(path.join(cwd, 'neighbour', 'keep.txt'), 'mine');
    const before = snapshot(cwd);
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      writes += 1;
      if (writes === 4) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      return write(...args);
    });

    const run = init(cwd, 'app');

    expect(writes).toBeGreaterThanOrEqual(4);
    expect(run.code).toBe(1);
    expect(run.err).toContain('no space left');
    expect(snapshot(cwd)).toEqual(before);
  });

  it('removes its own output and exits as interrupted when the interrupt arrives during the copy, leaving the neighbours alone', () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'neighbour'));
    fs.writeFileSync(path.join(cwd, 'neighbour', 'keep.txt'), 'mine');
    const before = snapshot(cwd);
    const interrupt = new AbortController();
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
      writes += 1;
      if (writes === 4) interrupt.abort();
      return write(...args);
    });

    const run = saga(cwd, ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'], interrupt.signal);

    expect(run.code).toBe(130);
    expect(run.out).toBe('');
    expect(snapshot(cwd)).toEqual(before);
  });

  it('writes nothing when it was interrupted before it started', () => {
    const cwd = workspace();
    const interrupt = new AbortController();
    interrupt.abort();

    expect(saga(cwd, ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'], interrupt.signal).code).toBe(130);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });
});

describe('the command as a process', () => {
  const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

  function runProcess(cwd: string, args: readonly string[]): { status: number | null; stdout: string; stderr: string; invoked: string[] } {
    // Stand-ins for the package manager and npx: if init ever ran either, they would leave a mark.
    const bin = fs.mkdtempSync(path.join(root, 'bin-'));
    const marks = path.join(bin, 'invoked.log');
    for (const name of ['npm', 'npx', 'pnpm', 'yarn']) {
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho ${name} "$@" >> '${marks}'\n`, { mode: 0o755 });
    }
    const result = spawnSync(tsx, [path.join(repoRoot, 'scripts', 'saga.ts'), ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, invoked: fs.existsSync(marks) ? fs.readFileSync(marks, 'utf8').split('\n').filter(Boolean) : [] };
  }

  it('creates the project from the checkout it runs from, stamped with that checkout\'s build, and runs no package manager', () => {
    const cwd = workspace();
    const run = runProcess(cwd, ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'fresh']);

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.invoked).toEqual([]);
    expect(fs.existsSync(path.join(cwd, 'fresh', 'node_modules'))).toBe(false);
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'fresh', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(manifest.dependencies['@saga-a2ui/core']).toMatch(/^0\.0\.0-candidate\.g[0-9a-f]{12}(\.dirty)?$/);
    expect(run.stdout).toContain(manifest.dependencies['@saga-a2ui/core']);
  });

  it('exits non-zero for an unsupported pair and an existing target, and writes nothing', () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'taken'));

    const unsupported = runProcess(cwd, ['init', '--a2ui-stack', 'lit-mcp', '--server', 'hapi', 'fresh']);
    const taken = runProcess(cwd, ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'taken']);

    expect(unsupported.status).toBe(1);
    expect(unsupported.stderr).toContain('--a2ui-stack lit-mcp --server node');
    expect(taken.status).toBe(1);
    expect(unsupported.invoked.concat(taken.invoked)).toEqual([]);
    expect(fs.readdirSync(cwd).sort()).toEqual(['taken']);
    expect(fs.readdirSync(path.join(cwd, 'taken'))).toEqual([]);
  });
});
