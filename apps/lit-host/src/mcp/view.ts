import type { App, McpUiToolInputNotification, McpUiToolResultNotification } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { A2uiMessage } from '@a2ui/web_core/v0_9';
import type { IngestResult } from '../protocols/a2ui/v0_9/session.js';
import { panelData, panelSurface, SURFACE_ID } from '../saga-panel/fixture.js';
import { PublicEpisodeSchema } from './episode.js';

export type ToolResult = McpUiToolResultNotification['params'];
export type ToolInput = McpUiToolInputNotification['params'];

export interface ToolResultViewDependencies {
  /** The MCP Apps view bridge. Its transport is chosen by the composition root. */
  readonly app: App;
  readonly transport: Transport;
  /** Handles each delivered result. Never called after the connection is disposed. */
  readonly onToolResult: (result: ToolResult) => void;
  /**
   * Optional. Called when the host reports that a tool call is starting (`toolinput`), with that
   * notification's own params. The notification carries the business arguments of the call the
   * host is starting — the only place they appear — so a view that must keep them reads them here.
   * It is not that call's response, and it does not authenticate a later `toolresult`. A view that
   * must recover from a correlated response uses this as the moment to start that request.
   * Registering it before `connect` keeps it in the same lifetime as `onToolResult`.
   */
  readonly onToolInput?: (input: ToolInput) => void;
}

/** A connected view. Ends the bridge connection and stops all delivery. */
export interface ToolResultViewConnection {
  /** Idempotent. Results that arrive afterwards are ignored. */
  dispose(): void;
}

/**
 * Connects the view bridge and owns its lifetime; what to do with a result belongs to the caller.
 *
 * Lifecycle, using only the upstream `App` API:
 * - The `toolresult` listener and the teardown handler are installed before `connect`, so a
 *   result the host sends right after initialization is handled, once.
 * - `dispose()` removes the listener and closes the connection once, even after a host teardown
 *   request has already stopped delivery; it also runs when `connect` fails. Teardown only stops
 *   delivery, because the host ends the connection after its request is answered. Connecting
 *   the same `App` again starts with exactly one listener.
 */
export async function connectToolResultView(deps: ToolResultViewDependencies): Promise<ToolResultViewConnection> {
  const { app } = deps;
  let disposed = false; // delivery has stopped
  let closed = false; // the App's transport close has been requested

  const onToolResult = (result: ToolResult) => {
    if (!disposed) deps.onToolResult(result);
  };
  const onToolInput = (input: ToolInput) => {
    if (!disposed) deps.onToolInput?.(input);
  };
  const release = () => {
    disposed = true;
    app.removeEventListener('toolresult', onToolResult);
    if (deps.onToolInput) app.removeEventListener('toolinput', onToolInput);
    app.onteardown = undefined;
  };
  const connection: ToolResultViewConnection = {
    dispose() {
      if (closed) return; // completed disposal must not touch a later connection's handlers
      closed = true;
      release();
      void app.close().catch(() => undefined);
    },
  };

  if (deps.onToolInput) app.addEventListener('toolinput', onToolInput);
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

export interface EpisodeViewDependencies {
  readonly app: App;
  readonly transport: Transport;
  /** Hands A2UI input to the renderer's session (decoding and validation live there). */
  readonly deliver: (input: unknown) => IngestResult;
  /** Shows a plain-text problem, or clears it when called with `undefined`. */
  readonly showProblem: (message: string | undefined) => void;
}

/** A connected episode view. */
export type EpisodeViewConnection = ToolResultViewConnection;

const removePanel: readonly A2uiMessage[] = [{ version: 'v0.9', deleteSurface: { surfaceId: SURFACE_ID } }];

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
 */
export function connectEpisodeView(deps: EpisodeViewDependencies): Promise<EpisodeViewConnection> {
  let panelShown = true;

  const showFailure = (problem: string) => {
    if (panelShown) {
      deps.deliver(removePanel);
      panelShown = false;
    }
    deps.showProblem(problem);
  };

  return connectToolResultView({
    app: deps.app,
    transport: deps.transport,
    onToolResult(result) {
      if (result.isError) return showFailure('The tool reported an error.');
      const episode = PublicEpisodeSchema.safeParse(result.structuredContent);
      if (!episode.success) return showFailure('The tool result was not a public episode.');

      const data = panelData(episode.data);
      const outcome = deps.deliver(panelShown ? data : [...panelSurface, ...data]);
      if (!outcome.ok) return showFailure(outcome.failure.message);
      panelShown = true;
      deps.showProblem(undefined);
    },
  });
}
