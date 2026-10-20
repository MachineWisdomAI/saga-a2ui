// The layout and data messages of the starter surface. The layout gives the markup its IDs and its
// structure and nothing else: it names no action, no handler and no function. Which behavior a
// control has is decided by application code that attaches an action to the rendered instance
// (view.ts), never by a name in these messages.

export const CATALOG_ID = 'https://starter.example/catalogs/starter/v1';
export const SURFACE_ID = 'starter';

/** The ID the application attaches the clear action to. */
export const CLEAR_ID = 'clear';

export const starterSurface: unknown[] = [
  { version: 'v0.9', createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        { id: 'root', component: 'Column', children: ['headline', CLEAR_ID] },
        { id: 'headline', component: 'Line', kind: 'title', text: { path: '/headline' } },
        { id: CLEAR_ID, component: 'ActionButton', child: 'clear-label' },
        { id: 'clear-label', component: 'Line', kind: 'body', text: 'Clear the note' },
      ],
    },
  },
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, value: { headline: '' } } },
];

/** Replaces the headline the surface shows. */
export const headlineData = (headline: string): unknown[] => [
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, path: '/headline', value: headline } },
];
