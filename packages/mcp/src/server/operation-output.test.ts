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

  it('measures the escaped text: NULs that are small raw but large as JSON are refused', async () => {
    // 200,000 raw bytes, 1,200,002 bytes on the wire; a full 1 MiB of them is about 6 MiB.
    for (const count of [200_000, 1024 * 1024]) {
      const result = await call(
        pageOperation({
          project: (page) => ({
            text: '\u0000'.repeat(count),
            data: { title: page.title, lines: [] },
          }),
        }) as never,
      );
      safeFailure(result);
      await open.host?.close();
      open.host = undefined;
    }
  });

  it('returns what was admitted when a getter answers differently on a later read', async () => {
    let reads = 0;
    const data = {
      get title(): string {
        reads += 1;
        return reads === 1 ? 'admitted' : 'x'.repeat(2 * 1024 * 1024);
      },
      lines: [] as string[],
    };
    const result = await call(
      pageOperation({ project: () => ({ text: 'Getter', data }) }) as never,
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ title: 'admitted', lines: [] });
    expect(reads).toBe(1);
  });

  it('is not changed by a contract transform that mutates its output after it returns', async () => {
    const Mutating = z.strictObject({
      title: z.string(),
      lines: z.array(z.string()).transform((lines) => {
        queueMicrotask(() => lines.push('late'.repeat(1_000_000)));
        return lines;
      }),
    });
    const result = await call({
      ...pageOperation(),
      output: Mutating,
    } as never);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      title: 'Home',
      lines: ['one', 'two'],
    });
    expect(JSON.stringify(result).length).toBeLessThan(1_000);
  });

  it('keeps a Date field valid and writes it as its ISO string', async () => {
    const Dated = z.strictObject({ title: z.string(), when: z.date() });
    const result = await call({
      ...pageOperation(),
      output: Dated,
      project: () => ({
        text: 'Dated',
        data: { title: 'Dated', when: new Date(0) },
      }),
    } as never);
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      title: 'Dated',
      when: '1970-01-01T00:00:00.000Z',
    });
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

  // The exact size of the result as the transport writes it: the same envelope the operation returns.
  const wireBytes = (text: string, data: unknown) =>
    Buffer.byteLength(
      JSON.stringify({
        content: [{ type: 'text', text }],
        structuredContent: data,
      }),
      'utf8',
    );

  /** Admits `text` then `data` against `maxBytes`; true only when both pass. */
  const admits = (maxBytes: number, text: string, data: unknown): boolean => {
    const admission = admitOutput(limits({ maxBytes }));
    return admission.text(text) && admission.data(data) !== undefined;
  };

  const strings = {
    escapes: 'a"b\\c\n\t\u0000\u001f é€ 😀 \ud800 \udc00',
    // A surrogate pair that straddles a measuring slice boundary must still cost four bytes.
    pairAcrossSlice: `${'a'.repeat(4095)}😀${'b'.repeat(4094)}😀`,
    manyNuls: '\u0000'.repeat(10_000),
  };

  it.each(Object.entries(strings))(
    'admits exactly the serialized size, and not one byte less (%s)',
    (_name, string) => {
      const data = {
        s: string,
        n: [1, -2.5, 1e21, true, false, null, undefined],
        o: { [string]: { e: [] }, skipped: undefined, kept: 'x' },
        d: new Date(0),
      };
      const exact = wireBytes(string, data);
      expect(admits(exact, string, data)).toBe(true);
      expect(admits(exact - 1, string, data)).toBe(false);
    },
  );

  it('charges the escaped text, not its raw length', () => {
    // 200,000 NULs are 200,000 raw bytes but 1,200,002 bytes of JSON.
    const nuls = '\u0000'.repeat(200_000);
    expect(Buffer.byteLength(nuls, 'utf8')).toBeLessThan(
      DEFAULT_OUTPUT_LIMITS.maxBytes,
    );
    expect(wireBytes(nuls, {})).toBeGreaterThan(DEFAULT_OUTPUT_LIMITS.maxBytes);
    expect(admitOutput(limits()).text(nuls)).toBe(false);
    // The same count of ordinary characters is nowhere near the limit.
    expect(admitOutput(limits()).text('n'.repeat(200_000))).toBe(true);
  });

  it('charges the envelope around the text and data', () => {
    const empty = wireBytes('', {});
    expect(admits(empty, '', {})).toBe(true);
    expect(admits(empty - 1, '', {})).toBe(false);
    expect(admitOutput(limits({ maxBytes: 5 })).text('')).toBe(false);
  });

  it('returns a stable copy that holds what was measured, not the caller object', () => {
    let reads = 0;
    const original = {
      get title(): string {
        reads += 1;
        return reads === 1 ? 'first' : 'x'.repeat(2 * 1024 * 1024);
      },
      lines: ['a'],
      when: new Date(86_400_000),
    };
    const admission = admitOutput(limits());
    expect(admission.text('t')).toBe(true);
    const admitted = admission.data(original);
    const copy = admitted?.value as typeof original;
    // Assertion messages read getters, so the count is taken before any assertion touches the original.
    const readsByAdmission = reads;
    expect(copy === original).toBe(false);
    expect(copy.lines).not.toBe(original.lines);
    expect(copy.when).not.toBe(original.when);
    expect(copy.when.getTime()).toBe(86_400_000);
    const descriptor = Object.getOwnPropertyDescriptor(copy, 'title');
    expect(descriptor?.get).toBeUndefined();
    expect(descriptor?.value).toBe('first');
    // Nothing the caller does to its object afterwards reaches the copy.
    const before = JSON.stringify(copy);
    original.lines.push('later'.repeat(100_000));
    expect(JSON.stringify(copy)).toBe(before);
    expect(readsByAdmission).toBe(1);
  });

  it('writes a Date as JSON does, and an invalid one as null', () => {
    const data = { ok: new Date(0), bad: new Date(Number.NaN) };
    expect(admits(wireBytes('', data), '', data)).toBe(true);
    expect(admits(wireBytes('', data) - 1, '', data)).toBe(false);
  });

  it('keeps a __proto__ member as data instead of changing the copy prototype', () => {
    const data = JSON.parse('{"__proto__":{"admin":true},"a":1}') as unknown;
    const admission = admitOutput(limits());
    admission.text('');
    const copy = admission.data(data)?.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.keys(copy)).toEqual(['__proto__', 'a']);
    expect((copy as { admin?: unknown }).admin).toBeUndefined();
  });

  it('rejects values JSON cannot carry or whose serialization it cannot see', () => {
    const bigint = admitOutput(limits());
    bigint.text('');
    expect(bigint.data({ n: 10n })).toBeUndefined();
    const method = admitOutput(limits());
    method.text('');
    expect(method.data({ n: { toJSON: () => 'x' } })).toBeUndefined();
    // A toJSON that appears only after the first read is never consulted: the copy has no method.
    let reads = 0;
    const shifty = {
      get toJSON(): unknown {
        reads += 1;
        return reads === 1
          ? 'not a function'
          : () => 'x'.repeat(10 * 1024 * 1024);
      },
      a: 1,
    };
    const admission = admitOutput(limits());
    admission.text('');
    const copy = admission.data(shifty)?.value as Record<string, unknown>;
    expect(typeof copy.toJSON).not.toBe('function');
    expect(JSON.stringify(copy).length).toBeLessThan(100);
  });

  it('rejects an array with an enormous declared length without visiting it', () => {
    const sparse = new Array<string>(2_000_000_000);
    const admission = admitOutput(limits());
    admission.text('');
    expect(admission.data({ sparse })).toBeUndefined();
  });

  it('refuses a wide object or array before reading any member', () => {
    let reads = 0;
    const wide: Record<string, unknown> = {};
    for (let index = 0; index < 6; index += 1)
      Object.defineProperty(wide, `k${index}`, {
        enumerable: true,
        get: () => {
          reads += 1;
          return 1;
        },
      });
    // Six members are twelve values (a key and a value each): over a limit of ten.
    const objects = admitOutput(limits({ maxNodes: 10 }));
    objects.text('');
    expect(objects.data(wide)).toBeUndefined();
    const items = Array.from({ length: 12 }, (_, index) => ({
      get index() {
        reads += 1;
        return index;
      },
    }));
    const arrays = admitOutput(limits({ maxNodes: 10 }));
    arrays.text('');
    expect(arrays.data(items)).toBeUndefined();
    expect(reads).toBe(0);
  });

  it('admits a value of exactly the node limit and refuses one more', () => {
    // One object, one key and one value per member: 1 + 2 * members nodes.
    const members = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, i]));
    const check = (count: number) => {
      const admission = admitOutput(limits({ maxNodes: 9 }));
      admission.text('');
      return admission.data(members(count)) !== undefined;
    };
    expect(check(4)).toBe(true);
    expect(check(5)).toBe(false);
  });
});
