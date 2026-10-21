import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { QUALIFIED_STARTERS } from './qualified-starters.js';
import {
  ExportInterrupted,
  TemplateError,
  createDirectoryInterruptibly,
  exportTemplate,
  exportTemplateInterruptibly,
  extractSnippets,
  readTemplateMetadata,
  stampSdkVersion,
  templateDirectory,
  templateFiles,
  templatesRoot,
  writeSnippets,
} from './starter-template.js';

// The starter template as a developer receives it and as a guide quotes it: exported without
// overwriting anything, stamped to one SDK build, with snippets that are the template's own lines.
// The browser, server and identity behavior of the exported starter is qualified in starter.test.ts.

const SDK_VERSION = '0.0.0-candidate.g0123456789ab';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'saga-starter-template-'));
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));
const template = templateDirectory('lit-node');

/** A throwaway template with the given files, for the cases the maintained one does not contain. */
function scratchTemplate(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(work, 'template-'));
  fs.writeFileSync(path.join(directory, 'template.json'), '{}');
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), text);
  }
  return directory;
}

describe('exporting a starter', () => {
  it('writes the template files into a new directory, pins every SDK package to the given build and leaves out its maintenance files and markers', () => {
    const exported = exportTemplate(template, path.join(work, 'fresh'), {
      sdkVersion: SDK_VERSION,
    });

    expect(exported.files).toEqual(templateFiles(template));
    expect(exported.files).not.toContain('template.json');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(exported.directory, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies['@saga-a2ui/core']).toBe(SDK_VERSION);
    expect(manifest.dependencies['@saga-a2ui/lit']).toBe(SDK_VERSION);
    expect(manifest.dependencies['@saga-a2ui/mcp']).toBe(SDK_VERSION);
    for (const file of exported.files)
      expect(
        fs.readFileSync(path.join(exported.directory, file), 'utf8'),
        file,
      ).not.toContain('saga-snippet');
  });

  it('refuses a path that exists, whether a directory or a symbolic link, and changes nothing there', () => {
    const existing = path.join(work, 'existing');
    fs.mkdirSync(existing);
    fs.writeFileSync(path.join(existing, 'keep.txt'), 'mine');
    const link = path.join(work, 'link');
    fs.symlinkSync(existing, link);

    expect(() =>
      exportTemplate(template, existing, { sdkVersion: SDK_VERSION }),
    ).toThrow(TemplateError);
    expect(() =>
      exportTemplate(template, link, { sdkVersion: SDK_VERSION }),
    ).toThrow(TemplateError);
    expect(fs.readdirSync(existing)).toEqual(['keep.txt']);
    expect(fs.readFileSync(path.join(existing, 'keep.txt'), 'utf8')).toBe(
      'mine',
    );
  });

  it('does not merge into, or remove, a directory that appeared after the existence check', () => {
    // The race: the path is absent when the export looks and present when it creates the directory.
    const raced = path.join(work, 'raced');
    fs.mkdirSync(raced);
    fs.writeFileSync(path.join(raced, 'keep.txt'), 'mine');
    const exists = fs.existsSync.bind(fs);
    const spy = vi
      .spyOn(fs, 'existsSync')
      .mockImplementation((candidate) =>
        candidate === raced ? false : exists(candidate),
      );
    try {
      expect(() =>
        exportTemplate(template, raced, { sdkVersion: SDK_VERSION }),
      ).toThrow(TemplateError);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readdirSync(raced)).toEqual(['keep.txt']);
    expect(fs.readFileSync(path.join(raced, 'keep.txt'), 'utf8')).toBe('mine');
  });

  it('writes nothing for a directory that is not a template, and removes only its own output when the export fails part-way', () => {
    const notATemplate = fs.mkdtempSync(path.join(work, 'plain-'));
    const target = path.join(work, 'never-written');
    expect(() =>
      exportTemplate(notATemplate, target, { sdkVersion: SDK_VERSION }),
    ).toThrow(TemplateError);
    expect(fs.existsSync(target)).toBe(false);

    // A manifest that declares an SDK package with a range other than "*" fails after other files were written.
    const bad = scratchTemplate({
      'a.ts': 'export {};\n',
      'package.json': JSON.stringify({
        dependencies: { '@saga-a2ui/core': '^1.0.0' },
      }),
    });
    const partial = path.join(work, 'partial');
    expect(() =>
      exportTemplate(bad, partial, { sdkVersion: SDK_VERSION }),
    ).toThrow(TemplateError);
    expect(fs.existsSync(partial)).toBe(false);
  });

  it('does not delete a directory that replaced its output before a write failed, and does not write into it', () => {
    // The race: after the export created its directory, another process moved it away and put its own at the same path.
    const target = path.join(work, 'swapped');
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    const spy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
        if (!String(args[0]).startsWith(`${target}${path.sep}`))
          return write(...args);
        writes += 1;
        if (writes < 4) return write(...args);
        fs.renameSync(target, `${target}.moved`);
        fs.mkdirSync(target);
        write(path.join(target, 'keep.txt'), 'mine');
        throw Object.assign(new Error('ENOSPC: no space left on device'), {
          code: 'ENOSPC',
        });
      });
    try {
      expect(() =>
        exportTemplate(template, target, { sdkVersion: SDK_VERSION }),
      ).toThrow(/no space left.*was replaced meanwhile/);
    } finally {
      spy.mockRestore();
    }
    expect(writes).toBe(4);
    expect(fs.readdirSync(target)).toEqual(['keep.txt']);
    expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('mine');
  });

  it('removes its own directory and reports the interrupt when the signal aborts during an interruptible export, but not before the event loop has run', async () => {
    const target = path.join(work, 'interrupted');
    const interrupt = new AbortController();
    // A callback scheduled from a synchronous write runs only when the export hands control back; the export must do so.
    const write = fs.writeFileSync.bind(fs);
    let writes = 0;
    const spy = vi
      .spyOn(fs, 'writeFileSync')
      .mockImplementation((...args: Parameters<typeof fs.writeFileSync>) => {
        writes += 1;
        if (writes === 3) setImmediate(() => interrupt.abort());
        return write(...args);
      });
    try {
      await expect(
        exportTemplateInterruptibly(template, target, {
          sdkVersion: SDK_VERSION,
          signal: interrupt.signal,
        }),
      ).rejects.toBeInstanceOf(ExportInterrupted);
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(target)).toBe(false);
    expect(writes).toBeLessThan(templateFiles(template).length);
  });

  it('creates a directory of any files through the same destination handling, and writes through nothing that exists', async () => {
    const target = path.join(work, 'plain-files');
    const files = [
      { path: 'a.txt', content: () => 'a' },
      { path: 'nested/b.bin', content: () => new Uint8Array([0, 255, 7]) },
    ];

    expect(await createDirectoryInterruptibly(target, files)).toBe(target);
    expect(fs.readFileSync(path.join(target, 'a.txt'), 'utf8')).toBe('a');
    expect([...fs.readFileSync(path.join(target, 'nested', 'b.bin'))]).toEqual([
      0, 255, 7,
    ]);

    fs.symlinkSync(
      path.join(work, 'nowhere'),
      path.join(work, 'dangling-link'),
    );
    for (const taken of [target, path.join(work, 'dangling-link')]) {
      await expect(createDirectoryInterruptibly(taken, files)).rejects.toThrow(
        /already exists/,
      );
    }
    expect(fs.existsSync(path.join(work, 'nowhere'))).toBe(false);
    expect(fs.readdirSync(target).sort()).toEqual(['a.txt', 'nested']);
  });

  it.each([
    ['../outside.txt'],
    ['/etc/outside.txt'],
    ['nested/../../outside.txt'],
  ])('refuses the file path %s before creating anything', async (escaping) => {
    const target = path.join(work, `escape-${escaping.replaceAll(/\W/g, '-')}`);

    await expect(
      createDirectoryInterruptibly(target, [
        { path: 'ok.txt', content: () => 'ok' },
        { path: escaping, content: () => 'no' },
      ]),
    ).rejects.toThrow(/not inside the new directory/);

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(path.join(work, 'outside.txt'))).toBe(false);
  });

  it('rejects an SDK range other than "*" rather than rewriting it', () => {
    expect(() =>
      stampSdkVersion(
        { dependencies: { '@saga-a2ui/core': 'workspace:*' } },
        SDK_VERSION,
      ),
    ).toThrow(TemplateError);
    expect(
      stampSdkVersion(
        { dependencies: { '@saga-a2ui/core': '*', zod: '4.6.7' } },
        SDK_VERSION,
      ),
    ).toEqual({
      dependencies: { '@saga-a2ui/core': SDK_VERSION, zod: '4.6.7' },
    });
  });
});

describe('the maintained templates say what they are', () => {
  it('are exactly the templates whose pair CI qualifies: none is offered without its evidence, none qualified is missing', () => {
    const directories = fs
      .readdirSync(templatesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(directories).toEqual([...QUALIFIED_STARTERS].sort());
  });

  it.each(QUALIFIED_STARTERS)(
    '%s declares the server adapter and the SDK packages it actually depends on',
    (name) => {
      const directory = templateDirectory(name);
      const metadata = readTemplateMetadata(directory);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
      ) as { dependencies: Record<string, string> };

      expect(manifest.dependencies[metadata.serverAdapter.package]).toBe(
        metadata.serverAdapter.version,
      );
      const declaredSdk = Object.keys(manifest.dependencies)
        .filter((dependency) => dependency.startsWith('@saga-a2ui/'))
        .map((dependency) => dependency.slice('@saga-a2ui/'.length))
        .sort();
      expect(declaredSdk).toEqual([...metadata.sdkPackages].sort());
    },
  );

  it('give each pair its own stack and server, so one pair is never offered twice', () => {
    const pairs = QUALIFIED_STARTERS.map((name) => {
      const { stack, server } = readTemplateMetadata(templateDirectory(name));
      return `${stack}/${server}`;
    });
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('snippets', () => {
  it.each(QUALIFIED_STARTERS)(
    '%s: are exactly the lines the exported starter contains, and every declared snippet exists',
    (name) => {
      const directory = templateDirectory(name);
      const metadata = readTemplateMetadata(directory);
      const snippets = extractSnippets(directory);
      expect(snippets.map((snippet) => snippet.name).sort()).toEqual(
        [...metadata.snippets].sort(),
      );

      const exported = exportTemplate(
        directory,
        path.join(work, `for-snippets-${name}`),
        { sdkVersion: SDK_VERSION },
      );
      for (const snippet of snippets) {
        expect(snippet.text.trim(), snippet.name).not.toBe('');
        expect(
          fs.readFileSync(path.join(exported.directory, snippet.file), 'utf8'),
          snippet.name,
        ).toContain(snippet.text);
      }
    },
  );

  it.each([
    ['lit-node', 'auth: decision.authInfo'],
    ['lit-express', 'req.auth = decision.authInfo'],
    ['lit-fastify', 'reply.code(decision.status)'],
    ['lit-hono', 'decision.authInfo'],
  ] as const)(
    '%s: carry the identity handoff and the direct attachment a developer is meant to copy',
    (name, handoff) => {
      const byName = Object.fromEntries(
        extractSnippets(templateDirectory(name)).map((snippet) => [
          snippet.name,
          snippet.text,
        ]),
      );
      expect(byName['identity-handoff']).toContain('authenticate(');
      expect(byName['identity-handoff']).toContain(handoff);
      expect(byName['bind-action']).toContain("bindAction('activate'");
      expect(byName['register-protected-operation']).toContain(
        'registerProtectedOperation(',
      );
    },
  );

  it('are written as files into a new directory, never over an existing one', () => {
    const target = path.join(work, 'snippet-files');
    const written = writeSnippets(template, target);

    expect(written.map((file) => path.basename(file)).sort()).toEqual([
      'bind-action.ts',
      'identity-handoff.ts',
      'prepare-view.ts',
      'register-protected-operation.ts',
    ]);
    for (const snippet of extractSnippets(template))
      expect(
        fs.readFileSync(path.join(target, `${snippet.name}.ts`), 'utf8'),
      ).toBe(`${snippet.text}\n`);
    expect(() => writeSnippets(template, target)).toThrow(TemplateError);
  });

  it('refuse a region that is unclosed, unopened, nested or repeated instead of cutting something else', () => {
    const open = scratchTemplate({
      'a.ts': '// #region saga-snippet:one\nconst a = 1;\n',
    });
    expect(() => extractSnippets(open)).toThrow(/never closed/);
    const unopened = scratchTemplate({
      'a.ts': 'const a = 1;\n// #endregion saga-snippet:one\n',
    });
    expect(() => extractSnippets(unopened)).toThrow(/does not match/);
    const nested = scratchTemplate({
      'a.ts':
        '// #region saga-snippet:one\n// #region saga-snippet:two\n// #endregion saga-snippet:two\n// #endregion saga-snippet:one\n',
    });
    expect(() => extractSnippets(nested)).toThrow(/opens inside/);
    const repeated = scratchTemplate({
      'a.ts':
        '// #region saga-snippet:one\nx\n// #endregion saga-snippet:one\n',
      'b.ts':
        '// #region saga-snippet:one\ny\n// #endregion saga-snippet:one\n',
    });
    expect(() => extractSnippets(repeated)).toThrow(/defined twice/);
  });
});
