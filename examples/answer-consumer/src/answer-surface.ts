import type { LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import {
  a2uiV0_9Decoder,
  createMessageSession,
  defineSurface,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import { createA2uiAppElement } from '@saga-a2ui/lit';
import { faithfulCardEntry } from '@saga-a2ui/lit/faithful-card';
import { css } from 'lit';

// The A2UI path the standalone page (main.ts, through answer-app.ts) uses to show an answer: its
// catalog (the one optional SAGA component), the surface that binds the card to a data model, and
// the data updates that replace the answer. The page an MCP host mounts (mcp-main.ts) is started by
// the Lit stack from a card application definition and holds none of this.

const CATALOG_ID = 'https://answers.example/catalogs/answer/v1';
const SURFACE_ID = 'answer';

const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [
  faithfulCardEntry,
]);

/** The answer surface: the card's two values bound to a data model that starts empty. */
const answerSurface = defineSurface({
  surfaceId: SURFACE_ID,
  catalogId: CATALOG_ID,
  data: z.object({ contractVersion: z.literal(1), markdown: z.string() }),
  initial: { contractVersion: 1, markdown: '' },
  root: {
    component: 'FaithfulCard',
    bind: { contractVersion: 'contractVersion', markdown: 'markdown' },
  },
});

/** The data that replaces the card's whole content with `markdown` (empty clears it). */
export const answerData = (markdown: string) =>
  ({ contractVersion: 1, markdown }) as const;

/** An element that presents the answer surface; the page subclasses it to add its own chrome. */
export function createAnswerSurfaceElement() {
  return createA2uiAppElement({
    createSession: () =>
      createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder }),
    layout: answerSurface,
  });
}

/** The standalone page's frame; the brand's CSS properties (see branding.ts) fill it in. */
export const answerFrameStyles = css`
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
