import {
  Catalog,
  ColumnApi,
  CommonSchemas,
  type ComponentApi,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import { describe, expect, it } from 'vitest';
import { ActionButtonApi } from '../../../actions/action-button-schema.js';
import { z } from '../zod3.js';
import { a2uiV0_9Decoder } from './decoder.js';
import { createMessageSession } from './session.js';
import { defineSurface, type SurfaceLayout } from './surface-layout.js';

// Renderer-independent: no DOM, no Lit. The component contracts are the upstream Column and the
// SDK's ActionButton, plus a text line like the starter's, so child references behave as in an
// application.
const CATALOG_ID = 'https://example.test/catalogs/starter/v1';
const LineApi: ComponentApi = {
  name: 'Line',
  schema: z
    .object({
      text: CommonSchemas.DynamicString,
      kind: z.enum(['title', 'body']),
    })
    .strict(),
};
const catalog = new Catalog<ComponentApi>(CATALOG_ID, 'v0.9', [
  ColumnApi,
  LineApi,
  ActionButtonApi,
]);

const starter = () =>
  defineSurface({
    surfaceId: 'starter',
    catalogId: CATALOG_ID,
    data: z.object({ headline: z.string() }),
    initial: { headline: '' },
    root: {
      component: 'Column',
      bind: {},
      props: { children: ['headline', 'clear'] },
    },
    components: [
      {
        id: 'headline',
        component: 'Line',
        kind: 'title',
        text: { path: '/headline' },
      },
      { id: 'clear', component: 'ActionButton', child: 'clear-label' },
      {
        id: 'clear-label',
        component: 'Line',
        kind: 'body',
        text: 'Clear the note',
      },
    ],
  });

function open(layout: SurfaceLayout<unknown>) {
  const session = createMessageSession({
    catalogs: [catalog],
    decoder: a2uiV0_9Decoder,
  });
  const surfaces: SurfaceModel<ComponentApi>[] = [];
  session.onSurfaceCreated((surface) => surfaces.push(surface));
  const opened = session.ingest(layout.opening);
  return { session, opened, surface: surfaces[0] };
}

describe('defineSurface', () => {
  it('produces opening messages the decoder and the upstream processor accept', () => {
    const { opened, surface } = open(starter());
    expect(opened).toEqual({ ok: true });
    expect(surface?.id).toBe('starter');
    expect(surface?.componentsModel.get('root')?.type).toBe('Column');
    expect(surface?.componentsModel.get('clear')?.type).toBe('ActionButton');
    expect(surface?.dataModel.get('/headline')).toBe('');
  });

  it('replaces the whole data model with an update the session accepts', () => {
    const layout = starter();
    const { session, surface } = open(layout);
    const update = layout.update({ headline: 'Signed in' });
    if (!update.ok) throw new Error(update.failure.message);
    expect(session.ingest(update.messages)).toEqual({ ok: true });
    expect(surface?.dataModel.get('/headline')).toBe('Signed in');
  });
});

describe('update', () => {
  const noteLayout = () =>
    defineSurface({
      surfaceId: 'note',
      catalogId: CATALOG_ID,
      data: z.object({
        title: z.string(),
        subtitle: z.string().optional(),
        count: z.number(),
      }),
      initial: { title: 'First', subtitle: 'Sub', count: 1 },
      root: {
        component: 'Line',
        bind: { text: 'title' },
        props: { kind: 'title' },
      },
    });

  it('replaces the whole model, so a field left out is gone rather than stale', () => {
    const layout = noteLayout();
    const { session, surface } = open(layout);
    expect(surface?.dataModel.get('/subtitle')).toBe('Sub');
    const update = layout.update({ title: 'Second', count: 2 });
    if (!update.ok) throw new Error(update.failure.message);
    expect(session.ingest(update.messages)).toEqual({ ok: true });
    expect(surface?.dataModel.get('/title')).toBe('Second');
    expect(surface?.dataModel.get('/count')).toBe(2);
    expect(surface?.dataModel.get('/subtitle')).toBeUndefined();
  });

  it('refuses data that does not fit the schema, naming the field', () => {
    const update = noteLayout().update({
      title: 'x',
      count: 'many',
    } as never);
    expect(update.ok).toBe(false);
    if (!update.ok) {
      expect(update.failure.kind).toBe('invalid-data');
      expect(update.failure.message).toContain('count');
    }
  });

  it('refuses an unknown field instead of dropping it', () => {
    const update = noteLayout().update({
      title: 'x',
      count: 1,
      note: 'surprise',
    } as never);
    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.failure.message).toContain('note');
  });

  it('refuses a missing required field instead of filling it in', () => {
    const update = noteLayout().update({ title: 'x' } as never);
    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.failure.message).toContain('count');
  });

  const rowsLayout = () =>
    defineSurface({
      surfaceId: 'rows',
      catalogId: CATALOG_ID,
      data: z.object({
        rows: z.array(z.object({ id: z.string(), title: z.string() })),
        label: z.string().default('Untitled'),
      }),
      initial: { rows: [], label: 'Rows' },
      root: { component: 'Line', bind: { text: 'label' } },
    });

  it('refuses an unknown field inside nested data instead of stripping it', () => {
    const update = rowsLayout().update({
      rows: [{ id: 'a', title: 'A', secret: 'kept?' }],
      label: 'x',
    } as never);
    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.failure.message).toContain('rows.0.secret');
  });

  it('refuses data a schema default would fill in instead of applying the default', () => {
    const update = rowsLayout().update({ rows: [] } as never);
    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.failure.message).toContain('label');
  });

  it('refuses data a schema would coerce or rewrite', () => {
    const layout = defineSurface({
      surfaceId: 'coerce',
      catalogId: CATALOG_ID,
      data: z.object({ count: z.coerce.number(), name: z.string().trim() }),
      initial: { count: 1, name: 'x' },
      root: { component: 'Line', bind: { text: 'name' } },
    });
    const coerced = layout.update({ count: '5', name: 'x' } as never);
    expect(coerced.ok).toBe(false);
    if (!coerced.ok) expect(coerced.failure.message).toContain('count');
    const trimmed = layout.update({ count: 5, name: '  x ' });
    expect(trimmed.ok).toBe(false);
    if (!trimmed.ok) expect(trimmed.failure.message).toContain('name');
  });

  it('accepts valid nested data exactly as given', () => {
    const layout = rowsLayout();
    const { session, surface } = open(layout);
    const update = layout.update({
      rows: [{ id: 'a', title: 'A' }],
      label: 'Two',
    });
    if (!update.ok) throw new Error(update.failure.message);
    expect(session.ingest(update.messages)).toEqual({ ok: true });
    expect(surface?.dataModel.get('/rows')).toEqual([{ id: 'a', title: 'A' }]);
  });

  it('keeps every generated message acceptable to the decoder, whatever the data', () => {
    // A decoder rejection of anything the layout generates is an SDK defect, not caller error.
    const layout = noteLayout();
    const texts = [
      '',
      'plain',
      '<img src=x onerror=alert(1)>',
      'a/b~c "quoted" \\ back',
      '\u{1F600} emoji and \u0000 control',
      'x'.repeat(10_000),
    ];
    for (const title of texts) {
      const update = layout.update({ title, count: 0 });
      if (!update.ok) throw new Error(update.failure.message);
      const decoded = a2uiV0_9Decoder.decode(update.messages);
      expect(decoded.ok).toBe(true);
    }
    expect(a2uiV0_9Decoder.decode(layout.opening).ok).toBe(true);
  });

  it('carries the data as a value, never as markup or a path', () => {
    const layout = noteLayout();
    const { session, surface } = open(layout);
    const hostile = '/title';
    const update = layout.update({ title: hostile, count: 1 });
    if (!update.ok) throw new Error(update.failure.message);
    session.ingest(update.messages);
    expect(surface?.dataModel.get('/title')).toBe(hostile);
  });
});

describe('opening a surface', () => {
  it('gives each root property its path binding or its value', () => {
    const layout = defineSurface({
      surfaceId: 'bound',
      catalogId: CATALOG_ID,
      data: z.object({ 'odd/key~': z.string(), plain: z.string() }),
      initial: { 'odd/key~': 'a', plain: 'b' },
      root: {
        component: 'Line',
        bind: { text: 'odd/key~' },
        props: { kind: 'body' },
      },
    });
    const { opened, surface } = open(layout);
    expect(opened).toEqual({ ok: true });
    const root = surface?.componentsModel.get('root');
    expect(root?.properties).toMatchObject({
      kind: 'body',
      text: { path: '/odd~1key~0' },
    });
    expect(surface?.dataModel.get('/odd~1key~0')).toBe('a');
  });

  it('fails explicitly when the root component is not in the catalog', () => {
    const layout = defineSurface({
      surfaceId: 'ghost',
      catalogId: CATALOG_ID,
      data: z.object({}),
      initial: {},
      root: { component: 'NoSuchComponent', bind: {} },
    });
    const { opened } = open(layout);
    expect(opened.ok).toBe(false);
    if (!opened.ok) {
      expect(opened.failure.kind).toBe('rejected');
      expect(opened.failure.message).toContain('NoSuchComponent');
    }
  });

  it('can open any number of sessions and cannot be altered by a caller', () => {
    const layout = starter();
    expect(open(layout).opened).toEqual({ ok: true });
    expect(open(layout).opened).toEqual({ ok: true });
    expect(() => (layout.opening as unknown[]).push({})).toThrow();
    expect(() => {
      (layout.opening[0] as { version: string }).version = 'v0.8';
    }).toThrow();
    expect(open(layout).opened).toEqual({ ok: true });
  });
});

describe('a definition that cannot work', () => {
  const base = {
    surfaceId: 'broken',
    catalogId: CATALOG_ID,
    data: z.object({ headline: z.string() }),
    initial: { headline: '' },
    root: { component: 'Line', bind: { text: 'headline' as const } },
  };

  it('throws at definition time when initial fails the schema, naming the field', () => {
    expect(() =>
      defineSurface({ ...base, initial: { headline: 3 } as never }),
    ).toThrow(/headline/);
    expect(() =>
      defineSurface({ ...base, initial: { headline: '', extra: 1 } as never }),
    ).toThrow(/extra/);
    expect(() =>
      defineSurface({
        surfaceId: 'nested',
        catalogId: CATALOG_ID,
        data: z.object({ rows: z.array(z.object({ id: z.string() })) }),
        initial: { rows: [{ id: 'a', stray: 1 }] } as never,
        root: { component: 'Line', bind: {} },
      }),
    ).toThrow(/rows\.0\.stray/);
  });

  it('throws when a binding names a field the schema does not define', () => {
    expect(() =>
      defineSurface({
        ...base,
        root: { component: 'Line', bind: { text: 'nope' as never } },
      }),
    ).toThrow(/nope/);
  });

  it('throws when a root property is both bound and given a value', () => {
    expect(() =>
      defineSurface({
        ...base,
        root: { ...base.root, props: { text: 'literal' } },
      }),
    ).toThrow(/text/);
  });

  it('throws when the layout sets a property the protocol owns', () => {
    expect(() =>
      defineSurface({
        ...base,
        root: { component: 'Line', bind: {}, props: { id: 'mine' } },
      }),
    ).toThrow(/"id"/);
  });

  it('throws when component ids repeat or reuse the root id', () => {
    const line = { component: 'Line', kind: 'body', text: 'x' };
    expect(() =>
      defineSurface({ ...base, components: [{ id: 'root', ...line }] }),
    ).toThrow(/root/);
    expect(() =>
      defineSurface({
        ...base,
        components: [
          { id: 'a', ...line },
          { id: 'a', ...line },
        ],
      }),
    ).toThrow(/"a"/);
  });
});

// Type-level: the data type comes from the schema. A wrong shape does not compile.
describe('typed data', () => {
  it('infers the data type from the schema', () => {
    const layout = starter();
    const headline: string = layout.initial.headline;
    expect(headline).toBe('');
    // @ts-expect-error -- headline is a string
    layout.update({ headline: 1 });
    // @ts-expect-error -- unknown field
    layout.update({ headline: 'x', other: true });
  });
});
