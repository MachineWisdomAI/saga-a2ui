import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  SUPPORTED_DEMO_PAIRS,
  SUPPORTED_PAIRS,
  runCli,
  type Environment,
} from './saga.js';
import { repoRoot } from './packed-consumer.js';
import { DEMO_TEMPLATE } from './qualified-starters.js';
import {
  readTemplateMetadata,
  templateDirectory,
  templateFiles,
} from './starter-template.js';

// `saga init` and `saga demo` as a developer runs them: the command line in, a new directory or a
// refusal out. The demonstration's own build is DEMO1's and is qualified through the command in
// saga-demo.test.ts; here a stand-in supplies a small built download, so these cases cover only what
// the command owns.
//
// For `init`: the command line in, a new project directory or a refusal out. The export itself (stamping, markers, snippets) is covered by starter-template.test.ts and
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

/** The download a stand-in build hands over: what the command copies, not what DEMO1 builds. */
const DOWNLOAD: Record<string, string> = {
  'server.mjs': '// the bundled demonstration server\n',
  'package.json':
    '{"name":"saga-lit-node-demo","scripts":{"start":"node server.mjs"}}\n',
  'release.json': '{"download":"saga-lit-node-demo"}\n',
  'views/host.html': '<!doctype html><title>host</title>\n',
};
const DOWNLOAD_SDK_VERSION = '0.0.0-candidate.gfedcba987654';

interface Staging {
  readonly stage: Environment['stageDemo'];
  /** How many builds were asked for, and how many of their results were given up again. */
  readonly staged: () => number;
  readonly disposed: () => number;
}

/** A stand-in for the demonstration build. By default it succeeds; `behavior` replaces what it does. */
function staging(
  behavior?: (signal: AbortSignal | undefined) => Promise<void>,
): Staging {
  let staged = 0;
  let disposed = 0;
  return {
    staged: () => staged,
    disposed: () => disposed,
    stage: async (signal) => {
      staged += 1;
      await behavior?.(signal);
      return {
        sdkVersion: DOWNLOAD_SDK_VERSION,
        files: Object.entries(DOWNLOAD).map(([file, text]) => ({
          path: file,
          content: () => text,
        })),
        dispose: () => void (disposed += 1),
      };
    },
  };
}

/** `init` builds nothing: a case that does not pass a stand-in fails if the command asks for a demonstration. */
const NO_DEMO: Staging = staging(() =>
  Promise.reject(new Error('this command must not build the demonstration')),
);

async function saga(
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
  demo: Staging = NO_DEMO,
): Promise<Run> {
  let out = '';
  let err = '';
  const code = await runCli(args, {
    cwd,
    sdkVersion: () => SDK_VERSION,
    stageDemo: demo.stage,
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
    signal,
  });
  return { code, out, err };
}

const init = (
  cwd: string,
  directory: string,
  stack = 'lit-mcp',
  server = 'node',
): Promise<Run> =>
  saga(cwd, ['init', '--a2ui-stack', stack, '--server', server, directory]);

/** Everything under a directory, so a case can show that a refusal left the disk as it was. */
function snapshot(directory: string): Record<string, string | null> {
  const found: Record<string, string | null> = {};
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(directory, full);
      if (entry.isSymbolicLink())
        found[relative] = `-> ${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) {
        found[relative] = null;
        walk(full);
      } else found[relative] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(directory);
  return found;
}

const LIFECYCLE_HOOKS = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'preprepare',
  'postprepare',
];

describe('saga init for the qualified pair', () => {
  it('creates the starter in a new directory, pinned to the SDK build, and says what to run next', async () => {
    const cwd = workspace();
    const run = await init(cwd, 'my-app');

    expect(run.code).toBe(0);
    expect(run.err).toBe('');
    const created = path.join(cwd, 'my-app');
    const template = templateDirectory('lit-node');
    expect(
      Object.keys(snapshot(created))
        .filter((file) => fs.statSync(path.join(created, file)).isFile())
        .sort(),
    ).toEqual(templateFiles(template));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(created, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    for (const sdk of readTemplateMetadata(template).sdkPackages)
      expect(manifest.dependencies[`@saga-a2ui/${sdk}`]).toBe(SDK_VERSION);
    expect(run.out).toContain(SDK_VERSION);
    for (const step of [
      'cd my-app',
      'npm install',
      'npm run build',
      'npm start',
    ])
      expect(run.out).toContain(step);
    // The build is a private candidate: the output must not suggest that a registry install will find it.
    expect(run.out).toMatch(/not published/i);
  });

  it('writes no installed dependencies, lockfile, hook, demonstration or maintenance file', async () => {
    const cwd = workspace();
    expect((await init(cwd, 'clean')).code).toBe(0);

    const files = Object.keys(snapshot(path.join(cwd, 'clean')));
    expect(
      files.filter((file) =>
        /node_modules|package-lock|fixtures|template\.json|^demo/.test(file),
      ),
    ).toEqual([]);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(cwd, 'clean', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    for (const hook of LIFECYCLE_HOOKS)
      expect(manifest.scripts[hook], hook).toBeUndefined();
  });

  it('accepts a path with spaces and shows a command that can be pasted', async () => {
    const cwd = workspace();
    const run = await init(cwd, 'my app');

    expect(run.code).toBe(0);
    expect(fs.existsSync(path.join(cwd, 'my app', 'package.json'))).toBe(true);
    expect(run.out).toContain("cd 'my app'");
  });
});

describe.each(SUPPORTED_PAIRS)('saga init for $stack on $server', (pair) => {
  it('creates exactly its maintained template, with its adapter and the SDK build pinned, and installs and runs nothing', async () => {
    const cwd = workspace();
    const run = await init(cwd, 'out', pair.stack, pair.server);

    expect(run.code, run.err).toBe(0);
    expect(run.err).toBe('');
    expect(run.out).toContain(
      `Created a ${pair.stack} starter on ${pair.server} in out`,
    );
    expect(run.out).toContain('Nothing was installed and no command was run.');
    const created = path.join(cwd, 'out');
    const template = templateDirectory(pair.template);
    const metadata = readTemplateMetadata(template);
    const files = Object.keys(snapshot(created))
      .filter((file) => fs.statSync(path.join(created, file)).isFile())
      .sort();
    expect(files).toEqual(templateFiles(template));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(created, 'package.json'), 'utf8'),
    ) as {
      name: string;
      dependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(manifest.name).toBe(`saga-${pair.template}-starter`);
    expect(manifest.dependencies[metadata.serverAdapter.package]).toBe(
      metadata.serverAdapter.version,
    );
    for (const sdk of metadata.sdkPackages)
      expect(manifest.dependencies[`@saga-a2ui/${sdk}`]).toBe(SDK_VERSION);
    for (const hook of LIFECYCLE_HOOKS)
      expect(manifest.scripts[hook], hook).toBeUndefined();
    expect(
      files.filter((file) =>
        /node_modules|package-lock|fixtures|template\.json|^demo/.test(file),
      ),
    ).toEqual([]);
  });
});

describe('the pairs it offers', () => {
  it('lists only pairs whose template really is that stack and server', () => {
    expect(SUPPORTED_PAIRS.length).toBeGreaterThan(0);
    for (const pair of SUPPORTED_PAIRS) {
      const metadata = readTemplateMetadata(templateDirectory(pair.template));
      expect(
        { stack: metadata.stack, server: metadata.server },
        pair.template,
      ).toEqual({ stack: pair.stack, server: pair.server });
    }
  });

  it('offers the five qualified servers for the stack, each on its own maintained template', () => {
    expect(
      SUPPORTED_PAIRS.map(
        (pair) => `${pair.stack} on ${pair.server} from ${pair.template}`,
      ),
    ).toEqual([
      'lit-mcp on node from lit-node',
      'lit-mcp on express from lit-express',
      'lit-mcp on fastify from lit-fastify',
      'lit-mcp on hono from lit-hono',
      'lit-mcp on hapi from lit-hapi',
    ]);
  });

  it.each([
    ['a server with no qualified starter', 'lit-mcp', 'koa'],
    ['a qualified server for an unqualified stack', 'react-mcp', 'express'],
    ['another stack on the qualified server', 'react-mcp', 'node'],
    ['a stack without its delivery', 'lit', 'node'],
    ['a stack that names no renderer', 'mcp', 'node'],
    ['a server that is only a path', 'lit-mcp', '../node'],
  ])(
    'refuses %s without writing and lists the supported pairs',
    async (_name, stack, server) => {
      const cwd = workspace();
      fs.writeFileSync(path.join(cwd, 'mine.txt'), 'mine');
      const before = snapshot(cwd);

      const run = await init(cwd, 'app', stack, server);

      expect(run.code).toBe(1);
      expect(run.out).toBe('');
      expect(run.err).toContain(`${stack}`);
      for (const pair of SUPPORTED_PAIRS)
        expect(run.err).toContain(
          `--a2ui-stack ${pair.stack} --server ${pair.server}`,
        );
      expect(snapshot(cwd)).toEqual(before);
    },
  );

  it('prints the supported pairs for --help and writes nothing', async () => {
    const cwd = workspace();
    const run = await saga(cwd, ['--help']);

    expect(run.code).toBe(0);
    for (const pair of SUPPORTED_PAIRS)
      expect(run.out).toContain(
        `--a2ui-stack ${pair.stack} --server ${pair.server}`,
      );
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
    [
      'two directories',
      ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'one', 'two'],
    ],
    [
      'an unknown option',
      [
        'init',
        '--a2ui-stack',
        'lit-mcp',
        '--server',
        'node',
        '--install',
        'app',
      ],
    ],
    [
      'an option without its value',
      ['init', '--a2ui-stack', 'lit-mcp', '--server'],
    ],
  ])(
    'exits with a usage error for %s, shows the supported pairs and writes nothing',
    async (_name, args) => {
      const cwd = workspace();
      const run = await saga(cwd, args);

      expect(run.code).toBe(2);
      expect(run.out).toBe('');
      expect(run.err).toContain('Usage: saga init');
      for (const pair of SUPPORTED_PAIRS)
        expect(run.err).toContain(
          `--a2ui-stack ${pair.stack} --server ${pair.server}`,
        );
      expect(fs.readdirSync(cwd)).toEqual([]);
    },
  );
});

describe('a target it must not touch', () => {
  it('refuses a directory that exists and leaves everything in it as it was', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'app', 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'app', 'package.json'), '{"name":"mine"}');
    fs.writeFileSync(path.join(cwd, 'app', 'src', 'index.ts'), 'mine');
    const before = snapshot(cwd);

    const run = await init(cwd, 'app');

    expect(run.code).toBe(1);
    expect(run.err).toMatch(/already exists/);
    expect(snapshot(cwd)).toEqual(before);
  });

  it('refuses an existing file', async () => {
    const cwd = workspace();
    fs.writeFileSync(path.join(cwd, 'app'), 'mine');

    expect((await init(cwd, 'app')).code).toBe(1);
    expect(fs.readFileSync(path.join(cwd, 'app'), 'utf8')).toBe('mine');
  });

  it('refuses a symbolic link, whether it points at a directory, at a file or at nothing, and writes through none of them', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'elsewhere'));
    fs.writeFileSync(path.join(cwd, 'elsewhere', 'keep.txt'), 'mine');
    fs.writeFileSync(path.join(cwd, 'a-file'), 'mine');
    fs.symlinkSync(path.join(cwd, 'elsewhere'), path.join(cwd, 'to-directory'));
    fs.symlinkSync(path.join(cwd, 'a-file'), path.join(cwd, 'to-file'));
    fs.symlinkSync(path.join(cwd, 'nothing-here'), path.join(cwd, 'dangling'));
    const before = snapshot(cwd);

    for (const link of ['to-directory', 'to-file', 'dangling']) {
      const run = await init(cwd, link);
      expect(run.code, link).toBe(1);
      expect(run.err, link).toMatch(/already exists|symbolic link/);
    }
    expect(snapshot(cwd)).toEqual(before);
    expect(fs.existsSync(path.join(cwd, 'nothing-here'))).toBe(false);
  });

  it('creates the new directory where a symbolic-linked parent really is', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'real'));
    fs.symlinkSync(path.join(cwd, 'real'), path.join(cwd, 'linked'));

    expect((await init(cwd, 'linked/app')).code).toBe(0);
    expect(fs.existsSync(path.join(cwd, 'real', 'app', 'package.json'))).toBe(
      true,
    );
  });

  it('does not create missing parent directories, and refuses a parent that is not a directory', async () => {
    const cwd = workspace();
    fs.writeFileSync(path.join(cwd, 'file'), 'mine');
    const before = snapshot(cwd);

    const missing = await init(cwd, 'no/such/parent/app');
    const notADirectory = await init(cwd, 'file/app');

    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/parent directory/);
    expect(notADirectory.code).toBe(1);
    expect(snapshot(cwd)).toEqual(before);
  });
});

describe('a copy that does not finish', () => {
  it('removes what this run created, and nothing beside it, when a write fails part-way', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'neighbour'));
    fs.writeFileSync(path.join(cwd, 'neighbour', 'keep.txt'), 'mine');
    const before = snapshot(cwd);
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(
      (...args: Parameters<typeof fs.writeFileSync>) => {
        writes += 1;
        if (writes === 4)
          throw Object.assign(new Error('ENOSPC: no space left on device'), {
            code: 'ENOSPC',
          });
        return write(...args);
      },
    );

    const run = await init(cwd, 'app');

    expect(writes).toBeGreaterThanOrEqual(4);
    expect(run.code).toBe(1);
    expect(run.err).toContain('no space left');
    expect(snapshot(cwd)).toEqual(before);
  });

  it('removes its own output and exits as interrupted when the interrupt arrives during the copy, leaving the neighbours alone', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'neighbour'));
    fs.writeFileSync(path.join(cwd, 'neighbour', 'keep.txt'), 'mine');
    const before = snapshot(cwd);
    const interrupt = new AbortController();
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(
      (...args: Parameters<typeof fs.writeFileSync>) => {
        writes += 1;
        if (writes === 4) interrupt.abort();
        return write(...args);
      },
    );

    const run = await saga(
      cwd,
      ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'],
      interrupt.signal,
    );

    expect(run.code).toBe(130);
    expect(run.out).toBe('');
    expect(snapshot(cwd)).toEqual(before);
  });

  it('writes nothing when it was interrupted before it started', async () => {
    const cwd = workspace();
    const interrupt = new AbortController();
    interrupt.abort();

    expect(
      (
        await saga(
          cwd,
          ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'],
          interrupt.signal,
        )
      ).code,
    ).toBe(130);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });
});

describe('an output path that is replaced while the copy runs', () => {
  /**
   * On the nth write into the new directory, moves that directory aside and puts a different one,
   * holding keep.txt, at the same path: what another process could do between two of our calls.
   * `fail` makes that write fail; otherwise it completes and the swap happens after it.
   */
  function replaceOnWrite(
    cwd: string,
    nth: number,
    fail: boolean,
    after?: () => void,
  ): { writes: () => number } {
    // The CLI writes under the real location of the working directory (newDirectoryTarget resolves
    // it), which differs from the lexical one where the temporary directory is a link (macOS /var).
    const target = path.join(fs.realpathSync(cwd), 'app');
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    let swapped = false;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(
      (...args: Parameters<typeof fs.writeFileSync>) => {
        if (swapped || !String(args[0]).startsWith(`${target}${path.sep}`))
          return write(...args);
        writes += 1;
        if (writes !== nth) return write(...args);
        swapped = true;
        const swap = (): void => {
          fs.renameSync(target, `${target}.moved`);
          fs.mkdirSync(target);
          write(path.join(target, 'keep.txt'), 'mine');
        };
        if (fail) {
          swap();
          throw Object.assign(new Error('ENOSPC: no space left on device'), {
            code: 'ENOSPC',
          });
        }
        const result = write(...args);
        swap();
        after?.();
        return result;
      },
    );
    return { writes: () => writes };
  }

  const replacementIsUntouched = (cwd: string): void => {
    expect(fs.readdirSync(path.join(cwd, 'app'))).toEqual(['keep.txt']);
    expect(fs.readFileSync(path.join(cwd, 'app', 'keep.txt'), 'utf8')).toBe(
      'mine',
    );
  };

  it('does not delete the replacement when a write then fails, and says the path was replaced', async () => {
    const cwd = workspace();
    const spy = replaceOnWrite(cwd, 4, true);

    const run = await init(cwd, 'app');

    expect(spy.writes()).toBe(4);
    expect(run.code).toBe(1);
    expect(run.err).toContain('no space left');
    expect(run.err).toMatch(/was replaced meanwhile/);
    replacementIsUntouched(cwd);
  });

  it('stops writing at the replaced path instead of carrying on into it', async () => {
    const cwd = workspace();
    const spy = replaceOnWrite(cwd, 4, false);

    const run = await init(cwd, 'app');

    expect(spy.writes()).toBe(4);
    expect(run.code).toBe(1);
    expect(run.err).toMatch(/was replaced/);
    expect(run.out).toBe('');
    replacementIsUntouched(cwd);
  });

  it('does not report success when the replacement comes after the last file', async () => {
    const cwd = workspace();
    const files = templateFiles(templateDirectory('lit-node')).length;
    replaceOnWrite(cwd, files, false);

    const run = await init(cwd, 'app');

    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    replacementIsUntouched(cwd);
  });

  it('does not delete the replacement when an interrupt arrives, and exits as interrupted', async () => {
    const cwd = workspace();
    const interrupt = new AbortController();
    replaceOnWrite(cwd, 4, false, () => interrupt.abort());

    const run = await saga(
      cwd,
      ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'],
      interrupt.signal,
    );

    expect(run.code).toBe(130);
    expect(run.err).toMatch(/replaced/);
    replacementIsUntouched(cwd);
  });
});

const demo = (
  cwd: string,
  directory: string,
  stack = 'lit-mcp',
  server = 'node',
  build: Staging = staging(),
): Promise<Run & { build: Staging }> =>
  saga(
    cwd,
    ['demo', '--a2ui-stack', stack, '--server', server, directory],
    undefined,
    build,
  ).then((run) => ({ ...run, build }));

/** What the command copied: every file below the directory, relative, with its text. */
const copied = (directory: string): Record<string, string> =>
  Object.fromEntries(
    Object.entries(snapshot(directory)).flatMap(
      ([file, text]): [string, string][] =>
        text === null ? [] : [[file, text]],
    ),
  );

describe('saga demo for the qualified pair', () => {
  it('creates the built demonstration, exactly its files, in a new directory and says what it is and what to run next', async () => {
    const cwd = workspace();
    const run = await demo(cwd, 'my-demo');

    expect(run.code).toBe(0);
    expect(run.err).toBe('');
    expect(copied(path.join(cwd, 'my-demo'))).toEqual(
      Object.fromEntries(
        Object.entries(DOWNLOAD).map(([file, text]) => [
          file.split('/').join(path.sep),
          text,
        ]),
      ),
    );
    expect(run.build.staged()).toBe(1);
    expect(run.build.disposed()).toBe(1);
    expect(run.out).toContain(DOWNLOAD_SDK_VERSION);
    expect(run.out).toMatch(/local-only/i);
    for (const step of ['cd my-demo', 'npm install --omit=dev', 'npm start'])
      expect(run.out).toContain(step);
    expect(run.out).toMatch(/nothing was installed/i);
  });

  it('accepts a path with spaces and shows a command that can be pasted', async () => {
    const cwd = workspace();
    const run = await demo(cwd, 'my demo');

    expect(run.code).toBe(0);
    expect(fs.existsSync(path.join(cwd, 'my demo', 'server.mjs'))).toBe(true);
    expect(run.out).toContain("cd 'my demo'");
  });

  it('keeps the demonstration out of a starter made beside it, and the starter out of the demonstration', async () => {
    const cwd = workspace();
    expect((await demo(cwd, 'demo-out')).code).toBe(0);
    expect((await init(cwd, 'starter-out')).code).toBe(0);

    const demonstration = Object.keys(copied(path.join(cwd, 'demo-out')));
    const starter = Object.keys(copied(path.join(cwd, 'starter-out')));
    expect(
      starter.filter(
        (file) => demonstration.includes(file) && file !== 'package.json',
      ),
    ).toEqual([]);
    expect(
      starter.filter((file) =>
        /fixtures|release\.json|server\.mjs|^views/.test(file),
      ),
    ).toEqual([]);
  });
});

describe('the demonstrations it offers', () => {
  it('are pairs the init command offers, on the one template the demonstration is built from', () => {
    const offered = SUPPORTED_DEMO_PAIRS.map(
      (pair) => `${pair.stack}/${pair.server}`,
    );
    expect(offered.length).toBeGreaterThan(0);
    for (const pair of SUPPORTED_DEMO_PAIRS) {
      expect(SUPPORTED_PAIRS, `${pair.stack} on ${pair.server}`).toContainEqual(
        pair,
      );
      expect(pair.template).toBe(DEMO_TEMPLATE);
    }
  });

  it.each([
    ['another server for the qualified stack', 'lit-mcp', 'express'],
    [
      'a server whose starter is qualified but whose demonstration is not built',
      'lit-mcp',
      'fastify',
    ],
    ['another stack on the qualified server', 'react-mcp', 'node'],
    ['a stack without its delivery', 'lit', 'node'],
    ['a server that is only a path', 'lit-mcp', '../node'],
  ])(
    'refuses %s before building anything, writes nothing and lists the supported demonstrations',
    async (_name, stack, server) => {
      const cwd = workspace();
      fs.writeFileSync(path.join(cwd, 'mine.txt'), 'mine');
      const before = snapshot(cwd);

      const run = await demo(cwd, 'app', stack, server);

      expect(run.code).toBe(1);
      expect(run.out).toBe('');
      expect(run.err).toContain(`${stack}`);
      for (const pair of SUPPORTED_DEMO_PAIRS)
        expect(run.err).toContain(
          `--a2ui-stack ${pair.stack} --server ${pair.server}`,
        );
      expect(run.build.staged()).toBe(0);
      expect(snapshot(cwd)).toEqual(before);
    },
  );

  it('shows the demonstrations beside the starters for --help', async () => {
    const run = await saga(workspace(), ['--help']);

    expect(run.code).toBe(0);
    expect(run.out).toContain('saga demo');
    for (const pair of SUPPORTED_DEMO_PAIRS)
      expect(run.out).toContain(
        `--a2ui-stack ${pair.stack} --server ${pair.server}`,
      );
  });
});

describe('a demo command line it cannot understand', () => {
  it.each([
    ['no stack', ['demo', '--server', 'node', 'app']],
    ['no server', ['demo', '--a2ui-stack', 'lit-mcp', 'app']],
    ['no directory', ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node']],
    [
      'two directories',
      ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'one', 'two'],
    ],
    [
      'an unknown option',
      [
        'demo',
        '--a2ui-stack',
        'lit-mcp',
        '--server',
        'node',
        '--install',
        'app',
      ],
    ],
    [
      'an option without its value',
      ['demo', '--a2ui-stack', 'lit-mcp', '--server'],
    ],
  ])(
    'exits with a usage error for %s, builds nothing and writes nothing',
    async (_name, args) => {
      const cwd = workspace();
      const build = staging();
      const run = await saga(cwd, args, undefined, build);

      expect(run.code).toBe(2);
      expect(run.out).toBe('');
      expect(run.err).toContain('Usage: saga init');
      expect(run.err).toContain('saga demo');
      expect(build.staged()).toBe(0);
      expect(fs.readdirSync(cwd)).toEqual([]);
    },
  );
});

describe('a target the demo must not touch', () => {
  it('refuses a directory that exists before building, and leaves everything in it as it was', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'app', 'src'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'app', 'server.mjs'), 'mine');
    fs.writeFileSync(path.join(cwd, 'app', 'src', 'index.ts'), 'mine');
    const before = snapshot(cwd);

    const run = await demo(cwd, 'app');

    expect(run.code).toBe(1);
    expect(run.err).toMatch(/already exists/);
    expect(run.build.staged()).toBe(0);
    expect(snapshot(cwd)).toEqual(before);
  });

  it('refuses an existing file', async () => {
    const cwd = workspace();
    fs.writeFileSync(path.join(cwd, 'app'), 'mine');

    const run = await demo(cwd, 'app');

    expect(run.code).toBe(1);
    expect(fs.readFileSync(path.join(cwd, 'app'), 'utf8')).toBe('mine');
  });

  it('refuses a symbolic link, whether it points at a directory, at a file or at nothing, and writes through none of them', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'elsewhere'));
    fs.writeFileSync(path.join(cwd, 'elsewhere', 'keep.txt'), 'mine');
    fs.writeFileSync(path.join(cwd, 'a-file'), 'mine');
    fs.symlinkSync(path.join(cwd, 'elsewhere'), path.join(cwd, 'to-directory'));
    fs.symlinkSync(path.join(cwd, 'a-file'), path.join(cwd, 'to-file'));
    fs.symlinkSync(path.join(cwd, 'nothing-here'), path.join(cwd, 'dangling'));
    const before = snapshot(cwd);
    const build = staging();

    for (const link of ['to-directory', 'to-file', 'dangling']) {
      const run = await demo(cwd, link, 'lit-mcp', 'node', build);
      expect(run.code, link).toBe(1);
      expect(run.err, link).toMatch(/already exists|symbolic link/);
    }
    expect(build.staged()).toBe(0);
    expect(snapshot(cwd)).toEqual(before);
    expect(fs.existsSync(path.join(cwd, 'nothing-here'))).toBe(false);
  });

  it('refuses a target that appears while the demonstration is being built, and keeps what appeared', async () => {
    const cwd = workspace();
    const build = staging(async () => {
      fs.mkdirSync(path.join(cwd, 'app'));
      fs.writeFileSync(path.join(cwd, 'app', 'keep.txt'), 'mine');
    });

    const run = await demo(cwd, 'app', 'lit-mcp', 'node', build);

    expect(run.code).toBe(1);
    expect(run.err).toMatch(/already exists/);
    expect(run.out).toBe('');
    expect(fs.readdirSync(path.join(cwd, 'app'))).toEqual(['keep.txt']);
    expect(build.disposed()).toBe(1);
  });

  it('creates the new directory where a symbolic-linked parent really is', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'real'));
    fs.symlinkSync(path.join(cwd, 'real'), path.join(cwd, 'linked'));

    expect((await demo(cwd, 'linked/app')).code).toBe(0);
    expect(fs.existsSync(path.join(cwd, 'real', 'app', 'server.mjs'))).toBe(
      true,
    );
  });

  it('does not create missing parent directories, and refuses a parent that is not a directory, before building', async () => {
    const cwd = workspace();
    fs.writeFileSync(path.join(cwd, 'file'), 'mine');
    const before = snapshot(cwd);
    const build = staging();

    const missing = await demo(
      cwd,
      'no/such/parent/app',
      'lit-mcp',
      'node',
      build,
    );
    const notADirectory = await demo(cwd, 'file/app', 'lit-mcp', 'node', build);

    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/parent directory/);
    expect(notADirectory.code).toBe(1);
    expect(build.staged()).toBe(0);
    expect(snapshot(cwd)).toEqual(before);
  });
});

describe('a demonstration that does not finish', () => {
  it('reports a build that fails, writes nothing and gives the build up', async () => {
    const cwd = workspace();
    const build = staging(() =>
      Promise.reject(
        new Error('the demonstration build failed: vite exploded'),
      ),
    );

    const run = await demo(cwd, 'app', 'lit-mcp', 'node', build);

    expect(run.code).toBe(1);
    expect(run.err).toContain('vite exploded');
    expect(run.out).toBe('');
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  it('removes what this run created, and nothing beside it, when a write fails part-way, and gives the build up', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'neighbour'));
    fs.writeFileSync(path.join(cwd, 'neighbour', 'keep.txt'), 'mine');
    const before = snapshot(cwd);
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(
      (...args: Parameters<typeof fs.writeFileSync>) => {
        writes += 1;
        if (writes === 3)
          throw Object.assign(new Error('ENOSPC: no space left on device'), {
            code: 'ENOSPC',
          });
        return write(...args);
      },
    );

    const run = await demo(cwd, 'app');

    expect(writes).toBeGreaterThanOrEqual(3);
    expect(run.code).toBe(1);
    expect(run.err).toContain('no space left');
    expect(run.out).toBe('');
    expect(run.build.disposed()).toBe(1);
    expect(snapshot(cwd)).toEqual(before);
  });

  it('writes nothing and builds nothing when it was interrupted before it started', async () => {
    const cwd = workspace();
    const interrupt = new AbortController();
    interrupt.abort();
    const build = staging();

    const run = await saga(
      cwd,
      ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'],
      interrupt.signal,
      build,
    );

    expect(run.code).toBe(130);
    expect(build.staged()).toBe(0);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  it('exits as interrupted without creating anything when the interrupt arrives while the demonstration is being built', async () => {
    const cwd = workspace();
    const interrupt = new AbortController();
    const build = staging(async (signal) => {
      interrupt.abort();
      signal?.throwIfAborted();
    });

    const run = await saga(
      cwd,
      ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'],
      interrupt.signal,
      build,
    );

    expect(run.code).toBe(130);
    expect(run.out).toBe('');
    expect(run.err).toMatch(/interrupted before anything was written/);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  it('exits as interrupted when the interrupt arrives after the build but before the first file, and gives the build up', async () => {
    const cwd = workspace();
    const interrupt = new AbortController();
    const build = staging(async () => interrupt.abort());

    const run = await saga(
      cwd,
      ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'],
      interrupt.signal,
      build,
    );

    expect(run.code).toBe(130);
    expect(run.out).toBe('');
    expect(build.disposed()).toBe(1);
    expect(fs.readdirSync(cwd)).toEqual([]);
  });

  it('removes its own output and exits as interrupted when the interrupt arrives during the copy, leaving the neighbours alone', async () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'neighbour'));
    fs.writeFileSync(path.join(cwd, 'neighbour', 'keep.txt'), 'mine');
    const before = snapshot(cwd);
    const interrupt = new AbortController();
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(
      (...args: Parameters<typeof fs.writeFileSync>) => {
        writes += 1;
        if (writes === 2) interrupt.abort();
        return write(...args);
      },
    );
    const build = staging();

    const run = await saga(
      cwd,
      ['demo', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'],
      interrupt.signal,
      build,
    );

    expect(run.code).toBe(130);
    expect(run.out).toBe('');
    expect(build.disposed()).toBe(1);
    expect(snapshot(cwd)).toEqual(before);
  });

  it('does not delete a replacement that appears at the output path during the copy, and does not report success', async () => {
    const cwd = workspace();
    const target = path.join(fs.realpathSync(cwd), 'app');
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(
      (...args: Parameters<typeof fs.writeFileSync>) => {
        if (!String(args[0]).startsWith(`${target}${path.sep}`))
          return write(...args);
        writes += 1;
        if (writes !== 2) return write(...args);
        fs.renameSync(target, `${target}.moved`);
        fs.mkdirSync(target);
        write(path.join(target, 'keep.txt'), 'mine');
        return write(...args);
      },
    );

    const run = await demo(cwd, 'app');

    expect(run.code).toBe(1);
    expect(run.out).toBe('');
    expect(run.err).toMatch(/was replaced/);
    expect(fs.readdirSync(path.join(cwd, 'app'))).toEqual(
      expect.arrayContaining(['keep.txt']),
    );
    expect(fs.readFileSync(path.join(cwd, 'app', 'keep.txt'), 'utf8')).toBe(
      'mine',
    );
  });
});

describe('the command as a process', () => {
  const tsx = path.join(repoRoot, 'node_modules', '.bin', 'tsx');

  function runProcess(
    cwd: string,
    args: readonly string[],
    extraEnv: Record<string, string> = {},
  ): {
    status: number | null;
    stdout: string;
    stderr: string;
    invoked: string[];
  } {
    // Stand-ins for the package manager and npx: if init ever ran either, they would leave a mark.
    const bin = fs.mkdtempSync(path.join(root, 'bin-'));
    const marks = path.join(bin, 'invoked.log');
    for (const name of ['npm', 'npx', 'pnpm', 'yarn']) {
      fs.writeFileSync(
        path.join(bin, name),
        `#!/bin/sh\necho ${name} "$@" >> '${marks}'\n`,
        { mode: 0o755 },
      );
    }
    const result = spawnSync(
      tsx,
      [path.join(repoRoot, 'scripts', 'saga.ts'), ...args],
      {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
          ...extraEnv,
        },
      },
    );
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      invoked: fs.existsSync(marks)
        ? fs.readFileSync(marks, 'utf8').split('\n').filter(Boolean)
        : [],
    };
  }

  it("creates the project from the checkout it runs from, stamped with that checkout's build, and runs no package manager", () => {
    const cwd = workspace();
    const run = runProcess(cwd, [
      'init',
      '--a2ui-stack',
      'lit-mcp',
      '--server',
      'node',
      'fresh',
    ]);

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.invoked).toEqual([]);
    expect(fs.existsSync(path.join(cwd, 'fresh', 'node_modules'))).toBe(false);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(cwd, 'fresh', 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies['@saga-a2ui/core']).toMatch(
      /^0\.0\.0-candidate\.g[0-9a-f]{12}(\.dirty)?$/,
    );
    expect(run.stdout).toContain(manifest.dependencies['@saga-a2ui/core']);
  });

  // A real signal, as a terminal or a supervisor sends it. A callback for it cannot run while the
  // copy is synchronous, which an AbortController.abort() inside a mock hides. The preload makes the
  // process signal itself on its nth write into the new directory (so the timing is exact); it is
  // not SIGKILL, which no process can handle.
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'exits as interrupted and removes its own directory when a real %s arrives during the copy',
    (name) => {
      const cwd = workspace();
      fs.mkdirSync(path.join(cwd, 'neighbour'));
      fs.writeFileSync(path.join(cwd, 'neighbour', 'keep.txt'), 'mine');
      const before = snapshot(cwd);
      const preload = path.join(
        fs.mkdtempSync(path.join(root, 'preload-')),
        'signal-on-nth-write.mjs',
      );
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

      const run = runProcess(
        cwd,
        ['init', '--a2ui-stack', 'lit-mcp', '--server', 'node', 'app'],
        {
          NODE_OPTIONS: `--import ${pathToFileURL(preload).href}`,
          SAGA_TEST_UNDER: path.join(fs.realpathSync(cwd), 'app', path.sep),
          SAGA_TEST_NTH: '4',
          SAGA_TEST_SIGNAL: name,
        },
      );

      expect(run.status).toBe(130);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/interrupted/);
      expect(run.invoked).toEqual([]);
      expect(snapshot(cwd)).toEqual(before);
    },
  );

  it('exits non-zero for an unsupported pair and an existing target, and writes nothing', () => {
    const cwd = workspace();
    fs.mkdirSync(path.join(cwd, 'taken'));

    const unsupported = runProcess(cwd, [
      'init',
      '--a2ui-stack',
      'lit-mcp',
      '--server',
      'koa',
      'fresh',
    ]);
    const taken = runProcess(cwd, [
      'init',
      '--a2ui-stack',
      'lit-mcp',
      '--server',
      'node',
      'taken',
    ]);

    expect(unsupported.status).toBe(1);
    expect(unsupported.stderr).toContain('--a2ui-stack lit-mcp --server node');
    expect(taken.status).toBe(1);
    expect(unsupported.invoked.concat(taken.invoked)).toEqual([]);
    expect(fs.readdirSync(cwd).sort()).toEqual(['taken']);
    expect(fs.readdirSync(path.join(cwd, 'taken'))).toEqual([]);
  });
});
