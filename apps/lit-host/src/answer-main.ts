import { startA2uiView } from '@saga-a2ui/lit-mcp-stack';
import { answerCardData, answerLayout } from './answer-card/presentation.js';
import { answerCatalog } from './lit/answer-card.js';
import { createAnswerView } from './mcp/answer-view.js';

// Composition root of the answer view. No server code: the question and answer arrive only through
// the host's bridge and reach the page as A2UI data bound to text, so they stay inert text. The
// stack connects to the host, holds what arrives early and ends the view; this page decides what
// each notification means (mcp/answer-view.ts) and how a state looks (answer-card/).
const container = document.querySelector('answer-app');
if (!container) throw new Error('answer.html has no answer-app element');

// Every state replaces the whole card, so a stale answer never stays beside a new state. The stack
// calls the handlers only once the view is ready, after `view` exists.
const answer = createAnswerView(
  (state) => void view.surface.update(answerCardData(state)),
);
const view = startA2uiView({
  container,
  layout: answerLayout,
  catalog: answerCatalog,
  identity: { name: 'saga-a2ui-answer-view', version: '0.0.0' },
  onToolInput: answer.onToolInput,
  onToolResult: answer.onToolResult,
});
await view.ready;
