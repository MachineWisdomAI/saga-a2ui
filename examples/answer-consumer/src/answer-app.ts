import {
  provideContentView,
  type ContentView,
} from '@saga-a2ui/lit/faithful-card';
import { css, html } from 'lit';
import type { AnswerFunction } from './answer-function.js';
import {
  answerData,
  answerFrameStyles,
  createAnswerSurfaceElement,
} from './answer-surface.js';
import { applyBranding, type Branding } from './branding.js';

// The standalone page's composition: the shared answer surface (answer-surface.ts), its own chrome
// (brand, question form, status), and a typed answer function it calls itself. SAGA's card shows
// the Markdown it is given; it never calls the answer function, never sees the question and never
// decides what the status says. The page an MCP host mounts (answer-view.ts) has no form and no
// answer function: the host delivers the answer.

export interface AnswerAppDependencies {
  /** The application's backend call. Any implementation of the type can be composed in. */
  readonly answer: AnswerFunction;
  readonly branding: Branding;
  /** The trusted settings of the card: Markdown dialect, content bound, policy, host callback and consent. */
  readonly content: ContentView;
}

export function createAnswerAppElement(deps: AnswerAppDependencies) {
  class AnswerApp extends createAnswerSurfaceElement() {
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
    #status = 'Ask a question.';
    /** Orders questions: an answer that arrives after a newer question was asked is not shown. */
    #asked = 0;

    override connectedCallback() {
      applyBranding(this, deps.branding);
      this.#endContentView = provideContentView(this, deps.content);
      super.connectedCallback();
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
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
      this.ingest(answerData(''));
      try {
        const answer = await deps.answer(question);
        if (asked !== this.#asked) return;
        this.ingest(answerData(answer.markdown));
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
        ${super.render()}`;
    }
  }
  return AnswerApp;
}
