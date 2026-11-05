import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyFixture, editing, saga, workspace } from './publish/harness.js';
import { terminalText, terminalValue } from './terminal-text.mjs';

// SECURITY.md invariant 6: untrusted text that reaches a terminal or a CI log is shown with its
// control characters written out, after secret redaction, at one final boundary.

// Escape, bell, carriage return, a C1 control sequence introducer, DEL and a right-to-left override.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202e]/;
const HOSTILE = '\u001b]0;pwned\u0007\u001b[2J\r\u009b31m\u007f\u202e';
// A line feed and a tab are not control characters of a terminal, but in a report they start a
// line and a column of their own: a value holding them can forge a verdict line.
const FORGED = '\nFORGED  pass   forged.verdict: ready\tCOLUMN';
const FORGED_SHOWN = '\\nFORGED  pass   forged.verdict: ready\\tCOLUMN';

describe('terminalText and terminalValue', () => {
  it('write control characters out and leave ordinary text, lines and tabs alone', () => {
    const ordinary = 'Notes Fixture 1.0.0: déjà vu — 日本語 ✓\n\tindented\n';
    expect(terminalText(ordinary)).toBe(ordinary);
    expect(terminalValue('src/ok file.ts')).toBe('src/ok file.ts');

    const shown = terminalText(`a${HOSTILE}b`);
    expect(shown).toBe('a\\x1b]0;pwned\\x07\\x1b[2J\\x0d\\x9b31m\\x7f\\u202eb');
    expect(shown).not.toMatch(CONTROL);
  });

  it('treat a carriage-return line ending as a line ending and a lone one as a control', () => {
    expect(terminalText('one\r\ntwo\r\n')).toBe('one\ntwo\n');
    expect(terminalText('shown\rhidden')).toBe('shown\\x0dhidden');
  });

  it('write a value so it cannot start a line, and defang a workflow command at a line start', () => {
    expect(terminalValue('a\n::error::forged\tb')).toBe(
      'a\\n::error::forged\\tb',
    );
    expect(terminalText('fine\n::error::forged\n  ::warning::x\n')).toBe(
      'fine\n\\x3a:error::forged\n  \\x3a:warning::x\n',
    );
    expect(terminalText('time: 10::30')).toBe('time: 10::30');
  });

  it('are idempotent, so a second boundary changes nothing', () => {
    const once = terminalText(`::x ${HOSTILE}`);
    expect(terminalText(once)).toBe(once);
  });
});

describe('publication output', () => {
  const hostileServer = editing('initialize', (result) => {
    result.serverInfo.name = `notes${HOSTILE}`;
    result.serverInfo.version = '1.0.0\u001b[31m';
  });

  it('shows an endpoint-chosen server identity with its controls written out', async () => {
    const run = await saga(
      [
        'publish',
        'check',
        '--target',
        'chatgpt',
        '--release',
        path.join(copyFixture(), 'saga-publication.json'),
      ],
      { cwd: workspace(), wire: hostileServer },
    );

    expect(run.out + run.err).toContain('notes\\x1b]0;pwned\\x07');
    expect(run.out).not.toMatch(CONTROL);
    expect(run.err).not.toMatch(CONTROL);
  });

  it('shows an endpoint-chosen server identity with its line feed and tab written out', async () => {
    const run = await saga(
      [
        'publish',
        'check',
        '--target',
        'chatgpt',
        '--release',
        path.join(copyFixture(), 'saga-publication.json'),
      ],
      {
        cwd: workspace(),
        wire: editing('initialize', (result) => {
          result.serverInfo.name = `notes${FORGED}`;
        }),
      },
    );

    const shown = run.out + run.err;
    expect(shown).toContain(`notes${FORGED_SHOWN}`);
    expect(shown).not.toMatch(/^FORGED/m);
    expect(shown).not.toContain('\tCOLUMN');
  });

  it('shows ordinary output exactly as before', async () => {
    const app = copyFixture();
    const run = await saga(
      [
        'publish',
        'check',
        '--target',
        'chatgpt',
        '--release',
        path.join(app, 'saga-publication.json'),
      ],
      { cwd: workspace() },
    );

    expect(run.out).toContain('saga publish check (chatgpt)');
    expect(run.out).not.toContain('\\x');
    expect(run.out).not.toMatch(CONTROL);
  });

  it('shows a handoff command argument chosen with control characters with them written out', async () => {
    const run = await saga(['publish', 'handoff', 'status', 'x\u001b[2J'], {
      cwd: workspace(),
    });

    expect(run.code).not.toBe(0);
    expect(run.err).toContain('"x\\x1b[2J"');
    expect(run.err).not.toMatch(CONTROL);
    expect(run.out).not.toMatch(CONTROL);
  });
});

describe('the command line', () => {
  it('shows an option value chosen with a line feed and a tab with them written out', async () => {
    const run = await saga(
      ['init', '--a2ui-stack', `lit-mcp${FORGED}`, '--server', 'node', 'x'],
      { cwd: workspace() },
    );

    expect(run.code).not.toBe(0);
    expect(run.err).toContain(`lit-mcp${FORGED_SHOWN} on node`);
    expect(run.err).not.toMatch(/^FORGED/m);
    expect(run.err).not.toContain('\tCOLUMN');
    // The trusted layout of the report is kept.
    expect(run.err).toContain('\n\nSupported pairs:\n');
  });

  it('shows a destination or option chosen with control characters with them written out', async () => {
    const run = await saga(
      ['init', '--a2ui-stack', `lit-mcp${HOSTILE}`, '--server', 'node', 'x'],
      { cwd: workspace() },
    );

    expect(run.code).not.toBe(0);
    expect(run.err).toContain('lit-mcp\\x1b]0;pwned');
    expect(run.err).not.toMatch(CONTROL);
    expect(run.out).not.toMatch(CONTROL);
  });
});

describe('the candidate tooling', () => {
  it('shows a diagnostic that repeats a path chosen with control characters with them written out', () => {
    const run = spawnSync(
      path.resolve('node_modules/.bin/tsx'),
      [
        'scripts/release-candidate.ts',
        'verify',
        '--candidate',
        `missing${HOSTILE}.json`,
        '--combination',
        'x',
        '--modules',
        'x',
      ],
      { encoding: 'utf8' },
    );

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('missing\\x1b]0;pwned');
    expect(run.stdout).not.toMatch(CONTROL);
    expect(run.stderr).not.toMatch(CONTROL);
  });

  it('shows an unexpected failure that repeats a path chosen with control characters with them written out', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-'));
    try {
      // An output directory that already exists is refused with its path in the message.
      const out = path.join(parent, `taken${HOSTILE}${FORGED}`);
      fs.mkdirSync(out);
      const run = spawnSync(
        path.resolve('node_modules/.bin/tsx'),
        ['scripts/release-candidate.ts', 'tarballs', '--out', out],
        { encoding: 'utf8' },
      );

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('taken\\x1b]0;pwned');
      expect(run.stderr).not.toMatch(/^FORGED/m);
      expect(run.stdout).not.toMatch(CONTROL);
      expect(run.stderr).not.toMatch(CONTROL);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('the workflow pin check', () => {
  it('shows a failure that repeats a workflow file name chosen with control characters with them written out', () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'pins-'));
    try {
      const git = (...args: string[]): void => {
        execFileSync('git', args, { cwd: repository, stdio: 'ignore' });
      };
      git('init', '--quiet');
      const name = `.github/workflows/a${HOSTILE}${FORGED}.yml`;
      fs.mkdirSync(path.join(repository, '.github/workflows'), {
        recursive: true,
      });
      fs.writeFileSync(path.join(repository, name), 'name: x\n');
      git('add', '--', name);
      // Tracked but unreadable: the scan fails on the file name.
      fs.rmSync(path.join(repository, name));

      const run = spawnSync(
        process.execPath,
        [path.resolve('scripts/check-action-pins.mjs')],
        { cwd: repository, encoding: 'utf8' },
      );

      expect(run.status).toBe(1);
      expect(run.stderr).toContain('a\\x1b]0;pwned');
      expect(run.stderr).not.toMatch(/^FORGED/m);
      expect(run.stderr).not.toMatch(CONTROL);
    } finally {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });
});
