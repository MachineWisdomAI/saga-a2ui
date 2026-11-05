import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INCLUDE,
  blankComments,
  repoRoot,
  selectFiles,
  type ExcludeEntry,
  type IncludeEntry,
} from './consumer-boundary.js';

// The official MCP server counts the array elements and object members of one tools/call payload
// only when it is given `maxToolInputElements`; with none it accepts any payload the transport
// reads. Every maintained server therefore passes the one shared default, and a server (or a
// documented snippet someone copies) that omits it is a regression this scan reports by line.

const CONSTRUCTION = /\bnew\s+McpServer\s*\(/g;
const LIMIT = /\bmaxToolInputElements\s*:\s*DEFAULT_MAX_TOOL_INPUT_ELEMENTS\b/;

interface Construction {
  readonly line: number;
  readonly limited: boolean;
}

/** The text of the argument list that opens at `open` (a "("), skipping strings, or undefined if unbalanced. */
function argumentsFrom(code: string, open: number): string | undefined {
  let depth = 0;
  let quote: string | undefined;
  for (let index = open; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote !== undefined) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, index);
    }
  }
  return undefined;
}

/** Every `new McpServer(...)` in a text of code, and whether its arguments pass the shared limit. */
function constructions(text: string, isCode = true): Construction[] {
  // Prose is not code: its apostrophes would read as strings, so a guide is scanned as written.
  // It is scanned whole, not by fence, so an indented example block is read too.
  const code = isCode ? blankComments(text) : text;
  return [...code.matchAll(CONSTRUCTION)].map((found) => {
    const open = found.index + found[0].length - 1;
    const args = argumentsFrom(code, open);
    if (args === undefined)
      throw new Error(`unbalanced new McpServer( at offset ${found.index}`);
    return {
      line: code.slice(0, found.index).split('\n').length,
      limited: LIMIT.test(args),
    };
  });
}

// Maintained servers and the guides that quote them. The consumer-boundary selection supplies the
// templates, examples, demonstration, host application and guides; the qualification consumers
// that run from packed tarballs are added here.
const EXTRA_INCLUDE: readonly IncludeEntry[] = [
  { glob: 'scripts/fixtures/mcp-server-consumer.ts', kind: 'code' },
  { glob: 'scripts/request-consumer/server.ts', kind: 'code' },
  { glob: 'scripts/fetch-consumer/app.ts', kind: 'code' },
];
const EXCLUDE: readonly ExcludeEntry[] = [
  {
    glob: 'apps/lit-host/e2e/**',
    reason: 'protocol and host qualification fixtures',
  },
  { glob: 'apps/lynx-fixture/**', reason: 'a retained, separate fixture' },
  { glob: '**/*.test.{ts,tsx}', reason: 'tests construct doubles' },
  { glob: '**/*.test-support.ts', reason: 'test support' },
  {
    glob: 'docs/tic-tac-toe/**',
    reason:
      'the tutorial quotes an external application at a pinned revision, installed from published packages; it moves with that application, not with this tree',
  },
  {
    glob: 'docs/build-tic-tac-toe-with-react.md',
    reason: 'the tutorial overview, same pinned application',
  },
];

function unlimitedServers(root: string): {
  readonly files: string[];
  readonly total: number;
  readonly unlimited: string[];
} {
  const selected = selectFiles(root, [...INCLUDE, ...EXTRA_INCLUDE], EXCLUDE);
  const unlimited: string[] = [];
  let total = 0;
  for (const { file, kind } of selected) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const found = constructions(text, kind === 'code');
    total += found.length;
    for (const one of found)
      if (!one.limited) unlimited.push(`${file}:${one.line}`);
  }
  return { files: selected.map((one) => one.file), total, unlimited };
}

describe('the construction scan', () => {
  it('reports a server built without the shared limit, by line', () => {
    expect(
      constructions(
        "const a = 1;\nconst server = new McpServer({ name: 'x', version: '1' });",
      ),
    ).toEqual([{ line: 2, limited: false }]);
    expect(
      constructions(
        "new McpServer({ name: 'x', version: '1' }, { maxToolInputElements: 5 });",
      ),
    ).toEqual([{ line: 1, limited: false }]);
    expect(
      constructions('new McpServer({ name: f(")"), version: "1" }, {});'),
    ).toEqual([{ line: 1, limited: false }]);
  });

  it('accepts the shared default however the call is formatted', () => {
    expect(
      constructions(
        "new McpServer(\n  { name: 'x', version: '1' },\n  {\n    maxToolInputElements:\n      DEFAULT_MAX_TOOL_INPUT_ELEMENTS,\n  },\n);",
      ),
    ).toEqual([{ line: 1, limited: true }]);
    expect(
      constructions(
        "new McpServer({ name: f('('), version: '1' }, { maxToolInputElements: DEFAULT_MAX_TOOL_INPUT_ELEMENTS });",
      ),
    ).toEqual([{ line: 1, limited: true }]);
  });

  it('does not let a comment or another call stand in for the option', () => {
    expect(
      constructions(
        "new McpServer({ name: 'x', version: '1' }); // maxToolInputElements: DEFAULT_MAX_TOOL_INPUT_ELEMENTS",
      ),
    ).toEqual([{ line: 1, limited: false }]);
    expect(
      constructions(
        "new McpServer({ name: 'x', version: '1' });\nconst limit = { maxToolInputElements: DEFAULT_MAX_TOOL_INPUT_ELEMENTS };",
      ),
    ).toEqual([{ line: 1, limited: false }]);
    expect(constructions('// new McpServer({})\nconst a = 1;')).toEqual([]);
  });

  it('reads an example in a guide, fenced or indented, at its line', () => {
    const markdown = [
      'Prose that mentions `McpServer` is not a construction.',
      '```ts',
      "const server = new McpServer({ name: 'x', version: '1' });",
      '```',
      '',
      "    const other = new McpServer({ name: 'y', version: '1' });",
    ].join('\n');
    expect(constructions(markdown, false)).toEqual([
      { line: 3, limited: false },
      { line: 6, limited: false },
    ]);
  });
});

describe('the maintained servers', () => {
  const report = unlimitedServers(repoRoot);

  it('scans the servers it exists to guard', () => {
    // A floor, so a moved directory or a pattern that stops matching cannot pass by finding nothing.
    expect(report.total).toBeGreaterThanOrEqual(30);
    for (const required of [
      'templates/lit-node/server/operations.ts',
      'templates/react-hono/server/operations.ts',
      'apps/lit-host/src/mcp/server.ts',
      'examples/pack1-consumer/server/notes-server.ts',
      'docs/attach-to-existing-backend.md',
      'docs/local-mcp-server.md',
      'docs/fetch-mcp-hosting.md',
    ])
      expect(report.files).toContain(required);
  });

  it('gives every one the shared tool input element limit', () => {
    expect(report.unlimited).toEqual([]);
  });
});
