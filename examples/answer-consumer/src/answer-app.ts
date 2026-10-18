import type { LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import { a2uiV0_9Decoder, createMessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createA2uiAppElement } from '@saga-a2ui/lit';
import { faithfulCardEntry, provideContentView, type ContentView } from '@saga-a2ui/lit/faithful-card';
import { css, html } from 'lit';
import type { AnswerFunction } from './answer-function.js';
import type { Branding } from './branding.js';

// The application's composition: its own catalog (the one optional SAGA component), its own
// chrome (brand, question form, status), and a typed answer function it calls itself. SAGA's card
// shows the Markdown it is given; it never calls the answer function, never sees the question and
// never decides what the status says.

const CATALOG_ID = 'https://answers.example/catalogs/answer/v1';
const SURFACE_ID = 'answer';

const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [faithfulCardEntry]);

const surface = [
  { version: 'v0.9', createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID } },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: SURFACE_ID,
      components: [
        { id: 'root', component: 'FaithfulCard', contractVersion: { path: '/contractVersion' }, markdown: { path: '/markdown' } },
      ],
    },
  },
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, value: { contractVersion: 1, markdown: '' } } },
];

const answerData = (markdown: string) => [
  { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, value: { contractVersion: 1, markdown } } },
];

export interface AnswerAppDependencies {
  /** The application's backend call. Any implementation of the type can be composed in. */
  readonly answer: AnswerFunction;
  readonly branding: Branding;
  /** The trusted settings of the card: Markdown dialect, content bound, policy, host callback and consent. */
  readonly content: ContentView;
}

export function createAnswerAppElement(deps: AnswerAppDependencies) {
  class AnswerApp extends createA2uiAppElement({
    createSession: () => createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder }),
    initialInput: surface,
    surfaceId: SURFACE_ID,
  }) {
    static override styles = css`
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
      h1 { margin-block: 0 1rem; color: var(--saga-card-accent-color); }
      form { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-block-end: 0.5rem; }
      input { flex: 1 1 12rem; min-width: 0; font: inherit; padding: 0.35rem; }
      button { font: inherit; padding: 0.35rem 0.75rem; }
      [role='status'] { min-height: 1.5em; margin-block: 0.5rem; }
    `;

    #endContentView?: () => void;
    #status = 'Ask a question.';
    /** Orders questions: an answer that arrives after a newer question was asked is not shown. */
    #asked = 0;

    override connectedCallback() {
      const { branding } = deps;
      this.style.setProperty('--app-surface', branding.surface);
      this.style.setProperty('--saga-card-font-family', branding.fontFamily);
      this.style.setProperty('--saga-card-accent-color', branding.accent);
      this.style.setProperty('--saga-card-text-color', branding.text);
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
