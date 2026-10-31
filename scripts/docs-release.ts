import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import {
  deriveComponent,
  type CatalogComponent,
  type ComponentSpec,
} from './docs-release/catalog.js';
import {
  anchorsOf,
  convertGuide,
  fencedBlocks,
  unverifiedAnchorCharacters,
} from './docs-release/convert.js';

// Publishes SDK documentation as immutable, versioned Mintlify content (docs/mintlify.md).
//
// A release is a directory `docs/releases/VERSION/` whose `release.json` names the published
// version, the pinned source revision, the guides taken from that revision, the guides left out
// and why, and the components of the catalog. `generate` writes the guide pages and the component
// catalog from that revision; it refuses to touch a release that already exists, because a
// published release is a snapshot. `check` needs only the committed files. `verify-source`
// regenerates a release in memory from the pinned revision and reports any drift.

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPOSITORY = 'MachineWisdomAI/saga-a2ui';
export const ASSISTANTS_PAGE = 'docs/connect/assistants';

export interface GuideSpec {
  readonly source: string;
  readonly slug: string;
  readonly group: string;
  readonly description: string;
  readonly sidebarTitle?: string;
}

export interface ReleaseSpec {
  readonly version: string;
  readonly channel: 'stable' | 'prerelease';
  /** The full commit the release is documented from. */
  readonly revision: string;
  /** Packages published to npm at exactly this version, as verified against the registry. */
  readonly packages: Readonly<Record<string, string>>;
  /** A sentence added to every generated page of the release. */
  readonly notice?: string;
  /** Hand-written pages in the release directory, in navigation order. */
  readonly authored: readonly { page: string; group: string }[];
  readonly guides: readonly GuideSpec[];
  readonly exclusions: readonly { source: string; reason: string }[];
  readonly components: readonly ComponentSpec[];
  readonly componentExclusions: readonly { name: string; reason: string }[];
}

export interface SourceTree {
  readonly read: (repoPath: string) => string;
  readonly kind: (repoPath: string) => 'file' | 'dir' | 'missing';
}

export interface BuiltRelease {
  /** Page content by path relative to the release directory. */
  readonly files: ReadonlyMap<string, string>;
  /** Navigation groups for the release, as docs.json lists them. */
  readonly groups: readonly { group: string; pages: string[] }[];
}

const SHORT = 7;

export function routeBase(version: string): string {
  return `/docs/releases/${version}`;
}

function yamlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function frontMatter(fields: Record<string, string | undefined>): string {
  const lines = Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}: ${yamlString(value)}`);
  return `---\n${lines.join('\n')}\n---\n`;
}

function sourceUrl(revision: string, repoPath: string, kind: 'file' | 'dir') {
  return `https://github.com/${REPOSITORY}/${kind === 'dir' ? 'tree' : 'blob'}/${revision}/${repoPath}`;
}

function imageUrl(revision: string, repoPath: string): string {
  // Raster formats are stored through Git LFS; the media host serves their content.
  return /\.svg$/i.test(repoPath)
    ? `https://raw.githubusercontent.com/${REPOSITORY}/${revision}/${repoPath}`
    : `https://media.githubusercontent.com/media/${REPOSITORY}/${revision}/${repoPath}`;
}

function bannerFor(spec: ReleaseSpec, what: string): string {
  const label = spec.channel === 'stable' ? 'stable' : 'prerelease';
  const revision = spec.revision;
  const lines = [
    `> Documents saga a2ui **${spec.version}** (${label}). ${what} at source revision [\`${revision.slice(0, SHORT)}\`](https://github.com/${REPOSITORY}/tree/${revision}). It is published as a snapshot: later source changes do not alter it. Licensed under [Apache-2.0](https://github.com/${REPOSITORY}/blob/${revision}/LICENSE).`,
  ];
  if (spec.notice !== undefined) lines.push('>', `> ${spec.notice}`);
  return lines.join('\n') + '\n';
}

export function buildRelease(
  spec: ReleaseSpec,
  tree: SourceTree,
): BuiltRelease {
  const base = routeBase(spec.version);
  const files = new Map<string, string>();
  const routes = new Map(
    spec.guides.map((guide) => [guide.source, `${base}/guides/${guide.slug}`]),
  );
  const problems: string[] = [];
  for (const guide of spec.guides) {
    const converted = convertGuide(tree.read(guide.source), {
      sourcePath: guide.source,
      routeOf: (repoPath) => routes.get(repoPath),
      kindOf: (repoPath) => tree.kind(repoPath),
      sourceUrl: (repoPath, kind) => sourceUrl(spec.revision, repoPath, kind),
      imageUrl: (repoPath) => imageUrl(spec.revision, repoPath),
    });
    for (const broken of converted.brokenLinks)
      problems.push(
        `${guide.source}: ${broken} does not exist at the revision`,
      );
    const banner = bannerFor(
      spec,
      `This is the SDK guide [\`${guide.source}\`](${sourceUrl(spec.revision, guide.source, 'file')})`,
    );
    files.set(
      `guides/${guide.slug}.mdx`,
      `${frontMatter({
        title: converted.title,
        sidebarTitle: guide.sidebarTitle,
        description: guide.description,
      })}\n${banner}\n${converted.body}`,
    );
  }
  if (problems.length > 0)
    throw new Error(
      `Broken links in the pinned source:\n${problems.join('\n')}`,
    );

  const reader = {
    read: (repoPath: string) => tree.read(repoPath),
    exists: (repoPath: string) => tree.kind(repoPath) === 'file',
  };
  const components = spec.components.map((component) =>
    deriveComponent(component, spec.packages, reader, (repoPath) =>
      sourceUrl(spec.revision, repoPath, 'file'),
    ),
  );
  const specById = new Map(spec.components.map((c) => [c.id, c]));
  for (const component of components)
    files.set(
      `components/${component.id}.mdx`,
      componentPage(spec, component, specById.get(component.id)!),
    );
  files.set('components/index.mdx', componentIndex(spec, components));
  files.set(
    'components/catalog.json',
    JSON.stringify(catalogJson(spec, components, specById)),
  );

  const groups: { group: string; pages: string[] }[] = [];
  const add = (group: string, page: string) => {
    let entry = groups.find((candidate) => candidate.group === group);
    if (entry === undefined) {
      entry = { group, pages: [] };
      groups.push(entry);
    }
    entry.pages.push(page);
  };
  for (const authored of spec.authored)
    add(authored.group, `docs/releases/${spec.version}/${authored.page}`);
  for (const guide of spec.guides)
    add(guide.group, `docs/releases/${spec.version}/guides/${guide.slug}`);
  add('Components', `docs/releases/${spec.version}/components/index`);
  for (const component of spec.components)
    add(
      'Components',
      `docs/releases/${spec.version}/components/${component.id}`,
    );
  add('Use these docs with assistants', ASSISTANTS_PAGE);
  return { files, groups };
}

function list(names: readonly string[]): string {
  return names.length === 0 ? 'none' : names.map((n) => `\`${n}\``).join(', ');
}

function linkTo(spec: ReleaseSpec, link: { guide: string; anchor?: string }) {
  return `${routeBase(spec.version)}/guides/${link.guide}${link.anchor === undefined ? '' : `#${link.anchor}`}`;
}

function componentPage(
  spec: ReleaseSpec,
  component: CatalogComponent,
  source: ComponentSpec,
): string {
  const base = routeBase(spec.version);
  const rows = component.entries.map(
    (entry) =>
      `| \`${entry.import}\` | ${entry.version === null ? 'Not published to npm at this release' : `\`${entry.package}@${entry.version}\``} | ${entry.role} |`,
  );
  const exportsSections = component.entries.map((entry) =>
    [
      `### \`${entry.import}\``,
      '',
      `Source: [entry point at the pinned revision](${entry.source}).`,
      entry.stylesheet === null
        ? undefined
        : `Stylesheet: \`${entry.stylesheet}\`.`,
      '',
      `Values: ${list(entry.exports.values)}.`,
      '',
      `Types: ${list(entry.exports.types)}.`,
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
  );
  const renderers =
    component.renderers.length === 0
      ? 'Renderer-neutral.'
      : `Renderers: ${component.renderers.join(' and ')}.`;
  const preview = component.preview;
  return [
    frontMatter({
      title: component.name,
      sidebarTitle: component.name,
      description: component.summary,
    }),
    bannerFor(
      spec,
      `This catalog entry is generated from the package manifests and entry points`,
    ),
    component.summary,
    '',
    renderers,
    '',
    '## Entry points',
    '',
    '| Import | Registry version | Role |',
    '| --- | --- | --- |',
    ...rows,
    '',
    '## Exports',
    '',
    'The names below are read from the entry point sources at the pinned revision.',
    '',
    exportsSections.join('\n\n'),
    '',
    '## Static demonstration',
    '',
    `${preview.caption} It is a copy of lines from [\`${preview.source}\`](${sourceUrl(spec.revision, preview.source, 'file')}) at the pinned revision, not a live rendering.`,
    '',
    '```' + preview.language,
    preview.code,
    '```',
    '',
    '## Usage',
    '',
    ...(source.usage.length === 0
      ? [
          'This release has no guide for this component. The exports above are its reference.',
        ]
      : source.usage.map((link) => `- [${link.label}](${linkTo(spec, link)})`)),
    '',
    '## Evidence and limits',
    '',
    ...source.qualification.map((item) =>
      item.guide === undefined
        ? `- ${item.statement}`
        : `- ${item.statement} ([${item.label ?? 'Guide'}](${linkTo(spec, { guide: item.guide, anchor: item.anchor })}))`,
    ),
    '- Package exports and tests establish a contract. Acceptance in a named assistant host is recorded only where a page above says so.',
    '',
    `Back to the [component catalog](${base}/components/index).`,
    '',
  ].join('\n');
}

function componentIndex(
  spec: ReleaseSpec,
  components: readonly CatalogComponent[],
): string {
  const base = routeBase(spec.version);
  return [
    frontMatter({
      title: `Component catalog for ${spec.version}`,
      sidebarTitle: 'Component catalog',
      description: `Components exported by saga a2ui ${spec.version}, with their entry points and the guides that explain them.`,
    }),
    bannerFor(
      spec,
      'This catalog is generated from the package manifests and entry points',
    ),
    'Every component the SDK documents at this release is listed here or in the exclusions below. A row names only exports found in the source at the pinned revision.',
    '',
    '| Component | Renderers | Summary |',
    '| --- | --- | --- |',
    ...components.map(
      (component) =>
        `| [${component.name}](${base}/components/${component.id}) | ${component.renderers.length === 0 ? 'Neutral' : component.renderers.join(', ')} | ${component.summary} |`,
    ),
    '',
    '## Not in the catalog',
    '',
    ...spec.componentExclusions.map(
      (exclusion) => `- **${exclusion.name}.** ${exclusion.reason}`,
    ),
    '',
    '## Machine-readable catalog',
    '',
    `The same entries are committed as [\`docs/releases/${spec.version}/components/catalog.json\`](https://github.com/${REPOSITORY}/blob/main/docs/releases/${spec.version}/components/catalog.json). A consumer such as a marketing site reads it at a pinned commit of this repository and links to the pages here; it does not keep its own copy of the manual.`,
    '',
  ].join('\n');
}

function catalogJson(
  spec: ReleaseSpec,
  components: readonly CatalogComponent[],
  specs: ReadonlyMap<string, ComponentSpec>,
) {
  const base = routeBase(spec.version);
  return {
    schema: 1,
    release: {
      version: spec.version,
      channel: spec.channel,
      revision: spec.revision,
      source: `https://github.com/${REPOSITORY}/tree/${spec.revision}`,
      route: `${base}/components/index`,
    },
    components: components.map((component) => {
      const source = specs.get(component.id)!;
      return {
        ...component,
        route: `${base}/components/${component.id}`,
        usage: source.usage.map((link) => ({
          label: link.label,
          route: linkTo(spec, link),
        })),
        qualification: source.qualification.map((item) => ({
          statement: item.statement,
          route:
            item.guide === undefined
              ? null
              : linkTo(spec, { guide: item.guide, anchor: item.anchor }),
        })),
      };
    }),
    excluded: spec.componentExclusions,
  };
}

// ---------------------------------------------------------------------------------------------
// Files

export function gitTree(root: string, revision: string): SourceTree {
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  return {
    read: (repoPath) => git('show', `${revision}:${repoPath}`),
    kind: (repoPath) => {
      try {
        return git('cat-file', '-t', `${revision}:${repoPath}`).trim() ===
          'tree'
          ? 'dir'
          : 'file';
      } catch {
        return 'missing';
      }
    },
  };
}

export function readSpec(root: string, version: string): ReleaseSpec {
  const file = path.join(root, 'docs/releases', version, 'release.json');
  const spec = JSON.parse(fs.readFileSync(file, 'utf8')) as ReleaseSpec;
  if (spec.version !== version)
    throw new Error(`${file} describes ${spec.version}, not ${version}.`);
  if (!/^[0-9a-f]{40}$/.test(spec.revision))
    throw new Error(`${file} must pin a full 40-character revision.`);
  return spec;
}

export function releaseVersions(root: string): string[] {
  const dir = path.join(root, 'docs/releases');
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function formatJson(root: string, file: string, value: unknown) {
  const options = (await prettier.resolveConfig(path.join(root, file))) ?? {};
  return prettier.format(JSON.stringify(value), {
    ...options,
    parser: 'json',
  });
}

interface DocsConfig {
  navigation: {
    versions: {
      version: string;
      tag?: string;
      default?: boolean;
      groups: { group: string; pages: string[] }[];
    }[];
  };
  [key: string]: unknown;
}

/** Add or replace one release's navigation; labels and the default are never changed for an existing entry. */
export function withNavigation(
  config: DocsConfig,
  spec: ReleaseSpec,
  groups: BuiltRelease['groups'],
): DocsConfig {
  const versions = [...config.navigation.versions];
  const index = versions.findIndex((entry) => entry.version === spec.version);
  if (index >= 0) {
    versions[index] = { ...versions[index]!, groups: [...groups] };
  } else {
    versions.push({
      version: spec.version,
      tag: spec.channel === 'stable' ? 'Stable' : 'Prerelease',
      default: false,
      groups: [...groups],
    });
  }
  return { ...config, navigation: { ...config.navigation, versions } };
}

async function generate(root: string, version: string): Promise<void> {
  const spec = readSpec(root, version);
  const directory = path.join(root, 'docs/releases', version);
  // A release is a snapshot once its pages are committed. Until then the generator may rewrite them.
  const committed = execFileSync(
    'git',
    [
      'ls-files',
      '--',
      `docs/releases/${version}/guides`,
      `docs/releases/${version}/components`,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (committed.trim() !== '')
    throw new Error(
      `Pages of ${version} are already committed. A published release is a snapshot; correct a page in a reviewed change, or use verify-source to see drift.`,
    );
  const built = buildRelease(spec, gitTree(root, spec.revision));
  for (const [relative, content] of built.files) {
    const target = path.join(directory, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      relative === 'components/catalog.json'
        ? await formatJson(
            root,
            `docs/releases/${version}/${relative}`,
            JSON.parse(content),
          )
        : content,
    );
  }
  const configFile = path.join(root, 'docs.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8')) as DocsConfig;
  fs.writeFileSync(
    configFile,
    await formatJson(
      root,
      'docs.json',
      withNavigation(config, spec, built.groups),
    ),
  );
  console.log(`Wrote ${built.files.size} files for ${version}.`);
}

async function verifySource(root: string, version: string): Promise<number> {
  const spec = readSpec(root, version);
  const built = buildRelease(spec, gitTree(root, spec.revision));
  const directory = path.join(root, 'docs/releases', version);
  let drift = 0;
  for (const [relative, content] of built.files) {
    const target = path.join(directory, relative);
    const expected =
      relative === 'components/catalog.json'
        ? await formatJson(
            root,
            `docs/releases/${version}/${relative}`,
            JSON.parse(content),
          )
        : content;
    const actual = fs.existsSync(target)
      ? fs.readFileSync(target, 'utf8')
      : undefined;
    if (actual !== expected) {
      drift += 1;
      console.log(`DRIFT ${version}/${relative}`);
    }
  }
  console.log(
    `${version}: ${built.files.size} files compared with ${spec.revision.slice(0, SHORT)}; ${drift} differ.`,
  );
  return drift;
}

// ---------------------------------------------------------------------------------------------
// Offline check of the committed release content

export interface CheckResult {
  readonly problems: string[];
}

const PAGE_LINK = /\]\((\/docs\/[^)\s#]*)(#[^)\s]*)?\)/g;

function headingsOf(markdown: string): string[] {
  const out: string[] = [];
  let open: { char: string; length: number } | undefined;
  for (const line of markdown.split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (open === undefined) {
      if (fence !== null) {
        open = { char: fence[1]![0]!, length: fence[1]!.length };
        continue;
      }
      const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading !== null) out.push(heading[1]!);
    } else if (
      fence !== null &&
      fence[1]![0] === open.char &&
      fence[1]!.length >= open.length &&
      fence[2]!.trim() === ''
    )
      open = undefined;
  }
  return out;
}

export function checkReleases(root: string): CheckResult {
  const problems: string[] = [];
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'docs.json'), 'utf8'),
  ) as DocsConfig;
  const versions = config.navigation.versions;
  const directories = releaseVersions(root);
  const navigationVersions = versions.map((entry) => entry.version);
  for (const version of directories)
    if (!navigationVersions.includes(version))
      problems.push(`docs/releases/${version} is not in the navigation.`);
  for (const version of navigationVersions)
    if (!directories.includes(version))
      problems.push(
        `Navigation lists ${version} but docs/releases/${version} is missing.`,
      );
  const defaults = versions.filter((entry) => entry.default === true);
  if (defaults.length !== 1)
    problems.push(
      `Exactly one version must be the default; found ${defaults.length}.`,
    );

  const pageFiles = new Map<string, string>();
  const known = new Set<string>();
  for (const entry of versions) {
    const spec = directories.includes(entry.version)
      ? readSpec(root, entry.version)
      : undefined;
    if (spec === undefined) continue;
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec.version))
      problems.push(`${spec.version} is not a released version number.`);
    if (spec.channel === 'stable') {
      if (spec.version.includes('-'))
        problems.push(
          `${spec.version} is labeled stable but is a prerelease version.`,
        );
      if (entry.tag !== 'Stable')
        problems.push(`${spec.version} must be tagged Stable.`);
    } else {
      if (!spec.version.includes('-'))
        problems.push(
          `${spec.version} is labeled prerelease but has no prerelease suffix.`,
        );
      if (entry.tag !== 'Prerelease')
        problems.push(`${spec.version} must be tagged Prerelease.`);
      if (entry.default === true)
        problems.push(
          `${spec.version} is a prerelease and cannot be the default.`,
        );
    }
    if (entry.default === true && spec.channel !== 'stable')
      problems.push('The default version must be a stable release.');
    for (const group of entry.groups)
      for (const page of group.pages) {
        known.add(page);
        const file = path.join(root, `${page}.mdx`);
        if (!fs.existsSync(file))
          problems.push(`${page} is in the navigation but missing.`);
        else pageFiles.set(page, fs.readFileSync(file, 'utf8'));
      }
    // Every file of the release is reachable from the navigation.
    const directory = path.join(root, 'docs/releases', entry.version);
    const walk = (current: string): string[] =>
      fs
        .readdirSync(current, { withFileTypes: true })
        .flatMap((item) =>
          item.isDirectory()
            ? walk(path.join(current, item.name))
            : [path.join(current, item.name)],
        );
    for (const file of walk(directory)) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (
        relative.endsWith('.mdx') &&
        !known.has(relative.replace(/\.mdx$/, ''))
      )
        problems.push(`${relative} is not in the navigation.`);
    }
    // Generated pages carry the pinned revision; the catalog matches the release record.
    for (const guide of spec.guides) {
      const page = `docs/releases/${spec.version}/guides/${guide.slug}`;
      const text = pageFiles.get(page);
      if (text !== undefined && !text.includes(spec.revision))
        problems.push(`${page} does not identify the source revision.`);
    }
    const catalogFile = path.join(directory, 'components/catalog.json');
    if (fs.existsSync(catalogFile)) {
      const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8')) as {
        release: { version: string; revision: string };
        components: {
          id: string;
          entries: { package: string; version: string | null }[];
        }[];
      };
      if (
        catalog.release.version !== spec.version ||
        catalog.release.revision !== spec.revision
      )
        problems.push(`${spec.version} catalog does not match release.json.`);
      for (const component of spec.components)
        if (!catalog.components.some((c) => c.id === component.id))
          problems.push(`${spec.version} catalog lacks ${component.id}.`);
      for (const component of catalog.components)
        for (const entry of component.entries)
          if (entry.version !== (spec.packages[entry.package] ?? null))
            problems.push(
              `${spec.version} catalog lists ${entry.package}@${entry.version} but release.json publishes ${spec.packages[entry.package] ?? 'nothing'}.`,
            );
    } else problems.push(`${spec.version} has no components/catalog.json.`);
  }
  pageFiles.set(
    ASSISTANTS_PAGE,
    fs.existsSync(path.join(root, `${ASSISTANTS_PAGE}.mdx`))
      ? fs.readFileSync(path.join(root, `${ASSISTANTS_PAGE}.mdx`), 'utf8')
      : '',
  );

  // Fences, internal links and anchors.
  const anchors = new Map<string, Map<string, string>>();
  for (const [page, text] of pageFiles) {
    try {
      fencedBlocks(text);
    } catch (error) {
      problems.push(`${page}: ${(error as Error).message}`);
    }
    const headings = headingsOf(text);
    anchors.set(
      page,
      new Map(anchorsOf(headings).map((anchor, i) => [anchor, headings[i]!])),
    );
  }
  const unverified = (page: string, fragment: string): string | undefined => {
    const heading = anchors.get(page)?.get(fragment);
    if (heading === undefined) return undefined;
    const odd = unverifiedAnchorCharacters(heading);
    return odd.length === 0
      ? undefined
      : `${page}#${fragment}: the heading contains ${odd.join(' ')}, whose anchor form is not verified on Mintlify.`;
  };
  for (const [page, text] of pageFiles) {
    const own = /^docs\/releases\/([^/]+)\//.exec(page)?.[1];
    for (const match of text.matchAll(PAGE_LINK)) {
      const target = match[1]!.replace(/^\//, '');
      const fragment = match[2]?.slice(1);
      if (!known.has(target) && target !== ASSISTANTS_PAGE) {
        problems.push(`${page}: link to ${match[1]} has no page.`);
        continue;
      }
      const targetVersion = /^docs\/releases\/([^/]+)\//.exec(target)?.[1];
      if (
        own !== undefined &&
        targetVersion !== undefined &&
        targetVersion !== own
      )
        problems.push(`${page}: links to the other release ${targetVersion}.`);
      if (fragment !== undefined) {
        if (!anchors.get(target)?.has(fragment))
          problems.push(
            `${page}: ${match[1]}#${fragment} has no such heading.`,
          );
        else {
          const odd = unverified(target, fragment);
          if (odd !== undefined) problems.push(odd);
        }
      }
    }
    for (const match of text.matchAll(/\]\(#([^)\s]+)\)/g))
      if (!anchors.get(page)?.has(match[1]!))
        problems.push(`${page}: #${match[1]} has no such heading.`);
      else {
        const odd = unverified(page, match[1]!);
        if (odd !== undefined) problems.push(odd);
      }
  }
  return { problems };
}

export interface RouteInventory {
  readonly default: string;
  readonly releases: readonly {
    readonly version: string;
    readonly channel: 'stable' | 'prerelease';
    readonly default: boolean;
    readonly revision: string;
    readonly pages: readonly string[];
  }[];
  /** Where each catalog component is documented: its page in the default release and in each other release. */
  readonly components: readonly {
    readonly id: string;
    readonly name: string;
    readonly routes: Readonly<Record<string, string>>;
  }[];
  readonly shared: readonly string[];
}

/** Every public route of the committed site, from the navigation and the component catalogs. */
export function routeInventory(root: string): RouteInventory {
  const config = JSON.parse(
    fs.readFileSync(path.join(root, 'docs.json'), 'utf8'),
  ) as DocsConfig;
  const releases = config.navigation.versions.map((entry) => {
    const spec = readSpec(root, entry.version);
    return {
      version: entry.version,
      channel: spec.channel,
      default: entry.default === true,
      revision: spec.revision,
      pages: entry.groups.flatMap((group) =>
        group.pages.map((page) => `/${page}`),
      ),
    };
  });
  const byId = new Map<
    string,
    { name: string; routes: Record<string, string> }
  >();
  for (const release of releases) {
    const catalog = JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          'docs/releases',
          release.version,
          'components/catalog.json',
        ),
        'utf8',
      ),
    ) as { components: { id: string; name: string; route: string }[] };
    for (const component of catalog.components) {
      const entry = byId.get(component.id) ?? {
        name: component.name,
        routes: {},
      };
      entry.routes[release.version] = component.route;
      byId.set(component.id, entry);
    }
  }
  return {
    default: releases.find((release) => release.default)?.version ?? '',
    releases,
    components: [...byId].map(([id, entry]) => ({ id, ...entry })),
    shared: [`/${ASSISTANTS_PAGE}`],
  };
}

async function main(): Promise<void> {
  const root = path.resolve(here, '..');
  const [command, version] = process.argv.slice(2);
  if (command === 'generate' && version !== undefined) {
    await generate(root, version);
  } else if (command === 'check') {
    const { problems } = checkReleases(root);
    for (const problem of problems) console.log(`PROBLEM ${problem}`);
    console.log(
      problems.length === 0
        ? 'Release documentation is consistent.'
        : `${problems.length} problem(s).`,
    );
    process.exitCode = problems.length === 0 ? 0 : 1;
  } else if (command === 'routes') {
    console.log(JSON.stringify(routeInventory(root), null, 2));
  } else if (command === 'verify-source') {
    const targets = version === undefined ? releaseVersions(root) : [version];
    let drift = 0;
    for (const target of targets) drift += await verifySource(root, target);
    process.exitCode = drift === 0 ? 0 : 1;
  } else {
    console.error(
      'Usage: tsx scripts/docs-release.ts generate VERSION | check | routes | verify-source [VERSION]',
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
