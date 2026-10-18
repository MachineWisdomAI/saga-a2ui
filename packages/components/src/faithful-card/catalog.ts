import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';

/**
 * The A2UI catalog contract of FaithfulCard: the two bindable values of its content contract.
 * `contractVersion` is read by the card's reader, which refuses a version it does not support;
 * `markdown` is the text to show. The schema is strict, so a layout cannot add an action, a
 * handler name, a dialect or a bound: those are trusted application settings, never properties.
 *
 * The contract depends on the A2UI schema types and Zod, not on Lit, so another renderer can
 * share it.
 */
export const FaithfulCardApi = {
  name: 'FaithfulCard',
  schema: z
    .object({
      contractVersion: CommonSchemas.DynamicNumber,
      markdown: CommonSchemas.DynamicString,
    })
    .strict(),
};
