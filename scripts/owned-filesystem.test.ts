import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  OwnedDirectory,
  UnsafePath,
  assertSafeSegment,
  listContainedFiles,
  readContainedFile,
  writeContainedFile,
} from './owned-filesystem.js';

// The shared rules for what maintained tooling reads as source and owns as output
// (SECURITY.md invariant 5). Each refusal is paired with the ordinary case that must keep working.

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-owned-fs-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const fresh = (): string => {
  const directory = path.join(scratch, `case-${(counter += 1)}`);
  fs.mkdirSync(directory);
  return directory;
};
const secret = (): string => {
  const file = path.join(fresh(), 'secret.txt');
  fs.writeFileSync(file, 'outside secret');
  return file;
};

describe('safe segments', () => {
  it.each(['getting-started', '0.11.0-rc.1', 'faithful_card', 'CANDIDATE.md'])(
    'accepts %s',
    (value) => {
      expect(assertSafeSegment(value, 'name')).toBe(value);
    },
  );
  it.each([
    '',
    '.',
    '..',
    '../x',
    'a/b',
    'a\\b',
    '/abs',
    '.hidden',
    'a..b',
    'x y',
  ])('refuses %j', (value) => {
    expect(() => assertSafeSegment(value, 'name')).toThrow(UnsafePath);
  });
  it('refuses a value that is not text', () => {
    expect(() => assertSafeSegment(undefined, 'name')).toThrow(UnsafePath);
  });
});

describe('reading below a root', () => {
  it('reads a regular file, nested', () => {
    const root = fresh();
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(path.join(root, 'a', 'b.txt'), 'inside');
    expect(readContainedFile(root, 'a/b.txt').toString()).toBe('inside');
    expect(listContainedFiles(root)).toEqual(['a/b.txt']);
  });

  it('refuses a file that is a link, and does not return what it points at', () => {
    const root = fresh();
    fs.symlinkSync(secret(), path.join(root, 'link.txt'));
    expect(() => readContainedFile(root, 'link.txt')).toThrow(/symbolic link/);
    expect(() => listContainedFiles(root)).toThrow(/symbolic link/);
  });

  it('refuses a path that passes through a linked directory', () => {
    const root = fresh();
    const outside = fresh();
    fs.writeFileSync(path.join(outside, 'x.txt'), 'outside');
    fs.symlinkSync(outside, path.join(root, 'dir'), 'dir');
    expect(() => readContainedFile(root, 'dir/x.txt')).toThrow(/symbolic link/);
    expect(() => listContainedFiles(root)).toThrow(/symbolic link/);
  });

  it('refuses a root that is itself a link', () => {
    const outside = fresh();
    fs.writeFileSync(path.join(outside, 'x.txt'), 'outside');
    const root = path.join(fresh(), 'root');
    fs.symlinkSync(outside, root, 'dir');
    expect(() => readContainedFile(root, 'x.txt')).toThrow(/real directory/);
  });

  it.each(['../x', 'a/../../x', '/etc/passwd', '', 'a//b', './a'])(
    'refuses the path %j',
    (relative) => {
      expect(() => readContainedFile(fresh(), relative)).toThrow(UnsafePath);
    },
  );

  it('refuses a special file', () => {
    const root = fresh();
    fs.mkdirSync(path.join(root, 'sub'));
    // A directory where a file is expected stands in for a non-regular entry on every platform.
    expect(() => readContainedFile(root, 'sub')).toThrow(/not a regular file/);
  });

  it('reports a missing file as missing', () => {
    expect(() => readContainedFile(fresh(), 'nope.txt')).toThrow(
      /does not exist/,
    );
  });

  it('skips only the directories it is told to skip', () => {
    const root = fresh();
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.symlinkSync(secret(), path.join(root, 'node_modules', 'link'));
    fs.writeFileSync(path.join(root, 'a.txt'), '');
    expect(listContainedFiles(root, new Set(['node_modules']))).toEqual([
      'a.txt',
    ]);
  });
});

describe('an owned output directory', () => {
  it('creates a missing directory and reports its path', () => {
    const target = path.join(fresh(), 'deep', 'out');
    const owned = OwnedDirectory.create(target);
    expect(owned.path).toBe(
      fs.realpathSync(path.dirname(target)) + path.sep + 'out',
    );
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it('authenticates an existing real directory', () => {
    const target = fresh();
    expect(() => OwnedDirectory.create(target)).not.toThrow();
  });

  it('refuses an existing directory when a new one is required', () => {
    expect(() => OwnedDirectory.create(fresh(), { fresh: true })).toThrow(
      /already exists/,
    );
  });

  it('refuses an output that is a link, to a directory or to nothing, and writes nothing through it', () => {
    const victim = fresh();
    fs.writeFileSync(path.join(victim, 'keep.txt'), 'keep');
    const link = path.join(fresh(), 'out');
    fs.symlinkSync(victim, link, 'dir');
    expect(() => OwnedDirectory.create(link)).toThrow(/not a real directory/);
    const dangling = path.join(fresh(), 'dangling');
    fs.symlinkSync(path.join(victim, 'missing'), dangling);
    expect(() => OwnedDirectory.create(dangling)).toThrow(UnsafePath);
    expect(fs.readdirSync(victim)).toEqual(['keep.txt']);
  });

  it('refuses an output that is a file', () => {
    expect(() => OwnedDirectory.create(secret())).toThrow(
      /not a real directory/,
    );
  });

  it('empties a child directory it owns and nothing else', () => {
    const output = OwnedDirectory.create(fresh());
    const first = output.resetChild('packages');
    fs.writeFileSync(path.join(first.path, 'old.tgz'), 'old');
    fs.writeFileSync(path.join(output.path, 'sibling.txt'), 'kept');
    const second = output.resetChild('packages');
    expect(fs.readdirSync(second.path)).toEqual([]);
    expect(fs.readFileSync(path.join(output.path, 'sibling.txt'), 'utf8')).toBe(
      'kept',
    );
  });

  it('refuses a child that is a link and removes nothing behind it', () => {
    const victim = fresh();
    fs.writeFileSync(path.join(victim, 'keep.txt'), 'keep');
    const output = OwnedDirectory.create(fresh());
    fs.symlinkSync(victim, path.join(output.path, 'packages'), 'dir');
    expect(() => output.resetChild('packages')).toThrow(/not a real directory/);
    expect(() => output.ensureChild('packages')).toThrow(
      /not a real directory/,
    );
    expect(fs.readFileSync(path.join(victim, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('keeps an existing real child as it is', () => {
    const output = OwnedDirectory.create(fresh());
    const child = output.ensureChild('packages');
    fs.writeFileSync(path.join(child.path, 'kept.tgz'), 'kept');
    output.ensureChild('packages');
    expect(fs.readdirSync(child.path)).toEqual(['kept.tgz']);
  });

  it('replaces a fixed leaf that is a link instead of writing through it', () => {
    const victim = secret();
    const output = OwnedDirectory.create(fresh());
    fs.symlinkSync(victim, path.join(output.path, 'candidate.json'));
    output.writeFile('candidate.json', '{"ok":true}');
    expect(fs.readFileSync(victim, 'utf8')).toBe('outside secret');
    expect(
      fs.lstatSync(path.join(output.path, 'candidate.json')).isFile(),
    ).toBe(true);
    expect(
      fs.readFileSync(path.join(output.path, 'candidate.json'), 'utf8'),
    ).toBe('{"ok":true}');
    expect(fs.readdirSync(output.path)).toEqual(['candidate.json']);
  });

  it('refuses to write or remove once the directory was replaced', () => {
    const parent = fresh();
    const victim = fresh();
    fs.writeFileSync(path.join(victim, 'keep.txt'), 'keep');
    const output = OwnedDirectory.create(path.join(parent, 'out'));
    fs.renameSync(output.path, path.join(parent, 'moved'));
    fs.symlinkSync(victim, output.path, 'dir');
    expect(() => output.writeFile('a.json', '1')).toThrow(/was replaced/);
    expect(() => output.resetChild('packages')).toThrow(/was replaced/);
    expect(fs.readdirSync(victim)).toEqual(['keep.txt']);
  });

  it('refuses a name that is not one safe segment', () => {
    const output = OwnedDirectory.create(fresh());
    expect(() => output.writeFile('../escape.txt', 'x')).toThrow(UnsafePath);
    expect(() => output.resetChild('a/b')).toThrow(UnsafePath);
  });
});

describe('writing below a root', () => {
  it('creates directories and replaces a file', () => {
    const root = fresh();
    writeContainedFile(root, 'guides/a.mdx', 'one');
    writeContainedFile(root, 'guides/a.mdx', 'two');
    expect(fs.readFileSync(path.join(root, 'guides/a.mdx'), 'utf8')).toBe(
      'two',
    );
  });

  it('refuses a path that leaves the root or passes through a link', () => {
    const root = fresh();
    const outside = fresh();
    expect(() => writeContainedFile(root, '../escape.mdx', 'x')).toThrow(
      UnsafePath,
    );
    fs.symlinkSync(outside, path.join(root, 'guides'), 'dir');
    expect(() => writeContainedFile(root, 'guides/a.mdx', 'x')).toThrow(
      /real directory/,
    );
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('replaces a linked leaf without writing through it', () => {
    const root = fresh();
    const victim = secret();
    fs.symlinkSync(victim, path.join(root, 'a.mdx'));
    writeContainedFile(root, 'a.mdx', 'new');
    expect(fs.readFileSync(victim, 'utf8')).toBe('outside secret');
  });
});
