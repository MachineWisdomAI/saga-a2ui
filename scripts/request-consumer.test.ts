import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AuthInfo } from '@modelcontextprotocol/server';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  startTestHost,
  type TestHost,
} from '../packages/mcp/src/server/http-host.test-support.js';
import type { Callbacks, RequestConsumer } from './request-consumer/server.js';
import {
  bundleConsumerServer,
  createWorkDirectory,
  installPackedSdk,
  linkDeclaredDependencies,
  repoRoot,
} from './packed-consumer.js';

// CORE3 through installed public exports: an application outside this repository receives the packed
// `@saga-a2ui/mcp`, declares operations from its server export and hosts them. The tarball is
// unpacked into a clean directory, only its declared dependencies are linked, and the consumer is
// bundled against that copy, so a file left out of the package or an undeclared dependency fails
// here. The hosting is the test's own Streamable HTTP host (the application listener is exercised
// from the workspace by apps/lit-host/src/mcp/request-pipeline.test.ts); it is not an actual MCP host.

const consumerSource = fileURLToPath(
  new URL('./request-consumer', import.meta.url),
);
const work = createWorkDirectory('saga-request-consumer-test-');
afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

const CANARY = 'canary-installed-secret';
const HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};
const MODES = [
  ['JSON', true],
  ['server-sent events', false],
] as const;

interface Loaded {
  readonly createRequestConsumer: (
    callbacks?: Callbacks,
    budgets?: { operationMs?: number; requestMs?: number },
  ) => RequestConsumer;
  readonly FAILURE_TEXT: {
    readonly unavailable: string;
    readonly invalidOutput: string;
  };
  readonly modules: string[];
}

let loading: Promise<Loaded> | undefined;
const loaded = (): Promise<Loaded> =>
  (loading ??= (async () => {
    const consumer = path.join(work, 'consumer');
    fs.cpSync(consumerSource, consumer, { recursive: true });
    const sdk = installPackedSdk(work, consumer, ['mcp']);
    linkDeclaredDependencies(consumer, sdk, [
      '@modelcontextprotocol/server',
      'zod',
    ]);
    const { file, modules } = await bundleConsumerServer(consumer, 'server.ts');
    const exports = (await import(pathToFileURL(file).href)) as Omit<
      Loaded,
      'modules'
    >;
    return { ...exports, modules };
  })());

const alice: AuthInfo = {
  token: 't',
  clientId: 'c',
  scopes: [],
  expiresAt: 9_999_999_999,
  extra: { accountId: 'acct-alice' },
};
const bob: AuthInfo = { ...alice, extra: { accountId: 'acct-bob' } };
const open: { host?: TestHost } = {};
afterEach(async () => {
  await open.host?.close();
  open.host = undefined;
});

async function hostFor(
  consumer: RequestConsumer,
  jsonResponse: boolean,
): Promise<TestHost> {
  open.host = await startTestHost({
    jsonResponse,
    buildServer: () => consumer.buildServer(),
    authenticate: (credential) =>
      ({ alice, bob })[credential as 'alice' | 'bob'],
  });
  return open.host;
}

describe('the request contract from the installed @saga-a2ui/mcp', () => {
  it('is built from installed package exports and the consumer’s own file alone', async () => {
    const { modules } = await loaded();
    const source = fs.readFileSync(
      path.join(consumerSource, 'server.ts'),
      'utf8',
    );
    const specifiers = [...source.matchAll(/from '([^']+)'/g)]
      .map((match) => match[1])
      .sort();
    expect(specifiers).toEqual([
      '@modelcontextprotocol/server',
      '@saga-a2ui/mcp/policy',
      '@saga-a2ui/mcp/server',
      'zod',
    ]);
    for (const name of ['lifetime.ts', 'operation.ts']) {
      expect(
        modules.some((id) =>
          id.includes(
            `/consumer/node_modules/@saga-a2ui/mcp/src/server/${name}`,
          ),
        ),
        name,
      ).toBe(true);
    }
    expect(
      modules.filter(
        (id) =>
          id.startsWith(path.join(repoRoot, 'packages')) ||
          id.startsWith(path.join(repoRoot, 'apps')),
      ),
    ).toEqual([]);
  }, 120_000);

  describe.each(MODES)('over %s', (_name, jsonResponse) => {
    it('completes delayed work with progress inside the one budget, and does not restart it', async () => {
      const { createRequestConsumer } = await loaded();
      const consumer = createRequestConsumer(
        {
          handle: async (request) => {
            for (let step = 1; step <= 3; step += 1) {
              await new Promise((resolve) => setTimeout(resolve, 20));
              await request.reportProgress({ progress: step, total: 3 });
            }
            return { kind: 'record', record: 'a' };
          },
        },
        { operationMs: 1_000, requestMs: 2_000 },
      );
      const client = await (await hostFor(consumer, jsonResponse)).connect();
      const progress: number[] = [];
      const result = await client.callTool(
        { name: 'read', arguments: { id: 'a' } },
        { onprogress: (update) => void progress.push(update.progress) },
      );
      expect(result.structuredContent).toEqual({ id: 'a', text: 'ok' });
      if (!jsonResponse) expect(progress).toEqual([1, 2, 3]);
    });

    it('ends work that keeps reporting progress at its operation limit, with the declared text and a typed cause', async () => {
      const { createRequestConsumer, FAILURE_TEXT } = await loaded();
      const consumer = createRequestConsumer(
        {
          handle: async (request) => {
            for (;;) {
              await new Promise((resolve) => setTimeout(resolve, 15));
              await request.reportProgress({ progress: 1 });
              if (request.signal.aborted) throw new Error(`stopped ${CANARY}`);
            }
          },
        },
        { operationMs: 80, requestMs: 2_000 },
      );
      const client = await (await hostFor(consumer, jsonResponse)).connect();
      const started = Date.now();
      const result = await client.callTool(
        { name: 'read', arguments: { id: 'a' } },
        { onprogress: () => undefined },
      );
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(result.content).toEqual([
        { type: 'text', text: FAILURE_TEXT.unavailable },
      ]);
      expect(JSON.stringify(result)).not.toContain(CANARY);
      expect(
        consumer.lifetimes.flatMap((lifetime) => lifetime.causes),
      ).toMatchObject([
        { kind: 'operation-timeout', stage: 'handler', limitMs: 80 },
      ]);
    });

    it('refuses a malformed projection and an asynchronous identity resolver before they reach the caller or a handler', async () => {
      const { createRequestConsumer, FAILURE_TEXT } = await loaded();
      const consumer = createRequestConsumer({
        handle: () => ({ kind: 'record', record: 'a' }),
        project: () => ({
          text: { canary: CANARY } as never,
          data: { id: 'a', text: 'ok' },
        }),
      });
      const client = await (
        await hostFor(consumer, jsonResponse)
      ).connect('alice');
      const malformed = await client.callTool({
        name: 'read',
        arguments: { id: 'a' },
      });
      expect(malformed.content).toEqual([
        { type: 'text', text: FAILURE_TEXT.invalidOutput },
      ]);
      expect(JSON.stringify(malformed)).not.toContain(CANARY);

      let entered = 0;
      const asynchronous = createRequestConsumer({
        handle: () => ((entered += 1), { kind: 'record', record: 'a' }),
        identity: () => Promise.resolve({ accountId: 'acct-alice' }),
      });
      await open.host?.close();
      const second = await (
        await hostFor(asynchronous, jsonResponse)
      ).connect('alice');
      const refused = await second.callTool({
        name: 'mine',
        arguments: { id: 'a' },
      });
      expect(refused.content).toEqual([
        { type: 'text', text: FAILURE_TEXT.unavailable },
      ]);
      expect(entered).toBe(0);
    });

    it('gives each concurrent principal its own identity and none to a forged argument', async () => {
      const { createRequestConsumer } = await loaded();
      const seen: string[] = [];
      const consumer = createRequestConsumer({
        handle: async (_request, accountId) => {
          await new Promise((resolve) =>
            setTimeout(resolve, accountId === 'acct-alice' ? 40 : 5),
          );
          seen.push(String(accountId));
          return { kind: 'record', record: String(accountId) };
        },
        project: (record) => ({
          text: record,
          data: { id: record.slice(0, 16), text: 'ok' },
        }),
      });
      const started = await hostFor(consumer, jsonResponse);
      const [a, b] = await Promise.all([
        await started.connect('alice'),
        await started.connect('bob'),
      ]);
      const [fromAlice, fromBob] = await Promise.all([
        a.callTool({
          name: 'mine',
          arguments: { id: 'a', accountId: 'acct-bob' },
        }),
        b.callTool({
          name: 'mine',
          arguments: { id: 'a', accountId: 'acct-alice' },
        }),
      ]);
      expect(fromAlice.structuredContent).toMatchObject({ id: 'acct-alice' });
      expect(fromBob.structuredContent).toMatchObject({ id: 'acct-bob' });
      expect(seen).toEqual(['acct-bob', 'acct-alice']);
    });
  });

  it('does not enter a handler for a request cancelled in the same POST that carried it', async () => {
    const { createRequestConsumer } = await loaded();
    let entered = 0;
    const consumer = createRequestConsumer({
      handle: () => ((entered += 1), { kind: 'record', record: 'a' }),
    });
    const started = await hostFor(consumer, true);
    const waiting = new AbortController();
    setTimeout(() => waiting.abort(), 300);
    await fetch(started.url, {
      method: 'POST',
      headers: HEADERS,
      signal: waiting.signal,
      body: JSON.stringify([
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'read', arguments: { id: 'a' } },
        },
        {
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: 1 },
        },
      ]),
    }).catch(() => undefined);
    expect(entered).toBe(0);
  });
});
