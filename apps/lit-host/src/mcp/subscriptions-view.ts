import type { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/client';
import {
  EMPTY_SUBSCRIPTIONS_TEXT,
  INVALID_OUTPUT_TEXT,
  INVALID_SUBSCRIPTION_INPUT_TEXT,
  SIGN_IN_REQUIRED_TEXT,
  SUBSCRIPTION_LIMITS,
  SUBSCRIPTIONS_TOOL_NAME,
  SUBSCRIPTIONS_UNAVAILABLE_TEXT,
  SubscriptionsResultSchema,
  declaredSubscriptionRead,
  type DeclaredSubscriptionRead,
  type SubscriptionsResult,
} from './subscriptions.js';
import { connectToolResultView, type ToolResult, type ToolResultViewConnection } from './view.js';

/** What the view presents. Only `subscriptions` carries private subscription rows. */
export type SubscriptionsViewState =
  | { readonly kind: 'subscriptions'; readonly subscriptions: SubscriptionsResult; readonly selectedId?: string }
  | { readonly kind: 'empty'; readonly displayName: string; readonly message: string }
  | { readonly kind: 'sign-in-required' }
  | { readonly kind: 'retry'; readonly message: string }
  | { readonly kind: 'problem'; readonly message: string };

export interface SubscriptionsViewDependencies {
  readonly app: App;
  readonly transport: Transport;
  /** Presents a state. Each call replaces everything shown before it. */
  readonly show: (state: SubscriptionsViewState) => void;
  /** How long one safe read may run before it is retired. Tests use a short bound. */
  readonly readBoundMs?: number;
}

export interface SubscriptionsViewConnection extends ToolResultViewConnection {
  /** Re-reads with no arguments. Does not replay a failed input. */
  retry(): void;
  /** Keeps a row only when that id is in the result currently shown. */
  select(subscriptionId: string): void;
}

const KNOWN_FAILURE_TEXT = [
  SIGN_IN_REQUIRED_TEXT,
  SUBSCRIPTIONS_UNAVAILABLE_TEXT,
  INVALID_OUTPUT_TEXT,
  INVALID_SUBSCRIPTION_INPUT_TEXT,
] as const;

type KnownFailureText = (typeof KNOWN_FAILURE_TEXT)[number];

function knownFailureText(result: ToolResult): KnownFailureText | undefined {
  const parts = result.content ?? [];
  if (parts.length > 8) return undefined;
  for (const part of parts) {
    if (part.type !== 'text' || part.text.length > 200) continue;
    const match = KNOWN_FAILURE_TEXT.find((text) => text === part.text);
    if (match) return match;
  }
  return undefined;
}

function incomingBytes(value: unknown): number {
  try {
    const encoded = JSON.stringify(value);
    return encoded === undefined ? Number.POSITIVE_INFINITY : encoded.length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Presents each subscriptions result, tied to one sign-in.
 *
 * The host's opening `toolresult` can pin the label: that notification is the result of the call
 * that created the view. After that, a `toolinput` notification is not authentication. It carries
 * no request id, so the next `toolresult` may be a delayed copy of an earlier result. When the
 * host can proxy a server tool call, a new input starts `App.callServerTool`, carrying the
 * declared status filter from that input's business arguments — a request whose response is
 * correlated with that call — and only that response may establish or recover the pin. An
 * undeclared field (for example `accountId`), or a status the tool does not support, is not
 * forwarded: the server refuses that same business input, and the view clears instead of reading
 * without the filter. Each read keeps an identity that is not recycled when the view returns to
 * idle, so an older in-flight response cannot match a later read or reopen private rendering after
 * a later refusal. An unsolicited notification cannot open private rendering. It can still end it:
 * an error, a changed label, or an unknown shape clears the view immediately, including while a
 * read is in flight, and retires every read that started before that loss. Only a correlated
 * read started after the loss may recover.
 *
 * A read that does not finish within its bound is retired the same way: the late result is not
 * shown. Retry calls the safe read (`list_subscriptions` with no arguments) and nothing else.
 * The label says only whether the data on screen is still from the sign-in it started with. It
 * never grants access; the server authorizes every call from the verified request.
 */
export function connectSubscriptionsView(deps: SubscriptionsViewDependencies): Promise<SubscriptionsViewConnection> {
  let pinnedSession: string | undefined;
  let shown: SubscriptionsResult | undefined;
  let selectedId: string | undefined;
  let invalidated = false;
  let disposed = false;
  let nextRead = 0;
  let activeRead = 0;
  let readTimer: ReturnType<typeof setTimeout> | undefined;
  const readBoundMs = deps.readBoundMs ?? SUBSCRIPTION_LIMITS.readBoundMs;

  const stopTimer = () => {
    if (readTimer === undefined) return;
    clearTimeout(readTimer);
    readTimer = undefined;
  };

  const retireReads = () => {
    activeRead = 0;
    stopTimer();
  };

  const dropPrivate = () => {
    pinnedSession = undefined;
    shown = undefined;
    selectedId = undefined;
  };

  const clear = (state: SubscriptionsViewState) => {
    dropPrivate();
    if (!disposed) deps.show(state);
  };

  type IncomingResult =
    | { readonly kind: 'error'; readonly text: KnownFailureText | undefined }
    | { readonly kind: 'unreadable' }
    | { readonly kind: 'changed-session' }
    | { readonly kind: 'current'; readonly data: SubscriptionsResult };

  const readIncoming = (result: ToolResult): IncomingResult => {
    if (result.isError) return { kind: 'error', text: knownFailureText(result) };
    if (result.structuredContent !== undefined && incomingBytes(result.structuredContent) > SUBSCRIPTION_LIMITS.maxIncomingStateBytes) {
      return { kind: 'unreadable' };
    }
    const parsed = SubscriptionsResultSchema.safeParse(result.structuredContent);
    if (!parsed.success) return { kind: 'unreadable' };
    if (pinnedSession !== undefined && parsed.data.viewSession !== pinnedSession) return { kind: 'changed-session' };
    return { kind: 'current', data: parsed.data };
  };

  const presentCurrent = (data: SubscriptionsResult) => {
    pinnedSession = data.viewSession;
    invalidated = false;
    if (data.subscriptions.length === 0) {
      shown = undefined;
      selectedId = undefined;
      if (!disposed) deps.show({ kind: 'empty', displayName: data.displayName, message: EMPTY_SUBSCRIPTIONS_TEXT });
      return;
    }
    shown = data;
    if (selectedId !== undefined && !data.subscriptions.some((item) => item.subscriptionId === selectedId)) {
      selectedId = undefined;
    }
    if (disposed) return;
    deps.show(selectedId === undefined
      ? { kind: 'subscriptions', subscriptions: data }
      : { kind: 'subscriptions', subscriptions: data, selectedId });
  };

  const apply = (result: ToolResult) => {
    if (disposed) return;
    const incoming = readIncoming(result);
    switch (incoming.kind) {
      case 'error':
        invalidated = true;
        if (incoming.text === SIGN_IN_REQUIRED_TEXT) return clear({ kind: 'sign-in-required' });
        if (incoming.text === SUBSCRIPTIONS_UNAVAILABLE_TEXT) return clear({ kind: 'retry', message: SUBSCRIPTIONS_UNAVAILABLE_TEXT });
        if (incoming.text === INVALID_OUTPUT_TEXT) return clear({ kind: 'problem', message: INVALID_OUTPUT_TEXT });
        if (incoming.text === INVALID_SUBSCRIPTION_INPUT_TEXT) return clear({ kind: 'problem', message: INVALID_SUBSCRIPTION_INPUT_TEXT });
        return clear({ kind: 'problem', message: 'The tool reported an error.' });
      case 'unreadable':
        invalidated = true;
        return clear({ kind: 'problem', message: 'The tool result was not a subscriptions result.' });
      case 'changed-session':
        invalidated = true;
        return clear({ kind: 'problem', message: 'Your session changed. Reload to see your subscriptions.' });
      case 'current':
        presentCurrent(incoming.data);
        return;
    }
  };

  const settleRead = (generation: number, run: () => void) => {
    if (generation !== activeRead || disposed) return;
    activeRead = 0;
    stopTimer();
    run();
  };

  // A host that advertises `serverTools` can proxy this read. The returned promise is the
  // authenticated response; a refusal (the listener's HTTP 401/403, before any tool handler)
  // rejects it, and the private view stays cleared. The bound retires a read that does not
  // finish, so a late resolution cannot emit. The read carries the declared arguments of the
  // input that started it: the optional status filter, and nothing else.
  const readThroughHost = (declared: DeclaredSubscriptionRead) => {
    if (!deps.app.getHostCapabilities()?.serverTools || disposed) return;
    stopTimer();
    const generation = ++nextRead;
    activeRead = generation;
    readTimer = setTimeout(() => {
      settleRead(generation, () => {
        invalidated = true;
        clear({ kind: 'retry', message: SUBSCRIPTIONS_UNAVAILABLE_TEXT });
      });
    }, readBoundMs);
    void deps.app.callServerTool({
      name: SUBSCRIPTIONS_TOOL_NAME,
      arguments: declared.kind === 'filtered' ? { status: declared.status } : {},
    }).then(
      (result) => settleRead(generation, () => apply(result)),
      () => settleRead(generation, () => {
        invalidated = true;
        clear({ kind: 'sign-in-required' });
      }),
    );
  };

  return connectToolResultView({
    app: deps.app,
    transport: deps.transport,
    onToolInput(input) {
      const declared = declaredSubscriptionRead(input.arguments);
      if (declared.kind === 'rejected') {
        // The server refuses this business input for the same reason, so the view refuses it here
        // instead of reading without the filter. No read starts, and a read already in flight is
        // retired so its late result cannot put private rows back after the refusal.
        invalidated = true;
        retireReads();
        clear({ kind: 'problem', message: INVALID_SUBSCRIPTION_INPUT_TEXT });
        return;
      }
      readThroughHost(declared);
    },
    onToolResult(result) {
      // Session loss is not freshness. Classify it before suppressing uncorrelated positive
      // data, clear immediately, and retire reads that started before the loss so a later
      // resolution cannot restore private rendering. A well-shaped result still cannot open
      // private rendering while the view is invalid or a correlated read is in flight.
      if (readIncoming(result).kind !== 'current') {
        retireReads();
        apply(result);
        return;
      }
      if (invalidated || activeRead !== 0) return;
      apply(result);
    },
  }).then((connection) => ({
    retry() {
      readThroughHost({ kind: 'unfiltered' });
    },
    select(subscriptionId) {
      if (disposed || shown === undefined) return;
      if (!shown.subscriptions.some((item) => item.subscriptionId === subscriptionId)) return;
      selectedId = subscriptionId;
      deps.show({ kind: 'subscriptions', subscriptions: shown, selectedId });
    },
    dispose() {
      disposed = true;
      retireReads();
      connection.dispose();
    },
  }));
}
