import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The consumer boundary scan: a guard against duplicated integration rules in code that is meant to
// hold application meaning only. It is not a ban on the supported lower-level interfaces: an
// application that authors its own catalog needs upstream's component API, and one reviewed line
// may say so (`// saga-boundary: <rule> <reason>`). What it reports is the SDK's own glue written
// again in a consumer: A2UI wire messages, the MCP Apps bridge, and the protocol session.
//
// The scan reports counts; the verdict (zero unexempted hits, a floor on the files read, every
// template directory present) belongs to scripts/consumer-boundary.test.ts. A raw `pagehide`
// listener is application behavior, not a rule.

export type RuleName = 'wire-literal' | 'integration-import' | 'session-symbol';

export interface Rule {
  readonly name: RuleName;
  readonly description: string;
  /** The text of each match on one line of code (comments are already blanked). */
  readonly match: (code: string) => string[];
}

const all = (pattern: RegExp, code: string): string[] =>
  [...code.matchAll(pattern)].map((one) => one[0]);

const IMPORT_FORM = String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)`;
// The bridge is the view side of MCP Apps: the package and its client subpaths. Its `/server`
// subpath registers tools on a server and is not view glue, so it is not part of the rule.
const FORBIDDEN_MODULE = String.raw`(?:@modelcontextprotocol/ext-apps(?:/(?!server\b)[^'"\`]*)?|@saga-a2ui/mcp/view|@a2ui/[^'"\`]+)`;

export const RULES: readonly Rule[] = [
  {
    name: 'wire-literal',
    description:
      "A2UI wire literals: createSurface:, updateComponents:, updateDataModel:, version: 'v0.9'",
    match: (code) => [
      ...all(/\b(?:createSurface|updateComponents|updateDataModel)\s*:/g, code),
      ...all(/\bversion\s*:\s*['"]v0\.9['"]/g, code),
    ],
  },
  {
    name: 'integration-import',
    description:
      'imports of @modelcontextprotocol/ext-apps, @saga-a2ui/mcp/view and @a2ui/*',
    match: (code) =>
      all(
        new RegExp(`${IMPORT_FORM}['"\`]${FORBIDDEN_MODULE}['"\`]`, 'g'),
        code,
      ),
  },
  {
    name: 'session-symbol',
    description:
      'the createMessageSession, a2uiV0_9Decoder and IngestResult symbols',
    match: (code) =>
      all(/\b(?:createMessageSession|a2uiV0_9Decoder|IngestResult)\b/g, code),
  },
];

const RULE_NAMES = new Set<string>(RULES.map((rule) => rule.name));

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly rule: RuleName;
  readonly text: string;
  /** The reason on the exemption that covers this hit, when one does. */
  readonly exemption?: string;
}

/** A malformed or stale exemption: the exemption mechanism is itself checked. */
export interface Problem {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

export interface FileScan {
  /** Hits no exemption covers. */
  readonly hits: Hit[];
  /** Hits an exemption names by rule and gives a reason for. */
  readonly exempt: Hit[];
  readonly problems: Problem[];
}

/**
 * Blanks comments (keeping every line break and every string), so a rule never reads prose. The
 * exemption itself is read from the raw line.
 */
export function blankComments(text: string): string {
  let out = '';
  let state: 'code' | 'line' | 'block' | "'" | '"' | '`' = 'code';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];
    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      } else out += ' ';
    } else if (state === 'block') {
      if (char === '*' && next === '/') {
        out += '  ';
        index += 1;
        state = 'code';
      } else out += char === '\n' ? '\n' : ' ';
    } else if (state === 'code') {
      if (char === '/' && next === '/') {
        out += '  ';
        index += 1;
        state = 'line';
      } else if (char === '/' && next === '*') {
        out += '  ';
        index += 1;
        state = 'block';
      } else {
        if (char === "'" || char === '"' || char === '`') state = char;
        out += char;
      }
    } else {
      // Inside a string: keep it; a backslash escapes the next character; only a template spans lines.
      out += char;
      if (char === '\\' && next !== undefined) {
        out += next;
        index += 1;
      } else if (char === state) state = 'code';
      else if (char === '\n' && state !== '`') state = 'code';
    }
  }
  return out;
}

const EXEMPTION = /\/\/\s*saga-boundary:\s*(.*)$/;

interface ParsedExemption {
  readonly rules: RuleName[];
  readonly reason: string;
}

/** `// saga-boundary: <rule>[, <rule>] <reason>`; undefined with the problem when it is not that. */
function parseExemption(raw: string): ParsedExemption | string | undefined {
  const found = EXEMPTION.exec(raw);
  if (found === null)
    return /saga-boundary/.test(raw)
      ? 'malformed exemption: use "// saga-boundary: <rule> <reason>"'
      : undefined;
  const body = found[1]!.trim();
  const match = /^([a-z-]+(?:\s*,\s*[a-z-]+)*)\s+(\S.*)$/.exec(body);
  if (match === null)
    return 'malformed exemption: it must name a rule and then give a reason';
  const rules = match[1]!.split(/\s*,\s*/);
  const unknown = rules.filter((rule) => !RULE_NAMES.has(rule));
  if (unknown.length > 0)
    return `exemption names unknown rule ${unknown.join(', ')}`;
  return { rules: rules as RuleName[], reason: match[2]!.trim() };
}

/** Scans lines of code. `lineOffset` is the line number of the first line within its file. */
function scanLines(
  file: string,
  rawLines: readonly string[],
  codeLines: readonly string[],
  lineOffset: number,
): FileScan {
  const hits: Hit[] = [];
  const exempt: Hit[] = [];
  const problems: Problem[] = [];
  rawLines.forEach((raw, index) => {
    const line = lineOffset + index;
    const parsed = parseExemption(raw);
    if (typeof parsed === 'string')
      problems.push({ file, line, message: parsed });
    const covered = typeof parsed === 'object' ? parsed : undefined;
    const matched = new Set<RuleName>();
    for (const rule of RULES) {
      for (const text of rule.match(codeLines[index] ?? '')) {
        matched.add(rule.name);
        if (covered?.rules.includes(rule.name))
          exempt.push({
            file,
            line,
            rule: rule.name,
            text,
            exemption: covered.reason,
          });
        else hits.push({ file, line, rule: rule.name, text });
      }
    }
    for (const named of covered?.rules ?? [])
      if (!matched.has(named))
        problems.push({
          file,
          line,
          message: `stale exemption: no ${named} hit on this line`,
        });
  });
  return { hits, exempt, problems };
}

/** The info string of a fence that marks old code on purpose. */
export const TEACHING_FENCE = /\b(?:before|historical)\b/i;

/** Scans a source file. */
export function scanCode(file: string, text: string): FileScan {
  return scanLines(file, text.split('\n'), blankComments(text).split('\n'), 1);
}

/** Scans the code fences of a Markdown file, except those whose info string says `before` or `historical`. */
export function scanMarkdown(file: string, text: string): FileScan {
  const result: { hits: Hit[]; exempt: Hit[]; problems: Problem[] } = {
    hits: [],
    exempt: [],
    problems: [],
  };
  const lines = text.split('\n');
  let open: { marker: string; info: string; start: number } | undefined;
  const fenceLines: string[] = [];
  const flush = (): void => {
    if (open === undefined || TEACHING_FENCE.test(open.info)) return;
    const code = blankComments(fenceLines.join('\n')).split('\n');
    const scan = scanLines(file, fenceLines, code, open.start + 1);
    result.hits.push(...scan.hits);
    result.exempt.push(...scan.exempt);
    result.problems.push(...scan.problems);
  };
  lines.forEach((line, index) => {
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open === undefined) {
      if (fence !== null)
        open = { marker: fence[1]!, info: fence[2]!, start: index + 1 };
      return;
    }
    if (
      fence !== null &&
      fence[1]![0] === open.marker[0] &&
      fence[1]!.length >= open.marker.length &&
      fence[2]!.trim() === ''
    ) {
      flush();
      open = undefined;
      fenceLines.length = 0;
      return;
    }
    fenceLines.push(line);
  });
  return result;
}

// --- What is scanned -------------------------------------------------------------------------

export interface IncludeEntry {
  readonly glob: string;
  readonly kind: 'code' | 'markdown';
}

export interface ExcludeEntry {
  readonly glob: string;
  readonly reason: string;
}

/**
 * Explicit include list. Every entry must match at least one file: an empty glob or a directory
 * that moved fails the scan loudly instead of passing it silently.
 */
export const INCLUDE: readonly IncludeEntry[] = [
  { glob: 'templates/*/src/**/*.{ts,tsx}', kind: 'code' },
  { glob: 'examples/*/src/**/*.{ts,tsx}', kind: 'code' },
  { glob: 'apps/lit-host/src/mcp/**/*.ts', kind: 'code' },
  { glob: 'apps/lit-host/src/answer-card/**/*.ts', kind: 'code' },
  { glob: 'apps/lit-host/src/playback/**/*.ts', kind: 'code' },
  { glob: 'apps/lit-host/src/lit/**/*.ts', kind: 'code' },
  { glob: 'apps/lit-host/src/react/**/*.{ts,tsx}', kind: 'code' },
  { glob: 'apps/lit-host/src/*-main.{ts,tsx}', kind: 'code' },
  { glob: 'README.md', kind: 'markdown' },
  { glob: 'docs/**/*.md', kind: 'markdown' },
  { glob: 'packages/README.md', kind: 'markdown' },
  { glob: 'packages/*/README.md', kind: 'markdown' },
  { glob: 'templates/**/*.md', kind: 'markdown' },
  { glob: 'demo/**/*.md', kind: 'markdown' },
  { glob: 'blueprints/features/*.md', kind: 'markdown' },
];

/**
 * Explicit exclude list; each entry says why. No entire maintained application is excluded: the
 * templates and examples are scanned whole, and the host application is scanned except for the
 * modules that are the host side of the bridge.
 */
export const EXCLUDE: readonly ExcludeEntry[] = [
  {
    glob: 'apps/lit-host/src/main.ts',
    reason:
      'host side: the page that plays the host sends A2UI messages to the view it mounts, and host-side SDK interfaces are legitimate',
  },
  {
    glob: 'apps/lit-host/src/saga-panel/**',
    reason:
      'host side: the panel contract and its wire fixtures are what the host page sends',
  },
  {
    glob: 'apps/lit-host/src/lit/saga-app.ts',
    reason:
      "host side: the window.sagaSend hook relays the host page's protocol messages into the mounted session, and only main.ts uses it",
  },
  {
    glob: 'apps/lit-host/e2e/**',
    reason:
      'protocol and host qualification fixtures send wire messages by design',
  },
  {
    glob: 'apps/lynx-fixture/**',
    reason:
      'a retained qualification fixture, a separate project outside the workspace',
  },
  {
    glob: '**/*.test.{ts,tsx}',
    reason: 'tests state wire messages and doubles to check the SDK',
  },
  {
    glob: '**/*.test-support.ts',
    reason: 'test support, like the tests that use it',
  },
  {
    glob: 'docs/2026-*',
    reason: 'dated observations are historical records and are not edited',
  },
];

/** The required templates that no scanned file belongs to: an empty result means all of them are scanned. */
export function unscannedTemplates(
  files: readonly string[],
  required: readonly string[] = REQUIRED_TEMPLATES,
): string[] {
  return required.filter(
    (name) => !files.some((file) => file.startsWith(`templates/${name}/src/`)),
  );
}

/** The directories every maintained template must have, each scanned; a missing one fails the scan. */
export const REQUIRED_TEMPLATES = [
  'lit-node',
  'lit-express',
  'lit-fastify',
  'lit-hono',
  'lit-hapi',
] as const;

/** `*` is within one path segment, `**` crosses segments, `{a,b}` is a choice; the match covers the whole path. */
export const globToRegExp = (glob: string): RegExp => {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === '*' && glob[index + 1] === '*') {
      index += 1;
      if (glob[index + 1] === '/') {
        index += 1;
        source += '(?:.*/)?';
      } else source += '.*';
    } else if (char === '*') source += '[^/]*';
    else if (char === '{') {
      const end = glob.indexOf('}', index);
      source += `(?:${glob
        .slice(index + 1, end)
        .split(',')
        .map(escape)
        .join('|')})`;
      index = end;
    } else source += escape(char);
  }
  return new RegExp(`^${source}$`);
};

const escape = (text: string): string =>
  text.replace(/[.+^$()|[\]\\?]/g, '\\$&');

const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'dist-installed',
  '.git',
  '.worktrees',
  '.wise-agents',
  'test-results',
  'playwright-report',
]);

function walk(root: string, directory = ''): string[] {
  return fs
    .readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relative =
        directory === '' ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory())
        return SKIPPED_DIRECTORIES.has(entry.name) ? [] : walk(root, relative);
      return [relative];
    });
}

/** A scan configuration that cannot be trusted: an include entry matched nothing. */
export class ScanConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanConfigurationError';
  }
}

export interface ScannedFile {
  readonly file: string;
  readonly kind: 'code' | 'markdown';
}

/** The files the configuration selects under `root`. Throws when an include entry selects nothing. */
export function selectFiles(
  root: string,
  include: readonly IncludeEntry[] = INCLUDE,
  exclude: readonly ExcludeEntry[] = EXCLUDE,
): ScannedFile[] {
  const everything = walk(root);
  const excluded = exclude.map((entry) => globToRegExp(entry.glob));
  const selected = new Map<string, 'code' | 'markdown'>();
  for (const entry of include) {
    const pattern = globToRegExp(entry.glob);
    const matches = everything.filter((file) => pattern.test(file));
    if (matches.length === 0)
      throw new ScanConfigurationError(
        `the include entry ${entry.glob} matches no file under ${root}`,
      );
    for (const file of matches)
      if (!excluded.some((one) => one.test(file)))
        selected.set(file, entry.kind);
  }
  return [...selected]
    .map(([file, kind]) => ({ file, kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export interface Report {
  readonly files: string[];
  readonly hits: Hit[];
  readonly exempt: Hit[];
  readonly problems: Problem[];
}

/** Scans every selected file. */
export function scan(
  root: string,
  include: readonly IncludeEntry[] = INCLUDE,
  exclude: readonly ExcludeEntry[] = EXCLUDE,
): Report {
  const selected = selectFiles(root, include, exclude);
  const report = {
    files: [] as string[],
    hits: [] as Hit[],
    exempt: [] as Hit[],
    problems: [] as Problem[],
  };
  for (const { file, kind } of selected) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const result = (kind === 'markdown' ? scanMarkdown : scanCode)(file, text);
    report.files.push(file);
    report.hits.push(...result.hits);
    report.exempt.push(...result.exempt);
    report.problems.push(...result.problems);
  }
  return report;
}

/** Hit counts per rule, for the Blueprint's evidence and the review. Counts, not a verdict. */
export function countsByRule(hits: readonly Hit[]): Record<RuleName, number> {
  const counts: Record<RuleName, number> = {
    'wire-literal': 0,
    'integration-import': 0,
    'session-symbol': 0,
  };
  for (const hit of hits) counts[hit.rule] += 1;
  return counts;
}

export function formatReport(report: Report): string {
  const lines = [
    `files scanned: ${report.files.length}`,
    `hits: ${report.hits.length} ${JSON.stringify(countsByRule(report.hits))}`,
    `exempt (reasoned, per line): ${report.exempt.length} ${JSON.stringify(countsByRule(report.exempt))}`,
    `exemption problems: ${report.problems.length}`,
  ];
  for (const hit of report.hits)
    lines.push(`HIT ${hit.file}:${hit.line} [${hit.rule}] ${hit.text}`);
  for (const problem of report.problems)
    lines.push(`PROBLEM ${problem.file}:${problem.line} ${problem.message}`);
  return lines.join('\n');
}

export const repoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = scan(repoRoot);
  console.log(formatReport(report));
  if (process.argv.includes('--exempt'))
    for (const hit of report.exempt)
      console.log(
        `EXEMPT ${hit.file}:${hit.line} [${hit.rule}] ${hit.exemption}`,
      );
  process.exitCode = report.hits.length + report.problems.length === 0 ? 0 : 1;
}
