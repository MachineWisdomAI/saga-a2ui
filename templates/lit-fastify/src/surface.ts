import { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';

// The layout of the starter surface: its data and its components. The layout gives the markup its
// IDs and its structure and nothing else: it names no action, no handler and no function. Which
// behavior a control has is decided by application code that attaches an action to the rendered
// instance (view.ts), never by a name in this layout.

export const CATALOG_ID = 'https://starter.example/catalogs/starter/v1';

/** The ID the application attaches the clear action to. */
export const CLEAR_ID = 'clear';

export const starterSurface = defineSurface({
  surfaceId: 'starter',
  catalogId: CATALOG_ID,
  data: z.object({ headline: z.string() }),
  initial: { headline: '' },
  root: {
    component: 'Column',
    bind: {},
    props: { children: ['headline', CLEAR_ID] },
  },
  components: [
    {
      id: 'headline',
      component: 'Line',
      kind: 'title',
      text: { path: '/headline' },
    },
    { id: CLEAR_ID, component: 'ActionButton', child: 'clear-label' },
    {
      id: 'clear-label',
      component: 'Line',
      kind: 'body',
      text: 'Clear the note',
    },
  ],
});

/** The data the surface shows: replaced whole by each update. */
export type StarterData = typeof starterSurface.initial;
