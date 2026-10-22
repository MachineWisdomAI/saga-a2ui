import {
  provideContentView,
  type ContentView,
} from '@saga-a2ui/lit/faithful-card';
import { html } from 'lit';
import {
  answerData,
  answerFrameStyles,
  createAnswerSurfaceElement,
} from './answer-surface.js';
import { applyBranding, type Branding } from './branding.js';

// The page an MCP host mounts. It composes the same answer surface and card as the standalone page
// (answer-surface.ts) but has no form and no answer function: the host delivers the tool result the
// server produced, and this element shows exactly that. The connection to the host is made by the
// composition root (mcp-main.ts) with the SDK's shared view connection.

export interface AnswerViewDependencies {
  readonly branding: Branding;
  /** The trusted settings of the card: Markdown dialect, content bound, policy, host callback and consent. */
  readonly content: ContentView;
}

const WAITING_TEXT = 'Waiting for the answer…';
const PROBLEM_TEXT = 'The answer could not be shown.';

/** The Markdown of the server's published output (`{ contractVersion: 1, markdown }`), or nothing if it is anything else. */
export function readAnswerMarkdown(
  structuredContent: unknown,
): string | undefined {
  if (typeof structuredContent !== 'object' || structuredContent === null)
    return undefined;
  const { contractVersion, markdown } = structuredContent as {
    contractVersion?: unknown;
    markdown?: unknown;
  };
  return contractVersion === 1 && typeof markdown === 'string'
    ? markdown
    : undefined;
}

export function createAnswerViewElement(deps: AnswerViewDependencies) {
  class AnswerView extends createAnswerSurfaceElement() {
    static override styles = [answerFrameStyles];

    #endContentView?: () => void;
    #status = WAITING_TEXT;

    override connectedCallback() {
      applyBranding(this, deps.branding);
      this.#endContentView = provideContentView(this, deps.content);
      super.connectedCallback();
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
      this.#endContentView?.();
      this.#endContentView = undefined;
    }

    /**
     * Shows one delivered tool result, replacing whatever was shown before. An error or a result
     * outside the published output clears the answer and says so; the next valid result recovers.
     */
    show(result: {
      readonly isError?: boolean;
      readonly structuredContent?: unknown;
    }): void {
      const markdown =
        result.isError === true
          ? undefined
          : readAnswerMarkdown(result.structuredContent);
      this.updateData(answerData(markdown ?? ''));
      this.#status = markdown === undefined ? PROBLEM_TEXT : 'Answer';
      this.requestUpdate();
    }

    override render() {
      return html`<h1>${deps.branding.name}</h1>
        <p role="status" data-testid="answer-status">${this.#status}</p>
        ${super.render()}`;
    }
  }
  return AnswerView;
}
