import type { App, McpUiToolResultNotification } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import type { IngestResult } from '../protocols/a2ui/v0_9/session.js';
import { panelData, panelSurface, SURFACE_ID } from '../saga-panel/fixture.js';
import { PublicEpisodeSchema } from './episode.js';

export interface EpisodeViewDependencies {
  /** The MCP Apps view bridge. Its transport is chosen by the composition root. */
  readonly app: App;
  readonly transport: Transport;
  /** Hands A2UI input to the renderer's session (decoding and validation live there). */
  readonly deliver: (input: unknown) => IngestResult;
  /** Shows a plain-text problem, or clears it when called with `undefined`. */
  readonly showProblem: (message: string | undefined) => void;
}

/** A connected episode view. Ends the bridge connection and stops all delivery. */
export interface EpisodeViewConnection {
  /** Idempotent. Results that arrive afterwards are ignored. */
  dispose(): void;
}

type ToolResult = McpUiToolResultNotification['params'];

const removePanel: readonly A2uiMessage[] = [{ version: 'v0.9', deleteSurface: { surfaceId: SURFACE_ID } }];

/**
 * Connects the view bridge, then renders each delivered tool result through the A2UI session.
 *
 * Delivery only: the result is checked against the public episode contract and turned into
 * A2UI messages; A2UI decoding stays in the protocol module and presentation in the Lit view.
 * This module owns the bridge connection's lifetime; the session's lifetime stays with the
 * caller.
 *
 * Lifecycle, using only the upstream `App` API:
 * - The `toolresult` listener and the teardown handler are installed before `connect`, so a
 *   result the host sends right after initialization is handled, once.
 * - Each valid result replaces the one shown. The panel surface exists when this is called
 *   (the Lit app creates it); after a failure removed it, the next valid result recreates it
 *   before supplying data.
 * - An error or non-episode result removes the panel and shows a plain-text fallback, so
 *   stale content is never left beside a problem.
 * - `dispose()` removes the listener and closes the connection; it also runs when `connect`
 *   fails. A host teardown request releases the listener and the host then ends the connection. Connecting the same `App` again
 *   starts with exactly one listener.
 */
export async function connectEpisodeView(deps: EpisodeViewDependencies): Promise<EpisodeViewConnection> {
  const { app } = deps;
  let disposed = false;
  let panelShown = true;

  const showFailure = (problem: string) => {
    if (panelShown) {
      deps.deliver(removePanel);
      panelShown = false;
    }
    deps.showProblem(problem);
  };

  const onToolResult = (result: ToolResult) => {
    if (disposed) return;
    if (result.isError) return showFailure('The tool reported an error.');
    const episode = PublicEpisodeSchema.safeParse(result.structuredContent);
    if (!episode.success) return showFailure('The tool result was not a public episode.');

    const data = panelData(episode.data);
    const outcome = deps.deliver(panelShown ? data : [...panelSurface, ...data]);
    if (outcome.ok) panelShown = true;
    deps.showProblem(outcome.ok ? undefined : outcome.failure.message);
  };

  const release = () => {
    disposed = true;
    app.removeEventListener('toolresult', onToolResult);
    app.onteardown = undefined;
  };
  const connection: EpisodeViewConnection = {
    dispose() {
      if (disposed) return;
      release();
      void app.close().catch(() => undefined);
    },
  };

  app.addEventListener('toolresult', onToolResult);
  // The host closes the connection after its teardown request is answered, so only release here.
  app.onteardown = async () => {
    release();
    return {};
  };
  try {
    await app.connect(deps.transport);
  } catch (error) {
    connection.dispose();
    throw error;
  }
  return connection;
}
