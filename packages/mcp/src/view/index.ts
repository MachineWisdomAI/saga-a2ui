import type { App, McpUiToolInputNotification, McpUiToolResultNotification } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/client';

// Browser-side connection lifetime. Everything imported above is a type, so this module adds no
// server code and no renderer to a view bundle.

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
  /**
   * Optional. Called once when the host asks the view to tear down, before the request is answered
   * and before delivery stops. A view that holds something outside the page's own rendering (a
   * running player, a pending request) releases it here, because the host ends the connection
   * right after it answers and nothing else tells the view it is going away.
   */
  readonly onTeardown?: () => void;
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
    if (!disposed) deps.onTeardown?.();
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
