import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import { SAGA_CATALOG_ID } from './contract.js';

export const SURFACE_ID = 'fixture';

/** Creates the panel surface; its title and description bind to the data model. */
export const panelSurface = [
  {
    version: 'v0.9',
    createSurface: { surfaceId: SURFACE_ID, catalogId: SAGA_CATALOG_ID },
  },
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
] satisfies readonly A2uiMessage[];

/** Supplies the panel's text. The values are inert text wherever they came from. */
export function panelData(panel: {
  readonly title: string;
  readonly description: string;
}): readonly A2uiMessage[] {
  return [
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: SURFACE_ID,
        value: { title: panel.title, description: panel.description },
      },
    },
  ];
}

// Public synthetic data only. The description is plain inert text.
export const initialFixture: readonly A2uiMessage[] = [
  ...panelSurface,
  ...panelData({
    title: 'Sample title',
    description: 'A synthetic description shown as plain text.',
  }),
];

export const updatedFixture = [
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE_ID,
      path: '/title',
      value: 'Updated sample title',
    },
  },
] satisfies readonly A2uiMessage[];
