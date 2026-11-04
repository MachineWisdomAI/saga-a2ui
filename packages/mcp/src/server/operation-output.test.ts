import { McpServer } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  OperationConfigurationError,
  registerPublicOperation,
  type OutputLimits,
  type PublicOperation,
} from './index.js';
import {
  DEFAULT_OUTPUT_LIMITS,
  admitOutput,
  resolveOutputLimits,
} from './output-budget.js';
import { startTestHost, type TestHost } from './http-host.test-support.js';

// An operation's contract usually bounds its own fields, but nothing obliges it to: a contract with
// an unbounded string or array, or a projection that fills one, would otherwise let a single record
// become an arbitrarily large response. The connector owns a budget for the result, applied to the
// projection before the contract parses it and before anything is serialized.

const FAILURES = {
  absent: 'No such page.',
  unavailable: 'Pages are unavailable.',
  invalidOutput: 'The page could not be shown.',
} as const;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

// Deliberately generous contracts: only the connector's budget stands between these and the wire.
const PageInput = z.object({ pageId: z.string().min(1).max(16) });
const PageOutput = z.strictObject({
  title: z.string(),
  lines: z.array(z.string()),
});
const TreeOutput = z.strictObject({ tree: z.unknown() });

interface Page {
  readonly title: string;
  readonly lines: readonly string[];
}

type Pages = PublicOperation<typeof PageInput, typeof PageOutput, Page>;

function pageOperation(overrides: Partial<Pages> = {}): Pages {
  return {
    name: 'get_page',
    title: 'Get page',
    description: 'Returns one page.',
    annotations: READ_ONLY,
    input: PageInput,
    output: PageOutput,
    failures: FAILURES,
    handle: (_input, _request) => ({
      kind: 'record',
      record: { title: 'Home', lines: ['one', 'two'] },
    }),
    project: (page) => ({
      text: page.title,
      data: { title: page.title, lines: [...page.lines] },
    }),
    ...overrides,
  };
}

const open: { host?: TestHost } = {};
afterEach(async () => {
  await open.host?.close();
  open.host = undefined;
});

async function call(operation: PublicOperation<never, never, never>) {
  const started = await startTestHost({
    buildServer: () => {
      const server = new McpServer({ name: 'output-test', version: '0.0.0' });
      registerPublicOperation(server, operation as never);
      return server;
    },
    jsonResponse: true,
    authenticate: () => undefined,
  });
  open.host = started;
  const client = await started.connect();
  return client.callTool({ name: 'get_page', arguments: { pageId: 'p1' } });
}

const safeFailure = (result: Awaited<ReturnType<typeof call>>) => {
  expect(result.isError).toBe(true);
  expect(result.content).toEqual([
    { type: 'text', text: FAILURES.invalidOutput },
  ]);
  expect(result.structuredContent).toBeUndefined();
};

describe('operation result budget', () => {
  it('serves a result inside the budget unchanged', async () => {
    const result = await call(pageOperation() as never);
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: 'text', text: 'Home' }]);
    expect(result.structuredContent).toEqual({
      title: 'Home',
      lines: ['one', 'two'],
    });
  });

  it('serves a large but legitimate result under the default budget', async () => {
    const lines = Array.from({ length: 2_000 }, (_, i) =>
      `line ${i} `.repeat(8),
    );
    const result = await call(
      pageOperation({
        project: () => ({ text: 'Big', data: { title: 'Big', lines } }),
      }) as never,
    );
    expect(result.isError).toBeFalsy();
    expect(
      (result.structuredContent as { lines: string[] }).lines,
    ).toHaveLength(2_000);
  });

  it('refuses structured data larger than the budget, though the contract allows it', async () => {
    const result = await call(
      pageOperation({
        project: () => ({
          text: 'Huge',
          data: { title: 'Huge', lines: ['x'.repeat(2 * 1024 * 1024)] },
        }),
      }) as never,
    );
    safeFailure(result);
    expect(JSON.stringify(result)).not.toContain('xxxx');
  });

  it('refuses model-facing text larger than the budget', async () => {
    const result = await call(
      pageOperation({
        project: (page) => ({
          text: 'y'.repeat(2 * 1024 * 1024),
          data: { title: page.title, lines: [] },
        }),
      }) as never,
    );
    safeFailure(result);
  });

  it('counts text and data together against one budget', async () => {
    const half = 'z'.repeat(600 * 1024);
    const result = await call(
      pageOperation({
        project: () => ({ text: half, data: { title: half, lines: [] } }),
      }) as never,
    );
    safeFailure(result);
  });

  it('refuses many small values, which are cheap in bytes but not to handle', async () => {
    const result = await call(
      pageOperation({
        project: () => ({
          text: 'Many',
          data: { title: 'Many', lines: new Array<string>(150_000).fill('') },
        }),
      }) as never,
    );
    safeFailure(result);
  });

  it('refuses a structure nested deeper than the budget', async () => {
    let tree: unknown = 'leaf';
    for (let i = 0; i < 100; i += 1) tree = [tree];
    const operation = {
      ...pageOperation(),
      output: TreeOutput,
      project: () => ({ text: 'Deep', data: { tree } }),
    };
    safeFailure(await call(operation as never));
  });

  it('refuses a cyclic structure instead of walking or serializing it forever', async () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const operation = {
      ...pageOperation(),
      output: TreeOutput,
      project: () => ({ text: 'Loop', data: { tree: loop } }),
    };
    safeFailure(await call(operation as never));
  });

  it('refuses a result a contract transform grows past the budget', async () => {
    const Grows = z.strictObject({
      title: z.string().transform((title) => title.repeat(2_000_000)),
      lines: z.array(z.string()),
    });
    const operation = { ...pageOperation(), output: Grows };
    safeFailure(await call(operation as never));
  });

  it('refuses data it cannot read without leaking the fault', async () => {
    const hostile = {
      get title(): string {
        throw new Error('canary-secret');
      },
      lines: [],
    };
    const result = await call(
      pageOperation({
        project: () => ({ text: 'Hostile', data: hostile }),
      }) as never,
    );
    safeFailure(result);
    expect(JSON.stringify(result)).not.toContain('canary-secret');
  });

  it('lets an operation declare a smaller or a larger budget of its own', async () => {
    const lines = ['x'.repeat(2_000)];
    const project: Pages['project'] = () => ({
      text: 'Sized',
      data: { title: 'Sized', lines },
    });
    safeFailure(
      await call(
        pageOperation({ project, outputLimits: { maxBytes: 1_000 } }) as never,
      ),
    );
    const big = 'b'.repeat(2 * 1024 * 1024);
    const raised = await call(
      pageOperation({
        project: () => ({ text: 'Raised', data: { title: big, lines: [] } }),
        outputLimits: { maxBytes: 4 * 1024 * 1024 },
      }) as never,
    );
    expect(raised.isError).toBeFalsy();
  });

  it.each<[string, unknown]>([
    ['a zero byte limit', { maxBytes: 0 }],
    ['a fractional depth', { maxDepth: 1.5 }],
    ['an infinite node limit', { maxNodes: Number.POSITIVE_INFINITY }],
    ['a non-object', 'big'],
  ])('refuses registration with %s', (_name, outputLimits) => {
    const server = new McpServer({ name: 'output-test', version: '0.0.0' });
    expect(() =>
      registerPublicOperation(
        server,
        pageOperation({ outputLimits: outputLimits as OutputLimits }),
      ),
    ).toThrow(OperationConfigurationError);
  });
});

describe('admitOutput', () => {
  const limits = (overrides: OutputLimits = {}) =>
    resolveOutputLimits(overrides);

  it('keeps the documented defaults', () => {
    expect(DEFAULT_OUTPUT_LIMITS).toEqual({
      maxBytes: 1024 * 1024,
      maxDepth: 32,
      maxNodes: 100_000,
    });
  });

  it('never estimates below what JSON.stringify produces', () => {
    const value = {
      a: 'é€😀"\\',
      b: [1, -2.5, 1e21, true, false, null, undefined],
      c: { d: { e: [] } },
      f: new Date(0),
    };
    const exact = Buffer.byteLength(JSON.stringify(value), 'utf8');
    const tight = limits({ maxBytes: exact });
    expect(admitOutput(tight).data(value)).toBe(true);
    expect(admitOutput(limits({ maxBytes: exact - 40 })).data(value)).toBe(
      false,
    );
  });

  it('rejects values JSON cannot carry or whose serialization it cannot see', () => {
    expect(admitOutput(limits()).data({ n: 10n })).toBe(false);
    expect(admitOutput(limits()).data({ n: { toJSON: () => 'x' } })).toBe(
      false,
    );
  });

  it('rejects an array with an enormous declared length without visiting it', () => {
    const sparse = new Array<string>(2_000_000_000);
    expect(admitOutput(limits()).data({ sparse })).toBe(false);
  });
});
