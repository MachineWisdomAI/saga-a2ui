import type { App } from '@modelcontextprotocol/ext-apps';
import type {
  AppendResult,
  Conversation,
  RequestOutcome,
} from '@saga-a2ui/core/conversation';

/**
 * The request's own outcome, or a settlement as soon as `signal` aborts, whichever comes first.
 * The request is not cancelled (the bridge offers no way to) and is not retried; its late result or
 * rejection is dropped. The abort listener is removed once either side has settled.
 */
function untilEnded<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return request;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => resolve(undefined as T);
    // `once` alone would leave the listener behind when the request settles first.
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = (): void => signal.removeEventListener('abort', onAbort);
    request.then(
      (value) => {
        settle();
        resolve(value);
      },
      (error: unknown) => {
        settle();
        reject(error);
      },
    );
  });
}

/**
 * Adds messages to the conversation through the upstream MCP Apps requests: `ui/update-model-context`
 * for a message's context, then `ui/message` with role `user`. Each is sent only when the host
 * advertised its capability (`updateModelContext`, `message`); the capabilities are read at call
 * time, so the conversation can be built before the bridge has connected. There is no fallback:
 * without a capability that request is not made.
 *
 * The two requests are sent in that order, never in parallel, and nothing is retried: a request
 * that rejects or times out may still have been carried out, and a repeated message would ask the
 * assistant twice. A context that cannot be delivered (unsupported, refused or failed) stops the
 * message with `stage: 'context'` unless the caller set `bestEffort`, in which case the message is
 * still attempted and an accepted one reports `{outcome: 'appended', context: <why it was skipped>}`.
 *
 * Outcomes of one request: `unavailable` without the capability or once `signal` has aborted (also
 * when it aborts while a request is outstanding, so a view that has ended hears of no late result
 * and nothing further is sent), `denied` when the host answers with `isError`, `failed` when the
 * request rejects. The pinned bridge (`@modelcontextprotocol/ext-apps` 2.0.3) gives a context update
 * no way to answer `isError`, so a host's refusal of one arrives as a rejection and reads `failed`.
 */
export function conversationFromApp(
  app: App,
  signal?: AbortSignal,
): Conversation {
  // A function, not a local: the signal can abort while a request is awaited.
  const ended = (): boolean => signal?.aborted === true;

  // `undefined` is acceptance. The caller maps any outcome onto the stage it belongs to.
  const attempt = async (
    capability: 'updateModelContext' | 'message',
    send: () => Promise<object>,
  ): Promise<RequestOutcome | undefined> => {
    if (ended() || app.getHostCapabilities()?.[capability] === undefined)
      return 'unavailable';
    try {
      const result = await untilEnded(send(), signal);
      if (ended()) return 'unavailable';
      // `ui/message` answers a refusal with `isError`. `ui/update-model-context` has an empty
      // result in the pinned bridge, which rejects any other key, so a host that refuses a context
      // update can only reject it; the same reading is kept for a bridge that ever allows it.
      return (result as { isError?: unknown }).isError === true
        ? 'denied'
        : undefined;
    } catch {
      return ended() ? 'unavailable' : 'failed';
    }
  };

  return {
    async appendMessage(text, options): Promise<AppendResult> {
      const context = options?.context;
      let skipped: RequestOutcome | undefined;
      if (context !== undefined) {
        skipped = await attempt('updateModelContext', () =>
          app.updateModelContext({
            content: [{ type: 'text', text: context.text }],
            ...(context.data === undefined
              ? {}
              : { structuredContent: context.data }),
          }),
        );
        if (skipped !== undefined && context.bestEffort !== true)
          return { outcome: skipped, stage: 'context' };
      }
      // The view can end while the context request is outstanding, even for a best-effort one:
      // `attempt` then sends nothing and the message is unavailable.
      const refused = await attempt('message', () =>
        app.sendMessage({
          role: 'user',
          content: [{ type: 'text', text }],
        }),
      );
      if (refused !== undefined) return { outcome: refused, stage: 'message' };
      return skipped === undefined
        ? { outcome: 'appended' }
        : { outcome: 'appended', context: skipped };
    },
  };
}
