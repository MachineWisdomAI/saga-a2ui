import { Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import {
  a2uiV0_9Decoder,
  createMessageSession,
  defineSurface,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { describe, expect, it } from 'vitest';
import { FaithfulCardApi } from './catalog.js';

// A FaithfulCard root authored as a layout, opened without a DOM or a renderer: the decoder and
// the upstream processor accept it against the card's real catalog contract.
const CATALOG_ID = 'https://example.test/catalogs/faithful-card/v1';
const cardLayout = () =>
  defineSurface({
    surfaceId: 'card',
    catalogId: CATALOG_ID,
    data: z.object({ contractVersion: z.literal(1), markdown: z.string() }),
    initial: { contractVersion: 1, markdown: 'Waiting.' },
    root: {
      component: 'FaithfulCard',
      bind: { contractVersion: 'contractVersion', markdown: 'markdown' },
    },
  });

function open() {
  const layout = cardLayout();
  const session = createMessageSession({
    catalogs: [new Catalog(CATALOG_ID, 'v0.9', [FaithfulCardApi])],
    decoder: a2uiV0_9Decoder,
  });
  const surfaces: SurfaceModel<typeof FaithfulCardApi>[] = [];
  session.onSurfaceCreated((surface) => surfaces.push(surface));
  return { layout, session, opened: session.ingest(layout.opening), surfaces };
}

describe('a FaithfulCard root authored as a surface layout', () => {
  it('opens with both card values bound to the data model', () => {
    const { opened, surfaces } = open();
    expect(opened).toEqual({ ok: true });
    const root = surfaces[0]?.componentsModel.get('root');
    expect(root?.type).toBe('FaithfulCard');
    expect(root?.properties).toEqual({
      contractVersion: { path: '/contractVersion' },
      markdown: { path: '/markdown' },
    });
    expect(surfaces[0]?.dataModel.get('/markdown')).toBe('Waiting.');
  });

  it('replaces the answer through update, and refuses a contract version the layout did not allow', () => {
    const { layout, session, surfaces } = open();
    const update = layout.update({ contractVersion: 1, markdown: '**Done**' });
    if (!update.ok) throw new Error(update.failure.message);
    expect(session.ingest(update.messages)).toEqual({ ok: true });
    expect(surfaces[0]?.dataModel.get('/markdown')).toBe('**Done**');

    const refused = layout.update({
      contractVersion: 2,
      markdown: 'x',
    } as never);
    expect(refused.ok).toBe(false);
    expect(surfaces[0]?.dataModel.get('/markdown')).toBe('**Done**');
  });
});
