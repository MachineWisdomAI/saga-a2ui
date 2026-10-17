import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { connectAnswerView, type AnswerViewState } from './mcp/answer-view.js';

// Composition root of the answer view. No server code: the question and answer arrive only through
// the host's bridge, and every value is written with textContent so it stays inert text.
function element<T extends HTMLElement>(testId: string): T {
  const found = document.querySelector<T>(`[data-testid="${testId}"]`);
  if (!found) throw new Error(`answer.html has no ${testId} element`);
  return found;
}
const root = element<HTMLElement>('answer-root');
const status = element<HTMLElement>('answer-status');
const question = element<HTMLElement>('answer-question');
const answer = element<HTMLElement>('answer-text');

function show(state: AnswerViewState): void {
  // Never leave a previous question or answer beside a new state.
  question.hidden = true;
  answer.hidden = true;
  question.textContent = '';
  answer.textContent = '';
  root.dataset.state = state.kind;
  switch (state.kind) {
    case 'waiting':
      status.textContent = state.question === undefined ? 'Waiting for a question…' : 'Waiting for the answer…';
      if (state.question !== undefined) {
        question.textContent = state.question;
        question.hidden = false;
      }
      return;
    case 'answer':
      status.textContent = 'Answer';
      question.textContent = state.result.question;
      answer.textContent = state.result.answer;
      question.hidden = false;
      answer.hidden = false;
      return;
    case 'problem':
      status.textContent = state.message;
      return;
  }
}

await connectAnswerView({
  app: new App({ name: 'saga-a2ui-answer-view', version: '0.0.0' }),
  transport: new PostMessageTransport(window.parent, window.parent),
  show,
});
