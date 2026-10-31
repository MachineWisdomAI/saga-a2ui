import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  comparePages,
  FACTS,
  judge,
  plain,
  probeMcp,
  readSite,
  releaseCases,
  releasePagesIn,
  snapshotPages,
} from './docs-probe.js';

// The probe is a development tool for the hosted documentation. These checks run it against local
// stand-ins: a search endpoint served by the real MCP server package, and a page host. They show
// that the probe distinguishes a correct release from a wrong one; they do not show anything about
// the hosted site, which only a run of the probe against it can.

const ENDPOINT = 'https://docs.example.test/mcp';
const site = readSite();
const cases = releaseCases(site);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The committed Markdown of a release page, which the hosted site is built from. */
const committed = (page: string): string =>
  fs.readFileSync(path.join(root, `${page}.mdx`), 'utf8');

interface Stand {
  /** What search returns for a query. */
  readonly search: (query: string) => string;
  /** What the read-only filesystem tool returns for a page path such as `docs/releases/…`. */
  readonly read: (page: string) => string;
  readonly tools?: { search?: string | null; read?: string | null };
}

function endpoint(
  stand: Stand,
): (url: string | URL, init?: RequestInit) => Promise<Response> {
  const names = {
    search: 'search_saga_a2ui',
    read: 'query_docs_filesystem_saga_a2ui',
    ...stand.tools,
  };
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'docs', version: '1.0.0' });
    if (names.search !== null)
      server.registerTool(
        names.search,
        { inputSchema: z.object({ query: z.string() }) },
        ({ query }) => ({
          content: [{ type: 'text', text: stand.search(query) }],
        }),
      );
    if (names.read !== null)
      server.registerTool(
        names.read,
        { inputSchema: z.object({ command: z.string() }) },
        ({ command }) => ({
          content: [
            {
              type: 'text',
              text: stand.read(
                command.replace(/^cat \//, '').replace(/\.mdx$/, ''),
              ),
            },
          ],
        }),
      );
    if (names.search === null && names.read === null)
      server.registerTool('fetch_page', { inputSchema: z.object({}) }, () => ({
        content: [{ type: 'text', text: '' }],
      }));
    return server;
  });
  return (url, init) => handler.fetch(new Request(url, init));
}

const result = (page: string) =>
  `Title: page\nLink: https://docs.example.test/${page}\nContent: text`;

const entryFor = (query: string) =>
  cases.find((candidate) => query.includes(candidate.version))!;

/** A stand-in that answers every question with its own release's page and committed content. */
const faithful: Stand = {
  search: (query) => result(entryFor(query).expectedPage),
  read: committed,
};

describe('the committed release navigation', () => {
  it('lists a stable default and a labeled prerelease with the same topic page', () => {
    expect(site.releases.filter((release) => release.default)).toHaveLength(1);
    expect(site.releases.every((release) => release.tag !== undefined)).toBe(
      true,
    );
    expect(cases.map((entry) => entry.version)).toEqual(
      site.releases.map((release) => release.version),
    );
    for (const entry of cases)
      expect(entry.expectedPage).toContain(`docs/releases/${entry.version}/`);
  });
});

describe('the facts that tell the releases apart', () => {
  it('are stated by the committed page of their own release and not by the other', () => {
    for (const entry of cases) {
      const other = cases.find((candidate) => candidate !== entry)!;
      const own = plain(committed(entry.expectedPage));
      const rival = plain(committed(other.expectedPage));
      expect(entry.required).toEqual(FACTS[entry.version]?.required);
      for (const statement of entry.required) {
        expect(own).toContain(statement);
        expect(rival).not.toContain(statement);
      }
      for (const statement of entry.forbidden) {
        expect(own).not.toContain(statement);
        expect(rival).toContain(statement);
      }
    }
  });
});

describe('release pages in a response', () => {
  it('names each page once in order of appearance', () => {
    expect(
      releasePagesIn(
        'a https://x.test/docs/releases/0.7.6/installation.md b (/docs/releases/1.0.0/installation) c /docs/releases/0.7.6/installation',
      ),
    ).toEqual([
      { version: '0.7.6', page: 'docs/releases/0.7.6/installation' },
      { version: '1.0.0', page: 'docs/releases/1.0.0/installation' },
    ]);
  });

  it('does not accept a response that only mentions a version', () => {
    const [stable] = cases;
    expect(stable).toBeDefined();
    const verdict = judge(stable!, releasePagesIn('This is 0.7.6 guidance.'));
    expect(verdict.passed).toBe(false);
  });

  it('does not accept the expected page address without its retrieved content', () => {
    const [stable] = cases;
    const returned = releasePagesIn(result(stable!.expectedPage));
    expect(judge(stable!, returned).passed).toBe(false);
    expect(
      judge(stable!, returned, committed(stable!.expectedPage)).passed,
    ).toBe(true);
  });
});

describe('the MCP probe', () => {
  it('passes when each question returns its own release first with that release’s content', async () => {
    const report = await probeMcp(ENDPOINT, cases, {
      fetch: endpoint(faithful),
    });
    expect(report.server?.name).toBe('docs');
    expect(report.tools).toEqual([
      'search_saga_a2ui',
      'query_docs_filesystem_saga_a2ui',
    ]);
    expect(report.searchTool).toBe('search_saga_a2ui');
    expect(report.readTool).toBe('query_docs_filesystem_saga_a2ui');
    expect(report.cases.map((entry) => entry.passed)).toEqual([true, true]);
    expect(report.passed).toBe(true);
  });

  it('reports other releases that also appear in search without failing for them', async () => {
    const report = await probeMcp(ENDPOINT, cases, {
      fetch: endpoint({
        ...faithful,
        search: (query) => {
          const own = entryFor(query);
          const other = cases.find((candidate) => candidate !== own)!;
          return `${result(own.expectedPage)}\n${result(other.expectedPage)}`;
        },
      }),
    });
    expect(report.passed).toBe(true);
    expect(report.cases[0]?.otherReleases).toEqual([cases[1]?.version]);
  });

  it('fails when the right page address carries another release’s guidance', async () => {
    const [stable, prerelease] = cases;
    const report = await probeMcp(ENDPOINT, cases, {
      fetch: endpoint({
        ...faithful,
        // The stable address is returned, but its content is the prerelease page.
        read: (page) =>
          committed(
            page === stable!.expectedPage ? prerelease!.expectedPage : page,
          ),
      }),
    });
    expect(report.cases.map((entry) => entry.passed)).toEqual([false, true]);
    expect(report.cases[0]?.missing).toEqual(stable!.required);
    expect(report.cases[0]?.foreign).toEqual(stable!.forbidden);
    expect(report.cases[0]?.reason).toContain('does not match release 0.7.6');
    expect(report.passed).toBe(false);
  });

  it('fails when the retrieved page is not the release’s guidance at all', async () => {
    const report = await probeMcp(ENDPOINT, cases, {
      fetch: endpoint({ ...faithful, read: () => 'Content: text' }),
    });
    expect(report.cases.map((entry) => entry.passed)).toEqual([false, false]);
    expect(report.passed).toBe(false);
  });

  it('fails when the page cannot be read or the endpoint has no read tool', async () => {
    const noRead = await probeMcp(ENDPOINT, cases, {
      fetch: endpoint({ ...faithful, tools: { read: null } }),
    });
    expect(noRead.readTool).toBeNull();
    expect(noRead.passed).toBe(false);
    expect(noRead.cases[0]?.reason).toContain('no read-only filesystem tool');
  });

  it('fails when one release answers every question', async () => {
    const report = await probeMcp(ENDPOINT, cases, {
      fetch: endpoint({
        ...faithful,
        search: () => result(cases[1]!.expectedPage),
      }),
    });
    expect(report.cases.map((entry) => entry.passed)).toEqual([false, true]);
    expect(report.cases[0]?.reason).toContain(cases[1]!.expectedPage);
    expect(report.passed).toBe(false);
  });

  it('fails when the endpoint offers no search tool', async () => {
    const report = await probeMcp(ENDPOINT, cases, {
      fetch: endpoint({ ...faithful, tools: { search: null, read: null } }),
    });
    expect(report.searchTool).toBeNull();
    expect(report.passed).toBe(false);
  });
});

describe('the page snapshot', () => {
  const pages = site.releases.flatMap((release) => release.pages);
  const host = (edits: Record<string, string> = {}) =>
    ((url: string | URL) => {
      const page = String(url).replace('https://docs.example.test/', '');
      const key = page.replace(/\.md$/, '');
      return Promise.resolve(
        pages.includes(key)
          ? new Response(edits[key] ?? `body of ${key}`)
          : new Response('absent', { status: 404 }),
      );
    }) as (url: string | URL, init?: RequestInit) => Promise<Response>;

  it('shows that only the edited newer page moved', async () => {
    const newer = site.releases[1]!.pages[0]!;
    const before = await snapshotPages(
      'https://docs.example.test/',
      pages,
      host(),
    );
    const after = await snapshotPages(
      'https://docs.example.test',
      pages,
      host({ [newer]: 'edited' }),
    );
    const comparison = comparePages(before, after);
    expect(comparison.changed).toEqual([newer]);
    expect(comparison.unchanged).toHaveLength(pages.length - 1);
    expect(comparison.unreadable).toEqual([]);
  });

  it('hashes the same page identically on a preview and on the production host', async () => {
    const page = pages[0]!;
    const served = (host: string) =>
      (() =>
        Promise.resolve(
          new Response(
            `> Index: ${host}/llms.txt\n\nSee [next](${host}/${page}.md) for details.`,
          ),
        )) as (url: string | URL, init?: RequestInit) => Promise<Response>;
    const production = await snapshotPages(
      'https://docs.mintlify.app',
      [page],
      served('https://docs.mintlify.app'),
    );
    const preview = await snapshotPages(
      'https://docs-branch.mintlify.site',
      [page],
      served('https://docs-branch.mintlify.site'),
    );
    expect(comparePages(production, preview).unchanged).toEqual([page]);
  });

  it('reports an unreadable page instead of calling it unchanged', async () => {
    const before = await snapshotPages(
      'https://docs.example.test',
      pages,
      host(),
    );
    const after = await snapshotPages(
      'https://docs.example.test',
      [...pages, 'docs/releases/none/missing'],
      host(),
    );
    expect(
      comparePages(
        {
          ...before,
          pages: {
            ...before.pages,
            'docs/releases/none/missing': { status: 200, sha256: 'x' },
          },
        },
        after,
      ).unreadable,
    ).toEqual(['docs/releases/none/missing']);
  });
});
