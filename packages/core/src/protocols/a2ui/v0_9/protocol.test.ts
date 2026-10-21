import {
  Catalog,
  type ComponentApi,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import { describe, expect, it } from 'vitest';
import { z } from '../zod3.js';
import { a2uiV0_9Decoder } from './decoder.js';
import type { A2uiMessageVisitor, ValidatedMessage } from './message.js';
import { createMessageSession } from './session.js';

// Renderer-independent: no DOM, no Lit. A neutral one-component catalog stands in for the app's.
const CATALOG_ID = 'https://example.test/catalog';
const Panel: ComponentApi = {
  name: 'Panel',
  schema: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
    })
    .strict(),
};
const catalog = new Catalog<ComponentApi>(CATALOG_ID, 'v0.9', [Panel]);

const create = {
  version: 'v0.9',
  createSurface: { surfaceId: 's', catalogId: CATALOG_ID },
} as const;
const components = (list: Record<string, unknown>[]) =>
  ({
    version: 'v0.9',
    updateComponents: { surfaceId: 's', components: list },
  }) as const;
const rootPanel = components([
  { id: 'root', component: 'Panel', title: 'T', description: 'D' },
]);

/** Names the case of each message, via the visitor interface only. */
const caseName: A2uiMessageVisitor<string> = {
  createSurface: () => 'createSurface',
  updateComponents: () => 'updateComponents',
  updateDataModel: () => 'updateDataModel',
  deleteSurface: () => 'deleteSurface',
};
/** Returns the validated value of each message. */
const valueOf: A2uiMessageVisitor<unknown> = {
  createSurface: (m) => m,
  updateComponents: (m) => m,
  updateDataModel: (m) => m,
  deleteSurface: (m) => m,
};
const names = (messages: readonly ValidatedMessage[]) =>
  messages.map((m) => m.accept(caseName));

describe('decoder', () => {
  const decode = (input: unknown) => a2uiV0_9Decoder.decode(input);

  it('accepts a single message, an array and a message-list wrapper alike', () => {
    for (const input of [create, [create], { messages: [create] }]) {
      const result = decode(input);
      expect(result.ok && names(result.messages)).toEqual(['createSurface']);
    }
  });

  it('returns every case as its own typed visitor operation, in order', () => {
    const result = decode([
      create,
      rootPanel,
      { version: 'v0.9', updateDataModel: { surfaceId: 's', value: {} } },
      { version: 'v0.9', deleteSurface: { surfaceId: 's' } },
    ]);
    expect(result.ok && names(result.messages)).toEqual([
      'createSurface',
      'updateComponents',
      'updateDataModel',
      'deleteSurface',
    ]);
  });

  it('preserves supplied optional fields', () => {
    const input = {
      version: 'v0.9',
      createSurface: {
        surfaceId: 's',
        catalogId: CATALOG_ID,
        theme: { primaryColor: '#fff' },
        sendDataModel: true,
      },
    };
    const result = decode(input);
    if (!result.ok) throw new Error(result.failure.message);
    expect(result.messages[0]!.accept(valueOf)).toEqual(input);
  });

  it('does not let later changes to the caller input alter validated messages', () => {
    const entry: Record<string, unknown> = {
      id: 'root',
      component: 'Panel',
      title: 'Before',
    };
    const result = decode(components([entry]));
    entry.title = 'After';
    expect(result.ok && result.messages[0]!.accept(valueOf)).toEqual(
      components([{ id: 'root', component: 'Panel', title: 'Before' }]),
    );
  });

  it.each([
    [
      'an unsupported version',
      { ...create, version: 'v0.8' },
      'unsupported-version',
    ],
    [
      'a missing version',
      { createSurface: create.createSurface },
      'unsupported-version',
    ],
    ['a non-object', 'text', 'malformed'],
    ['null', null, 'malformed'],
    ['an unknown operation', { version: 'v0.9', notAMessage: {} }, 'malformed'],
    [
      'a case with a missing field',
      { version: 'v0.9', createSurface: { surfaceId: 's' } },
      'malformed',
    ],
    [
      'two operations in one message',
      { ...create, deleteSurface: { surfaceId: 's' } },
      'malformed',
    ],
    [
      'a wrapper with extra keys',
      { messages: [create], extra: 1 },
      'malformed',
    ],
    [
      'a wrapper whose messages is not an array',
      { messages: create },
      'malformed',
    ],
  ])('rejects %s with a typed failure', (_name, input, kind) => {
    const result = decode(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe(kind);
      expect(result.failure.message).not.toBe('');
    }
  });

  it('rejects an empty component list, which the schema forbids', () => {
    const result = decode(components([]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('malformed');
  });

  it('exposes no unchecked message constructor', async () => {
    const exported = Object.keys(await import('./message.js'));
    expect(exported).toEqual([]);
  });

  it.each([
    [
      'a value that cannot be copied',
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 's',
          value: { unsupported: () => undefined },
        },
      },
      'malformed',
    ],
    [
      'a bigint version',
      { version: 1n, deleteSurface: { surfaceId: 's' } },
      'unsupported-version',
    ],
    [
      'a cyclic version',
      (() => {
        const v: unknown[] = [];
        v.push(v);
        return { version: v, deleteSurface: { surfaceId: 's' } };
      })(),
      'unsupported-version',
    ],
  ])(
    'returns a typed failure instead of throwing for %s',
    (_name, input, kind) => {
      const result = decode(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe(kind);
    },
  );

  it('returns malformed instead of throwing when inspecting the input throws', () => {
    const throwingProperty = {
      version: 'v0.9',
      get deleteSurface(): never {
        throw new Error('invalid caller property');
      },
    };
    const throwingList = {
      get messages(): never {
        throw new Error('invalid caller property');
      },
    };
    for (const input of [throwingProperty, [throwingProperty], throwingList]) {
      const result = decode(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe('malformed');
    }
    expect(decode(create).ok).toBe(true);
  });

  it('rejects the whole input when any message in a batch is invalid', () => {
    expect(decode([create, { version: 'v0.9', notAMessage: {} }]).ok).toBe(
      false,
    );
  });
});

describe('message session', () => {
  const newSession = () =>
    createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder });

  const surfaceOf = (session: ReturnType<typeof newSession>) => {
    const surfaces: unknown[] = [];
    session.onSurfaceCreated((s) => surfaces.push(s));
    return surfaces;
  };

  it('applies a valid creation sequence and announces the surface', () => {
    const session = newSession();
    const created = surfaceOf(session);
    expect(session.ingest([create, rootPanel]).ok).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('applies successive data-model updates from frozen validated messages', () => {
    const session = newSession();
    const created = surfaceOf(session);
    expect(
      session.ingest([
        create,
        rootPanel,
        {
          version: 'v0.9',
          updateDataModel: { surfaceId: 's', value: { title: 'One' } },
        },
        {
          version: 'v0.9',
          updateDataModel: { surfaceId: 's', path: '/title', value: 'Two' },
        },
      ]),
    ).toEqual({ ok: true });
    const surface = created[0] as SurfaceModel<ComponentApi>;
    expect(surface.dataModel.get('/title')).toBe('Two');
  });

  it('accepts a partial update of an existing component, resolving its type from state', () => {
    const session = newSession();
    const created = surfaceOf(session);
    session.ingest([create, rootPanel]);
    const result = session.ingest(
      components([{ id: 'root', title: 'Partial title' }]),
    );
    expect(result).toEqual({ ok: true });
    const root = (created[0] as SurfaceModel<ComponentApi>).componentsModel.get(
      'root',
    );
    expect(root?.type).toBe('Panel');
    expect(root?.properties).toMatchObject({ title: 'Partial title' });
  });

  it('rejects a new component of an unknown type, including inside a wrapper', () => {
    const session = newSession();
    session.ingest([create, rootPanel]);
    const bad = components([{ id: 'extra', component: 'Unsupported' }]);
    for (const input of [bad, [bad], { messages: [bad] }]) {
      const result = session.ingest(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe('rejected');
    }
  });

  it('rejects a partial update of a component that does not exist', () => {
    const session = newSession();
    session.ingest([create, rootPanel]);
    const result = session.ingest(components([{ id: 'ghost', title: 'x' }]));
    expect(result.ok).toBe(false);
  });

  it('rejects updates to an unknown surface', () => {
    const session = newSession();
    const result = session.ingest(
      components([{ id: 'root', component: 'Panel' }]),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a wrongly typed property', () => {
    const session = newSession();
    session.ingest(create);
    expect(
      session.ingest(
        components([{ id: 'root', component: 'Panel', title: 42 }]),
      ).ok,
    ).toBe(false);
  });

  it('reports decode failures through the same result type and keeps working afterwards', () => {
    const session = newSession();
    const failed = session.ingest({ version: 'v0.9', notAMessage: {} });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.failure.kind).toBe('malformed');
    expect(session.ingest([create, rootPanel]).ok).toBe(true);
  });

  it('reports uncopyable or odd input through ingest and still accepts valid input afterwards', () => {
    const session = newSession();
    for (const bad of [
      {
        version: 'v0.9',
        updateDataModel: { surfaceId: 's', value: { f: () => undefined } },
      },
      { version: 1n, deleteSurface: { surfaceId: 's' } },
      {
        version: 'v0.9',
        get deleteSurface(): never {
          throw new Error('invalid caller property');
        },
      },
    ]) {
      expect(session.ingest(bad).ok).toBe(false);
    }
    expect(session.ingest([create, rootPanel]).ok).toBe(true);
  });

  it('creating the same surface twice is a rejection, not a silent no-op', () => {
    const session = newSession();
    session.ingest(create);
    expect(session.ingest(create).ok).toBe(false);
  });

  it('refuses input after disposal; disposal is idempotent', () => {
    const session = newSession();
    session.dispose();
    session.dispose();
    const result = session.ingest(create);
    expect(result.ok).toBe(false);
  });
});
