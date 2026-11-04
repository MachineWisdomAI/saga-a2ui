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
 * What the SDK admits to the host, measured on what is sent: UTF-8 bytes for a message and for the
 * context text, and the JSON-encoded size of the structured context data. The budgets are generous
 * for prose and a game or form snapshot and exist so that a view cannot hand the host an unbounded
 * payload. They are the SDK's own: no supported host publishes one.
 */
export const CONVERSATION_LIMITS = Object.freeze({
  messageBytes: 16 * 1024,
  contextTextBytes: 16 * 1024,
  contextDataBytes: 64 * 1024,
});

/** The nesting depth that structured context data may reach; it also ends any cycle. */
const MAX_DATA_DEPTH = 32;

const encoder = new TextEncoder();

/** Whether `value` is a string of at most `limit` UTF-8 bytes. Never encodes more than `limit`. */
function fitsText(value: unknown, limit: number): boolean {
  // A string has at least one byte per UTF-16 unit, so a longer one cannot fit and is not encoded.
  return typeof value === 'string' && value.length <= limit
    ? encoder.encode(value).length <= limit
    : false;
}

/**
 * Whether `data` is plain JSON-like data of at most `limit` bytes, counting each string as its
 * UTF-8 bytes plus quotes and each value, key and separator at its JSON width (escapes are not
 * counted). The walk stops as soon as the running size passes the limit, so it visits at most
 * about `limit` values and never builds the encoding of an oversized value. Anything that is not
 * plain data does not fit: a cycle or nesting past `MAX_DATA_DEPTH`, a `Map`, typed array or other
 * non-plain object (whose contents the walk could not bound), or a getter that throws.
 */
function fitsData(data: unknown, limit: number): boolean {
  let size = 0;
  const add = (bytes: number): boolean => {
    size += bytes;
    return size <= limit;
  };
  const walk = (value: unknown, depth: number): boolean => {
    if (depth > MAX_DATA_DEPTH) return false;
    if (typeof value === 'string')
      return value.length <= limit && add(encoder.encode(value).length + 2);
    if (typeof value !== 'object' || value === null)
      return add(String(value).length);
    if (Array.isArray(value)) {
      if (!add(2)) return false;
      for (const item of value) {
        if (!add(1) || !walk(item, depth + 1)) return false;
      }
      return true;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if (!add(2)) return false;
    for (const key of Object.keys(value)) {
      if (!add(2) || !walk(key, depth + 1)) return false;
      if (!walk((value as Record<string, unknown>)[key], depth + 1))
        return false;
    }
    return true;
  };
  try {
    return walk(data, 0);
  } catch {
    return false;
  }
}

/**
 * Adds messages to the conversation through the upstream MCP Apps requests: `ui/update-model-context`
 * for a message's context, then `ui/message` with role `user`. Each is sent only when the host
 * advertised its capability (`updateModelContext`, `message`); the capabilities are read at call
 * time, so the conversation can be built before the bridge has connected. There is no fallback:
 * without a capability that request is not made.
 *
 * Payloads are admitted before anything is sent, against {@link CONVERSATION_LIMITS}: the message
 * text, the context text and the structured context data each have a size budget, and the data
 * must be plain JSON-like data. An over-budget message resolves `denied` at the message stage with
 * nothing sent, not even its context. An over-budget context is refused as `denied` at the context
 * stage and, as for any context that cannot be delivered, stops the message unless `bestEffort`.
 * Nothing is truncated or rewritten: the wording and meaning stay the application's.
 *
 * The two requests are sent in that order, never in parallel, and nothing is retried: a request
 * that rejects or times out may still have been carried out, and a repeated message would ask the
 * assistant twice. A context that cannot be delivered (unsupported, refused or failed) stops the
 * message with `stage: 'context'` unless the caller set `bestEffort`, in which case the message is
 * still attempted and an accepted one reports `{outcome: 'appended', context: <why it was skipped>}`.
 *
 * Outcomes of one request: `unavailable` without the capability or once `signal` has aborted (also
 * when it aborts while a request is outstanding, so a view that has ended hears of no late result
 * and nothing further is sent), `denied` when the host answers with `isError` or when the SDK
 * refuses the payload (above), `failed` when the request
 * rejects. The pinned bridge (`@modelcontextprotocol/ext-apps` 2.0.3) gives a context update
 * no way to answer `isError`, so a host's refusal of one arrives as a rejection and reads `failed`.
 */
export function conversationFromApp(
  app: App,
  signal?: AbortSignal,
): Conversation {
  // A function, not a local: the signal can abort while a request is awaited.
  const ended = (): boolean => signal?.aborted === true;

  // `undefined` is acceptance. The caller maps any outcome onto the stage it belongs to. A `send`
  // of `undefined` is a payload that was not admitted: it is refused here, after the checks that
  // would have stopped the request anyway, and nothing is sent.
  const attempt = async (
    capability: 'updateModelContext' | 'message',
    send: (() => Promise<object>) | undefined,
  ): Promise<RequestOutcome | undefined> => {
    if (ended() || app.getHostCapabilities()?.[capability] === undefined)
      return 'unavailable';
    if (send === undefined) return 'denied';
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
      // Admission comes before any dispatch. An over-budget message ends the call before even the
      // context is sent, since a context without its message has no effect to rely on.
      if (!fitsText(text, CONVERSATION_LIMITS.messageBytes)) {
        const outcome = await attempt('message', undefined);
        return { outcome: outcome ?? 'denied', stage: 'message' };
      }
      let skipped: RequestOutcome | undefined;
      if (context !== undefined) {
        const admitted =
          fitsText(context.text, CONVERSATION_LIMITS.contextTextBytes) &&
          (context.data === undefined ||
            fitsData(context.data, CONVERSATION_LIMITS.contextDataBytes));
        skipped = await attempt(
          'updateModelContext',
          admitted
            ? () =>
                app.updateModelContext({
                  content: [{ type: 'text', text: context.text }],
                  ...(context.data === undefined
                    ? {}
                    : { structuredContent: context.data }),
                })
            : undefined,
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
