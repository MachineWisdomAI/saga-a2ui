import type { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { SIGN_IN_REQUIRED_TEXT, SubscriptionsResultSchema, type SubscriptionsResult } from './subscriptions.js';
import { connectToolResultView, type ToolResultViewConnection } from './view.js';

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
 * Presents each delivered subscriptions result, tied to one sign-in.
 *
 * The first valid result pins its opaque view-session label. A later result with a different
 * label, or one that does not match the contract, clears the private view and keeps it cleared:
 * the label says only whether the data on screen is still from the sign-in it started with. It
 * never grants access; the server authorizes every call from the verified request.
 *
 * Any error result clears the view and releases the pin, and the view stays invalid until an
 * authenticated round trip — a fresh tool call — supplies the evidence that the session is
 * usable again. While invalid, a result that no new call started is ignored: after auth or
 * session loss, a delayed copy of an earlier result must not revive the private view. The next
 * call's valid result reestablishes the pin, so a refused or failed read recovers safely.
 */
export function connectSubscriptionsView(deps: SubscriptionsViewDependencies): Promise<ToolResultViewConnection> {
  let pinnedSession: string | undefined;
  let invalidated = false; // private rendering blocked until a new round trip succeeds
  let roundTripOpen = false; // a tool call started and its result has not arrived yet
  let delivered = false; // a result has already been delivered to this view

  const clear = (state: SubscriptionsViewState) => {
    pinnedSession = undefined;
    deps.show(state);
  };

  return connectToolResultView({
    app: deps.app,
    transport: deps.transport,
    onToolInput() {
      roundTripOpen = true;
    },
    onToolResult(result) {
      // A result the host delivers without a preceding call — the first one — still counts as
      // evidence; every result after that is trusted only when a fresh call started it.
      const fresh = roundTripOpen || !delivered;
      roundTripOpen = false;
      delivered = true;

      if (result.isError) {
        invalidated = true;
        const signInRequired = result.content?.some((part) => part.type === 'text' && part.text === SIGN_IN_REQUIRED_TEXT);
        return clear(signInRequired ? { kind: 'sign-in-required' } : { kind: 'problem', message: 'The tool reported an error.' });
      }
      // While invalid, only a result a new round trip started may reestablish the pin.
      if (invalidated && !fresh) return;
      const parsed = SubscriptionsResultSchema.safeParse(result.structuredContent);
      if (!parsed.success) {
        invalidated = true;
        return clear({ kind: 'problem', message: 'The tool result was not a subscriptions result.' });
      }
      if (pinnedSession !== undefined && parsed.data.viewSession !== pinnedSession) {
        invalidated = true;
        return clear({ kind: 'problem', message: 'Your session changed. Reload to see your subscriptions.' });
      }
      pinnedSession = parsed.data.viewSession;
      invalidated = false;
      deps.show({ kind: 'subscriptions', subscriptions: parsed.data });
    },
  });
}
