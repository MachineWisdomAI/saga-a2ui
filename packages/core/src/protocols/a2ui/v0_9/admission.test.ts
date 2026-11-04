import { Catalog, type ComponentApi } from '@a2ui/web_core/v0_9';
import { describe, expect, it } from 'vitest';
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
