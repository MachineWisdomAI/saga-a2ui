import {
  Catalog,
  type ComponentApi,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import { describe, expect, it, vi } from 'vitest';
import { z } from '../zod3.js';
import {
  a2uiV0_9Decoder,
  createA2uiV0_9Decoder,
  type MessageDecoder,
} from './decoder.js';
import { measureRetained, retainedGrowth } from './retained-state.js';
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

  // Primitives are an allowlist: strings, finite numbers, booleans and null. A bigint is
  // charged as nothing by the node and byte counts yet can hold millions of bits.
  const unsupportedPrimitives: [string, () => unknown][] = [
    ['a bigint', () => 1n << 8_000_000n],
    ['a small bigint', () => 1n],
    ['a symbol', () => Symbol('s')],
    ['a function', () => () => 1],
    ['undefined', () => undefined],
    ['NaN', () => Number.NaN],
    ['Infinity', () => Number.POSITIVE_INFINITY],
  ];

  it.each(unsupportedPrimitives)(
    'refuses %s from the default decoder wherever it sits',
    (_, make) => {
      const decoder = createA2uiV0_9Decoder({ maxNodes: 1_000 });
      for (const value of [
        make(),
        { a: make() },
        [make()],
        { a: [{ b: make() }] },
      ]) {
        const failure = failureOf(setData(value), decoder);
        expect(failure.kind).toBe('malformed');
        expect(failure.message).toMatch(/not plain data/);
      }
    },
  );

  it('does not let an oversized bigint through the default decoder into a session', () => {
    const session = createMessageSession({
      catalogs: [catalog],
      decoder: a2uiV0_9Decoder,
      retainedLimits: { maxNodes: 10, maxBytes: 100 },
    });
    expect(session.ingest(create).ok).toBe(true);
    const result = session.ingest(setData(1n << 8_000_000n));
    expect(result.ok).toBe(false);
    expect(result.ok || result.failure.kind).toBe('malformed');
  });

  it('still accepts strings, finite numbers, booleans and null', () => {
    const value = { s: 'x', n: -1.5, z: 0, t: true, f: false, nil: null };
    expect(decodedValue(a2uiV0_9Decoder.decode(setData(value)))).toEqual(value);
  });

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

  /** A proxy that counts the reads of each property name. */
  function counted<T extends object>(target: T, reads: Map<string, number>) {
    return new Proxy(target, {
      get(object, key, receiver) {
        const name = String(key);
        reads.set(name, (reads.get(name) ?? 0) + 1);
        return Reflect.get(object, key, receiver);
      },
    });
  }

  it('reads the length of a root message list once, and refuses an over-long one on that read', () => {
    const reads = new Map<string, number>();
    const list = counted([remove], reads);
    expect(a2uiV0_9Decoder.decode(list).ok).toBe(true);
    expect(reads.get('length')).toBe(1);
    expect(reads.get('0')).toBe(1);

    const tooLong = new Map<string, number>();
    const decoder = createA2uiV0_9Decoder({ maxMessages: 1 });
    expect(decoder.decode(counted([remove, remove], tooLong)).ok).toBe(false);
    expect(tooLong.get('length')).toBe(1);
    expect(tooLong.get('0')).toBeUndefined();
  });

  it('reads an envelope getter and its list once, and parses the value it measured', () => {
    let envelopeReads = 0;
    const listReads = new Map<string, number>();
    const envelope = {
      get messages() {
        envelopeReads += 1;
        // The first read is the list that was measured; a second would be far over budget.
        return envelopeReads === 1
          ? counted([remove], listReads)
          : new Array<unknown>(5_000).fill(remove);
      },
    };
    const result = a2uiV0_9Decoder.decode(envelope);
    expect(result.ok && result.messages.length).toBe(1);
    expect(envelopeReads).toBe(1);
    expect(listReads.get('length')).toBe(1);
  });

  it('measures a list a getter shrinks on its second read by the first read', () => {
    let reads = 0;
    const envelope = {
      get messages() {
        reads += 1;
        return reads === 1 ? new Array<unknown>(5_000).fill(remove) : [remove];
      },
    };
    const failure = failureOf(envelope);
    expect(failure.message).toMatch(/more than 1000 messages/);
    expect(reads).toBe(1);
  });

  it('counts messages only for the list itself, not for a key named messages deeper down', () => {
    const decoder = createA2uiV0_9Decoder({ maxMessages: 2 });
    expect(decoder.decode(setData({ messages: [1, 2, 3, 4] })).ok).toBe(true);
    expect(decoder.decode({ messages: [remove, remove] }).ok).toBe(true);
    expect(decoder.decode({ messages: [remove, remove, remove] }).ok).toBe(
      false,
    );
  });

  it('refuses a throwing getter as malformed', () => {
    const value = {
      get boom(): string {
        throw new Error('boom');
      },
    };
    expect(failureOf(setData(value)).kind).toBe('malformed');
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

  it('keeps accepting the same long scalar path, and still refuses a new one', () => {
    // 4 values for the surface, 31 for the path: 35 of 60 held after the first write.
    const { session, held } = newSession(60);
    const path = `/a${'/a'.repeat(30)}`;
    for (let index = 0; index < 50; index += 1) {
      const result = session.ingest(setData(`v${index}`, path));
      if (!result.ok)
        throw new Error(`update ${index}: ${result.failure.message}`);
    }
    expect(held()).toBe(32); // 31 objects and the scalar
    // A second path of new containers does not fit, and nothing of it is kept.
    const other = session.ingest(setData('v', `/b${'/b'.repeat(30)}`));
    expect(other.ok).toBe(false);
    expect(other.ok || other.failure.kind).toBe('rejected');
    expect(held()).toBe(32);
    // The first path can still be replaced after the refusal.
    expect(session.ingest(setData('again', path)).ok).toBe(true);
  });

  it('charges only the containers a path does not already have', () => {
    // 4 values for the surface and 29 for the path: 33 of 36 held after the first write.
    const { session, held } = newSession(36);
    expect(session.ingest(setData('v', `/a${'/a'.repeat(28)}`)).ok).toBe(true);
    // A branch off the 28th level makes two new containers, not thirty.
    const branch = `${'/a'.repeat(28)}/x/y`;
    expect(session.ingest(setData('v', branch)).ok).toBe(true);
    expect(held()).toBeLessThanOrEqual(36);
    // Five new containers do not fit, and none of them is kept.
    const before = held();
    expect(
      session.ingest(setData('v', `${'/a'.repeat(28)}/p/q/r/s/t`)).ok,
    ).toBe(false);
    expect(held()).toBe(before);
  });

  it('credits the value a write replaces, and charges only the difference', () => {
    // 4 values for the surface, 1 for the key and 40 for the object: 45 held, 46 allowed.
    const { session, held } = newSession(46);
    const keys = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`k${index}`, index]),
      );
    expect(session.ingest(setData(keys(40), '/slot')).ok).toBe(true);
    for (let index = 0; index < 20; index += 1)
      expect(session.ingest(setData(keys(40), '/slot')).ok).toBe(true);
    expect(session.ingest(setData(keys(41), '/slot')).ok).toBe(true); // exactly the budget
    expect(session.ingest(setData(keys(42), '/slot')).ok).toBe(false);
    expect(held()).toBe(43); // the refused write left the 41 keys in place
    expect(session.ingest(setData(keys(5), '/slot')).ok).toBe(true);
  });

  it('treats a batch that writes the same new path twice as the same two writes sent apart', () => {
    const path = `/a${'/a'.repeat(30)}`;
    // Sent apart, both fit (4 values for the surface and 32 for the path, of 60).
    const apart = newSession(60);
    expect(apart.session.ingest(setData('one', path)).ok).toBe(true);
    expect(apart.session.ingest(setData('two', path)).ok).toBe(true);
    // Sent together, the second write replaces the first, so both fit as well.
    const together = newSession(60);
    expect(
      together.session.ingest([setData('one', path), setData('two', path)]).ok,
    ).toBe(true);
    expect(together.held()).toBe(apart.held());
    expect(together.held()).toBe(32);
    // And so do many, with a deletion between.
    const many = newSession(60);
    const remove = {
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', path },
    };
    const batch = Array.from({ length: 40 }, (_, index) =>
      index % 3 === 2 ? remove : setData(`v${index}`, path),
    );
    expect(many.session.ingest(batch).ok).toBe(true);
    expect(many.held()).toBeLessThanOrEqual(60);
  });

  it('still refuses a batch whose writes do not fit together, and keeps none of it', () => {
    const { session, held } = newSession(60);
    const first = `/a${'/a'.repeat(30)}`;
    const second = `/b${'/b'.repeat(30)}`;
    const result = session.ingest([
      setData('one', first),
      setData('two', second),
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok || result.failure.kind).toBe('rejected');
    expect(held()).toBe(1);
    // Each fits alone; it is the pair that does not.
    expect(session.ingest(setData('one', first)).ok).toBe(true);
    expect(held()).toBe(32);
  });

  it('credits a value an earlier message of the batch wrote, once', () => {
    // 4 values for the surface, 1 for the key and 40 for the object.
    const { session, held } = newSession(46);
    const keys = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`k${index}`, index]),
      );
    expect(
      session.ingest([
        setData(keys(40), '/slot'),
        setData(keys(41), '/slot'),
        setData(keys(5), '/slot'),
        setData(keys(41), '/slot'),
      ]).ok,
    ).toBe(true);
    expect(held()).toBe(43);
    // Growing twice past the budget in one batch is refused as a whole.
    expect(
      session.ingest([setData(keys(41), '/slot'), setData(keys(43), '/slot')])
        .ok,
    ).toBe(false);
    expect(held()).toBe(43);
  });

  it('does not credit a deletion of something that is not there', () => {
    const { session, held } = newSession(36);
    const path = `/a${'/a'.repeat(28)}`;
    const remove = (at: string) => ({
      version: 'v0.9',
      updateDataModel: { surfaceId: 's', path: at },
    });
    // Deleting a path that was never written frees nothing for the write after it.
    const result = session.ingest([
      remove(`/z${'/z'.repeat(28)}`),
      setData('one', path),
      setData('two', `/b${'/b'.repeat(28)}`),
    ]);
    expect(result.ok).toBe(false);
    expect(held()).toBe(1);
  });

  it('charges a surface a batch creates exactly as it would be charged apart', () => {
    const batched = createMessageSession({
      catalogs: [catalog],
      decoder: a2uiV0_9Decoder,
      retainedLimits: { maxNodes: 60, maxBytes: 1_000_000 },
    });
    const path = `/a${'/a'.repeat(30)}`;
    expect(
      batched.ingest([create, setData('one', path), setData('two', path)]).ok,
    ).toBe(true);
  });

  it('keeps accepting a component that is replaced, without a deletion between', () => {
    const session = createMessageSession({
      catalogs: [catalog],
      decoder: a2uiV0_9Decoder,
      retainedLimits: { maxNodes: 30, maxBytes: 1_000_000 },
    });
    expect(session.ingest(create).ok).toBe(true);
    for (let index = 0; index < 100; index += 1) {
      const result = session.ingest({
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [
            { id: 'root', component: 'Panel', title: `Title ${index}` },
          ],
        },
      });
      if (!result.ok)
        throw new Error(`update ${index}: ${result.failure.message}`);
    }
  });
});

describe('retained-state measurement of what a custom decoder supplies', () => {
  // A custom decoder may hand the session any value; its content must be charged or refused.
  const decoderOf = (
    ...messages: Record<string, unknown>[]
  ): MessageDecoder => ({
    decode: () => ({
      ok: true,
      messages: messages.map((message) => ({
        accept: (visitor) => {
          const tag = Object.keys(message).find((key) => key !== 'version');
          return (visitor as unknown as Record<string, (m: unknown) => never>)[
            tag!
          ]!({ version: 'v0.9', ...message });
        },
      })),
    }),
  });
  const wide = () =>
    new Map(Array.from({ length: 250_000 }, (_, index) => [index, index]));
  const limits = { maxNodes: 10, maxBytes: 100 };
  const surfaceOf = (session: ReturnType<typeof createMessageSession>) => {
    let surface: SurfaceModel<ComponentApi> | undefined;
    session.onSurfaceCreated((created) => (surface = created));
    return () => surface;
  };
  const data = (value: unknown, path?: string) => ({
    updateDataModel: {
      surfaceId: 's',
      ...(path === undefined ? {} : { path }),
      value,
    },
  });
  const components = (entries: unknown[]) => ({
    updateComponents: { surfaceId: 's', components: entries },
  });

  class Held {
    readonly items = [1];
  }
  // What the session is given, as `updateDataModel`, `updateComponents` or `createSurface`.
  const cases: [string, Record<string, unknown>][] = [
    ['a Map as a data value', data(wide())],
    ['a Map at a data path', data(wide(), '/a/b')],
    ['a Map nested in a data value', data({ a: [{ b: wide() }] })],
    ['a Map at a shallow data path', data(wide(), '/m')],
    ['a Set', data(new Set([1, 2, 3]))],
    ['a Date', data(new Date())],
    ['a class instance', data(new Held())],
    ['an oversized bigint as a data value', data(1n << 8_000_000n)],
    ['a bigint nested in a data value', data({ a: [1n << 8_000_000n] })],
    ['a symbol', data({ a: Symbol('s') })],
    ['a function', data({ a: () => 1 })],
    ['a non-finite number', data({ a: Number.POSITIVE_INFINITY })],
    [
      'a bigint as a property',
      components([{ id: 'root', component: 'Panel', title: 1n << 8_000_000n }]),
    ],
    [
      'a Map as a property',
      components([{ id: 'root', component: 'Panel', title: wide() }]),
    ],
    [
      'a Map as component metadata',
      components([{ id: 'root', component: 'Panel', metadata: wide() }]),
    ],
    ['a Map as a component entry', components([wide()])],
    [
      'a Map as a theme',
      {
        createSurface: {
          surfaceId: 't',
          catalogId: CATALOG_ID,
          theme: wide(),
        },
      },
    ],
  ];

  it.each(cases)('refuses %s, and keeps nothing of it', (_, bad) => {
    const holder = { decoder: decoderOf(create) };
    const session = createMessageSession({
      catalogs: [catalog],
      decoder: { decode: (input) => holder.decoder.decode(input) },
      retainedLimits: limits,
    });
    const surface = surfaceOf(session);
    expect(session.ingest(null).ok).toBe(true);
    const before = measureRetained(new Map([['s', surface()!]]), limits);

    holder.decoder = decoderOf(bad);
    const result = session.ingest(null);
    expect(result.ok).toBe(false);
    expect(result.ok || result.failure.kind).toBe('rejected');
    expect(measureRetained(new Map([['s', surface()!]]), limits)).toEqual(
      before,
    );
    expect(surface()!.dataModel.get('/')).toEqual({});
    expect(surface()!.componentsModel.get('root')).toBeUndefined();
  });

  it('still accepts the same shapes as plain data', () => {
    const holder = { decoder: decoderOf(create) };
    const session = createMessageSession({
      catalogs: [catalog],
      decoder: { decode: (input) => holder.decoder.decode(input) },
      retainedLimits: limits,
    });
    expect(session.ingest(null).ok).toBe(true);
    holder.decoder = decoderOf(data({ a: [{ b: 1 }] }, '/m'));
    expect(session.ingest(null).ok).toBe(true);
  });

  it('refuses a Map as the first thing a session is given, too', () => {
    const session = createMessageSession({
      catalogs: [catalog],
      decoder: decoderOf({
        createSurface: {
          surfaceId: 's',
          catalogId: CATALOG_ID,
          theme: wide(),
        },
      }),
      retainedLimits: limits,
    });
    const surface = surfaceOf(session);
    expect(session.ingest(null).ok).toBe(false);
    expect(surface()).toBeUndefined();
  });

  // A custom decoder's value is read once into a snapshot; the snapshot is measured, replayed
  // and applied, so what is kept is what was measured.
  const sessionWith = (
    first: Record<string, unknown>,
    retainedLimits = limits,
  ) => {
    const holder = { decoder: decoderOf(create) };
    const session = createMessageSession({
      catalogs: [catalog],
      decoder: { decode: (input) => holder.decoder.decode(input) },
      retainedLimits,
    });
    const surface = surfaceOf(session);
    expect(session.ingest(null).ok).toBe(true);
    holder.decoder = decoderOf(first);
    return { session, surface };
  };

  it('reads a getter once, so the measured value is the one kept', () => {
    let reads = 0;
    const value = {
      get payload() {
        reads += 1;
        return reads === 1 ? 'ok' : 'x'.repeat(10_000);
      },
    };
    const { session, surface } = sessionWith(data(value));
    expect(session.ingest(null).ok).toBe(true);
    expect(reads).toBe(1);
    expect(surface()!.dataModel.get('/')).toEqual({ payload: 'ok' });
  });

  it('refuses a getter whose single read is over the limit', () => {
    let reads = 0;
    const value = {
      get payload() {
        reads += 1;
        return reads === 1 ? 'x'.repeat(10_000) : 'ok';
      },
    };
    const { session, surface } = sessionWith(data(value));
    const result = session.ingest(null);
    expect(result.ok).toBe(false);
    expect(reads).toBe(1);
    expect(surface()!.dataModel.get('/')).toEqual({});
  });

  it('refuses a getter that throws', () => {
    const value = {
      get payload(): string {
        throw new Error('boom');
      },
    };
    const { session, surface } = sessionWith(data(value));
    const result = session.ingest(null);
    expect(result.ok).toBe(false);
    expect(result.ok || result.failure.kind).toBe('rejected');
    expect(surface()!.dataModel.get('/')).toEqual({});
  });

  it('reads each property of a proxy once and keeps what it showed', () => {
    const reads = new Map<string | symbol, number>();
    const target: Record<string, unknown> = { a: 'one', b: 'two' };
    const value = new Proxy(target, {
      get(object, key) {
        const count = (reads.get(key) ?? 0) + 1;
        reads.set(key, count);
        return count === 1 ? object[key as string] : 'x'.repeat(10_000);
      },
    });
    const { session, surface } = sessionWith(data(value));
    expect(session.ingest(null).ok).toBe(true);
    expect(reads.get('a')).toBe(1);
    expect(reads.get('b')).toBe(1);
    expect(surface()!.dataModel.get('/')).toEqual({ a: 'one', b: 'two' });
  });

  it('does not keep an extra own property of an array, whatever it holds', () => {
    const items = Object.assign([] as unknown[], { extra: wide() });
    const { session, surface } = sessionWith(data(items, '/m'));
    expect(session.ingest(null).ok).toBe(true);
    const kept = surface()!.dataModel.get('/m') as unknown[];
    expect(kept).toEqual([]);
    expect(Object.keys(kept)).toEqual([]);
    expect(
      measureRetained(new Map([['s', surface()!]]), limits).nodes,
    ).toBeLessThanOrEqual(limits.maxNodes);
  });

  it('uses only the first observation of a message that shows more than one', () => {
    let calls = 0;
    const decoder: MessageDecoder = {
      decode: () => ({
        ok: true,
        messages: [
          {
            accept: (visitor) => {
              calls += 1;
              const v = visitor as unknown as Record<
                string,
                (m: unknown) => never
              >;
              if (calls > 1) return v.createSurface!(create);
              return v.createSurface!({
                ...create,
                createSurface: {
                  ...create.createSurface,
                  get theme() {
                    return {};
                  },
                },
              });
            },
          },
        ],
      }),
    };
    const session = createMessageSession({
      catalogs: [catalog],
      decoder,
      retainedLimits: limits,
    });
    expect(session.ingest(null).ok).toBe(true);
    expect(calls).toBe(1);
  });

  it('refuses a message that never shows the session a case', () => {
    const session = createMessageSession({
      catalogs: [catalog],
      decoder: {
        decode: () => ({
          ok: true,
          messages: [{ accept: () => undefined as never }],
        }),
      },
      retainedLimits: limits,
    });
    const result = session.ingest(null);
    expect(result.ok).toBe(false);
    expect(result.ok || result.failure.kind).toBe('rejected');
  });
});

describe('retained growth is never below what a batch really adds', () => {
  // A small seeded generator, so a failure names a reproducible case.
  function random(seed: number) {
    let state = seed;
    return (below: number) => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state % below;
    };
  }
  const segments = ['a', 'b', '0', '1', '3', 'x~1y', 'long-name-é'];

  function randomValue(next: (below: number) => number, depth = 0): unknown {
    switch (next(depth > 2 ? 4 : 7)) {
      case 0:
        return 'text'.repeat(next(5));
      case 1:
        return next(100);
      case 2:
        return null;
      case 3:
        return true;
      case 4:
        return Array.from({ length: next(4) }, () =>
          randomValue(next, depth + 1),
        );
      default:
        return Object.fromEntries(
          Array.from({ length: next(4) }, () => [
            segments[next(segments.length)]!,
            randomValue(next, depth + 1),
          ]),
        );
    }
  }

  function randomMessage(next: (below: number) => number): unknown {
    // The surface is deleted and made again, which the rest of the batch finds empty.
    if (next(15) === 0) return [remove, create];
    if (next(6) === 0)
      return {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [
            {
              id: next(2) === 0 ? 'root' : 'a',
              component: 'Panel',
              title: 'x'.repeat(next(20)),
            },
          ],
        },
      };
    const path =
      next(8) === 0
        ? undefined
        : `/${Array.from({ length: 1 + next(5) }, () => segments[next(segments.length)]).join('/')}`;
    // A data model root that is not an object is refused upstream, so root writes are objects.
    const value =
      path === undefined ? { a: randomValue(next) } : randomValue(next);
    return {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 's',
        ...(path === undefined ? {} : { path }),
        ...(value === undefined ? {} : { value }),
      },
    };
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'holds for a random sequence of batches (seed %i)',
    (seed) => {
      const next = random(seed);
      const limits = { maxNodes: 1_000_000, maxBytes: 100_000_000 };
      const session = createMessageSession({
        catalogs: [catalog],
        decoder: a2uiV0_9Decoder,
        retainedLimits: limits,
      });
      const surfaces = new Map<string, SurfaceModel<ComponentApi>>();
      session.onSurfaceCreated((surface) => surfaces.set(surface.id, surface));
      session.onSurfaceDeleted((id) => surfaces.delete(id));
      session.ingest(create);
      let applied = 0;
      for (let step = 0; step < 400; step += 1) {
        const batch = Array.from({ length: 1 + next(5) }, () =>
          randomMessage(next),
        ).flat();
        const decoded = a2uiV0_9Decoder.decode(batch);
        if (!decoded.ok) throw new Error(decoded.failure.message);
        const growth = retainedGrowth(decoded.messages, limits, surfaces);
        const before = measureRetained(surfaces, limits);
        const result = session.ingest(batch);
        const after = measureRetained(surfaces, limits);
        if (result.ok) applied += 1;
        // Messages applied before a refusal stay applied, so this holds for every batch.
        expect(growth).toBeDefined();
        // What the state really is can never make a batch cost more than the bound that reads none.
        const bound = retainedGrowth(decoded.messages, limits);
        expect(growth!.nodes).toBeLessThanOrEqual(bound!.nodes);
        expect(growth!.bytes).toBeLessThanOrEqual(bound!.bytes);
        expect(after.nodes - before.nodes).toBeLessThanOrEqual(growth!.nodes);
        expect(after.bytes - before.bytes).toBeLessThanOrEqual(growth!.bytes);
      }
      expect(applied).toBeGreaterThan(50);
    },
  );
});
