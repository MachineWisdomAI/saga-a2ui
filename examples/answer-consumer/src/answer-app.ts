import {
  openFaithfulCardSurface,
  provideContentView,
  type CardSurface,
  type ContentView,
} from '@saga-a2ui/lit/faithful-card';
import { LitElement, css, html } from 'lit';
import type { AnswerFunction } from './answer-function.js';
import { applyBranding, type Branding } from './branding.js';

// The standalone page's composition: SAGA's card surface, its own chrome (brand, question form,
// status), and a typed answer function it calls itself. SAGA's card shows the Markdown it is
// given; it never calls the answer function, never sees the question and never decides what the
// status says. The page an MCP host mounts (mcp-main.ts) has no form and no answer function: the
// host delivers the answer, and the stack starts the card.

/** The standalone page's frame; the brand's CSS properties (see branding.ts) fill it in. */
const answerFrameStyles = css`
  :host {
    display: block;
    max-width: 42rem;
    margin: 0 auto;
    padding: 1rem;
    box-sizing: border-box;
    background: var(--app-surface);
    color: var(--saga-card-text-color);
    font-family: var(--saga-card-font-family);
    line-height: 1.5;
  }
  h1 {
    margin-block: 0 1rem;
    color: var(--saga-card-accent-color);
  }
  [role='status'] {
    min-height: 1.5em;
    margin-block: 0.5rem;
  }
`;

export interface AnswerAppDependencies {
  /** The application's backend call. Any implementation of the type can be composed in. */
  readonly answer: AnswerFunction;
  readonly branding: Branding;
  /** The trusted settings of the card: Markdown dialect, content bound, policy, host callback and consent. */
  readonly content: ContentView;
}

export function createAnswerAppElement(deps: AnswerAppDependencies) {
  class AnswerApp extends LitElement {
    static override styles = [
      answerFrameStyles,
      css`
        form {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          margin-block-end: 0.5rem;
        }
        input {
          flex: 1 1 12rem;
          min-width: 0;
          font: inherit;
          padding: 0.35rem;
        }
        button {
          font: inherit;
          padding: 0.35rem 0.75rem;
        }
      `,
    ];

    #endContentView?: () => void;
    /** Open while the element is in the document; presenting an answer is the one way to change the card. */
    #card?: CardSurface;
    #status = 'Ask a question.';
    /** Orders questions: an answer that arrives after a newer question was asked is not shown. */
    #asked = 0;

    override connectedCallback() {
      applyBranding(this, deps.branding);
      this.#endContentView = provideContentView(this, deps.content);
      this.#card = openFaithfulCardSurface();
      super.connectedCallback();
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
      this.#card?.dispose();
      this.#card = undefined;
      this.#endContentView?.();
      this.#endContentView = undefined;
      this.#asked += 1; // an answer still on its way belongs to a retired element
    }

    #setStatus(status: string) {
      this.#status = status;
      this.requestUpdate();
    }

    async #ask(question: string) {
      const asked = ++this.#asked;
      this.#setStatus('Thinking…');
      // The previous answer goes as soon as a new question is asked: it must not look like the new one's.
      this.#card?.clear();
      try {
        const answer = await deps.answer(question);
        if (asked !== this.#asked) return;
        const shown = this.#card?.present({ markdown: answer.markdown });
        if (shown?.ok !== true) throw new Error('the card refused the answer');
        this.#setStatus('Answer');
      } catch {
        if (asked !== this.#asked) return;
        this.#setStatus('The answer could not be loaded.');
      }
    }

    #submit = (event: SubmitEvent) => {
      event.preventDefault();
      const input = this.renderRoot.querySelector('input');
      const question = input?.value.trim() ?? '';
      if (question !== '') void this.#ask(question);
    };

    override render() {
      return html`<h1>${deps.branding.name}</h1>
        <form @submit=${this.#submit}>
          <input name="question" aria-label="Question" autocomplete="off" />
          <button type="submit">Ask</button>
        </form>
        <p role="status" data-testid="answer-status">${this.#status}</p>
        ${this.#card?.element}`;
    }
  }
  return AnswerApp;
}
