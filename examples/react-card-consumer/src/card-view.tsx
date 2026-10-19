import { A2uiSurface } from '@a2ui/react/v0_9';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import type { HostLinks } from '@saga-a2ui/components/faithful-card';
import { connectToolResultView } from '@saga-a2ui/mcp/view';
import { FaithfulCardProvider, type FaithfulCardView } from '@saga-a2ui/react/faithful-card';
import '@saga-a2ui/react/faithful-card.css';
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { readAnswerMarkdown } from './answer-result.js';
import { openAnswerSurface, type AnswerSurface } from './answer-surface.js';
import './card-view.css';
import { createContentView } from './content-view.js';
import { CONTENT_POLICY_ELEMENT_ID, policyFromEmbedded } from './embedded-policy.js';

// The application: one React root that shows whatever answer the host last delivered, and nothing
// else. The page is built once. Its policy comes from the document it was served in, its brand from
// the composition root (main-*.tsx), and each answer only from a tool result, so a new answer never
// needs a new build or a new resource.

/** What the application knows about itself and its trusted artwork. The brand's CSS and font come with its stylesheet. */
export interface Brand {
  readonly name: string;
  /** The brand's trusted artwork, as the `data:` URL the build embedded. */
  readonly artwork: string;
}

type Status = 'waiting' | 'answer' | 'problem';

const STATUS_TEXT: Record<Status, string> = {
  waiting: 'Waiting for the answer…',
  answer: 'Answer',
  problem: 'The answer could not be shown.',
};

/** The status line the application shows beside the card; the card never decides what it says. */
function createStatusStore() {
  let current: Status = 'waiting';
  const listeners = new Set<() => void>();
  return {
    set(next: Status) {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    get: () => current,
  };
}
type StatusStore = ReturnType<typeof createStatusStore>;

function CardApp(props: { readonly brand: Brand; readonly view: FaithfulCardView; readonly answer: AnswerSurface; readonly status: StatusStore }) {
  const { brand, view, answer, status } = props;
  const current = useSyncExternalStore(status.subscribe, status.get);
  return (
    <FaithfulCardProvider view={view}>
      <main className="card-app">
        <header className="card-banner">
          <img className="card-artwork" src={brand.artwork} alt="" />
          <h1 className="card-title">{brand.name}</h1>
        </header>
        <p className="card-status" role="status" data-testid="answer-status">
          {STATUS_TEXT[current]}
        </p>
        <A2uiSurface surface={answer.surface} />
      </main>
    </FaithfulCardProvider>
  );
}

function PolicyProblem(props: { readonly brand: Brand }) {
  return (
    <main className="card-app">
      <h1 className="card-title">{props.brand.name}</h1>
      <p role="alert">This view could not start: its content policy is not valid.</p>
    </main>
  );
}

/**
 * Starts the application in `#root` and connects it to the MCP Apps host. The page going away ends the
 * connection, retires the view's image consent and unmounts the card, so a late delivery reaches nothing.
 */
export async function mountCardView(brand: Brand): Promise<void> {
  const container = document.getElementById('root');
  if (container === null) throw new Error('The page has no #root element.');
  const root = createRoot(container);
  const policy = policyFromEmbedded(document.getElementById(CONTENT_POLICY_ELEMENT_ID)?.textContent ?? null);
  if (!policy.ok) {
    root.render(<PolicyProblem brand={brand} />);
    return;
  }

  const app = new App({ name: 'react-card-consumer-view', version: '0.0.0' });
  const hostLinks: HostLinks = {
    async open(url) {
      if (app.getHostCapabilities()?.openLinks === undefined) return 'unavailable';
      try {
        return (await app.openLink({ url })).isError === true ? 'denied' : 'opened';
      } catch {
        return 'failed';
      }
    },
  };
  const view = createContentView({ policy: policy.policy, hostLinks, document });
  const answer = openAnswerSurface();
  const status = createStatusStore();
  root.render(
    <StrictMode>
      <CardApp brand={brand} view={view} answer={answer} status={status} />
    </StrictMode>,
  );

  /**
   * Replaces the answer shown. A result that is not the published output, or an error, clears it and says so.
   * Every result is a new selection, so it first revokes the view's image consent: an answer whose Markdown
   * equals the previous one would otherwise look unchanged to the card and keep the earlier grant.
   */
  const show = (result: { readonly isError?: boolean; readonly structuredContent?: unknown }): void => {
    view.consent.revokeAll();
    const markdown = result.isError === true ? undefined : readAnswerMarkdown(result.structuredContent);
    const shown = answer.show(markdown ?? '');
    status.set(markdown !== undefined && shown.ok ? 'answer' : 'problem');
  };

  const connection = await connectToolResultView({
    app,
    transport: new PostMessageTransport(window.parent, window.parent),
    onToolResult: show,
    // The host ends the connection after it answers the teardown request: nothing else tells this view it is going away.
    onTeardown: () => view.consent.retire(),
  });
  addEventListener('pagehide', () => {
    connection.dispose();
    view.consent.retire();
    root.unmount();
  });
}
