import {
  defineSurface,
  type SurfaceLayout,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { FAITHFUL_CARD_CONTRACT_VERSION } from './reader.js';

// The surface a renderer opens to show one card: a FaithfulCard root over a flat data model of the
// two values the card's catalog contract binds. The layout is authored once here, so both
// renderers open the same surface and an update means the same thing in each.

/**
 * What an application presents in the card: the Markdown to show and, optionally, a heading the
 * application's own chrome displays. The card renders the Markdown only; the heading never
 * enters the card's data.
 */
export interface CardContent {
  readonly markdown: string;
  readonly heading?: string;
}

/** The card surface's data model. The contract version is the component's, never the application's. */
export interface CardData {
  readonly contractVersion: typeof FAITHFUL_CARD_CONTRACT_VERSION;
  readonly markdown: string;
}

/** The catalog every card surface is opened over: the FaithfulCard entry alone. */
export const FAITHFUL_CARD_CATALOG_ID =
  'https://saga-a2ui.local/catalogs/faithful-card/v1';

/** The data a surface must hold to show `content`. */
export function cardData(content: CardContent): CardData {
  return {
    contractVersion: FAITHFUL_CARD_CONTRACT_VERSION,
    markdown: content.markdown,
  };
}

/** A fresh layout for one card surface, opening with an empty answer. */
export function cardLayout(): SurfaceLayout<CardData> {
  return defineSurface({
    surfaceId: 'faithful-card',
    catalogId: FAITHFUL_CARD_CATALOG_ID,
    data: z.object({
      contractVersion: z.literal(FAITHFUL_CARD_CONTRACT_VERSION),
      markdown: z.string(),
    }),
    initial: cardData({ markdown: '' }),
    root: {
      component: 'FaithfulCard',
      bind: { contractVersion: 'contractVersion', markdown: 'markdown' },
    },
  });
}
