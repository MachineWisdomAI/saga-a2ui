import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';

/**
 * Contract of the opt-in action control. It has no `action` property at all: a layout names the
 * control by ID and type, and application code attaches the callable to the rendered instance.
 * The schema is strict, so a layout that also supplies an upstream `action`, or a handler name,
 * is rejected when it is ingested, before any property is resolved or any function evaluated.
 *
 * The contract depends on the A2UI schema types and Zod, not on Lit, so another renderer can
 * share it.
 */
export const ActionButtonApi = {
  name: 'ActionButton',
  schema: z
    .object({
      child: CommonSchemas.ComponentId,
      // The same field the upstream Button has; it yields `isValid`.
      checks: z.array(CommonSchemas.CheckRule).optional(),
    })
    .strict(),
};
