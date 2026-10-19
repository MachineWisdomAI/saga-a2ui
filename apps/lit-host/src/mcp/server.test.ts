import { request as httpRequest } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createContentPolicy, type ContentPolicy } from '@saga-a2ui/components/faithful-card';
import { viewUriForHtml } from '@saga-a2ui/mcp/server';
import { EPISODE_TOOL_NAME } from './episode.js';
import { startEpisodeListener, type EpisodeListener } from './listener.js';
import type { EpisodeRecord } from './server.js';

const VIEW_HTML = '<!doctype html><html><head><title>view</title></head><body><saga-app></saga-app></body></html>';

// The record carries a field the public result must never expose.
const records: readonly (EpisodeRecord & { internalNotes: string })[] = [
  { id: 'ep-001', title: 'First title', description: 'Plain <b>text</b>.', internalNotes: 'private-note-1' },
  { id: 'ep-002', title: 'Second title', description: 'Another one.', internalNotes: 'private-note-2' },
];

const open: { listener?: EpisodeListener; client?: Client } = {};

async function connect(): Promise<{ client: Client; listener: EpisodeListener }> {
  const listener = await startEpisodeListener({
    viewHtml: VIEW_HTML,
    catalog: { find: (id) => records.find((record) => record.id === id) },
    port: 0,
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(listener.url)));
  open.listener = listener;
  open.client = client;
  return { client, listener };
}

/** The URI the server registered for the episode view, as a host learns it from the tool. */
async function registeredUri(client: Client): Promise<string> {
  const { tools } = await client.listTools();
  const uri = (tools[0]?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri;
  if (uri === undefined) throw new Error('The tool links no view resource.');
  return uri;
}

async function readText(client: Client, uri: string): Promise<string> {
  const { contents } = await client.readResource({ uri });
  const [content] = contents;
  if (!content || !('text' in content)) throw new Error('resources/read returned no text');
  return content.text;
}

/** Starts a listener for `viewHtml` under `policy`, returns what a client learns about its view, and closes it. */
async function servedIdentity(viewHtml: string, policy?: ContentPolicy): Promise<{ uri: string; text: string }> {
  const listener = await startEpisodeListener({
    viewHtml,
    catalog: { find: () => undefined },
    ...(policy === undefined ? {} : { contentPolicy: policy }),
    port: 0,
  });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(listener.url)));
    const uri = await registeredUri(client);
    return { uri, text: await readText(client, uri) };
  } finally {
    await client.close();
    await listener.close();
  }
}

afterEach(async () => {
  await open.client?.close();
  await open.listener?.close();
  open.client = undefined;
  open.listener = undefined;
});

describe('episode MCP server over streamable HTTP', () => {
  it('returns the bounded public episode for a known id', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId: 'ep-001' } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      episodeId: 'ep-001',
      title: 'First title',
      description: 'Plain <b>text</b>.',
    });
    expect(JSON.stringify(result)).not.toContain('private-note');
  });

  it('a different id returns a different title', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId: 'ep-002' } });
    expect(result.structuredContent).toMatchObject({ episodeId: 'ep-002', title: 'Second title' });
  });

  it('declares a read-only tool linked to the view resource', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    const [tool] = tools;
    expect(tool?.name).toBe(EPISODE_TOOL_NAME);
    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    const uri = await registeredUri(client);
    expect(tool?._meta).toMatchObject({ ui: { resourceUri: uri } });

    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toContain(uri);
    // The registered identity is the SDK byte identity of the document the resource serves.
    expect(uri).toBe(viewUriForHtml(await readText(client, uri)));
  });

  it('serves the same immutable HTML for every read, free of request data', async () => {
    const { client } = await connect();
    const uri = await registeredUri(client);
    const first = await client.readResource({ uri });
    await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId: 'ep-002' } });
    const second = await client.readResource({ uri });
    // Request data never enters the document, so the identity does not move either.
    expect(await registeredUri(client)).toBe(uri);

    expect(first.contents).toHaveLength(1);
    const [content] = first.contents;
    expect(content).toMatchObject({ uri, mimeType: RESOURCE_MIME_TYPE });
    expect(content && 'text' in content && content.text).toContain('<saga-app></saga-app>');
    expect(second.contents).toEqual(first.contents);
    expect(JSON.stringify(first)).not.toContain('Second title');
  });

  it('declares a CSP that allows no network or external resources by default', async () => {
    const { client } = await connect();
    const { contents } = await client.readResource({ uri: await registeredUri(client) });
    expect(contents[0]?._meta).toEqual({
      ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } },
    });
  });

  it('serves a configured image host under its own resource identity, declaring only that origin', async () => {
    const created = createContentPolicy({ imageHosts: ['images.example.com'] });
    if (!created.ok) throw new Error(created.failure.message);
    const listener = await startEpisodeListener({
      viewHtml: VIEW_HTML,
      catalog: { find: () => undefined },
      contentPolicy: created.policy,
      port: 0,
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(listener.url)));
    open.listener = listener;
    open.client = client;

    const { tools } = await client.listTools();
    const uri = (tools[0]?._meta as { ui: { resourceUri: string } }).ui.resourceUri;
    const { contents } = await client.readResource({ uri });
    const defaultUri = (await servedIdentity(VIEW_HTML)).uri;
    expect(uri).not.toBe(defaultUri);
    expect(uri).toBe(viewUriForHtml(contents[0] && 'text' in contents[0] ? contents[0].text : ''));
    expect(contents[0]?._meta).toEqual({
      ui: {
        csp: {
          connectDomains: [],
          resourceDomains: ['https://images.example.com'],
          frameDomains: [],
          baseUriDomains: [],
        },
      },
    });
    // The resource of the default policy is not served by this variant.
    await expect(client.readResource({ uri: defaultUri })).rejects.toThrow();
  });

  it('declares a configured font origin as a resource domain beside the image host, under its own identity', async () => {
    const created = createContentPolicy({ imageHosts: ['images.example.com'], fontOrigins: ['https://fonts.example.com:8443'] });
    if (!created.ok) throw new Error(created.failure.message);
    const listener = await startEpisodeListener({
      viewHtml: VIEW_HTML,
      catalog: { find: () => undefined },
      contentPolicy: created.policy,
      port: 0,
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(listener.url)));
    open.listener = listener;
    open.client = client;

    const { tools } = await client.listTools();
    const uri = (tools[0]?._meta as { ui: { resourceUri: string } }).ui.resourceUri;
    const { contents } = await client.readResource({ uri });
    expect(contents[0]?._meta).toEqual({
      ui: {
        csp: {
          connectDomains: [],
          resourceDomains: ['https://fonts.example.com:8443', 'https://images.example.com'],
          frameDomains: [],
          baseUriDomains: [],
        },
      },
    });
    const html = contents[0] && 'text' in contents[0] ? contents[0].text : '';
    expect(html).toContain("font-src data: blob: https://fonts.example.com:8443;");
    expect(html).toContain('img-src data: blob: https://images.example.com;');
  });

  it.each([
    ['the default policy', undefined],
    ['a Strict policy', { level: 'strict' }],
    ['a font-origin policy', { fontOrigins: ['https://fonts.example.com'] }],
  ])('registers a new URI when the served document changes under %s, and the same URI for equal bytes', async (_name, config) => {
    let policy: ContentPolicy | undefined;
    if (config !== undefined) {
      const created = createContentPolicy(config);
      if (!created.ok) throw new Error(created.failure.message);
      policy = created.policy;
    }
    const withBody = (css: string, code: string): string =>
      `<!doctype html><html><head><title>view</title><style>${css}</style></head><body><saga-app></saga-app><script>${code}</script></body></html>`;
    const base = await servedIdentity(withBody('b{margin:0}', '1'), policy);
    const same = await servedIdentity(withBody('b{margin:0}', '1'), policy);
    const code = await servedIdentity(withBody('b{margin:0}', '2'), policy);
    const css = await servedIdentity(withBody('b{margin:1px}', '1'), policy);
    const both = await servedIdentity(withBody('b{margin:1px}', '2'), policy);

    expect(same.uri).toBe(base.uri);
    expect(same.text).toBe(base.text);
    expect(new Set([base.uri, code.uri, css.uri, both.uri]).size).toBe(4);
    // Each registered URI is the byte identity of the document its own resource serves.
    for (const served of [base, code, css, both]) expect(served.uri).toBe(viewUriForHtml(served.text));
  });

  it.each([
    ['a missing id', {}],
    ['an id with disallowed characters', { episodeId: '../etc/passwd' }],
    ['an over-long id', { episodeId: 'a'.repeat(65) }],
    ['a non-string id', { episodeId: 7 }],
  ])('rejects %s before consulting the catalog', async (_name, args) => {
    const { client } = await connect();
    const result = await client.callTool({ name: EPISODE_TOOL_NAME, arguments: args }).catch((error: unknown) => error);
    const failed = result instanceof Error || (result as { isError?: boolean }).isError === true;
    expect(failed).toBe(true);
    expect(JSON.stringify(result)).not.toContain('private-note');
  });

  it('reports an unknown id as a tool error with no episode data', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId: 'nope' } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('does not serve anything but POST /mcp', async () => {
    const { listener } = await connect();
    const other = await fetch(new URL('/other', listener.url), { method: 'POST' });
    expect(other.status).toBe(404);
    const get = await fetch(listener.url, { method: 'GET' });
    expect(get.status).toBe(405);
  });

  it('rejects requests whose Host header is not the local listener (DNS rebinding)', async () => {
    const { listener } = await connect();
    // fetch() will not send a forged Host header, so use the raw HTTP client.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(
        listener.url,
        {
          method: 'POST',
          headers: {
            Host: 'evil.example',
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      request.on('error', reject);
      request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    });
    expect(status).toBe(403);
  });
});
