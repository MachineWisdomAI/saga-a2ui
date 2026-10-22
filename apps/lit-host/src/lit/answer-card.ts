import { A2uiLitElement, type LitComponentApi } from '@a2ui/lit/v0_9'; // saga-boundary: integration-import the answer card is the application's own component, authored against upstream's component API
import { Catalog } from '@a2ui/web_core/v0_9'; // saga-boundary: integration-import the application builds its own catalog from upstream's catalog value
import { defineElements } from '@saga-a2ui/lit';
import { html, nothing } from 'lit';
import { ANSWER_CATALOG_ID, AnswerCardApi } from '../answer-card/contract.js';

// Lit implementation of the answer card. Every value is a Lit text binding, so a question or an
// answer containing markup stays visible text. An empty question or answer is hidden, not removed.
export class AnswerCardElement extends A2uiLitElement<typeof AnswerCardApi> {
  protected readonly api = AnswerCardApi;

  render() {
    const props = this.controller?.props;
    if (!props) return nothing;
    const question = String(props.question ?? '');
    const answer = String(props.answer ?? '');
    return html`<main
      data-testid="answer-root"
      data-state=${String(props.state ?? '')}
    >
      <h1>Answer</h1>
      <p data-testid="answer-status" role="status">
        ${String(props.status ?? '')}
      </p>
      <p data-testid="answer-question" ?hidden=${question === ''}>
        ${question}
      </p>
      <p data-testid="answer-text" ?hidden=${answer === ''}>${answer}</p>
    </main>`;
  }
}

const AnswerCard: LitComponentApi = {
  ...AnswerCardApi,
  tagName: 'answer-card',
  element: AnswerCardElement,
};

/** The answer view's own catalog: one component, no functions. The stack defines its element. */
export const answerCatalog = new Catalog<LitComponentApi>(
  ANSWER_CATALOG_ID,
  'v0.9',
  [AnswerCard],
);

/** Explicit setup for a page that does not start the view through the stack: defines the catalog's element. */
export function registerAnswerElements(): void {
  defineElements([AnswerCard]);
}
