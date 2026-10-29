import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blankComments, repoRoot } from './consumer-boundary.js';

// What an application's view code may import once it installs a stack: the stack's own entries and
// the framework it peers on, plus the application's own third-party packages. Upstream's renderer
// and schema packages and the lower SDK packages arrive through the stack, so a view that names
// one is leaning on a hoisted install or on a stack export that is missing.
//
// This is a separate check from the consumer boundary scan (scripts/consumer-boundary.test.ts),
// which looks for the SDK's own glue written again; it does not change that scan's rules. Every
// file is stack-only unless it appears below with a reason. Server code is not view code and is
// not scanned here: a server keeps the delivery package's server export (`@saga-a2ui/mcp/server`).
//
// The packed, strict-peer proof that a stack-only application installs and compiles is
// scripts/check-react-pnpm.ts; this test keeps the maintained consumers on the same footing.

type Stack = 'lit' | 'react';
type Role =
  | { readonly kind: 'stack'; readonly stack: Stack }
  | { readonly kind: 'neutral'; readonly reason: string }
  | { readonly kind: 'lower-level'; readonly reason: string };

const STACK_PACKAGE: Record<Stack, string> = {
  lit: '@saga-a2ui/lit-mcp-stack',
  react: '@saga-a2ui/react-mcp-stack',
};
const FRAMEWORK: Record<Stack, RegExp> = {
  lit: /^lit(\/.*)?$/,
  react: /^react(-dom)?(\/.*)?$/,
};
/** The application's own third-party packages: its wire contract and the types of its MCP client. */
const APPLICATION_OWN = /^(zod|@modelcontextprotocol\/client)$/;

const stack = (which: Stack): Role => ({ kind: 'stack', stack: which });
const SHARED_BY_TWO_RENDERERS =
  'renderer-neutral application module shared by the Lit and React consumers of one example, which cannot name either stack';

interface Unit {
  readonly name: string;
  readonly directory: string;
  /** The role of each file under `src`; a file with no entry fails the test until it is classified. */
  readonly roles: (file: string) => Role | undefined;
}

const every =
  (role: Role) =>
  (file: string): Role | undefined =>
    /\.(ts|tsx)$/.test(file) && !/\.d\.ts$/.test(file) ? role : undefined;

const UNITS: readonly Unit[] = [
  ...['node', 'express', 'fastify', 'hono', 'hapi'].map((server): Unit => ({
    name: `templates/lit-${server}`,
    directory: `templates/lit-${server}`,
    roles: every(stack('lit')),
  })),
  {
    name: 'templates/react-hono',
    directory: 'templates/react-hono',
    roles: every(stack('react')),
  },
  {
    name: 'examples/pack1-consumer',
    directory: 'examples/pack1-consumer',
    roles: (file) => {
      if (/^(main-own|notes-view|notes-catalog)\.ts$/.test(file))
        return stack('lit');
      if (
        /^(main-react|notes-react-view|notes-react-catalog)\.tsx?$/.test(file)
      )
        return stack('react');
      if (file === 'main-card.ts')
        return {
          kind: 'lower-level',
          reason:
            'the optional FaithfulCard entry inside an own catalog, which neither stack exports yet',
        };
      if (
        /^(notes-actions|notes-controller|notes-surface|notes-contract|notes-line|row-holds)\.ts$/.test(
          file,
        )
      )
        return { kind: 'neutral', reason: SHARED_BY_TWO_RENDERERS };
      return undefined;
    },
  },
  {
    name: 'examples/answer-consumer',
    directory: 'examples/answer-consumer',
    roles: (file) => {
      if (/^(mcp-main|answer-result|branding|answer-function)\.ts$/.test(file))
        return stack('lit');
      if (/^(main|answer-app|answer-policy)\.ts$/.test(file))
        return {
          kind: 'lower-level',
          reason:
            'the standalone page: no MCP host, so the Lit card package and the components package are used directly',
        };
      return undefined;
    },
  },
  {
    name: 'examples/react-card-consumer',
    directory: 'examples/react-card-consumer',
    roles: every(stack('react')),
  },
  {
    name: 'examples/tic-tac-toe',
    directory: 'examples/tic-tac-toe',
    roles: every(stack('react')),
  },
];

/** Every module specifier a text of code imports, exports from or loads, comments blanked. */
function specifiers(text: string): string[] {
  const code = blankComments(text);
  const found: string[] = [];
  for (const pattern of [
    /\bfrom\s*(['"`])([^'"`]+)\1/g,
    /\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,
    /(?<![\w$.])import\s*(['"`])([^'"`]+)\1/g,
  ])
    for (const one of code.matchAll(pattern)) found.push(one[2]!);
  return found;
}

const isRelativeOrAsset = (specifier: string): boolean =>
  specifier.startsWith('.') || specifier.startsWith('node:');
const packageOf = (specifier: string): string =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]!;

/** Why a specifier is not allowed in a file of this role, or undefined when it is allowed. */
export function violationOf(role: Role, specifier: string): string | undefined {
  if (isRelativeOrAsset(specifier)) return undefined;
  const owner = packageOf(specifier);
  if (role.kind === 'lower-level')
    return owner.startsWith('@a2ui/')
      ? 'names an upstream renderer or schema package'
      : undefined;
  if (APPLICATION_OWN.test(owner)) return undefined;
  if (role.kind === 'neutral')
    return /^@saga-a2ui\/core(\/|$)/.test(specifier) ||
      FRAMEWORK.react.test(specifier) ||
      FRAMEWORK.lit.test(specifier)
      ? undefined
      : 'names a package outside the neutral set (core)';
  if (owner === STACK_PACKAGE[role.stack]) return undefined;
  if (FRAMEWORK[role.stack].test(specifier)) return undefined;
  return `is not a ${role.stack} stack entry, its framework or an application-own package`;
}

const sourceFiles = (directory: string): string[] => {
  const found: string[] = [];
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else found.push(full);
    }
  };
  visit(directory);
  return found.sort();
};

describe('the maintained consumers import their stack', () => {
  it('has a role for every view file, so a new file is classified before it is accepted', () => {
    for (const unit of UNITS) {
      const source = path.join(repoRoot, unit.directory, 'src');
      const unclassified = sourceFiles(source)
        .map((file) => path.relative(source, file))
        .filter(
          (file) =>
            /\.(ts|tsx)$/.test(file) &&
            !/\.d\.ts$/.test(file) &&
            unit.roles(file) === undefined,
        );
      expect(unclassified, unit.name).toEqual([]);
    }
  });

  it.each(UNITS)(
    "$name: view files import only their stack, its framework and the application's own packages",
    (unit) => {
      const source = path.join(repoRoot, unit.directory, 'src');
      const found: string[] = [];
      let scanned = 0;
      for (const file of sourceFiles(source)) {
        const relative = path.relative(source, file);
        const role = unit.roles(relative);
        if (role === undefined) continue;
        scanned += 1;
        for (const specifier of specifiers(fs.readFileSync(file, 'utf8'))) {
          const why = violationOf(role, specifier);
          if (why !== undefined) found.push(`${relative}: ${specifier} ${why}`);
        }
      }
      // The sources were really read.
      expect(scanned).toBeGreaterThan(3);
      expect(found).toEqual([]);
    },
  );

  it.each(UNITS)(
    '$name: declares no upstream renderer or schema package, and every SDK package its view files import',
    (unit) => {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(repoRoot, unit.directory, 'package.json'),
          'utf8',
        ),
      ) as { dependencies: Record<string, string> };
      const declared = Object.keys(manifest.dependencies);
      expect(
        declared.filter((name) => name.startsWith('@a2ui/')),
        `${unit.name} declares upstream packages the stack already brings`,
      ).toEqual([]);
      const source = path.join(repoRoot, unit.directory, 'src');
      const imported = new Set<string>();
      for (const file of sourceFiles(source)) {
        if (unit.roles(path.relative(source, file)) === undefined) continue;
        for (const specifier of specifiers(fs.readFileSync(file, 'utf8')))
          if (!isRelativeOrAsset(specifier)) imported.add(packageOf(specifier));
      }
      for (const name of imported)
        expect(
          declared,
          `${unit.name} imports ${name} without declaring it`,
        ).toContain(name);
    },
  );

  it('rejects a view file that names what the stack exports', () => {
    const own = stack('lit');
    for (const [specifier, expected] of [
      ['@a2ui/lit/v0_9', false],
      ['@a2ui/web_core/v0_9', false],
      ['@saga-a2ui/core/actions', false],
      ['@saga-a2ui/lit/actions', false],
      ['@saga-a2ui/react-mcp-stack', false],
      ['@saga-a2ui/lit-mcp-stack', true],
      ['@saga-a2ui/lit-mcp-stack/faithful-card', true],
      ['lit', true],
      ['lit/directives/ref.js', true],
      ['react', false],
      ['zod', true],
      ['./catalog.js', true],
    ] as const)
      expect(violationOf(own, specifier) === undefined, specifier).toBe(
        expected,
      );
    expect(
      violationOf(
        { kind: 'neutral', reason: SHARED_BY_TWO_RENDERERS },
        '@saga-a2ui/lit-mcp-stack',
      ),
    ).toBeDefined();
    expect(
      violationOf({ kind: 'lower-level', reason: 'x' }, '@a2ui/lit/v0_9'),
    ).toBeDefined();
  });

  it('finds the specifiers of every import form and ignores comments', () => {
    expect(
      specifiers(
        [
          "import a from 'one';",
          'import { b } from "two";',
          "export { c } from 'three';",
          "import 'four';",
          "const d = await import('five');",
          "// import x from 'commented';",
          "/* import y from 'blocked'; */",
        ].join('\n'),
      ).sort(),
    ).toEqual(['five', 'four', 'one', 'three', 'two']);
  });
});
