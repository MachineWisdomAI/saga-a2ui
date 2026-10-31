import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
} from '@modelcontextprotocol/client';

// A reproducible probe of the hosted versioned documentation (see docs/mintlify.md).
//
// Two checks that a local build cannot make:
//   - `mcp`: a real MCP client connects to the site's documentation endpoint, initializes, lists its
//     tools, calls the search tool once per release with that release's own question and reports
//     which release pages came back and in what order. A result passes only when the page of the
//     release that was asked about is the first release page returned; a response that merely
//     repeats the version string does not pass. Pages of other releases that also appear are
//     reported, not hidden.
//   - `snapshot` / `compare`: the hosted Markdown of every page in docs.json is hashed, so a
//     snapshot taken before and after a newer page changes shows whether a released page moved.
// Nothing here writes to the site. The only network traffic is MCP initialize, tools/list and
// search calls and page GETs.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const RELEASE_PAGE = /docs\/releases\/([^/\s)"'<>?#\\]+)\/([A-Za-z0-9._-]+)/g;
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
    return {
      version: release.version,
      expectedPage,
      query: `React MCP stack ${release.version}: which server entry points does this release export?`,
    };
  });
}

/** Release pages named in a response, in the order they first appear. */
export function releasePagesIn(text: string): ReleasePage[] {
  const seen = new Set<string>();
  const pages: ReleasePage[] = [];
  for (const match of text.matchAll(RELEASE_PAGE)) {
    const [, version, slug] = match;
    const page = `docs/releases/${version}/${slug?.replace(/\.mdx?$/, '')}`;
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
  readonly passed: boolean;
  readonly reason: string;
}

export interface McpProbeReport {
  readonly endpoint: string;
  readonly server: { readonly name: string; readonly version: string } | null;
  readonly tools: readonly string[];
  readonly searchTool: string | null;
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

/** Judges one response; kept separate from the network so the rule is checked on its own. */
export function judge(
  searchCase: SearchCase,
  returned: readonly ReleasePage[],
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
  return {
    ...base,
    passed: true,
    reason:
      others.length === 0
        ? 'Only the requested release was returned.'
        : `The requested page ranked first; pages of ${others.join(', ')} also appeared and are labeled by their own paths.`,
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
      results.push(
        response.isError === true
          ? {
              ...judge(searchCase, []),
              reason: 'The search tool reported an error.',
            }
          : judge(searchCase, releasePagesIn(textOf(response))),
      );
    }
    return {
      endpoint,
      server:
        info === undefined ? null : { name: info.name, version: info.version },
      tools,
      searchTool,
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
      const body = response.ok ? await response.text() : null;
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

const USAGE = `Usage:
  tsx scripts/docs-probe.ts mcp <https://site/mcp>
  tsx scripts/docs-probe.ts snapshot <https://site> > before.json
  tsx scripts/docs-probe.ts compare before.json after.json`;

export async function main(argv: readonly string[]): Promise<number> {
  const [command, first, second] = argv;
  if (command === 'mcp' && first !== undefined) {
    const report = await probeMcp(first, releaseCases(readSite()));
    console.log(JSON.stringify(report, null, 2));
    return report.passed ? 0 : 1;
  }
  if (command === 'snapshot' && first !== undefined) {
    const pages = readSite().releases.flatMap((release) => release.pages);
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
