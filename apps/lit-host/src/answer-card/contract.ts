import { CommonSchemas } from '@a2ui/web_core/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';

export const ANSWER_CATALOG_ID = 'https://saga-a2ui.local/catalogs/answer/v1';

/**
 * Neutral contract of the answer card: what the view says, the question it answers and the answer,
 * all bindable. This catalog is the answer view's own; it shares nothing with the panel catalog.
 */
export const AnswerCardApi = {
  name: 'AnswerCard',
  schema: z
    .object({
      state: CommonSchemas.DynamicString,
      status: CommonSchemas.DynamicString,
      question: CommonSchemas.DynamicString,
      answer: CommonSchemas.DynamicString,
    })
    .strict(),
};
