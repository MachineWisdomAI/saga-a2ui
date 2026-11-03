import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sourceOf } from './source.js';

// The application directory comes from the release input, so its repository configuration is less
// trusted than the operator running `saga publish`. Reading the revision must not execute anything
// that configuration names, and must not need a Git executable at all.

const COMMIT = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-source-'));
  roots.push(root);
  return root;
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A repository whose configuration would run a script if Git ever consulted it. */
function hostileRepository(): { directory: string; marker: string } {
  const root = scratch();
  const directory = path.join(root, 'app');
  const marker = path.join(root, 'executed');
  const hook = path.join(root, 'hook.sh');
  write(hook, `#!/bin/sh\necho ran > '${marker}'\nexit 0\n`);
  fs.chmodSync(hook, 0o755);
  const clean = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull };
  const git = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: directory,
      env: clean,
      encoding: 'utf8',
    }).trim();
  fs.mkdirSync(directory);
  git('init', '--quiet');
  git('config', 'user.email', 'a@example.test');
  git('config', 'user.name', 'a');
  write(path.join(directory, 'file.txt'), 'one\n');
  git('add', 'file.txt');
  git('commit', '--quiet', '-m', 'one');
  // Configuration an attacker who controls the directory can plant.
  git('config', 'core.fsmonitor', hook);
  git('config', 'core.hooksPath', root);
  git('config', 'core.sshCommand', hook);
  git('config', 'diff.external', hook);
  write(path.join(directory, 'file.txt'), 'two\n');
  return { directory, marker };
}

describe('sourceOf', () => {
  it('reports the commit of a real repository without running Git', () => {
    const { directory, marker } = hostileRepository();
    const expected = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull },
      encoding: 'utf8',
    }).trim();
    // The checkout has a tracked edit and a hostile configuration; the control is that the commit
    // is still found, and the attack is that nothing the configuration names ran.
    expect(fs.existsSync(marker)).toBe(false);
    const source = sourceOf(directory);
    expect(source.revision).toBe(expected);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('does not look for or run an executable named git', () => {
    const { directory } = hostileRepository();
    const root = scratch();
    const marker = path.join(root, 'shim-ran');
    const shim = path.join(root, 'bin', 'git');
    write(shim, `#!/bin/sh\necho ran > '${marker}'\nexit 1\n`);
    fs.chmodSync(shim, 0o755);
    const before = process.env.PATH;
    process.env.PATH = `${path.dirname(shim)}${path.delimiter}${before ?? ''}`;
    try {
      expect(sourceOf(directory).revision).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      process.env.PATH = before;
    }
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('does not claim whether the checkout is modified, which only Git could say', () => {
    const { directory } = hostileRepository();
    expect(sourceOf(directory).dirty).toBeNull();
  });

  it('follows a branch through a loose reference, from a subdirectory', () => {
    const root = scratch();
    write(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    write(path.join(root, '.git', 'refs', 'heads', 'main'), `${COMMIT}\n`);
    const nested = path.join(root, 'apps', 'notes');
    fs.mkdirSync(nested, { recursive: true });
    expect(sourceOf(nested)).toEqual({ revision: COMMIT, dirty: null });
  });

  it('follows a branch through packed references', () => {
    const root = scratch();
    write(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/release/1\n');
    write(
      path.join(root, '.git', 'packed-refs'),
      `# pack-refs with: peeled fully-peeled sorted\n${OTHER} refs/heads/other\n${COMMIT} refs/heads/release/1\n^${OTHER}\n`,
    );
    expect(sourceOf(root).revision).toBe(COMMIT);
  });

  it('reads a detached head', () => {
    const root = scratch();
    write(path.join(root, '.git', 'HEAD'), `${COMMIT}\n`);
    expect(sourceOf(root).revision).toBe(COMMIT);
  });

  it('follows a linked worktree to its own head and the shared references', () => {
    const root = scratch();
    const main = path.join(root, 'main');
    const linked = path.join(root, 'linked');
    const gitdir = path.join(main, '.git', 'worktrees', 'linked');
    write(path.join(main, '.git', 'refs', 'heads', 'topic'), `${COMMIT}\n`);
    write(path.join(gitdir, 'HEAD'), 'ref: refs/heads/topic\n');
    write(path.join(gitdir, 'commondir'), '../..\n');
    write(path.join(linked, '.git'), `gitdir: ${gitdir}\n`);
    expect(sourceOf(linked).revision).toBe(COMMIT);
  });

  it.each([
    ['no repository', () => scratch()],
    [
      'a branch that does not exist',
      () => {
        const root = scratch();
        write(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/gone\n');
        return root;
      },
    ],
    [
      'a head that is not a commit identifier',
      () => {
        const root = scratch();
        write(path.join(root, '.git', 'HEAD'), 'not a commit\n');
        return root;
      },
    ],
    [
      'a reference that leaves the repository',
      () => {
        const root = scratch();
        write(path.join(root, '.git', 'HEAD'), 'ref: ../../outside\n');
        write(path.join(root, 'outside'), `${COMMIT}\n`);
        return root;
      },
    ],
    [
      'a gitdir pointer to nothing',
      () => {
        const root = scratch();
        write(path.join(root, '.git'), 'gitdir: /nonexistent/nowhere\n');
        return root;
      },
    ],
  ])('reports an unknown source for %s', (_label, make) => {
    expect(sourceOf(make())).toEqual({ revision: null, dirty: null });
  });
});
