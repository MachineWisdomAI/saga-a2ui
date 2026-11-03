import { Catalog, type SurfaceModel } from '@a2ui/web_core/v0_9';
import {
  a2uiV0_9Decoder,
  createMessageSession,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { describe, expect, it } from 'vitest';
import {
  cardData,
  cardLayout,
  FAITHFUL_CARD_CATALOG_ID,
  type CardContent,
} from './card-layout.js';
import { FaithfulCardApi } from './catalog.js';

// The one surface layout both renderers open to show a card: a FaithfulCard root over a flat data
// model. Opened here without a DOM or a renderer, against the card's real catalog contract.

function open() {
  const layout = cardLayout();
  const session = createMessageSession({
    catalogs: [
      new Catalog(FAITHFUL_CARD_CATALOG_ID, 'v0.9', [FaithfulCardApi]),
    ],
    decoder: a2uiV0_9Decoder,
  });
  const surfaces: SurfaceModel<typeof FaithfulCardApi>[] = [];
  session.onSurfaceCreated((surface) => surfaces.push(surface));
  return { layout, session, opened: session.ingest(layout.opening), surfaces };
}

describe('the card layout', () => {
  it('opens a FaithfulCard root with both values bound to an empty answer', () => {
    const { opened, surfaces } = open();
    expect(opened).toEqual({ ok: true });
    const root = surfaces[0]?.componentsModel.get('root');
    expect(root?.type).toBe('FaithfulCard');
    expect(surfaces[0]?.dataModel.get('/markdown')).toBe('');
    expect(surfaces[0]?.dataModel.get('/contractVersion')).toBe(1);
  });

  it('turns presented content into a validated data update that carries the contract version', () => {
    const { layout, session, surfaces } = open();
    const content: CardContent = { markdown: '**Done**' };
    const update = layout.update(cardData(content));
    if (!update.ok) throw new Error(update.failure.message);
    expect(session.ingest(update.messages)).toEqual({ ok: true });
    expect(surfaces[0]?.dataModel.get('/markdown')).toBe('**Done**');
    expect(surfaces[0]?.dataModel.get('/contractVersion')).toBe(1);
  });

  it('refuses content whose markdown is not text, before any message exists', () => {
    const { layout } = open();
    const refused = layout.update(cardData({ markdown: 42 } as never));
    expect(refused.ok).toBe(false);
  });
});
