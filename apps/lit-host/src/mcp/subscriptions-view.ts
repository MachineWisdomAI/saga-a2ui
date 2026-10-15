import type { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SIGN_IN_REQUIRED_TEXT, SUBSCRIPTIONS_TOOL_NAME, SubscriptionsResultSchema, type SubscriptionsResult } from './subscriptions.js';
import { connectToolResultView, type ToolResult, type ToolResultViewConnection } from './view.js';

/** What the view presents. Only `subscriptions` carries private data. */
export type SubscriptionsViewState =
  | { readonly kind: 'subscriptions'; readonly subscriptions: SubscriptionsResult }
  | { readonly kind: 'sign-in-required' }
  | { readonly kind: 'problem'; readonly message: string };

export interface SubscriptionsViewDependencies {
  readonly app: App;
  readonly transport: Transport;
  /** Presents a state. Each call replaces everything shown before it. */
  readonly show: (state: SubscriptionsViewState) => void;
}

/**
 * Presents each subscriptions result, tied to one sign-in.
 *
 * The host's opening `toolresult` can pin the label: that notification is the result of the call
 * that created the view. After that, a `toolinput` notification is not authentication. It carries
 * no request id, so the next `toolresult` may be a delayed copy of an earlier result. When the
 * host can proxy a server tool call, a new input starts `callServerTool` — a request whose
 * response is correlated with that call — and only that response may establish or recover the
 * pin. Each read keeps an identity that is not recycled when the view returns to idle, so an
 * older in-flight response cannot match a later read or reopen private rendering after a later
 * refusal. An unsolicited notification cannot open private rendering. It can still end it: an
 * error, a changed label, or an unknown shape clears the view immediately, including while a
 * read is in flight, and retires every read that started before that loss. Only a correlated
 * read started after the loss may recover.
 *
 * The label says only whether the data on screen is still from the sign-in it started with. It
 * never grants access; the server authorizes every call from the verified request.
 */
export function connectSubscriptionsView(deps: SubscriptionsViewDependencies): Promise<ToolResultViewConnection> {
  let pinnedSession: string | undefined;
  let invalidated = false; // private rendering blocked until a correlated authenticated response
  let disposed = false;
  let nextRead = 0; // monotonic; a finished read never hands this identity to a later one
  let activeRead = 0; // identity of the in-flight correlated read, or 0 when idle

  const clear = (state: SubscriptionsViewState) => {
    pinnedSession = undefined;
    if (!disposed) deps.show(state);
  };

  // One classification for both the notification gate and presentation. An error, an unreadable
  // shape, or a different label ends the pinned sign-in. A well-shaped result does not, even
  // when it repeats the pinned label.
  type IncomingResult =
    | { readonly kind: 'error'; readonly signInRequired: boolean }
    | { readonly kind: 'unreadable' }
    | { readonly kind: 'changed-session' }
    | { readonly kind: 'current'; readonly data: SubscriptionsResult };

  const readIncoming = (result: ToolResult): IncomingResult => {
    if (result.isError) {
      return {
        kind: 'error',
        signInRequired: result.content?.some((part) => part.type === 'text' && part.text === SIGN_IN_REQUIRED_TEXT) ?? false,
      };
    }
    const parsed = SubscriptionsResultSchema.safeParse(result.structuredContent);
    if (!parsed.success) return { kind: 'unreadable' };
    if (pinnedSession !== undefined && parsed.data.viewSession !== pinnedSession) return { kind: 'changed-session' };
    return { kind: 'current', data: parsed.data };
  };

  const apply = (result: ToolResult) => {
    if (disposed) return;
    const incoming = readIncoming(result);
    switch (incoming.kind) {
      case 'error':
        invalidated = true;
        return clear(incoming.signInRequired ? { kind: 'sign-in-required' } : { kind: 'problem', message: 'The tool reported an error.' });
      case 'unreadable':
        invalidated = true;
        return clear({ kind: 'problem', message: 'The tool result was not a subscriptions result.' });
      case 'changed-session':
        invalidated = true;
        return clear({ kind: 'problem', message: 'Your session changed. Reload to see your subscriptions.' });
      case 'current':
        pinnedSession = incoming.data.viewSession;
        invalidated = false;
        deps.show({ kind: 'subscriptions', subscriptions: incoming.data });
        return;
    }
  };

  // A host that advertises `serverTools` can proxy this read. The returned promise is the
  // authenticated response; a refusal (the listener's HTTP 401/403, before any tool handler)
  // rejects it, and the private view stays cleared.
  const readThroughHost = () => {
    if (!deps.app.getHostCapabilities()?.serverTools) return;
    const generation = ++nextRead;
    activeRead = generation;
    void (async () => {
      try {
        const result = await deps.app.callServerTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} });
        if (generation !== activeRead || disposed) return;
        activeRead = 0;
        apply(result);
      } catch {
        if (generation !== activeRead || disposed) return;
        activeRead = 0;
        invalidated = true;
        clear({ kind: 'sign-in-required' });
      }
    })();
  };

  return connectToolResultView({
    app: deps.app,
    transport: deps.transport,
    onToolInput() {
      readThroughHost();
    },
    onToolResult(result) {
      // Session loss is not freshness. Classify it before suppressing uncorrelated positive
      // data, clear immediately, and retire reads that started before the loss so a later
      // resolution cannot restore private rendering. A well-shaped result still cannot open
      // private rendering while the view is invalid or a correlated read is in flight.
      if (readIncoming(result).kind !== 'current') {
        activeRead = 0;
        apply(result);
        return;
      }
      if (invalidated || activeRead !== 0) return;
      apply(result);
    },
  }).then((connection) => ({
    dispose() {
      disposed = true;
      activeRead = 0;
      connection.dispose();
    },
  }));
}
