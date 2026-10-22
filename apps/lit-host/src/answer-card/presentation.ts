import { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import type { AnswerViewState } from '../mcp/answer-view.js';
import { ANSWER_CATALOG_ID } from './contract.js';

export const ANSWER_SURFACE_ID = 'answer';

const AnswerCardDataSchema = z.object({
  state: z.enum(['waiting', 'answer', 'problem']),
  status: z.string(),
  question: z.string(),
  answer: z.string(),
});
export type AnswerCardData = z.infer<typeof AnswerCardDataSchema>;

/**
 * The whole card for one view state. Every field is replaced, so nothing of a previous question,
 * answer or problem can remain beside a new state. The values are inert text wherever they came from.
 */
export function answerCardData(state: AnswerViewState): AnswerCardData {
  return { state: state.kind, ...fields(state) };
}

function fields(state: AnswerViewState): {
  status: string;
  question: string;
  answer: string;
} {
  switch (state.kind) {
    case 'waiting':
      return {
        status:
          state.question === undefined
            ? 'Waiting for a question…'
            : 'Waiting for the answer…',
        question: state.question ?? '',
        answer: '',
      };
    case 'answer':
      return {
        status: 'Answer',
        question: state.result.question,
        answer: state.result.answer,
      };
    case 'problem':
      return { status: state.message, question: '', answer: '' };
  }
}

/** Creates the card; each field binds to the data model. It opens waiting for a question. */
export const answerLayout = defineSurface({
  surfaceId: ANSWER_SURFACE_ID,
  catalogId: ANSWER_CATALOG_ID,
  data: AnswerCardDataSchema,
  initial: answerCardData({ kind: 'waiting' }),
  root: {
    component: 'AnswerCard',
    bind: {
      state: 'state',
      status: 'status',
      question: 'question',
      answer: 'answer',
    },
  },
});
