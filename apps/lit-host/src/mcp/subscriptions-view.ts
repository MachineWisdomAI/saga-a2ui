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
 * Any error result clears the view and releases the pin. The tool's sign-in message shows the
 * sign-in-required state, and the next valid result starts a new pinned session.
 */
export function connectSubscriptionsView(deps: SubscriptionsViewDependencies): Promise<ToolResultViewConnection> {
  let pinnedSession: string | undefined;
  let invalidated = false;

  const invalidate = (message: string) => {
    invalidated = true;
    pinnedSession = undefined;
    deps.show({ kind: 'problem', message });
  };

  return connectToolResultView({
    app: deps.app,
    transport: deps.transport,
    onToolResult(result) {
      if (result.isError) {
        const signInRequired = result.content?.some((part) => part.type === 'text' && part.text === SIGN_IN_REQUIRED_TEXT);
        pinnedSession = undefined;
        invalidated = false;
        return deps.show(signInRequired ? { kind: 'sign-in-required' } : { kind: 'problem', message: 'The tool reported an error.' });
      }
      if (invalidated) return;
      const parsed = SubscriptionsResultSchema.safeParse(result.structuredContent);
      if (!parsed.success) return invalidate('The tool result was not a subscriptions result.');
      if (pinnedSession !== undefined && parsed.data.viewSession !== pinnedSession) {
        return invalidate('Your session changed. Reload to see your subscriptions.');
      }
      pinnedSession = parsed.data.viewSession;
      deps.show({ kind: 'subscriptions', subscriptions: parsed.data });
    },
  });
}
