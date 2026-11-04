import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeCandidate } from './release-candidate.js';
import { prepareReleasePackages } from './release-packages.js';
import { stageTrackedFiles } from './packed-consumer.js';
import { UnsafePath } from './owned-filesystem.js';
import {
  TemplateError,
  exportTemplate,
  extractSnippets,
  templateFiles,
} from './starter-template.js';

// Reviewed-source identity and output ownership of the maintained tooling (SECURITY.md invariants
// 5 and 9): what a template export or a release artifact may contain, and which directories the
// release commands may empty or write. Each refusal has an ordinary case beside it.

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-source-authority-'));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));
let counter = 0;
const fresh = (): string => {
  const directory = path.join(work, `case-${(counter += 1)}`);
  fs.mkdirSync(directory);
  return directory;
};

function template(files: Record<string, string>): string {
  const directory = fresh();
  fs.writeFileSync(path.join(directory, 'template.json'), '{}');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), text);
  }
  return directory;
}

describe('a template export reads only the template', () => {
  const SECRET = 'SECRET-OUTSIDE-THE-CHECKOUT';
  const outsideFile = (): string => {
    const file = path.join(fresh(), 'outside.txt');
    fs.writeFileSync(file, SECRET);
    return file;
  };

  it('exports a template of regular files', () => {
    const source = template({ 'a.ts': 'export const a = 1;\n' });
    const exported = exportTemplate(source, path.join(fresh(), 'out'), {
      sdkVersion: '0.0.0-candidate.g0123456789ab',
    });
    expect(exported.files).toEqual(['a.ts']);
  });

  it('refuses a template file that is a link and copies nothing from its target', () => {
    const source = template({ 'a.ts': 'export const a = 1;\n' });
    fs.symlinkSync(outsideFile(), path.join(source, 'leak.ts'));
    const destination = path.join(fresh(), 'out');
    expect(() =>
      exportTemplate(source, destination, { sdkVersion: '1.0.0' }),
    ).toThrow(TemplateError);
    expect(fs.existsSync(destination)).toBe(false);
    expect(() => extractSnippets(source)).toThrow(/symbolic link/);
  });

  it('refuses a linked directory in a template', () => {
    const source = template({ 'a.ts': 'export const a = 1;\n' });
    const outside = fresh();
    fs.writeFileSync(path.join(outside, 'b.ts'), SECRET);
    fs.symlinkSync(outside, path.join(source, 'shared'), 'dir');
    const destination = path.join(fresh(), 'out');
    expect(() => templateFiles(source)).toThrow(TemplateError);
    expect(() =>
      exportTemplate(source, destination, { sdkVersion: '1.0.0' }),
    ).toThrow(/symbolic link/);
    expect(fs.existsSync(destination)).toBe(false);
  });

  it('refuses a template.json that is a link', () => {
    const source = template({ 'a.ts': 'export const a = 1;\n' });
    fs.rmSync(path.join(source, 'template.json'));
    fs.symlinkSync(outsideFile(), path.join(source, 'template.json'));
    expect(() =>
      exportTemplate(source, path.join(fresh(), 'out'), {
        sdkVersion: '1.0.0',
      }),
    ).toThrow(/symbolic link/);
  });
});

describe('a release artifact is built from tracked files only', () => {
  function repository(): string {
    const root = fresh();
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Fixture');
    fs.mkdirSync(path.join(root, 'packages/demo/src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages/demo/package.json'), '{}');
    fs.writeFileSync(
      path.join(root, 'packages/demo/src/index.ts'),
      'export {};\n',
    );
    fs.writeFileSync(
      path.join(root, 'packages/demo/src/run.sh'),
      '#!/bin/sh\n',
      {
        mode: 0o755,
      },
    );
    fs.writeFileSync(path.join(root, 'LICENSE'), 'license text\n');
    fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'notices\n');
    git('add', '.');
    git('commit', '-q', '-m', 'initial');
    return root;
  }

  const AUXILIARY = ['LICENSE', 'THIRD_PARTY_NOTICES.md'];

  it('stages the tracked license and notices beside the package and binds them into its identity', () => {
    const root = repository();
    const destination = fresh();
    const first = stageTrackedFiles(
      root,
      'packages/demo',
      destination,
      AUXILIARY,
    );
    expect(fs.readFileSync(path.join(destination, 'LICENSE'), 'utf8')).toBe(
      'license text\n',
    );
    expect(
      fs.readFileSync(path.join(destination, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    ).toBe('notices\n');
    // The auxiliary bytes are part of what the package was built from.
    expect(first.sourceSha256).not.toBe(
      stageTrackedFiles(root, 'packages/demo', fresh()).sourceSha256,
    );
    for (const file of AUXILIARY) {
      fs.writeFileSync(path.join(root, file), 'edited\n');
      expect(
        stageTrackedFiles(root, 'packages/demo', fresh(), AUXILIARY)
          .sourceSha256,
      ).not.toBe(first.sourceSha256);
      fs.writeFileSync(
        path.join(root, file),
        file === 'LICENSE' ? 'license text\n' : 'notices\n',
      );
    }
  });

  for (const file of AUXILIARY) {
    it(`refuses ${file} when Git no longer tracks it, though the working tree still has it`, () => {
      const root = repository();
      execFileSync('git', ['rm', '-q', '--cached', file], { cwd: root });
      expect(fs.existsSync(path.join(root, file))).toBe(true);
      const destination = fresh();
      expect(() =>
        stageTrackedFiles(root, 'packages/demo', destination, AUXILIARY),
      ).toThrow(UnsafePath);
      expect(fs.existsSync(path.join(destination, file))).toBe(false);
    });

    it(`refuses ${file} when it is a tracked link`, () => {
      const root = repository();
      fs.rmSync(path.join(root, file));
      fs.symlinkSync('packages/demo/package.json', path.join(root, file));
      execFileSync('git', ['add', file], { cwd: root });
      expect(() =>
        stageTrackedFiles(root, 'packages/demo', fresh(), AUXILIARY),
      ).toThrow(UnsafePath);
    });
  }

  it('stages what Git tracks and names, and leaves out, an untracked file', () => {
    const root = repository();
    fs.writeFileSync(
      path.join(root, 'packages/demo/src/shadow.ts'),
      'export const shadow = true;\n',
    );
    const destination = fresh();
    const staged = stageTrackedFiles(root, 'packages/demo', destination);
    expect(fs.readdirSync(path.join(destination, 'src')).sort()).toEqual([
      'index.ts',
      'run.sh',
    ]);
    expect(staged.excludedUntracked).toEqual(['src/shadow.ts']);
    expect(
      fs.statSync(path.join(destination, 'src/run.sh')).mode & 0o111,
    ).not.toBe(0);
  });

  it('binds the staged content into one identity that changes with a tracked edit and not with an untracked file', () => {
    const root = repository();
    const first = stageTrackedFiles(root, 'packages/demo', fresh());
    fs.writeFileSync(path.join(root, 'packages/demo/stray.txt'), 'stray');
    expect(stageTrackedFiles(root, 'packages/demo', fresh()).sourceSha256).toBe(
      first.sourceSha256,
    );
    fs.writeFileSync(
      path.join(root, 'packages/demo/src/index.ts'),
      'export const x = 1;\n',
    );
    expect(
      stageTrackedFiles(root, 'packages/demo', fresh()).sourceSha256,
    ).not.toBe(first.sourceSha256);
  });

  it('names an ignored file among those left out, not only an unignored untracked one', () => {
    const root = repository();
    fs.appendFileSync(
      path.join(root, '.git/info/exclude'),
      'packages/demo/generated.txt\n',
    );
    fs.writeFileSync(path.join(root, 'packages/demo/generated.txt'), 'built');
    fs.writeFileSync(path.join(root, 'packages/demo/src/shadow.ts'), '');
    const destination = fresh();
    const staged = stageTrackedFiles(root, 'packages/demo', destination);
    expect(staged.excludedUntracked).toEqual([
      'generated.txt',
      'src/shadow.ts',
    ]);
    expect(fs.existsSync(path.join(destination, 'generated.txt'))).toBe(false);
  });

  it('refuses a tracked file that the working tree has replaced with a link', () => {
    const root = repository();
    const outside = path.join(fresh(), 'outside.txt');
    fs.writeFileSync(outside, 'outside');
    const file = path.join(root, 'packages/demo/src/index.ts');
    fs.rmSync(file);
    fs.symlinkSync(outside, file);
    expect(() => stageTrackedFiles(root, 'packages/demo', fresh())).toThrow(
      UnsafePath,
    );
  });

  it('refuses a link that is tracked', () => {
    const root = repository();
    fs.symlinkSync(
      '../package.json',
      path.join(root, 'packages/demo/src/link.json'),
    );
    execFileSync('git', ['add', 'packages/demo/src/link.json'], { cwd: root });
    expect(() => stageTrackedFiles(root, 'packages/demo', fresh())).toThrow(
      /not a plain tracked file/,
    );
  });
});

describe('release commands own the directory they empty and write', () => {
  const victim = (): string => {
    const directory = fresh();
    fs.writeFileSync(path.join(directory, 'keep.txt'), 'keep');
    return directory;
  };

  it.each([
    ['release:pack', (out: string) => prepareReleasePackages(out)],
    ['candidate:pack', (out: string) => writeCandidate(out)],
  ])('%s refuses an output directory that is a link', (_name, run) => {
    const target = victim();
    const link = path.join(fresh(), 'out');
    fs.symlinkSync(target, link, 'dir');
    expect(() => run(link)).toThrow(/not a real directory/);
    expect(fs.readdirSync(target)).toEqual(['keep.txt']);
  });

  it('release:pack refuses a packages directory that is a link', () => {
    const target = victim();
    const out = fresh();
    fs.symlinkSync(target, path.join(out, 'packages'), 'dir');
    expect(() => prepareReleasePackages(out)).toThrow(/not a real directory/);
    expect(fs.readdirSync(target)).toEqual(['keep.txt']);
  });

  it('release:pack replaces a tarball leaf that is a link and writes nothing through it, and reuses a legitimate output', () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(import.meta.dirname, '..', 'packages/core/package.json'),
        'utf8',
      ),
    ) as { version: string };
    const leaf = `saga-a2ui-core-${manifest.version}.tgz`;
    const target = victim();
    const outside = path.join(target, 'keep.txt');
    const out = fresh();
    fs.mkdirSync(path.join(out, 'packages'));
    fs.symlinkSync(outside, path.join(out, 'packages', leaf));
    const first = prepareReleasePackages(out);
    expect(fs.readFileSync(outside, 'utf8')).toBe('keep');
    const written = path.join(out, 'packages', leaf);
    expect(fs.lstatSync(written).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(written).isFile()).toBe(true);
    const core = first.packages.find((one) => one.name === 'core');
    expect(core?.bytes).toBe(fs.statSync(written).size);
    // The same output directory is reusable: a second run replaces the regular files in place.
    expect(prepareReleasePackages(out).packages).toHaveLength(7);
    expect(fs.readdirSync(path.join(out, 'packages'))).toHaveLength(7);
  }, 120_000);

  it('candidate:pack refuses a packages directory that is a link and empties nothing behind it', () => {
    const target = victim();
    const out = fresh();
    fs.symlinkSync(target, path.join(out, 'packages'), 'dir');
    expect(() => writeCandidate(out)).toThrow(/not a real directory/);
    expect(fs.readdirSync(target)).toEqual(['keep.txt']);
  });

  it('candidate:pack refuses the repository root as its output', () => {
    expect(() =>
      writeCandidate(path.resolve(import.meta.dirname, '..')),
    ).toThrow(/repository root/);
  });
});
