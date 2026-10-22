import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import {
  a2uiV0_9Decoder,
  createMessageSession,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createA2uiAppElement } from '@saga-a2ui/lit';
import { answerCardData, answerLayout } from './answer-card/presentation.js';
import { answerCatalog, registerAnswerElements } from './lit/answer-card.js';
import { connectAnswerView } from './mcp/answer-view.js';

// Composition root of the answer view. No server code: the question and answer arrive only through
// the host's bridge and reach the page as A2UI data bound to text, so they stay inert text.
const AnswerApp = createA2uiAppElement({
  createSession: () =>
    createMessageSession({
      catalogs: [answerCatalog],
      decoder: a2uiV0_9Decoder,
    }),
  layout: answerLayout,
});
registerAnswerElements();
customElements.define('answer-app', AnswerApp);

const app =
  document.querySelector<InstanceType<typeof AnswerApp>>('answer-app');
if (!app) throw new Error('answer.html has no answer-app element');

await connectAnswerView({
  app: new App({ name: 'saga-a2ui-answer-view', version: '0.0.0' }),
  transport: new PostMessageTransport(window.parent, window.parent),
  // Every state replaces the whole card, so a stale answer never stays beside a new state.
  show: (state) => void app.updateData(answerCardData(state)),
});
