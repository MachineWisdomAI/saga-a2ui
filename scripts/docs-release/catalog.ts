// Derives the component catalog of one release from the SDK's own package manifests and entry
// point sources at the pinned revision. A catalog entry names nothing that the source does not
// export: an entry point missing from a package's `exports`, or an index that no longer exports
// a listed symbol, stops generation instead of publishing an invented API.

export interface SourceReader {
  readonly read: (repoPath: string) => string;
  readonly exists: (repoPath: string) => boolean;
}

export interface EntrySpec {
  readonly package: string;
  /** The subpath of the package's `exports` map, for example `./faithful-card`. */
  readonly subpath: string;
  /** What this entry point contributes to the component. */
  readonly role: string;
  /** A stylesheet entry point (`exports` key) that belongs with this entry. */
  readonly stylesheet?: string;
}

export interface ExcerptSpec {
  readonly caption: string;
  readonly source: string;
  readonly from: string;
  readonly to: string;
  readonly language: string;
  /** Extra lines taken before the first and after the last matching line, for enclosing braces. */
  readonly before?: number;
  readonly after?: number;
}

export interface PageLink {
  readonly label: string;
  readonly guide: string;
  readonly anchor?: string;
}

export interface ComponentSpec {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly entries: readonly EntrySpec[];
  readonly preview: ExcerptSpec;
  readonly usage: readonly PageLink[];
  /** A statement and, when a guide of the release supports it, the page and anchor that do. */
  readonly qualification: readonly {
    readonly statement: string;
    readonly guide?: string;
    readonly anchor?: string;
    readonly label?: string;
  }[];
}

export interface ExportedNames {
  readonly values: readonly string[];
  readonly types: readonly string[];
}

export interface CatalogEntry {
  readonly package: string;
  /** The version published to npm for this release, or null when the package has none. */
  readonly version: string | null;
  readonly import: string;
  readonly role: string;
  readonly source: string;
  readonly exports: ExportedNames;
  readonly stylesheet: string | null;
}

export interface CatalogComponent {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly renderers: readonly string[];
  readonly entries: readonly CatalogEntry[];
  readonly preview: ExcerptSpec & { readonly code: string };
}

const SPECIFIER =
  /\s*(type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*/;

/** The names an entry source file exports, split into values and types. */
export function exportedNames(source: string): ExportedNames {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (/export\s+\*/.test(stripped))
    throw new Error('An entry point uses `export *`; list its names instead.');
  const values = new Set<string>();
  const types = new Set<string>();
  for (const match of stripped.matchAll(
    /export\s+(type\s+)?\{([^}]*)\}(?:\s*from\s*['"][^'"]+['"])?/g,
  )) {
    for (const part of match[2]!.split(',')) {
      if (part.trim() === '') continue;
      const specifier = SPECIFIER.exec(part);
      if (specifier === null)
        throw new Error(`Cannot read the export specifier "${part.trim()}".`);
      const name = specifier[3] ?? specifier[2]!;
      (match[1] !== undefined || specifier[1] !== undefined
        ? types
        : values
      ).add(name);
    }
  }
  for (const match of stripped.matchAll(
    /^export\s+(?:declare\s+)?(const|let|function\*?|class|abstract\s+class|enum|interface|type)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    (match[1] === 'interface' || match[1] === 'type' ? types : values).add(
      match[2]!,
    );
  }
  return {
    values: [...values].sort(),
    types: [...types].sort(),
  };
}

/** Lines of `source` from the first line equal to `from` through the next line equal to `to`. */
export function excerpt(
  source: string,
  from: string,
  to: string,
  before = 0,
  after = 0,
): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === from.trim());
  if (start < 0) throw new Error(`Excerpt start not found: ${from}`);
  const end = lines.findIndex(
    (line, index) => index >= start && line.trim() === to.trim(),
  );
  if (end < 0) throw new Error(`Excerpt end not found: ${to}`);
  const slice = lines.slice(Math.max(0, start - before), end + 1 + after);
  const indent = Math.min(
    ...slice
      .filter((line) => line.trim() !== '')
      .map((l) => /^ */.exec(l)![0].length),
  );
  return slice.map((line) => line.slice(indent)).join('\n');
}

function packageDirectory(name: string): string {
  const match = /^@saga-a2ui\/([a-z0-9-]+)$/.exec(name);
  if (match === null) throw new Error(`Not an SDK package: ${name}`);
  return `packages/${match[1]}`;
}

function targetOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object')
    for (const inner of Object.values(value)) {
      const found = targetOf(inner);
      if (found !== undefined) return found;
    }
  return undefined;
}

export function rendererOf(packageName: string): string | undefined {
  if (/^@saga-a2ui\/react(-|$)/.test(packageName)) return 'React';
  if (/^@saga-a2ui\/lit(-|$)/.test(packageName)) return 'Lit';
  return undefined;
}

export function deriveComponent(
  spec: ComponentSpec,
  published: Readonly<Record<string, string>>,
  reader: SourceReader,
  sourceUrl: (repoPath: string) => string,
): CatalogComponent {
  const entries = spec.entries.map((entry): CatalogEntry => {
    const directory = packageDirectory(entry.package);
    const manifest = JSON.parse(reader.read(`${directory}/package.json`)) as {
      name: string;
      version?: string;
      exports?: Record<string, unknown>;
    };
    if (manifest.name !== entry.package)
      throw new Error(
        `${directory} is ${manifest.name}, not ${entry.package}.`,
      );
    const target = targetOf(manifest.exports?.[entry.subpath]);
    if (target === undefined)
      throw new Error(`${entry.package} does not export ${entry.subpath}.`);
    let stylesheet: string | null = null;
    if (entry.stylesheet !== undefined) {
      if (targetOf(manifest.exports?.[entry.stylesheet]) === undefined)
        throw new Error(
          `${entry.package} does not export ${entry.stylesheet}.`,
        );
      stylesheet = `${entry.package}/${entry.stylesheet.replace(/^\.\//, '')}`;
    }
    const sourcePath = `${directory}/${target.replace(/^\.\//, '')}`;
    const names = exportedNames(reader.read(sourcePath));
    if (names.values.length + names.types.length === 0)
      throw new Error(`${sourcePath} exports nothing.`);
    const version = published[entry.package] ?? null;
    if (version !== null && manifest.version !== version)
      throw new Error(
        `${entry.package} is ${manifest.version ?? 'unversioned'} at this revision, not ${version}.`,
      );
    return {
      package: entry.package,
      version,
      import: entry.package + entry.subpath.replace(/^\./, ''),
      role: entry.role,
      source: sourceUrl(sourcePath),
      exports: names,
      stylesheet,
    };
  });
  const renderers = [
    ...new Set(
      spec.entries.flatMap((entry) => rendererOf(entry.package) ?? []),
    ),
  ].sort();
  return {
    id: spec.id,
    name: spec.name,
    summary: spec.summary,
    renderers,
    entries,
    preview: {
      ...spec.preview,
      code: excerpt(
        reader.read(spec.preview.source),
        spec.preview.from,
        spec.preview.to,
        spec.preview.before,
        spec.preview.after,
      ),
    },
  };
}
