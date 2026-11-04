import { describe, expect, it } from 'vitest';
import {
  admitToolResult,
  DEFAULT_TOOL_RESULT_LIMITS,
  ToolResultRefused,
  toolResultLimits,
  type ToolResultLimits,
} from './result-admission.js';

const limits = (supplied: Partial<ToolResultLimits>): ToolResultLimits =>
  toolResultLimits(supplied);
const exceeded = (value: unknown, supplied: Partial<ToolResultLimits> = {}) => {
  const admission = admitToolResult(value, limits(supplied));
  return admission.ok ? undefined : admission.exceeded;
};

describe('admitToolResult', () => {
  it('admits an ordinary result of text, an image and structured data', () => {
    expect(
      exceeded({
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
        ],
        structuredContent: { a: [1, 2, { b: null, c: true, d: undefined }] },
        isError: false,
      }),
    ).toBeUndefined();
  });

  it('counts UTF-8 bytes of strings and of property names', () => {
    expect(exceeded('€€€', { maxBytes: 9 })).toBeUndefined();
    expect(exceeded('€€€', { maxBytes: 8 })).toBe('bytes');
    expect(exceeded({ ['k'.repeat(10)]: 1 }, { maxBytes: 9 })).toBe('bytes');
    // A string far past the budget is refused without being measured.
    expect(exceeded('x'.repeat(10_000), { maxBytes: 100 })).toBe('bytes');
  });

  it('counts the length of binary values as bytes', () => {
    expect(exceeded(new Uint8Array(10), { maxBytes: 10 })).toBeUndefined();
    expect(exceeded(new Uint8Array(11), { maxBytes: 10 })).toBe('bytes');
    expect(exceeded(new ArrayBuffer(11), { maxBytes: 10 })).toBe('bytes');
  });

  it('counts values and refuses past the node budget', () => {
    expect(exceeded([1, 2, 3], { maxNodes: 4 })).toBeUndefined();
    expect(exceeded([1, 2, 3], { maxNodes: 3 })).toBe('nodes');
  });

  it('refuses nesting past the depth budget without costing stack', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 100_000; i += 1) deep = [deep];
    expect(exceeded(deep, { maxDepth: 64, maxNodes: 1_000_000 })).toBe('depth');
    expect(exceeded([[1]], { maxDepth: 2 })).toBeUndefined();
    expect(exceeded([[[1]]], { maxDepth: 2 })).toBe('depth');
  });

  it('refuses an array past its item budget before reading any item, including a huge sparse one', () => {
    expect(exceeded(new Array(2 ** 31), { maxArrayItems: 10 })).toBe(
      'array-items',
    );
    expect(exceeded([1, 2, 3], { maxArrayItems: 2 })).toBe('array-items');
  });

  it("gives the content list a block budget of its own, but only the result's own list", () => {
    const blocks = Array.from({ length: 3 }, () => ({ type: 'x' }));
    expect(exceeded({ content: blocks }, { maxContentBlocks: 2 })).toBe(
      'content-blocks',
    );
    expect(
      exceeded(
        { structuredContent: { content: blocks } },
        { maxContentBlocks: 2 },
      ),
    ).toBeUndefined();
  });

  it('ends a cycle at the node budget', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(exceeded(cyclic, { maxNodes: 1000, maxDepth: 1_000_000 })).toBe(
      'nodes',
    );
  });

  it('refuses what is not plain data: bigint, symbol, function, Map, Set, Date and class instances', () => {
    for (const value of [
      10n ** 1000n,
      Symbol('s'),
      () => 1,
      new Map(),
      new Set(),
      new Date(),
      new (class Held {})(),
    ])
      expect(exceeded({ structuredContent: value })).toBe('unsupported');
  });

  it('admits a null-prototype object and a key named __proto__ as data', () => {
    expect(
      exceeded(Object.assign(Object.create(null), { a: 1 })),
    ).toBeUndefined();
    expect(exceeded(JSON.parse('{"__proto__":{"a":1}}'))).toBeUndefined();
  });

  it('has defaults a real answer sits far inside', () => {
    expect(
      exceeded({
        content: [{ type: 'text', text: 'a'.repeat(1_000_000) }],
        structuredContent: {
          rows: Array.from({ length: 5000 }, (_, i) => ({ i })),
        },
      }),
    ).toBeUndefined();
    expect(DEFAULT_TOOL_RESULT_LIMITS.maxBytes).toBe(4 * 1024 * 1024);
  });
});

describe('toolResultLimits', () => {
  it('refuses a limit that is not a positive whole number', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity])
      expect(() => toolResultLimits({ maxNodes: bad })).toThrow(RangeError);
  });
});

describe('ToolResultRefused', () => {
  it('is a TypeError that names the limit and never repeats content', () => {
    const refusal = new ToolResultRefused('bytes', limits({ maxBytes: 10 }));
    expect(refusal).toBeInstanceOf(TypeError);
    expect(refusal.message).toBe('The tool result is larger than 10 bytes.');
    expect(refusal.exceeded).toBe('bytes');
  });
});
