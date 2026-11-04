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

  describe('maxBytes is a bound on the serialized JSON size', () => {
    const jsonBytes = (value: unknown): number =>
      Buffer.byteLength(JSON.stringify(value), 'utf8');
    /** The smallest `maxBytes` that admits `value`. */
    const smallestBudget = (value: unknown): number => {
      let low = 1;
      let high = 2 ** 30;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (exceeded(value, { maxBytes: middle }) === undefined) high = middle;
        else low = middle + 1;
      }
      return low;
    };

    it('is exact for strings, property names and structure: admitted at the JSON size, refused one byte below', () => {
      for (const value of [
        '',
        'plain',
        '€€€',
        '😀',
        'a"b\\c',
        '\u0000'.repeat(5),
        '\n\t\b\f\r',
        '\u001f\u007f',
        '\ud800',
        '\udc00x',
        '\u2028\u2029',
        {},
        [],
        { k: 'v' },
        { 'a"b': 'c\nd' },
        { a: ['x', 'y', { b: 'z' }], c: {} },
        [[], [[]], {}],
        JSON.parse('{"__proto__":"x"}'),
        { content: [{ type: 'text', text: 'hello\u0000' }] },
      ]) {
        const size = jsonBytes(value);
        expect(smallestBudget(value)).toBe(size);
        expect(exceeded(value, { maxBytes: size })).toBeUndefined();
        expect(exceeded(value, { maxBytes: size - 1 })).toBe('bytes');
      }
    });

    it('refuses the NUL-text result whose raw bytes fit but whose JSON is six times larger', () => {
      const MiB4 = 4 * 1024 * 1024;
      const result = {
        content: [{ type: 'text', text: '\u0000'.repeat(MiB4 - 19) }],
      };
      expect(exceeded(result)).toBe('bytes');
      // The same size in ordinary characters is the legitimate case and is admitted.
      expect(
        exceeded({ content: [{ type: 'text', text: 'a'.repeat(MiB4 - 64) }] }),
      ).toBeUndefined();
    });

    it('never underestimates a number, boolean, null or absent value', () => {
      for (const value of [
        0,
        -1,
        0.1 + 0.2,
        5e-324,
        -1.7976931348623157e308,
        1e21,
        Number.MAX_SAFE_INTEGER,
        true,
        false,
        null,
        [undefined, undefined],
        [0.1 + 0.2, -1.7976931348623157e308, false, null],
        { a: 1e21, b: false, c: null, d: [-5e-324] },
      ])
        expect(smallestBudget(value)).toBeGreaterThanOrEqual(jsonBytes(value));
    });

    it('never underestimates binary values and charges at least their retained length', () => {
      for (const length of [1, 10, 11, 1000, 100_000])
        expect(smallestBudget(new Uint8Array(length))).toBeGreaterThanOrEqual(
          jsonBytes(new Uint8Array(length)),
        );
      expect(smallestBudget(new Float64Array(5))).toBeGreaterThanOrEqual(
        jsonBytes(new Float64Array(5)),
      );
      expect(smallestBudget(new ArrayBuffer(11))).toBeGreaterThanOrEqual(11);
      expect(exceeded(new Uint8Array(1000), { maxBytes: 100 })).toBe('bytes');
    });

    it('refuses a string far past the budget without measuring it', () => {
      expect(exceeded('x'.repeat(10_000), { maxBytes: 100 })).toBe('bytes');
    });
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

  it('resolves custom limits to a frozen object that cannot be raised afterwards', () => {
    const supplied = { maxBytes: 10 };
    const resolved = toolResultLimits(supplied);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(() => {
      (resolved as { maxBytes: number }).maxBytes = 2 ** 30;
    }).toThrow(TypeError);
    supplied.maxBytes = 2 ** 30;
    expect(resolved.maxBytes).toBe(10);
    expect(Object.isFrozen(DEFAULT_TOOL_RESULT_LIMITS)).toBe(true);
  });
});

describe('ToolResultRefused', () => {
  it('is a TypeError that names the limit and never repeats content', () => {
    const refusal = new ToolResultRefused('bytes', limits({ maxBytes: 10 }));
    expect(refusal).toBeInstanceOf(TypeError);
    expect(refusal.message).toBe('The tool result is larger than 10 bytes.');
    expect(refusal.exceeded).toBe('bytes');
  });

  it('exposes its own frozen copy of the limits, whatever object it was given', () => {
    const mutable: ToolResultLimits = { ...DEFAULT_TOOL_RESULT_LIMITS };
    const refusal = new ToolResultRefused('bytes', mutable);
    expect(refusal.limits).not.toBe(mutable);
    expect(Object.isFrozen(refusal.limits)).toBe(true);
    expect(() => {
      (refusal.limits as { maxBytes: number }).maxBytes = 2 ** 30;
    }).toThrow(TypeError);
    (mutable as { maxBytes: number }).maxBytes = 1;
    expect(refusal.limits.maxBytes).toBe(DEFAULT_TOOL_RESULT_LIMITS.maxBytes);
  });
});
