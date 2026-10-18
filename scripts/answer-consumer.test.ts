import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/server';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { CLOSED_VIEW_CSP } from '../packages/mcp/src/policy/index.js';
import { startTestHost, type TestHost } from '../packages/mcp/src/server/http-host.test-support.js';
import { answerConsumerSource, prepareAnswerConsumer } from './build-answer-consumer.js';
import { buildConsumerApplication, bundleConsumerEntry, bundleConsumerServer, createWorkDirectory, repoRoot } from './packed-consumer.js';

// An application outside this repository installs the packed core, Lit and optional components
// packages and renders a FaithfulCard. This checks what that installation consists of; the built
// page itself is exercised in a browser by apps/lit-host/e2e/answer-consumer.spec.ts.

const work = createWorkDirectory('saga-answer-consumer-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

describe('the answer consumer built from the packed SDK packages', () => {
  const { consumer, sdk } = prepareAnswerConsumer(work);

  it('imports only public package exports and its own files: no source path, alias or copied SDK module', () => {
    const sources = fs.readdirSync(path.join(answerConsumerSource, 'src')).filter((name) => name.endsWith('.ts'));
    expect(sources.length).toBeGreaterThan(0);
    const specifiers = sources.flatMap((name) =>
      [...fs.readFileSync(path.join(answerConsumerSource, 'src', name), 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1] as string),
    );
    const own = specifiers.filter((specifier) => specifier.startsWith('./'));
    const packages = [...new Set(specifiers.filter((specifier) => !specifier.startsWith('./')))].sort();
    expect(own.every((specifier) => /^\.\/[a-z-]+\.js$/.test(specifier))).toBe(true); // siblings only, never ../
    expect(packages).toEqual([
      '@a2ui/lit/v0_9',
      '@a2ui/web_core/v0_9',
      '@saga-a2ui/components/faithful-card',
      '@saga-a2ui/core/protocols/a2ui/v0_9',
      '@saga-a2ui/lit',
      '@saga-a2ui/lit/faithful-card',
      'lit',
    ]);
    expect(fs.existsSync(path.join(answerConsumerSource, 'node_modules'))).toBe(false);
  });

  it('installs each package as a tarball with source and its manifest only', () => {
    expect(Object.keys(sdk.files).sort()).toEqual(['components', 'core', 'lit', 'mcp']);
    for (const [name, packed] of Object.entries(sdk.files)) {
      expect(packed.filter((file) => file !== 'package.json' && !file.startsWith('src/')), name).toEqual([]);
      expect(packed.filter((file) => /\.test(-support)?\.ts$/.test(file)), name).toEqual([]);
    }
    expect(sdk.files.components).toContain('src/faithful-card/index.ts');
    expect(sdk.files.lit).toContain('src/faithful-card/index.ts');
    for (const hash of Object.values(sdk.tarballSha256)) expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps the components package independent of renderers and delivery, and Lit dependent on it only optionally', () => {
    const components = sdk.manifests.components!;
    expect(Object.keys(components.dependencies ?? {}).sort()).toEqual(['@a2ui/web_core', '@saga-a2ui/core', 'markdown-it', 'zod']);
    expect(components.peerDependencies ?? {}).toEqual({});
    const lit = sdk.manifests.lit!;
    expect(Object.keys(lit.dependencies ?? {})).not.toContain('@saga-a2ui/components');
    expect(lit.peerDependencies).toEqual({ '@saga-a2ui/components': '*' });
    expect(lit.peerDependenciesMeta?.['@saga-a2ui/components']).toEqual({ optional: true });
  });

  it('builds a browser artifact from the installed copies alone, with the FaithfulCard and its parser but no delivery code', async () => {
    const { modules, code } = await bundleConsumerEntry(consumer, 'src/main.ts');
    for (const name of ['core', 'lit', 'components']) {
      expect(modules.some((id) => id.includes(`/consumer/node_modules/@saga-a2ui/${name}/src/`)), name).toBe(true);
    }
    expect(modules.some((id) => id.includes('/consumer/node_modules/@saga-a2ui/components/src/faithful-card/reader.ts'))).toBe(true);
    expect(modules.some((id) => id.includes('/consumer/node_modules/@saga-a2ui/lit/src/faithful-card/faithful-card-element.ts'))).toBe(true);
    // Nothing came from the workspace, the example's own source, or a server or delivery package.
    expect(modules.filter((id) => id.startsWith(path.join(repoRoot, 'packages')) || id.startsWith(path.join(repoRoot, 'apps')))).toEqual([]);
    expect(modules.filter((id) => /node_modules\/(@modelcontextprotocol|react|react-dom)\//.test(id))).toEqual([]);
    expect(modules.filter((id) => /\/@saga-a2ui\/(mcp|react)\//.test(id))).toEqual([]);
    // The application's own composition used the packed card.
    expect(modules.some((id) => id.endsWith('/consumer/src/answer-app.ts'))).toBe(true);
    expect(code).toContain('saga-faithful-card');
    for (const marker of ['StreamableHTTP', 'node:http', 'process.env']) expect(code, marker).not.toContain(marker);
  }, 120_000);

  // The same application delivers its built page through MCP using the packed mcp package: the
  // shared operation links each result to the page, and the page's identity comes from its bytes.
  describe('served over MCP from the installed mcp package', () => {
    interface Served {
      readonly bytes: Buffer;
      readonly createAnswerServer: (html: string) => McpServer;
    }
    let preparing: Promise<Served> | undefined;
    const prepared = (): Promise<Served> =>
      (preparing ??= (async () => {
        const out = path.join(work, 'page');
        await buildConsumerApplication(consumer, out, [viteSingleFile()]);
        const { file } = await bundleConsumerServer(consumer, 'server/answer-server.ts');
        const loaded = (await import(pathToFileURL(file).href)) as Served;
        return { bytes: fs.readFileSync(path.join(out, 'index.html')), createAnswerServer: loaded.createAnswerServer };
      })());
    // Derived here from the requirement (SHA-256 of the served bytes), not by the package's own function.
    const identityOf = (bytes: Buffer | string): string => `ui://sha256/${createHash('sha256').update(bytes).digest('hex')}.html`;
    const open: { host?: TestHost } = {};
    afterEach(async () => {
      await open.host?.close();
      open.host = undefined;
    });

    it('gets its server from installed package exports and its own files only: no Ansari import, workspace path or copied SDK code', async () => {
      const { modules } = await bundleConsumerServer(consumer, 'server/answer-server.ts');
      const source = fs.readFileSync(path.join(answerConsumerSource, 'server', 'answer-server.ts'), 'utf8');
      const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1] as string).sort();
      expect(specifiers).toEqual(['../src/answer-function.js', '@modelcontextprotocol/server', '@saga-a2ui/mcp/policy', '@saga-a2ui/mcp/server', 'zod']);
      for (const name of ['operation.ts', 'view-identity.ts']) {
        expect(modules.some((id) => id.includes(`/consumer/node_modules/@saga-a2ui/mcp/src/server/${name}`)), name).toBe(true);
      }
      expect(modules.filter((id) => id.startsWith(path.join(repoRoot, 'packages')) || id.startsWith(path.join(repoRoot, 'apps')))).toEqual([]);
      expect(modules.filter((id) => /ansari/i.test(id))).toEqual([]);
      // Delivery pulls in no renderer, protocol decoder or card.
      expect(modules.filter((id) => /\/@saga-a2ui\/(lit|components|core|react)\/|\/@a2ui\/|\/lit(-html|-element)?\//.test(id))).toEqual([]);
    }, 120_000);

    it.each([
      ['a single JSON body', true],
      ['server-sent events', false],
    ])('links every result to the served page, which the host reads back byte for byte, over %s', async (_name, jsonResponse) => {
      const { bytes, createAnswerServer } = await prepared();
      const expected = identityOf(bytes);
      open.host = await startTestHost({ jsonResponse, buildServer: () => createAnswerServer(bytes.toString('utf8')) });
      const client = await open.host.connect();

      const hostile = 'ui://evil/steal.html'; // an answer text and a question that name another resource
      const answered = await client.callTool({ name: 'answer_question', arguments: { question: hostile, resourceUri: hostile } });
      expect(answered.isError).toBeFalsy();
      expect(answered._meta).toEqual({ ui: { resourceUri: expected } });
      const markdown = (answered.structuredContent as { markdown: string }).markdown;
      expect(markdown).toContain(`You asked: ${hostile}`);
      expect(answered.content).toEqual([{ type: 'text', text: markdown }]);
      expect(answered.structuredContent).toMatchObject({ contractVersion: 1 });

      const failed = await client.callTool({ name: 'answer_question', arguments: { question: 'please fail' } });
      expect(failed.isError).toBe(true);
      expect(failed._meta).toEqual({ ui: { resourceUri: expected } });
      expect(failed.content).toEqual([{ type: 'text', text: 'The answer is unavailable.' }]);

      const { tools } = await client.listTools();
      expect(tools.map((tool) => (tool._meta as { ui: { resourceUri: string } }).ui.resourceUri)).toEqual([expected]);
      const { contents } = await client.readResource({ uri: expected });
      const served = contents[0] as { uri: string; mimeType?: string; text: string; _meta?: unknown };
      expect(served.uri).toBe(expected);
      expect(served.mimeType).toBe('text/html;profile=mcp-app');
      expect(Buffer.from(served.text, 'utf8').equals(bytes)).toBe(true);
      expect(served._meta).toEqual({ ui: { csp: CLOSED_VIEW_CSP } });
    }, 120_000);

    it('gives a page with any changed byte a different resource, and the unchanged page the same one', async () => {
      const { bytes, createAnswerServer } = await prepared();
      const uriServing = async (html: string): Promise<string> => {
        open.host = await startTestHost({ jsonResponse: true, buildServer: () => createAnswerServer(html) });
        const client = await open.host.connect();
        const result = await client.callTool({ name: 'answer_question', arguments: { question: 'dates' } });
        await open.host.close();
        return (result._meta as { ui: { resourceUri: string } }).ui.resourceUri;
      };
      const html = bytes.toString('utf8');
      const original = await uriServing(html);
      expect(await uriServing(html)).toBe(original);
      const changed = await uriServing(html.replace('</body>', '<!-- rebuilt --></body>'));
      expect(changed).not.toBe(original);
      expect(changed).toBe(identityOf(html.replace('</body>', '<!-- rebuilt --></body>')));
    }, 120_000);
  });
});
