import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  comparePages,
  judge,
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

function searchEndpoint(
  answer: (query: string) => string,
  tool = 'search_saga_a2ui',
): (url: string | URL, init?: RequestInit) => Promise<Response> {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'docs', version: '1.0.0' });
    server.registerTool(
      tool,
      { inputSchema: z.object({ query: z.string() }) },
      ({ query }) => ({ content: [{ type: 'text', text: answer(query) }] }),
    );
    return server;
  });
  return (url, init) => handler.fetch(new Request(url, init));
}

const result = (page: string) =>
  `Title: page\nLink: https://docs.example.test/${page}\nContent: text`;

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
});

describe('the MCP probe', () => {
  it('passes when each question returns its own release first', async () => {
    const fetchEndpoint = searchEndpoint((query) => {
      const entry = cases.find((candidate) =>
        query.includes(candidate.version),
      );
      return result(entry!.expectedPage);
    });
    const report = await probeMcp(ENDPOINT, cases, { fetch: fetchEndpoint });
    expect(report.server?.name).toBe('docs');
    expect(report.tools).toEqual(['search_saga_a2ui']);
    expect(report.searchTool).toBe('search_saga_a2ui');
    expect(report.cases.map((entry) => entry.passed)).toEqual([true, true]);
    expect(report.passed).toBe(true);
  });

  it('reports other releases that also appear without hiding them', async () => {
    const fetchEndpoint = searchEndpoint((query) => {
      const own = cases.find((candidate) => query.includes(candidate.version))!;
      const other = cases.find((candidate) => candidate !== own)!;
      return `${result(own.expectedPage)}\n${result(other.expectedPage)}`;
    });
    const report = await probeMcp(ENDPOINT, cases, { fetch: fetchEndpoint });
    expect(report.passed).toBe(true);
    expect(report.cases[0]?.otherReleases).toEqual([cases[1]?.version]);
  });

  it('fails when one release answers every question', async () => {
    const fetchEndpoint = searchEndpoint(() => result(cases[1]!.expectedPage));
    const report = await probeMcp(ENDPOINT, cases, { fetch: fetchEndpoint });
    expect(report.cases.map((entry) => entry.passed)).toEqual([false, true]);
    expect(report.cases[0]?.reason).toContain(cases[1]!.expectedPage);
    expect(report.passed).toBe(false);
  });

  it('fails when the endpoint offers no search tool', async () => {
    const fetchEndpoint = searchEndpoint(() => '', 'fetch_page');
    const report = await probeMcp(ENDPOINT, cases, { fetch: fetchEndpoint });
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
