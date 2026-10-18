import { McpServer } from '@modelcontextprotocol/server';
import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CLOSED_VIEW_CSP } from '../policy/index.js';
import { registerPublicOperation, viewUriForHtml } from './index.js';
import { startTestHost, type TestHost } from './http-host.test-support.js';

// SHA-256 vectors from FIPS 180-2 (the empty message and "abc"), not computed by the code under test.
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

describe('viewUriForHtml', () => {
  it('derives a ui:// URI from the SHA-256 of the exact bytes', () => {
    expect(viewUriForHtml('')).toBe(`ui://sha256/${EMPTY}.html`);
    expect(viewUriForHtml('abc')).toBe(`ui://sha256/${ABC}.html`);
  });

  it('gives the same identity to the same bytes, whether held as a string or as bytes', () => {
    const html = '<!doctype html><title>café — ☃</title>';
    expect(viewUriForHtml(html)).toBe(viewUriForHtml(html.slice()));
    expect(viewUriForHtml(html)).toBe(viewUriForHtml(new TextEncoder().encode(html)));
    expect(viewUriForHtml(new Uint8Array([0x61, 0x62, 0x63]))).toBe(`ui://sha256/${ABC}.html`);
  });

  it.each([
    ['one character in the application', '<main>app v1</main><script>sdk()</script>', '<main>app v2</main><script>sdk()</script>'],
    ['one character in the inlined SDK', '<main>app</main><script>sdk(1)</script>', '<main>app</main><script>sdk(2)</script>'],
    ['trailing whitespace', '<main>app</main>', '<main>app</main>\n'],
    ['line endings', 'a\nb', 'a\r\nb'],
  ])('gives a different identity when %s changes', (_name, before, after) => {
    expect(viewUriForHtml(after)).not.toBe(viewUriForHtml(before));
  });

  it('refuses a string that has no exact UTF-8 bytes instead of hashing a substitute', () => {
    expect(() => viewUriForHtml('broken \ud800 text')).toThrow(RangeError);
  });
});

describe('a view identified by its content, served through an operation', () => {
  const open: { host?: TestHost } = {};
  afterEach(async () => {
    await open.host?.close();
    open.host = undefined;
  });

  // The application applies the identity to its final HTML, then declares the view with it.
  const serve = async (html: string): Promise<TestHost> => {
    const view = { uri: viewUriForHtml(html), title: 'Echo view', html, csp: CLOSED_VIEW_CSP };
    open.host = await startTestHost({
      jsonResponse: true,
      buildServer: () => {
        const server = new McpServer({ name: 'identity-test', version: '0.0.0' });
        registerPublicOperation(server, {
          name: 'echo',
          title: 'Echo',
          description: 'Echoes a word.',
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
          input: z.object({ word: z.string().max(8) }),
          output: z.strictObject({ word: z.string() }),
          view,
          failures: { absent: 'None.', unavailable: 'Unavailable.', invalidOutput: 'Invalid.' },
          handle: (input) => ({ kind: 'record', record: input.word }),
          project: (word) => ({ text: word, data: { word } }),
        });
        return server;
      },
    });
    return open.host;
  };

  it('agrees across discovery, the result and the resource read, and changes with the bytes', async () => {
    const html = '<!doctype html><title>echo v1</title>';
    const client = await (await serve(html)).connect();
    const result = await client.callTool({ name: 'echo', arguments: { word: 'hi' } });
    const { tools } = await client.listTools();
    const linked = (result._meta as { ui: { resourceUri: string } }).ui.resourceUri;
    expect(linked).toBe(viewUriForHtml(html));
    expect((tools[0]?._meta as { ui: { resourceUri: string } }).ui.resourceUri).toBe(linked);
    const { contents } = await client.readResource({ uri: linked });
    expect(contents[0]).toMatchObject({ uri: linked, mimeType: RESOURCE_MIME_TYPE, text: html });

    await open.host?.close();
    const changed = await (await serve('<!doctype html><title>echo v2</title>')).connect();
    const next = await changed.callTool({ name: 'echo', arguments: { word: 'hi' } });
    expect((next._meta as { ui: { resourceUri: string } }).ui.resourceUri).not.toBe(linked);
  });
});
