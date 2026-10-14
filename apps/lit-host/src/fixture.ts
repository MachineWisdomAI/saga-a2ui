import { SAGA_CATALOG_ID } from './catalog.js';

export const SURFACE_ID = 'fixture';

// Public synthetic data only. The description is plain inert text.
export const initialFixture = [
  { version: 'v0.9', createSurface: { surfaceId: SURFACE_ID, catalogId: SAGA_CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        {
          id: 'root',
          component: 'SagaPanel',
          title: { path: '/title' },
          description: { path: '/description' },
        },
      ],
    },
  },
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE_ID,
      value: { title: 'Sample title', description: 'A synthetic description shown as plain text.' },
    },
  },
] as const;

export const updatedFixture = [
  {
    version: 'v0.9',
    updateDataModel: { surfaceId: SURFACE_ID, path: '/title', value: 'Updated sample title' },
  },
] as const;
