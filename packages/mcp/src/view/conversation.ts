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

/** The levels of arrays and objects that structured context data may nest; it also ends any cycle. */
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
 * The UTF-8 bytes `JSON.stringify` writes for `value`, quotes and escapes included: `"` and `\`
 * and the short control escapes take two, the other control characters and a lone surrogate take
 * six, and every other character its UTF-8 width. Stops as soon as the total passes `limit` and
 * returns `undefined` then, so it reads at most `limit + 1` characters.
 */
function jsonStringBytes(value: string, limit: number): number | undefined {
  if (value.length + 2 > limit) return undefined;
  let bytes = 2;
  for (let i = 0; i < value.length && bytes <= limit; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit === 0x22 || unit === 0x5c) bytes += 2;
    else if (unit < 0x20)
      bytes +=
        unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13
          ? 2
          : 6;
    else if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 6;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes <= limit ? bytes : undefined;
}

/**
 * A copy of `data` made of plain data only, whose JSON encoding is at most `limit` bytes, or
 * `undefined` when `data` is not that. The budget is measured on the very copy that is returned,
 * so what is sent is what was measured: reading the original again, as a getter or a changing
 * object would allow, cannot widen it.
 *
 * Size is the exact `JSON.stringify` width: strings and keys with their escapes, the braces and
 * brackets, the colons and the commas between members. Admitted values are objects with the plain
 * `Object.prototype` (or none), arrays, strings, finite numbers, booleans and `null`. Everything
 * else is refused rather than converted: `undefined`, `bigint`, symbols, functions, `NaN` and
 * infinities, array holes, accessor properties (own properties only; a getter would run on every
 * read), and any other kind of object (a `Map`, typed array, `Date` or class instance), whose
 * contents the walk could not bound or that JSON would rewrite. A cycle or nesting past
 * `MAX_DATA_DEPTH` is refused. The walk stops as soon as the running size passes `limit`, and an
 * array longer than `limit` is refused without reading an item, so it visits about `limit` values
 * at most and builds a copy no larger than the budget. Object keys are read one at a time with
 * `for...in` and stopped at the budget; the engine's own enumeration of an already existing
 * object is the one cost the walk does not bound.
 */
function snapshotData(
  data: unknown,
  limit: number,
): Record<string, unknown> | undefined {
  let size = 0;
  const add = (bytes: number): boolean => {
    size += bytes;
    return size <= limit;
  };
  // `undefined` is a refusal, which no JSON value is.
  const walk = (value: unknown, depth: number): unknown => {
    if (typeof value === 'string') {
      const bytes = jsonStringBytes(value, limit - size);
      return bytes !== undefined && add(bytes) ? value : undefined;
    }
    if (value === null) return add(4) ? null : undefined;
    if (typeof value === 'boolean') {
      return add(value ? 4 : 5) ? value : undefined;
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) && add(JSON.stringify(value).length)
        ? value
        : undefined;
    }
    if (typeof value !== 'object' || depth >= MAX_DATA_DEPTH) return undefined;
    // An own data property's value, or `undefined` for a hole or an accessor.
    const own = (key: string | number): { value: unknown } | undefined => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && 'value' in descriptor
        ? { value: descriptor.value as unknown }
        : undefined;
    };
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return undefined;
      // Every item takes a byte, so a longer array cannot fit and none of it is read.
      if (value.length > limit || !add(2)) return undefined;
      const copy: unknown[] = [];
      for (let i = 0; i < value.length; i += 1) {
        const item = own(i);
        if (item === undefined || (i > 0 && !add(1))) return undefined;
        const admitted = walk(item.value, depth + 1);
        if (admitted === undefined) return undefined;
        copy.push(admitted);
      }
      return copy;
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    if (!add(2)) return undefined;
    const copy: Record<string, unknown> = {};
    let first = true;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      const member = own(key);
      const keyBytes = jsonStringBytes(key, limit - size);
      if (
        member === undefined ||
        keyBytes === undefined ||
        !add(keyBytes + 1 + (first ? 0 : 1))
      )
        return undefined;
      first = false;
      const admitted = walk(member.value, depth + 1);
      if (admitted === undefined) return undefined;
      // Defined, not assigned: a key called `__proto__` stays an own property.
      Object.defineProperty(copy, key, {
        value: admitted,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return copy;
  };
  try {
    if (typeof data !== 'object' || data === null || Array.isArray(data))
      return undefined;
    return walk(data, 0) as Record<string, unknown> | undefined;
  } catch {
    return undefined;
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
        // Read once: the checks and the request must see the same values. `data` is replaced by
        // the copy that was measured, so the host receives exactly what was admitted.
        const { text: contextText, data, bestEffort } = context;
        const snapshot =
          data === undefined
            ? undefined
            : snapshotData(data, CONVERSATION_LIMITS.contextDataBytes);
        const admitted =
          fitsText(contextText, CONVERSATION_LIMITS.contextTextBytes) &&
          (data === undefined || snapshot !== undefined);
        skipped = await attempt(
          'updateModelContext',
          admitted
            ? () =>
                app.updateModelContext({
                  content: [{ type: 'text', text: contextText }],
                  ...(snapshot === undefined
                    ? {}
                    : { structuredContent: snapshot }),
                })
            : undefined,
        );
        if (skipped !== undefined && bestEffort !== true)
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
