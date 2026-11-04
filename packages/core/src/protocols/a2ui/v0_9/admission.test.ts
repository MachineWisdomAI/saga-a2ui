import { Catalog, type ComponentApi } from '@a2ui/web_core/v0_9';
import { describe, expect, it, vi } from 'vitest';
import { z } from '../zod3.js';
import { a2uiV0_9Decoder, createA2uiV0_9Decoder } from './decoder.js';
import { createMessageSession } from './session.js';

// Admission is checked before Zod, before the first copy and before anything is retained, so
// these tests reach the decoder and the session through their public interfaces only.
const CATALOG_ID = 'https://example.test/catalog';
const Panel: ComponentApi = {
  name: 'Panel',
  schema: z
    .object({
      title: z.string().optional(),
      items: z.array(z.string()).optional(),
    })
    .strict(),
};
const catalog = new Catalog<ComponentApi>(CATALOG_ID, 'v0.9', [Panel]);

const create = {
  version: 'v0.9',
  createSurface: { surfaceId: 's', catalogId: CATALOG_ID },
} as const;
const remove = { version: 'v0.9', deleteSurface: { surfaceId: 's' } } as const;
const setData = (value: unknown, path?: string) => ({
  version: 'v0.9',
  updateDataModel: {
    surfaceId: 's',
    ...(path === undefined ? {} : { path }),
    value,
  },
});

/** `value` wrapped in `levels` single-key objects, built without recursion. */
function nested(levels: number, leaf: unknown = 'leaf'): unknown {
  let value = leaf;
  for (let i = 0; i < levels; i += 1) value = { a: value };
  return value;
}

function failureOf(input: unknown, decoder = a2uiV0_9Decoder) {
  const result = decoder.decode(input);
  if (result.ok) throw new Error('expected a failure');
  return result.failure;
}

describe('decoder admission (before parsing and copying)', () => {
  it('refuses a message list over the message budget without reading any element', () => {
    let reads = 0;
    const list = new Proxy(new Array<unknown>(5_000).fill(remove), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    for (const input of [list, { messages: list }]) {
      const failure = failureOf(input);
      expect(failure.kind).toBe('malformed');
      expect(failure.message).toMatch(/more than 1000 messages/);
    }
    expect(reads).toBe(0);
  });

  it('refuses an array over the item budget, wherever it sits, before reading its items', () => {
    let reads = 0;
    const items = new Proxy(new Array<unknown>(10_001).fill('x'), {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const failure = failureOf(setData({ items }));
    expect(failure.kind).toBe('malformed');
    expect(failure.message).toMatch(/array with more than 10000 items/);
    expect(reads).toBe(0);
  });

  it('refuses nesting over the depth budget iteratively, however deep', () => {
    for (const levels of [63, 200_000]) {
      const failure = failureOf(setData(nested(levels)));
      expect(failure.kind).toBe('malformed');
      expect(failure.message).toMatch(/nested deeper than 64 levels/);
    }
  });

  it('refuses input over the byte budget before copying it', () => {
    const failure = failureOf(setData('x'.repeat(4 * 1024 * 1024 + 1)));
    expect(failure.kind).toBe('malformed');
    expect(failure.message).toMatch(/larger than 4194304 bytes/);
  });

  it('counts bytes, not characters, and keys as well as values', () => {
    const decoder = createA2uiV0_9Decoder({ maxBytes: 1_000 });
    expect(decoder.decode(setData('é'.repeat(100))).ok).toBe(true); // ~200 bytes
    expect(decoder.decode(setData('€'.repeat(400))).ok).toBe(false); // 1200 bytes, 400 chars
    expect(decoder.decode(setData({ ['k'.repeat(1_000)]: 1 })).ok).toBe(false);
  });

  it('refuses input over the node budget, including a cycle or a shared subtree', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const shared = { leaf: ['a', 'b', 'c'] };
    const wide = Array.from({ length: 5_000 }, () => shared);
    for (const value of [cyclic, wide]) {
      const failure = failureOf(
        setData(value),
        createA2uiV0_9Decoder({ maxNodes: 1_000, maxDepth: 100_000 }),
      );
      expect(failure.message).toMatch(/more than 1000 values/);
    }
  });

  it('refuses a data path deeper than the depth budget', () => {
    const failure = failureOf(setData('v', '/a'.repeat(65)));
    expect(failure.kind).toBe('malformed');
    expect(failure.message).toMatch(/path/);
  });

  it('refuses a typed-array body by its byte length', () => {
    const decoder = createA2uiV0_9Decoder({ maxBytes: 1_000 });
    expect(decoder.decode(setData(new Uint8Array(2_000))).ok).toBe(false);
  });

  it('still decodes legitimate large input', () => {
    const components = Array.from({ length: 500 }, (_, index) => ({
      id: index === 0 ? 'root' : `c${index}`,
      component: 'Panel',
      title: `Component ${index}`,
      items: ['one', 'two', 'three'],
    }));
    const wide = Object.fromEntries(
      Array.from({ length: 2_000 }, (_, index) => [
        `field${index}`,
        `value ${index}`,
      ]),
    );
    const input = [
      create,
      { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
      setData({
        text: 'x'.repeat(1024 * 1024),
        wide,
        list: Array.from({ length: 10_000 }, (_, i) => i),
      }),
      setData(nested(50)),
    ];
    const result = a2uiV0_9Decoder.decode(input);
    expect(result.ok && result.messages.length).toBe(4);
    expect(a2uiV0_9Decoder.decode({ messages: input }).ok).toBe(true);
  });

  it('accepts exactly the budgets and refuses one past them', () => {
    const decoder = createA2uiV0_9Decoder({ maxMessages: 3, maxArrayItems: 4 });
    expect(decoder.decode([remove, remove, remove]).ok).toBe(true);
    expect(decoder.decode([remove, remove, remove, remove]).ok).toBe(false);
    expect(decoder.decode(setData({ list: [1, 2, 3, 4] })).ok).toBe(true);
    expect(decoder.decode(setData({ list: [1, 2, 3, 4, 5] })).ok).toBe(false);
  });

  it('rejects a limit that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createA2uiV0_9Decoder({ maxNodes: bad })).toThrow(
        /maxNodes/,
      );
    }
  });

  it('reports the admission size of what it accepted', () => {
    const result = createA2uiV0_9Decoder().decode(setData('abc'));
    expect(result.ok && result.size.bytes).toBeGreaterThan(0);
    expect(result.ok && result.size.nodes).toBeGreaterThan(0);
  });
});

describe('session retained-state admission', () => {
  const retainedLimits = { maxNodes: 300, maxBytes: 100_000 };
  const newSession = () =>
    createMessageSession({
      catalogs: [catalog],
      decoder: a2uiV0_9Decoder,
      retainedLimits,
    });

  it('refuses growth past the retained budget and leaves earlier state in place', () => {
    const session = newSession();
    expect(session.ingest(create).ok).toBe(true);
    let accepted = 0;
    let refusal: ReturnType<typeof session.ingest> | undefined;
    for (let index = 0; index < 1_000; index += 1) {
      const result = session.ingest(setData(`value ${index}`, `/k${index}`));
      if (!result.ok) {
        refusal = result;
        break;
      }
      accepted += 1;
    }
    expect(accepted).toBeGreaterThan(20);
    expect(accepted).toBeLessThan(300);
    expect(refusal && !refusal.ok && refusal.failure.kind).toBe('rejected');
    expect(refusal && !refusal.ok && refusal.failure.message).toMatch(
      /retained/,
    );
  });

  it('keeps accepting updates that replace what is already retained', () => {
    const session = newSession();
    session.ingest(create);
    for (let index = 0; index < 3_000; index += 1) {
      const result = session.ingest(setData(`value ${index}`, '/counter'));
      if (!result.ok)
        throw new Error(`update ${index}: ${result.failure.message}`);
    }
  });

  it('releases a deleted surface, and lets a full session delete', () => {
    const session = newSession();
    const fill = () => {
      let count = 0;
      while (session.ingest(setData(`value ${count}`, `/k${count}`)).ok)
        count += 1;
      return count;
    };
    session.ingest(create);
    const first = fill();
    expect(session.ingest(remove).ok).toBe(true); // a full session can always shrink
    session.ingest(create);
    expect(fill()).toBe(first);
  });

  it('applies the byte budget to retained strings', () => {
    const session = createMessageSession({
      catalogs: [catalog],
      decoder: a2uiV0_9Decoder,
      retainedLimits: { maxBytes: 3_000 },
    });
    session.ingest(create);
    const chunk = 'x'.repeat(1_000);
    expect(session.ingest(setData(chunk, '/a')).ok).toBe(true);
    expect(session.ingest(setData(chunk, '/b')).ok).toBe(true);
    expect(session.ingest(setData(chunk, '/c')).ok).toBe(false);
  });
});

/** The `value` of the first message, which must be an `updateDataModel`. */
function decodedValue(result: ReturnType<typeof a2uiV0_9Decoder.decode>) {
  if (!result.ok)
    throw new Error(`expected success: ${result.failure.message}`);
  return result.messages[0]!.accept({
    createSurface: () => undefined,
    updateComponents: () => undefined,
    updateDataModel: (message) => message.updateDataModel.value,
    deleteSurface: () => undefined,
  });
}

describe('admission reads caller input once and builds no key lists', () => {
  /** An object of `count` accessor properties that records how many are read. */
  function accessors(count: number) {
    const reads = { count: 0 };
    const object: Record<string, unknown> = {};
    for (let index = 0; index < count; index += 1)
      Object.defineProperty(object, `k${index}`, {
        enumerable: true,
        get() {
          reads.count += 1;
          return index;
        },
      });
    return { object, reads };
  }

  it('stops reading a wide object at the first limit and never lists its keys', () => {
    const keys = vi.spyOn(Object, 'keys');
    const decoder = createA2uiV0_9Decoder({ maxNodes: 50 });
    try {
      const wide = accessors(5_000);
      const failure = failureOf(setData(wide.object), decoder);
      expect(failure.message).toMatch(/more than 50 values/);
      expect(wide.reads.count).toBeLessThanOrEqual(50);
      expect(keys).not.toHaveBeenCalled();
    } finally {
      keys.mockRestore();
    }
  });

  it("does the same for extra keys beside an envelope's messages, and for a wide message", () => {
    const keys = vi.spyOn(Object, 'keys');
    const decoder = createA2uiV0_9Decoder({ maxNodes: 50 });
    try {
      const extra = accessors(5_000);
      const envelope = Object.defineProperties(
        { messages: [] as unknown[] },
        Object.getOwnPropertyDescriptors(extra.object),
      );
      expect(decoder.decode(envelope).ok).toBe(false);
      expect(extra.reads.count).toBeLessThanOrEqual(50);
      const message = accessors(5_000);
      Object.defineProperty(message.object, 'version', {
        value: 'v0.9',
        enumerable: true,
      });
      expect(decoder.decode(message.object).ok).toBe(false);
      expect(message.reads.count).toBeLessThanOrEqual(50);
      expect(keys).not.toHaveBeenCalled();
    } finally {
      keys.mockRestore();
    }
  });

  it('still refuses an envelope with a key beside "messages"', () => {
    const failure = failureOf({ messages: [remove], extra: 1 });
    expect(failure.kind).toBe('malformed');
    expect(failure.message).toMatch(/only a "messages" array/);
  });

  it.each([
    ['a Map', () => new Map(Array.from({ length: 250_000 }, (_, i) => [i, i]))],
    ['a Set', () => new Set(Array.from({ length: 250_000 }, (_, i) => i))],
    ['a Date', () => new Date(0)],
    [
      'a class instance',
      () =>
        new (class Held {
          held = 'x';
        })(),
    ],
  ])(
    'refuses %s as not plain data instead of charging it as one value',
    (_, make) => {
      const failure = failureOf(
        setData({ nested: [make()] }),
        createA2uiV0_9Decoder({ maxNodes: 1_000 }),
      );
      expect(failure.kind).toBe('malformed');
      expect(failure.message).toMatch(/not plain data/);
    },
  );

  it('accepts null-prototype objects and binary data, kept as a copy', () => {
    const bare = Object.assign(Object.create(null) as object, { a: 1 });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const result = a2uiV0_9Decoder.decode(setData({ bare, bytes }));
    const value = decodedValue(result) as { bare: unknown; bytes: ArrayBuffer };
    expect(value.bare).toEqual({ a: 1 });
    expect(new Uint8Array(value.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(value.bytes).not.toBe(bytes);
  });

  it('measures and keeps the value it read: a getter is read once', () => {
    let reads = 0;
    const value = {
      get field() {
        reads += 1;
        return reads === 1 ? 'small' : 'x'.repeat(1_000_000);
      },
    };
    const decoder = createA2uiV0_9Decoder({ maxBytes: 10_000 });
    const result = decoder.decode(setData(value));
    expect(result.ok).toBe(true);
    expect(decodedValue(result)).toEqual({ field: 'small' });
    expect(reads).toBe(1);
  });

  it('reads each property of a proxy, and an array item and length, once', () => {
    const reads = new Map<string, number>();
    const trap = <T extends object>(target: T) =>
      new Proxy(target, {
        get(object, key, receiver) {
          const name = String(key);
          const count = (reads.get(name) ?? 0) + 1;
          reads.set(name, count);
          return count === 1
            ? Reflect.get(object, key, receiver)
            : 'x'.repeat(1_000_000);
        },
      });
    const proxied = trap({ a: 'one', list: trap(['first', 'second']) });
    const decoder = createA2uiV0_9Decoder({ maxBytes: 10_000 });
    const result = decoder.decode(setData(proxied));
    expect(decodedValue(result)).toEqual({
      a: 'one',
      list: ['first', 'second'],
    });
    for (const [name, count] of reads)
      if (name !== 'then') expect([name, count]).toEqual([name, 1]);
  });

  it('refuses a throwing getter as malformed', () => {
    const value = {
      get boom(): string {
        throw new Error('boom');
      },
    };
    expect(failureOf(setData(value)).kind).toBe('malformed');
  });

  it('charges the containers a data path may create', () => {
    const decoder = createA2uiV0_9Decoder();
    const plain = decoder.decode(setData('v'));
    const deep = decoder.decode(setData('v', '/a/b/c/12'));
    if (!plain.ok || !deep.ok) throw new Error('expected success');
    // three object containers, one array extended to index 12, and the path's property names
    expect(deep.size.nodes - plain.size.nodes).toBeGreaterThanOrEqual(3 + 13);
    expect(deep.size.bytes).toBeGreaterThan(plain.size.bytes);
  });
});

describe('session retained-state admission of data paths', () => {
  /** Values the data model holds, counted as the retained budget counts them. */
  function weigh(value: unknown): number {
    if (Array.isArray(value))
      return 1 + value.reduce<number>((sum, item) => sum + weigh(item), 0);
    if (typeof value === 'object' && value !== null)
      return (
        1 +
        Object.values(value).reduce<number>((sum, item) => sum + weigh(item), 0)
      );
    return 1;
  }

  function newSession(maxNodes: number) {
    const session = createMessageSession({
      catalogs: [catalog],
      decoder: a2uiV0_9Decoder,
      retainedLimits: { maxNodes, maxBytes: 1_000_000 },
    });
    let held = () => 0;
    session.onSurfaceCreated((surface) => {
      held = () => weigh(surface.dataModel.get('/'));
    });
    session.ingest(create);
    return { session, held: () => held() };
  }

  it('never lets repeated unique deep scalar paths retain more than the budget', () => {
    const { session, held } = newSession(400);
    let accepted = 0;
    let refused = false;
    for (let index = 0; index < 100 && !refused; index += 1) {
      const result = session.ingest(
        setData('v', `/p${index}${'/a'.repeat(63)}`),
      );
      if (result.ok) accepted += 1;
      else refused = true;
      expect(held()).toBeLessThanOrEqual(400);
    }
    expect(refused).toBe(true);
    expect(accepted).toBeGreaterThanOrEqual(1);
    expect(accepted).toBeLessThanOrEqual(6); // 64 containers each
  });

  it('charges an array a numeric path extends, before it is extended', () => {
    const { session, held } = newSession(5_000);
    const result = session.ingest(setData('v', '/list/9999/x'));
    expect(result.ok).toBe(false);
    expect(held()).toBeLessThanOrEqual(5_000);
    expect(held()).toBe(1);

    const small = newSession(400);
    let refused = false;
    for (let index = 0; index < 100 && !refused; index += 1) {
      refused = !small.session.ingest(setData('v', `/l${index}/50/x`)).ok;
      expect(small.held()).toBeLessThanOrEqual(400);
    }
    expect(refused).toBe(true);
  });

  it('keeps accepting a deep path that is replaced or deleted', () => {
    const { session } = newSession(300);
    const path = `/deep${'/a'.repeat(30)}`;
    const remove = {
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', path },
    };
    for (let index = 0; index < 1_000; index += 1) {
      const result = session.ingest(
        index % 2 === 0 ? setData(`v${index}`, path) : remove,
      );
      if (!result.ok)
        throw new Error(`update ${index}: ${result.failure.message}`);
    }
  });
});
