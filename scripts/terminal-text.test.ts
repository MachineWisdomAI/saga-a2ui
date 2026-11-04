import { spawnSync } from 'node:child_process';
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
});
