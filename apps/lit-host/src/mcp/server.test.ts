import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { afterEach, describe, expect, it } from 'vitest';
import { EPISODE_TOOL_NAME, EPISODE_VIEW_URI } from './episode.js';
import { startEpisodeListener, type EpisodeListener } from './listener.js';
import type { EpisodeRecord } from './server.js';

const VIEW_HTML = '<!doctype html><title>view</title><saga-app></saga-app>';

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
    expect(tool?._meta).toMatchObject({ ui: { resourceUri: EPISODE_VIEW_URI } });

    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toContain(EPISODE_VIEW_URI);
  });

  it('serves the same immutable HTML for every read, free of request data', async () => {
    const { client } = await connect();
    const first = await client.readResource({ uri: EPISODE_VIEW_URI });
    await client.callTool({ name: EPISODE_TOOL_NAME, arguments: { episodeId: 'ep-002' } });
    const second = await client.readResource({ uri: EPISODE_VIEW_URI });

    expect(first.contents).toHaveLength(1);
    const [content] = first.contents;
    expect(content).toMatchObject({ uri: EPISODE_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: VIEW_HTML });
    expect(second.contents).toEqual(first.contents);
    expect(JSON.stringify(first)).not.toContain('Second title');
  });

  it('declares a CSP that allows no network or external resources', async () => {
    const { client } = await connect();
    const { contents } = await client.readResource({ uri: EPISODE_VIEW_URI });
    expect(contents[0]?._meta).toEqual({
      ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } },
    });
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
