import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { a2uiV0_9Decoder, createMessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createA2uiAppElement } from '@saga-a2ui/lit';
import { answerCardData, answerSurface, ANSWER_SURFACE_ID } from './answer-card/presentation.js';
import { answerCatalog, registerAnswerElements } from './lit/answer-card.js';
import { connectAnswerView } from './mcp/answer-view.js';

// Composition root of the answer view. No server code: the question and answer arrive only through
// the host's bridge and reach the page as A2UI data bound to text, so they stay inert text.
const AnswerApp = createA2uiAppElement({
  createSession: () => createMessageSession({ catalogs: [answerCatalog], decoder: a2uiV0_9Decoder }),
  initialInput: [...answerSurface, ...answerCardData({ kind: 'waiting' })],
  surfaceId: ANSWER_SURFACE_ID,
});
registerAnswerElements();
customElements.define('answer-app', AnswerApp);

const app = document.querySelector<InstanceType<typeof AnswerApp>>('answer-app');
if (!app) throw new Error('answer.html has no answer-app element');

await connectAnswerView({
  app: new App({ name: 'saga-a2ui-answer-view', version: '0.0.0' }),
  transport: new PostMessageTransport(window.parent, window.parent),
  // A rejected state shows the Lit fallback in place of the card, so a stale answer never stays.
  show: (state) => void app.ingest(answerCardData(state)),
});
