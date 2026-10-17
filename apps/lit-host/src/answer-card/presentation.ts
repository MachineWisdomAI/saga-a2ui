import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import type { AnswerViewState } from '../mcp/answer-view.js';
import { ANSWER_CATALOG_ID } from './contract.js';

export const ANSWER_SURFACE_ID = 'answer';

/** Creates the card; each field binds to the data model. */
export const answerSurface = [
  { version: 'v0.9', createSurface: { surfaceId: ANSWER_SURFACE_ID, catalogId: ANSWER_CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: ANSWER_SURFACE_ID,
      components: [
        {
          id: 'root',
          component: 'AnswerCard',
          state: { path: '/state' },
          status: { path: '/status' },
          question: { path: '/question' },
          answer: { path: '/answer' },
        },
      ],
    },
  },
] satisfies readonly A2uiMessage[];

/**
 * The whole card for one view state. Every field is replaced, so nothing of a previous question,
 * answer or problem can remain beside a new state. The values are inert text wherever they came from.
 */
export function answerCardData(state: AnswerViewState): readonly A2uiMessage[] {
  const value = { state: state.kind, ...fields(state) };
  return [{ version: 'v0.9', updateDataModel: { surfaceId: ANSWER_SURFACE_ID, value } }];
}

function fields(state: AnswerViewState): { status: string; question: string; answer: string } {
  switch (state.kind) {
    case 'waiting':
      return {
        status: state.question === undefined ? 'Waiting for a question…' : 'Waiting for the answer…',
        question: state.question ?? '',
        answer: '',
      };
    case 'answer':
      return { status: 'Answer', question: state.result.question, answer: state.result.answer };
    case 'problem':
      return { status: state.message, question: '', answer: '' };
  }
}
