import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { z } from 'zod';

export const SAGA_CATALOG_ID = 'https://saga-a2ui.local/catalogs/lit-host/v1';

/** Neutral contract of the panel: a title and plain-text description, both bindable. */
export const SagaPanelApi = {
  name: 'SagaPanel',
  schema: z
    .object({
      title: CommonSchemas.DynamicString,
      description: CommonSchemas.DynamicString.optional(),
    })
    .strict(),
};
