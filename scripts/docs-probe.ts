import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
} from '@modelcontextprotocol/client';
import { fencedBlocks } from './docs-release/convert.js';

// A reproducible probe of the hosted versioned documentation (see docs/mintlify.md).
//
// Two checks that a local build cannot make:
//   - `mcp`: a real MCP client connects to the site's documentation endpoint, initializes, lists its
//     tools, calls the search tool once per release with that release's own question and reports
//     which release pages came back and in what order. The page of the release that was asked about
//     must be the first release page returned, and the probe then reads that page with the
//     endpoint's read-only filesystem tool and checks its words against facts that differ between
//     the releases (FACTS, each checked against the committed pages by the tests). A page address
//     that is right but whose retrieved content belongs to another release does not pass, and
//     neither does a response that merely repeats the version string. Pages of other releases that
//     also appear in the search results are reported, not hidden; they are not a failure.
//   - `snapshot` / `compare`: the hosted Markdown of every page in docs.json is hashed, so a
//     snapshot taken before and after a newer page changes shows whether a released page moved.
// Nothing here writes to the site. The only network traffic is MCP initialize, tools/list and
// search calls and page GETs.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const RELEASE_PAGE =
  /docs\/releases\/([^/\s)"'<>?#\\]+)\/([A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*)/g;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface ReleasePage {
  readonly version: string;
  /** The page path as listed in docs.json, for example `docs/releases/0.7.6/installation`. */
  readonly page: string;
}

export interface DocsSite {
  readonly releases: readonly {
    readonly version: string;
    readonly tag: string | undefined;
    readonly default: boolean;
    readonly pages: readonly string[];
  }[];
}

/** The release navigation exactly as committed in docs.json. */
export function readSite(configPath?: string): DocsSite {
  const file = configPath ?? path.join(root, 'docs.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    navigation?: {
      versions?: {
        version: string;
        tag?: string;
        default?: boolean;
        groups?: { pages?: unknown[] }[];
      }[];
    };
  };
  const versions = config.navigation?.versions;
  if (versions === undefined || versions.length === 0)
    throw new Error('docs.json has no navigation.versions.');
  return {
    releases: versions.map((entry) => ({
      version: entry.version,
      tag: entry.tag,
      default: entry.default === true,
      pages: (entry.groups ?? []).flatMap((group) =>
        (group.pages ?? []).filter(
          (page): page is string => typeof page === 'string',
        ),
      ),
    })),
  };
}

export interface SearchCase {
  readonly version: string;
  readonly query: string;
  /** The page whose release must be the first one returned. */
  readonly expectedPage: string;
  /** Statements the retrieved page must make, compared after {@link plain}. */
  readonly required: readonly string[];
  /** Statements that belong to another release and must not appear in the retrieved page. */
  readonly forbidden: readonly string[];
}

/**
 * What distinguishes each release's answer to the server-entry-points question, as the pinned
 * source of that release defines it. The tests confirm each statement against the committed page
 * of its own release and its absence from the other release's page.
 */
export const FACTS: Readonly<
  Record<string, Pick<SearchCase, 'required' | 'forbidden'>>
> = {
  '0.7.6': {
    required: [
      '0.7.6 (stable)',
      'does not export /server/http or /server/node',
    ],
    forbidden: ['exports /server, /server/http, and /server/node'],
  },
  '0.11.0-rc.1': {
    required: [
      '0.11.0-rc.1 (prerelease)',
      'exports /server, /server/http, and /server/node',
    ],
    forbidden: ['does not export'],
  },
};

/** Page text without Markdown emphasis or code marks, on one line, so a statement can be compared. */
export function plain(markdown: string): string {
  return markdown.replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * One question per release about the same topic. The pages give different answers (the stable
 * release lacks the HTTP and Node server entry points), so a wrong release cannot answer correctly.
 */
export function releaseCases(
  site: DocsSite,
  topic = 'server-entry-points',
): SearchCase[] {
  return site.releases.map((release) => {
    const expectedPage = release.pages.find((page) => page.endsWith(topic));
    if (expectedPage === undefined)
      throw new Error(`Release ${release.version} has no ${topic} page.`);
    const facts = FACTS[release.version];
    if (facts === undefined)
      throw new Error(
        `No distinguishing facts are recorded for ${release.version}.`,
      );
    return {
      version: release.version,
      expectedPage,
      ...facts,
      query: `React MCP stack ${release.version}: which server entry points does this release export?`,
    };
  });
}

/**
 * Release pages named in a response, in the order they first appear. A search result names its page
 * in `Link:` and `Page:` lines; when the response has them, only those lines count, so a page whose
 * text mentions another release's path (as the shared assistants page does) is not read as a hit.
 * A response without such lines is scanned whole.
 */
export function releasePagesIn(text: string): ReleasePage[] {
  const headers = [...text.matchAll(/^(?:Link|Page):[ \t]*(.*)$/gm)]
    .map((match) => match[1])
    .join('\n');
  const scanned = headers === '' ? text : headers;
  const seen = new Set<string>();
  const pages: ReleasePage[] = [];
  for (const match of scanned.matchAll(RELEASE_PAGE)) {
    const [, version, slug] = match;
    const page = `docs/releases/${version}/${slug?.replace(/(?:\.mdx?)?\.?$/, '')}`;
    if (version === undefined || seen.has(page)) continue;
    seen.add(page);
    pages.push({ version, page });
  }
  return pages;
}

export interface CaseResult {
  readonly version: string;
  readonly query: string;
  readonly expectedPage: string;
  readonly returned: readonly ReleasePage[];
  readonly otherReleases: readonly string[];
  /** Required statements the retrieved page did not make. */
  readonly missing: readonly string[];
  /** Statements of another release found in the retrieved page. */
  readonly foreign: readonly string[];
  readonly passed: boolean;
  readonly reason: string;
  /** The same question with the search tool's own `version` argument, when the tool has one. */
  readonly versionFilter?: VersionFilterResult;
}

export interface VersionFilterResult {
  readonly supported: boolean;
  readonly returned: readonly ReleasePage[];
  /** Pages of another release that the filtered search returned anyway. */
  readonly foreign: readonly string[];
  readonly passed: boolean;
  readonly reason: string;
}

export interface McpProbeReport {
  readonly endpoint: string;
  readonly server: { readonly name: string; readonly version: string } | null;
  readonly tools: readonly string[];
  readonly searchTool: string | null;
  readonly readTool: string | null;
  readonly cases: readonly CaseResult[];
  readonly passed: boolean;
}

export interface McpProbeOptions {
  readonly fetch?: FetchLike | undefined;
  readonly timeoutMs?: number | undefined;
}

function textOf(result: {
  content?: unknown;
  structuredContent?: unknown;
}): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  const text = blocks
    .map((block) => {
      const entry = block as { type?: string; text?: string };
      return entry.type === 'text' && typeof entry.text === 'string'
        ? entry.text
        : '';
    })
    .join('\n');
  return result.structuredContent === undefined
    ? text
    : `${text}\n${JSON.stringify(result.structuredContent)}`;
}

/** Judges the filtered search: it may return only the requested release, and must return its pages. */
export function judgeFilter(
  version: string,
  returned: readonly ReleasePage[],
): VersionFilterResult {
  const foreign = returned
    .filter((page) => page.version !== version)
    .map((page) => page.page);
  if (foreign.length > 0)
    return {
      supported: true,
      returned,
      foreign,
      passed: false,
      reason: `The search filtered to ${version} returned ${foreign.join(', ')}.`,
    };
  if (returned.length === 0)
    return {
      supported: true,
      returned,
      foreign,
      passed: false,
      reason: `The search filtered to ${version} returned no release page.`,
    };
  return {
    supported: true,
    returned,
    foreign,
    passed: true,
    reason: `The search filtered to ${version} returned only its pages.`,
  };
}

/**
 * Judges one case; kept separate from the network so the rule is checked on its own. `content` is
 * the text retrieved for the expected page, or undefined when it could not be retrieved, which
 * never passes: a page address alone does not show that the release's guidance was returned.
 */
export function judge(
  searchCase: SearchCase,
  returned: readonly ReleasePage[],
  content?: string,
): CaseResult {
  const first = returned[0];
  const others = [
    ...new Set(
      returned
        .map((page) => page.version)
        .filter((version) => version !== searchCase.version),
    ),
  ];
  const base = {
    version: searchCase.version,
    query: searchCase.query,
    expectedPage: searchCase.expectedPage,
    returned,
    otherReleases: others,
    missing: [] as string[],
    foreign: [] as string[],
  };
  if (first === undefined)
    return {
      ...base,
      passed: false,
      reason: 'No release page was identifiable in the response.',
    };
  if (first.page !== searchCase.expectedPage)
    return {
      ...base,
      passed: false,
      reason: `The first release page was ${first.page}, not ${searchCase.expectedPage}.`,
    };
  if (content === undefined)
    return {
      ...base,
      passed: false,
      reason: `The content of ${searchCase.expectedPage} was not retrieved, so its guidance was not checked.`,
    };
  const text = plain(content);
  const missing = searchCase.required.filter(
    (statement) => !text.includes(statement),
  );
  const foreign = searchCase.forbidden.filter((statement) =>
    text.includes(statement),
  );
  if (missing.length > 0 || foreign.length > 0)
    return {
      ...base,
      missing,
      foreign,
      passed: false,
      reason: `The retrieved ${searchCase.expectedPage} does not match release ${searchCase.version}: ${[
        ...missing.map((statement) => `missing "${statement}"`),
        ...foreign.map((statement) => `contains "${statement}"`),
      ].join('; ')}.`,
    };
  const labeled =
    others.length === 0
      ? 'Only the requested release was returned by search.'
      : `Search also returned pages of ${others.join(', ')}, labeled by their own paths.`;
  return {
    ...base,
    passed: true,
    reason: `The requested page ranked first and its retrieved content states release ${searchCase.version}'s facts. ${labeled}`,
  };
}

export async function probeMcp(
  endpoint: string,
  cases: readonly SearchCase[],
  options: McpProbeOptions = {},
): Promise<McpProbeReport> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = (): AbortSignal => AbortSignal.timeout(timeout);
  const client = new Client({ name: 'saga-docs-probe', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  try {
    await client.connect(transport, { signal: signal() });
    const info = client.getServerVersion();
    const listed = await client.listTools(undefined, { signal: signal() });
    const tools = listed.tools.map((tool) => tool.name);
    const searchTool = tools.find((name) => /search/i.test(name)) ?? null;
    const readTool = tools.find((name) => /filesystem/i.test(name)) ?? null;
    const filterable = listed.tools.some(
      (tool) =>
        tool.name === searchTool &&
        'version' in
          ((tool.inputSchema as { properties?: object }).properties ?? {}),
    );
    const results: CaseResult[] = [];
    for (const searchCase of cases) {
      if (searchTool === null) {
        results.push({
          ...judge(searchCase, []),
          reason: 'The endpoint lists no search tool.',
        });
        continue;
      }
      const response = await client.callTool(
        { name: searchTool, arguments: { query: searchCase.query } },
        { signal: signal() },
      );
      if (response.isError === true) {
        results.push({
          ...judge(searchCase, []),
          reason: 'The search tool reported an error.',
        });
        continue;
      }
      const returned = releasePagesIn(textOf(response));
      const ranked = returned[0]?.page === searchCase.expectedPage;
      let content: string | undefined;
      if (ranked && readTool !== null) {
        const read = await client.callTool(
          {
            name: readTool,
            arguments: { command: `cat /${searchCase.expectedPage}.mdx` },
          },
          { signal: signal() },
        );
        if (read.isError !== true) content = textOf(read);
      }
      const verdict = judge(searchCase, returned, content);
      let versionFilter: VersionFilterResult = {
        supported: false,
        returned: [],
        foreign: [],
        passed: true,
        reason: 'The search tool has no version argument.',
      };
      if (filterable) {
        const filtered = await client.callTool(
          {
            name: searchTool,
            arguments: {
              query: searchCase.query,
              version: searchCase.version,
            },
          },
          { signal: signal() },
        );
        versionFilter = judgeFilter(
          searchCase.version,
          filtered.isError === true ? [] : releasePagesIn(textOf(filtered)),
        );
      }
      const checked =
        ranked && readTool === null
          ? {
              ...verdict,
              reason: 'The endpoint lists no read-only filesystem tool.',
            }
          : verdict;
      results.push(
        versionFilter.passed
          ? { ...checked, versionFilter }
          : {
              ...checked,
              passed: false,
              reason: `${checked.reason} ${versionFilter.reason}`,
              versionFilter,
            },
      );
    }
    return {
      endpoint,
      server:
        info === undefined ? null : { name: info.name, version: info.version },
      tools,
      searchTool,
      readTool,
      cases: results,
      passed: results.length > 0 && results.every((result) => result.passed),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface PageSnapshot {
  readonly site: string;
  readonly pages: Readonly<
    Record<string, { readonly status: number; readonly sha256: string | null }>
  >;
}

/**
 * The hosted Markdown names the host that served it (the documentation index and absolute links),
 * so the same page differs between a preview and the production site. Provider-hosted names are
 * removed before hashing; the page's own words are untouched.
 */
export function normalizeHosts(markdown: string): string {
  return markdown.replace(
    /https?:\/\/[a-z0-9-]+\.mintlify\.(?:site|app)/gi,
    '',
  );
}

/** Hashes the hosted Markdown of each listed page. Mintlify serves any page's source at `<url>.md`. */
export async function snapshotPages(
  site: string,
  pages: readonly string[],
  fetchPage: FetchLike = fetch,
): Promise<PageSnapshot> {
  const base = site.replace(/\/+$/, '');
  const entries = await Promise.all(
    pages.map(async (page) => {
      const response = await fetchPage(`${base}/${page}.md`, {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      const body = response.ok ? normalizeHosts(await response.text()) : null;
      return [
        page,
        {
          status: response.status,
          sha256:
            body === null
              ? null
              : createHash('sha256').update(body).digest('hex'),
        },
      ] as const;
    }),
  );
  return { site: base, pages: Object.fromEntries(entries) };
}

export interface Comparison {
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
  readonly unreadable: readonly string[];
}

export function comparePages(
  before: PageSnapshot,
  after: PageSnapshot,
): Comparison {
  const changed: string[] = [];
  const unchanged: string[] = [];
  const unreadable: string[] = [];
  for (const page of Object.keys(before.pages).sort()) {
    const was = before.pages[page]?.sha256 ?? null;
    const now = after.pages[page]?.sha256 ?? null;
    if (was === null || now === null) unreadable.push(page);
    else if (was === now) unchanged.push(page);
    else changed.push(page);
  }
  return { changed, unchanged, unreadable };
}

export interface PageCheck {
  readonly page: string;
  readonly status: number;
  readonly fences: { readonly expected: number; readonly actual: number };
  /** The first code block that differs, or null when all are equal. */
  readonly firstDifference: number | null;
  readonly passed: boolean;
}

/** The platform adds a theme attribute to a fence's info string when it serves Markdown. */
function withoutTheme(block: string): string {
  return block.replace(/^([^\n]*?) theme=\{[^}\n]*\}/, '$1');
}

/**
 * Compares what the site serves for each page with the committed page: the page must be served and
 * every fenced code block must equal the committed block (after the platform's theme attribute is
 * removed from the info string). It reads only the hosted Markdown and the committed files.
 */
export async function checkPages(
  site: string,
  pages: readonly string[],
  readCommitted: (page: string) => string,
  fetchPage: FetchLike = fetch,
): Promise<PageCheck[]> {
  const base = site.replace(/\/+$/, '');
  return Promise.all(
    pages.map(async (page): Promise<PageCheck> => {
      const expected = fencedBlocks(readCommitted(page));
      const response = await fetchPage(`${base}/${page}.md`, {
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      let actual: string[] = [];
      if (response.ok) {
        try {
          actual = fencedBlocks(await response.text()).map(withoutTheme);
        } catch {
          actual = [];
        }
      }
      const index = expected.findIndex((block, i) => actual[i] !== block);
      const firstDifference =
        index >= 0
          ? index
          : actual.length === expected.length
            ? null
            : actual.length;
      return {
        page,
        status: response.status,
        fences: { expected: expected.length, actual: actual.length },
        firstDifference,
        passed: response.ok && firstDifference === null,
      };
    }),
  );
}

const USAGE = `Usage:
  tsx scripts/docs-probe.ts mcp <https://site/mcp>
  tsx scripts/docs-probe.ts pages <https://site>
  tsx scripts/docs-probe.ts snapshot <https://site> > before.json
  tsx scripts/docs-probe.ts compare before.json after.json`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, first, second] = argv;
  if (command === 'mcp' && first !== undefined) {
    const report = await probeMcp(first, releaseCases(readSite()));
    console.log(JSON.stringify(report, null, 2));
    return report.passed ? 0 : 1;
  }
  if (command === 'pages' && first !== undefined) {
    const pages = [
      ...new Set(readSite().releases.flatMap((release) => release.pages)),
    ];
    const checks = await checkPages(first, pages, (page) =>
      fs.readFileSync(path.join(root, `${page}.mdx`), 'utf8'),
    );
    console.log(JSON.stringify(checks, null, 2));
    return checks.every((check) => check.passed) ? 0 : 1;
  }
  if (command === 'snapshot' && first !== undefined) {
    // A page shared by several releases, such as the assistants page, is hashed once.
    const pages = [
      ...new Set(readSite().releases.flatMap((release) => release.pages)),
    ];
    console.log(JSON.stringify(await snapshotPages(first, pages), null, 2));
    return 0;
  }
  if (command === 'compare' && first !== undefined && second !== undefined) {
    const read = (file: string): PageSnapshot =>
      JSON.parse(fs.readFileSync(file, 'utf8')) as PageSnapshot;
    const comparison = comparePages(read(first), read(second));
    console.log(JSON.stringify(comparison, null, 2));
    return comparison.unreadable.length === 0 ? 0 : 1;
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = await main(process.argv.slice(2));
