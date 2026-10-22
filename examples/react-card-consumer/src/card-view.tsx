import {
  FaithfulCardApp,
  startFaithfulCardApp,
  type CardChromeProps,
} from '@saga-a2ui/react-mcp-stack/faithful-card';
import '@saga-a2ui/react-mcp-stack/faithful-card.css';
import { readAnswerMarkdown } from './answer-result.js';
import './card-view.css';

// The application: one card that shows whatever answer the host last delivered, and nothing else. The
// page is built once. Its policy comes from the document it was served in, its brand from the
// composition root (main-*.tsx), and each answer only from a tool result, so a new answer never
// needs a new build or a new resource. The stack connects to the host, holds early results, reads
// the document's policy and ends the view with the page; this file states only what is its own.

/** What the application knows about itself and its trusted artwork. The brand's CSS and font come with its stylesheet. */
export interface Brand {
  readonly name: string;
  /** The brand's trusted artwork, as the `data:` URL the build embedded. */
  readonly artwork: string;
}

const TEXTS = {
  waiting: 'Waiting for the answer…',
  problem: 'The answer could not be shown.',
  connectFailure: 'This view could not connect to its host.',
  readyFailure: 'This view could not get ready.',
  policyFailure: 'This view could not start: its content policy is not valid.',
};

/** The Markdown dialect and a finite bound for this application's long answers. */
const READER = {
  dialect: 'commonmark-tables-strikethrough',
  maxLength: 50_000,
} as const;

/** The application's own frame around the card: the brand, the status line, then the card. */
function chromeFor(brand: Brand) {
  return function CardApp({ card, state }: CardChromeProps) {
    return (
      <main className="card-app">
        <header className="card-banner">
          <img className="card-artwork" src={brand.artwork} alt="" />
          <h1 className="card-title">{brand.name}</h1>
        </header>
        <p className="card-status" role="status" data-testid="answer-status">
          {state.kind === 'answer' ? 'Answer' : state.text}
        </p>
        {card}
      </main>
    );
  };
}

/**
 * Starts the application in `#root` and connects it to the MCP Apps host. The page going away ends
 * the connection, retires the view's image consent and unmounts the card, so a late delivery reaches
 * nothing. Every result is a new presentation, even when the Markdown equals the previous one.
 */
export async function mountCardView(brand: Brand): Promise<void> {
  const container = document.getElementById('root');
  if (container === null) throw new Error('The page has no #root element.');
  const definition = FaithfulCardApp.define({
    name: 'react-card-consumer-view',
    version: '0.0.0',
  })
    .reader(READER)
    .policy('document')
    // Only the published output (`{ contractVersion: 1, markdown }`) is read. Fields beyond those two
    // are never bound: a result cannot select assets, CSS, a template or a policy.
    .result((structuredContent) => {
      const markdown = readAnswerMarkdown(structuredContent);
      return markdown === undefined ? undefined : { markdown };
    })
    .texts(TEXTS)
    .build();
  const view = startFaithfulCardApp(definition, {
    container,
    sizing: 'host',
    chrome: chromeFor(brand),
  });
  await view.ready;
}
