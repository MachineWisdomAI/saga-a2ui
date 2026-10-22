import type { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/client';
import {
  connectToolResultView,
  type ToolResultViewConnection,
} from '@saga-a2ui/mcp/view';
import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import type { IngestResult } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { emptyPanel, SURFACE_ID } from '../saga-panel/fixture.js';
import { PublicEpisodeSchema } from './episode.js';

export interface EpisodeViewDependencies {
  readonly app: App;
  readonly transport: Transport;
  /** Hands A2UI input to the renderer's session (decoding and validation live there). */
  readonly deliver: (input: unknown) => IngestResult;
  /** Shows a plain-text problem, or clears it when called with `undefined`. */
  readonly showProblem: (message: string | undefined) => void;
  /**
   * Ends the reader's consent to load images in this view. Called before each delivered result is
   * applied (a new result is a new selection, even when its description is unchanged), so a view
   * never shows images the reader agreed to for what it showed before. The view stays live, so
   * the reader can consent again to the new selection.
   */
  readonly revokeImageConsent: () => void;
  /**
   * Ends image consent for good: called when the host asks the view to tear down and when the
   * connection is disposed. Nothing still on screen may grant consent afterwards.
   */
  readonly retireImageConsent: () => void;
}

/** A connected episode view. */
export type EpisodeViewConnection = ToolResultViewConnection;

const removePanel: readonly A2uiMessage[] = [
  { version: 'v0.9', deleteSurface: { surfaceId: SURFACE_ID } },
];

/**
 * Renders each delivered tool result through the A2UI session.
 *
 * Delivery only: the result is checked against the public episode contract and turned into
 * A2UI messages; A2UI decoding stays in the protocol module and presentation in the Lit view.
 * Bridge lifetime is `connectToolResultView`; the session's lifetime stays with the caller.
 *
 * - Each valid result replaces the one shown. The panel surface exists when this is called
 *   (the Lit app creates it); after a failure removed it, the next valid result recreates it
 *   before supplying data.
 * - An error or non-episode result removes the panel and shows a plain-text fallback, so
 *   stale content is never left beside a problem.
 * - A result the session rejects is treated like any other failure: panel removed, reason shown.
 * - Image consent is revoked before any result is applied, and retired for good on host teardown
 *   and on dispose.
 */
export async function connectEpisodeView(
  deps: EpisodeViewDependencies,
): Promise<EpisodeViewConnection> {
  let panelShown = true;

  const showFailure = (problem: string) => {
    if (panelShown) {
      deps.deliver(removePanel);
      panelShown = false;
    }
    deps.showProblem(problem);
  };

  const connection = await connectToolResultView({
    app: deps.app,
    transport: deps.transport,
    onTeardown: deps.retireImageConsent,
    onToolResult(result) {
      deps.revokeImageConsent();
      if (result.isError) return showFailure('The tool reported an error.');
      const episode = PublicEpisodeSchema.safeParse(result.structuredContent);
      if (!episode.success)
        return showFailure('The tool result was not a public episode.');

      const data = emptyPanel.update({
        title: episode.data.title,
        description: episode.data.description,
      });
      if (!data.ok) return showFailure(data.failure.message);
      const outcome = deps.deliver(
        panelShown ? data.messages : [...emptyPanel.opening, ...data.messages],
      );
      if (!outcome.ok) return showFailure(outcome.failure.message);
      panelShown = true;
      deps.showProblem(undefined);
    },
  });
  return {
    dispose() {
      connection.dispose();
      deps.retireImageConsent();
    },
  };
}
