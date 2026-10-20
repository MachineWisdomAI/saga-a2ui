import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLimits } from '../packages/core/src/actions/limits.js';
import { DEFAULT_OPERATION_MS, DEFAULT_REQUEST_MS } from '../packages/mcp/src/policy/index.js';
import { repoRoot } from './packed-consumer.js';
import { QUALIFIED_STARTERS } from './qualified-starters.js';
import { readTemplateMetadata, templateDirectory } from './starter-template.js';

// GUIDE2: the action guide (docs/actions.md) as a developer uses it. Every quoted block is compared
// with the file it names, every command is checked against the script or test it runs, and every
// package, subpath and link is real. The cases the guide *traces* are run by
// scripts/guide-actions.test.ts; prose is not parsed for meaning.

const GUIDE = 'docs/actions.md';
const read = (file: string): string => fs.readFileSync(path.join(repoRoot, file), 'utf8');
const guide = read(GUIDE);

interface Block {
  /** `repository` for a shell block run in a checkout, otherwise the language word. */
  readonly kind: string;
  /** The source file a code block quotes, when the fence names one. */
  readonly source: string | undefined;
  readonly lines: readonly string[];
}

function blocks(markdown: string): Block[] {
  const found: Block[] = [];
  let open: { kind: string; source: string | undefined; lines: string[] } | undefined;
  for (const line of markdown.split('\n')) {
    const fence = /^```(.*)$/.exec(line);
    if (fence === null) {
      open?.lines.push(line);
      continue;
    }
    if (open) {
      found.push(open);
      open = undefined;
    } else {
      const words = (fence[1] as string).trim().split(/\s+/);
      const language = words[0] as string;
      open = {
        kind: language === 'sh' && words[1] !== undefined ? words[1] : language,
        source: language !== 'sh' && language !== 'text' && words[1] !== undefined ? words[1] : undefined,
        lines: [],
      };
    }
  }
  return found;
}

/** Lines compared without indentation or blank lines: a quoted excerpt may be indented differently from its file. */
const significant = (lines: readonly string[]): string[] => lines.map((line) => line.trim()).filter((line) => line !== '');

function containsInOrder(file: readonly string[], excerpt: readonly string[]): boolean {
  for (let start = 0; start + excerpt.length <= file.length; start += 1) {
    if (excerpt.every((line, offset) => file[start + offset] === line)) return true;
  }
  return false;
}

describe('the quoted source', () => {
  const quoted = blocks(guide).filter((block) => block.source !== undefined);

  it('quotes several files, and each block is the file\u2019s own text, in order', () => {
    expect(quoted.length).toBeGreaterThanOrEqual(10);
    for (const block of quoted) {
      const source = block.source as string;
      expect(fs.existsSync(path.join(repoRoot, source)), `${source} exists`).toBe(true);
      const excerpt = significant(block.lines);
      expect(excerpt.length, `${source} block is not empty`).toBeGreaterThan(0);
      expect(containsInOrder(significant(read(source).split('\n')), excerpt), `${source}: ${excerpt[0]}`).toBe(true);
    }
  });

  it('never quotes upstream A2UI imports for a React reader, and names the supported React entry point', () => {
    for (const block of blocks(guide).filter((one) => ['ts', 'tsx'].includes(one.kind))) {
      expect(block.lines.join('\n')).not.toMatch(/from ['"]@a2ui\/(react|web_core)/);
    }
    expect(guide).toContain('`@saga-a2ui/react/a2ui`');
  });
});

describe('the commands the guide tells a reader to type', () => {
  const commands = blocks(guide)
    .filter((block) => block.kind === 'repository')
    .flatMap((block) => block.lines)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  it('run only repository scripts and test files that exist', () => {
    const rootScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(commands).toContain('npx vitest run scripts/guide-actions.test.ts');
    for (const line of commands) {
      const script = /^npm run ([\w:.-]+)/.exec(line)?.[1];
      if (script !== undefined) expect(rootScripts, line).toHaveProperty(script);
      const tests = /^npx vitest run (scripts\/[\w./-]+\.test\.ts)$/.exec(line)?.[1];
      if (tests !== undefined) expect(fs.existsSync(path.join(repoRoot, tests)), line).toBe(true);
      expect(line, 'a command is a known form').toMatch(/^(npm ci|npm run [\w:.-]+|npx vitest run scripts\/[\w./-]+\.test\.ts)$/);
    }
  });

  it('keeps the Lit tutorial on its matched candidate packages', () => {
    expect(guide).not.toMatch(/npm (install|i|add) [^\n]*@saga-a2ui/);
    expect(guide).toContain('unpublished Lit renderer');
    expect(guide).not.toMatch(/there is no release/i);
    expect(guide).toContain('candidate-update-and-rollback.md');
  });
});

describe('the package names and subpaths the guide mentions', () => {
  const manifests = fs
    .readdirSync(path.join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(read(`packages/${entry.name}/package.json`)) as { name: string; exports?: Record<string, string> });

  it('are real packages exported at the subpath named', () => {
    const mentions = [...guide.matchAll(/@saga-a2ui\/([a-z0-9-]+)((?:\/[a-z0-9_./-]*[a-z0-9_])?)/g)];
    expect(mentions.length).toBeGreaterThan(5);
    for (const match of mentions) {
      const manifest = manifests.find((one) => one.name === `@saga-a2ui/${match[1]}`);
      expect(manifest, match[0]).toBeDefined();
      if (match[2] !== '') expect(Object.keys(manifest?.exports ?? {}), match[0]).toContain(`.${match[2]}`);
    }
  });
});

describe('links in the guide', () => {
  const slug = (heading: string): string =>
    heading
      .toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[^\p{L}\p{N} -]/gu, '')
      .trim()
      .replace(/ /g, '-');

  it('lead to files and headings that exist', () => {
    for (const match of guide.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1] as string;
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [pathPart, anchor] = target.split('#') as [string, string | undefined];
      const resolved = pathPart === '' ? path.join(repoRoot, GUIDE) : path.resolve(path.dirname(path.join(repoRoot, GUIDE)), pathPart);
      expect(fs.existsSync(resolved), `${GUIDE} links to ${target}`).toBe(true);
      if (anchor !== undefined && resolved.endsWith('.md')) {
        const headings = fs
          .readFileSync(resolved, 'utf8')
          .split('\n')
          .filter((line) => /^#{1,6} /.test(line))
          .map((line) => slug(line.replace(/^#+ /, '')));
        expect(headings, `${GUIDE} links to ${target}`).toContain(anchor);
      }
    }
  });

  it('are reachable from the setup guide, which points here instead of at the issue that asked for this guide', () => {
    const setup = read('docs/getting-started.md');
    expect(setup).toContain('(actions.md)');
    expect(setup).not.toContain('issues/27');
  });
});

describe('what the guide must explain', () => {
  const headings = guide.split('\n').filter((line) => /^#{2,3} /.test(line)).map((line) => line.replace(/^#+ /, ''));

  it('has a section for each part the issue names', () => {
    for (const required of [
      'Run it first',
      'Who owns what',
      'Types check your code; the wire is checked at run time',
      'Change a component, and what changes with it',
      'A local action first',
      'The same mechanisms in protected playback',
      'Trace one press, allowed and denied',
      'What each case returns',
      'Prerequisites: session validity, confirmation and an audit entry',
      'Outcomes, hooks and cleanup',
      'Four clocks, kept apart',
      'Two rows, one definition',
      'Disposal, ownership and hand-off',
      'What each renderer and server has shown',
      'Hapi',
      'What this guide does not show',
    ]) {
      expect(headings, required).toContain(required);
    }
  });

  it('quotes the sentences and identifiers the notes application and the starter really contain', () => {
    const sources = ['examples/pack1-consumer/src/notes-actions.ts', 'examples/pack1-consumer/src/notes-contract.ts', 'templates/lit-node/src/contract.ts', 'templates/lit-node/server/authenticate.ts']
      .map(read)
      .join('\n');
    for (const quoted of [
      'Not archived: ',
      'The server declined; nothing changed',
      'Archive status unknown',
      'This note cannot be archived.',
      'This account may not see this.',
      'sign-in-required',
      'insufficient_scope',
      'invalid_token',
      'account:read',
      'saga-starter',
      'archive_note',
      'check_session',
    ]) {
      expect(sources, quoted).toContain(quoted);
      expect(guide, quoted).toContain(quoted);
    }
  });

  it('states the defaults the runtime actually has', () => {
    const resolved = resolveLimits({}, {});
    const seconds = (ms: number): string => `${ms / 1000} s`;
    const table = guide.slice(guide.indexOf('### Four clocks, kept apart'), guide.indexOf('The rules that connect them'));
    const rows = Object.fromEntries(table.split('\n').filter((line) => line.startsWith('| ')).map((line) => [line.split('|')[1]?.trim(), line.split('|')[2]?.trim()]));
    expect(rows['Work deadline']).toBe(seconds(resolved.deadlineMs));
    expect(rows['Hook or cleanup step']).toBe(seconds(resolved.hookMs));
    expect(rows['Server operation']).toBe(seconds(DEFAULT_OPERATION_MS));
    expect(rows['Server request']).toBe(seconds(DEFAULT_REQUEST_MS));
  });

  it('does not claim Hapi identity handoff before a Hapi recipe is qualified, and must trace it once one is', () => {
    const hapi = QUALIFIED_STARTERS.filter((name) => readTemplateMetadata(templateDirectory(name)).server === 'hapi');
    const section = guide.slice(guide.indexOf('### Hapi'), guide.indexOf('## What this guide does not show'));
    if (hapi.length === 0) {
      expect(section).toContain('no qualified recipe');
      expect(section).toContain('issues/65');
    } else {
      expect(section, 'a qualified Hapi template needs its identity handoff traced here').toMatch(/identity handoff/i);
      expect(section).not.toContain('no qualified recipe');
    }
  });

  it('keeps Lynx as history and claims no pair, renderer or host the evidence does not show', () => {
    const prose = guide.replace(/```[\s\S]*?```/g, '');
    for (const line of prose.split('\n').filter((one) => /lynx/i.test(one))) expect(line).toMatch(/retired|history/i);
    expect(guide).toMatch(/not shown/i);
    expect(guide).toMatch(/no React starter, template, CLI pair or authenticated recipe/);
    expect(guide).not.toMatch(/\bhapi\b[^\n]*\bis qualified\b/i);
  });
});
