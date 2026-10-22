import { CommonSchemas } from '@a2ui/web_core/v0_9'; // saga-boundary: integration-import the application's own components are typed by upstream's schemas
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';

// The contract of the application's own `Line` component, shared by every renderer's catalog.
// `Line` shows supplied text as text, never as markup, in one of three roles. The schema is the
// one place that says what a layout may give it; each renderer supplies only the element.

export const LineApi = {
  name: 'Line',
  schema: z
    .object({
      text: CommonSchemas.DynamicString,
      kind: z.enum(['title', 'body', 'status']),
    })
    .strict(),
};
