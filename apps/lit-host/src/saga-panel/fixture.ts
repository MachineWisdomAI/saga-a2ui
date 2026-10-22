import { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { SAGA_CATALOG_ID } from './contract.js';

export const SURFACE_ID = 'fixture';

const PanelDataSchema = z.object({
  title: z.string(),
  description: z.string(),
});
export type PanelData = z.infer<typeof PanelDataSchema>;

/** The panel surface opening with `initial`; its title and description bind to the data model. */
export const panelLayout = (initial: PanelData) =>
  defineSurface({
    surfaceId: SURFACE_ID,
    catalogId: SAGA_CATALOG_ID,
    data: PanelDataSchema,
    initial,
    root: {
      component: 'SagaPanel',
      bind: { title: 'title', description: 'description' },
    },
  });

// Public synthetic data only. The description is plain inert text.
export const initialFixture = panelLayout({
  title: 'Sample title',
  description: 'A synthetic description shown as plain text.',
});

/** The panel before any data has arrived. */
export const emptyPanel = panelLayout({ title: '', description: '' });
