import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The dependency direction of each SDK package, as data and as one check. Every package's
// `exports.test.ts` asserts its own row against its manifest and its source, and proves with a
// wrong-direction fixture that the check can fail. The rows restate the layout in
// packages/README.md ("Dependencies and versions"): core imports no delivery, renderer or DOM;
// delivery imports core only; components import core only and no DOM; renderers import core and
// components; only a stack package connects a renderer to a delivery.

export type PackageName =
  | 'core'
  | 'mcp'
  | 'components'
  | 'lit'
  | 'react'
  | 'lit-mcp-stack'
  | 'react-mcp-stack';

export interface DirectionRule {
  /** SAGA packages this one may depend on and import. Any other `@saga-a2ui/*` specifier is a violation. */
  readonly sagaMayImport: readonly PackageName[];
  /** Third-party modules this package must never import or declare (matched on the package name). */
  readonly forbiddenModules: RegExp;
  /** True for a package whose executable code must not name a browser object (it runs without a DOM). */
  readonly noDom: boolean;
}

const MCP = /^@modelcontextprotocol\//;
const LIT = /^(lit|lit-html|lit-element|@lit(-labs)?\/.*|@a2ui\/lit)$/;
const REACT = /^(react|react-dom|react\/.*|react-dom\/.*|@a2ui\/react)$/;
const any = (...parts: RegExp[]): RegExp =>
  new RegExp(parts.map((part) => `(?:${part.source})`).join('|'));

export const DIRECTIONS: Readonly<Record<PackageName, DirectionRule>> = {
  core: {
    sagaMayImport: [],
    forbiddenModules: any(MCP, LIT, REACT),
    noDom: true,
  },
  mcp: {
    sagaMayImport: ['core'],
    forbiddenModules: any(LIT, REACT),
    noDom: false,
  },
  components: {
    sagaMayImport: ['core'],
    forbiddenModules: any(MCP, LIT, REACT),
    noDom: true,
  },
  lit: {
    sagaMayImport: ['core', 'components'],
    forbiddenModules: any(MCP, REACT),
    noDom: false,
  },
  react: {
    sagaMayImport: ['core', 'components'],
    forbiddenModules: any(MCP, LIT),
    noDom: false,
  },
  'lit-mcp-stack': {
    sagaMayImport: ['core', 'components', 'mcp', 'lit'],
    forbiddenModules: REACT,
    noDom: false,
  },
  'react-mcp-stack': {
    sagaMayImport: ['core', 'components', 'mcp', 'react'],
    forbiddenModules: LIT,
    noDom: false,
  },
};

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

export interface Violation {
  readonly where: string;
  readonly message: string;
}

const COMMENTS = /\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/.*$/gm;
const DOM = /\b(document\.|window\.|customElements\b|HTMLElement\b)/;
const SPECIFIER = new RegExp(
  [
    String.raw`\b(?:import|export)\b[^'"\`;]*?\bfrom\s*['"]([^'"]+)['"]`,
    String.raw`\bimport\s*['"]([^'"]+)['"]`,
    String.raw`\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)`,
  ].join('|'),
  'g',
);

/** The module specifiers a source file imports (static, side-effect, dynamic and re-export forms). */
export function importSpecifiers(text: string): string[] {
  const code = text.replace(COMMENTS, '$1');
  return [...code.matchAll(SPECIFIER)].map(
    (match) => (match[1] ?? match[2] ?? match[3]) as string,
  );
}

/** `@saga-a2ui/mcp/view` -> `mcp`; undefined for anything that is not an SDK package. */
function sagaPackageOf(specifier: string): string | undefined {
  const match = /^@saga-a2ui\/([^/]+)/.exec(specifier);
  return match?.[1];
}

/** The module a specifier names: `@scope/name` or `name`, without a subpath. */
function moduleOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * Checks one package against its direction row: its manifest's declared dependencies and every
 * import in its non-test source. A package may name itself.
 */
export function directionViolations(
  name: PackageName,
  manifest: PackageManifest,
  files: readonly SourceFile[],
): Violation[] {
  const rule = DIRECTIONS[name];
  const violations: Violation[] = [];

  const judge = (where: string, specifier: string): void => {
    const saga = sagaPackageOf(specifier);
    if (saga !== undefined) {
      if (saga !== name && !(rule.sagaMayImport as string[]).includes(saga))
        violations.push({
          where,
          message: `${name} must not depend on @saga-a2ui/${saga} (${specifier})`,
        });
      return;
    }
    if (rule.forbiddenModules.test(moduleOf(specifier)))
      violations.push({
        where,
        message: `${name} must not depend on ${moduleOf(specifier)} (${specifier})`,
      });
  };

  for (const field of [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
  ] as const)
    for (const dependency of Object.keys(manifest[field] ?? {}))
      judge(`package.json ${field}`, dependency);

  for (const file of files) {
    for (const specifier of importSpecifiers(file.text))
      judge(file.path, specifier);
    if (rule.noDom && DOM.test(file.text.replace(COMMENTS, '$1')))
      violations.push({
        where: file.path,
        message: `${name} runs without a DOM but its code names a browser object`,
      });
  }
  return violations;
}

const SOURCE = /\.(ts|tsx)$/;
const NOT_SOURCE = /\.(test|test-support)\.(ts|tsx)$|\.d\.ts$/;

const packagesRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages',
);

/** A package's manifest and its shipped (non-test) source, read from the repository. */
export function readPackage(name: PackageName): {
  manifest: PackageManifest;
  files: SourceFile[];
} {
  const directory = path.join(packagesRoot, name);
  const walk = (current: string): string[] =>
    fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) return walk(full);
      return SOURCE.test(entry.name) && !NOT_SOURCE.test(entry.name)
        ? [full]
        : [];
    });
  return {
    manifest: JSON.parse(
      fs.readFileSync(path.join(directory, 'package.json'), 'utf8'),
    ) as PackageManifest,
    files: walk(path.join(directory, 'src')).map((file) => ({
      path: path.relative(directory, file).split(path.sep).join('/'),
      text: fs.readFileSync(file, 'utf8'),
    })),
  };
}

/** The violations of the package as it is in the repository. */
export function checkPackageDirection(name: PackageName): {
  readonly files: number;
  readonly violations: Violation[];
} {
  const { manifest, files } = readPackage(name);
  return {
    files: files.length,
    violations: directionViolations(name, manifest, files),
  };
}
