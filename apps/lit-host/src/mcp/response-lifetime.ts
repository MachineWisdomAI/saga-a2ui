import type { IncomingMessage, ServerResponse } from 'node:http';
import { startBoundedTimer } from '@saga-a2ui/mcp/policy';
import type { RequestLifetime } from '@saga-a2ui/mcp/server';

// The Node side of the request lifetime: it tells the portable lifetime what the transport did
// (the response finished, the caller went away) and acts on what the lifetime decides (the deadline
// passed, so stop delivering). Everything here is about one `ServerResponse`.
//
// A finite response is bounded through transport `finish`: calling `end` or having a result ready is
// not completion. When the request deadline passes before `finish` the response is destroyed, which
// clears the transport's own listeners and timers through `close`. A response that was already
// committed is never given a replacement status.

/**
 * How an established streaming response is kept finite. The request deadline bounds setup through
 * the moment the stream is established; after that the stream may live as long as it keeps moving.
 */
export interface StreamingPolicy {
  /**
   * The longest an established stream may go without the transport accepting more of its bytes. A
   * write that is still waiting on a slow reader counts as no activity, and so does progress the
   * application reported but never delivered. Must be a finite positive number.
   */
  readonly idleMs: number;
}

/** Used when the application enables streaming without choosing: finite, and deliberately generous. */
export const DEFAULT_STREAM_IDLE_MS = 30_000;

/** The listener's own configuration is unusable. Names the setting, never a value. */
export class ListenerConfigurationError extends Error {
  constructor(problem: string) {
    super(`The listener is not configured: ${problem}.`);
    this.name = 'ListenerConfigurationError';
  }
}

/** Resolves a streaming policy, selecting the documented default when none is supplied. */
export function resolveStreamingPolicy(policy: StreamingPolicy | undefined): StreamingPolicy {
  const idleMs: unknown = policy?.idleMs ?? DEFAULT_STREAM_IDLE_MS;
  if (typeof idleMs !== 'number' || !Number.isFinite(idleMs) || idleMs <= 0) {
    throw new ListenerConfigurationError('streaming.idleMs must be a finite positive number');
  }
  return Object.freeze({ idleMs });
}

/**
 * Whether a safe failure may still be written: the response is uncommitted and open, and the caller
 * has not gone. An expired request may still answer once (it gets no extra time to deliver it).
 */
export function mayAnswer(lifetime: RequestLifetime, res: ServerResponse): boolean {
  if (res.headersSent || res.destroyed) return false;
  const cause = lifetime.cause;
  return cause === undefined || cause.kind === 'request-timeout';
}

/** Whether `writeHead` was given a text/event-stream content type, as a status line plus a headers object or list. */
function declaresEventStream(args: readonly unknown[]): boolean {
  const headers = args.find((arg) => typeof arg === 'object' && arg !== null);
  const pairs: [unknown, unknown][] = Array.isArray(headers)
    ? headers.map((entry, index): [unknown, unknown] => (Array.isArray(entry) ? [entry[0], entry[1]] : [entry, headers[index + 1]]))
    : Object.entries((headers ?? {}) as Record<string, unknown>);
  return pairs.some(([name, value]) => typeof name === 'string' && name.toLowerCase() === 'content-type' && typeof value === 'string' && value.toLowerCase().startsWith('text/event-stream'));
}

/**
 * Connects one request's lifetime to its response, once, when the request is admitted. The caller
 * keeps writing responses as before; this only observes the transport and enforces the deadline.
 */
export function bindResponseToLifetime(
  req: IncomingMessage,
  res: ServerResponse,
  lifetime: RequestLifetime,
  streaming: StreamingPolicy | undefined,
  /** Called once, when the response is closed. `delivered` is true only when the transport finished it undestroyed. */
  onClosed: (delivered: boolean) => void,
): void {
  // A write to a response we destroyed must not escape as an unhandled error.
  res.on('error', () => undefined);
  req.on('error', () => undefined);

  // Destroying a response also emits `finish` on current Node (with `destroyed` already true and
  // `writableFinished` true), so neither event nor flag says the peer received the whole response. Only a
  // finish on a response nobody destroyed is delivery; anything else ended the response early.
  let delivered = false;
  res.once('finish', () => {
    if (res.destroyed) return;
    delivered = true;
    lifetime.finish();
  });
  res.once('close', () => {
    // A close after delivery is not a cancellation; before it, the caller went away (or we destroyed it,
    // in which case the request already ended with its own cause and this changes nothing).
    if (!delivered) lifetime.disconnect();
    onClosed(delivered);
  });

  lifetime.signal.addEventListener(
    'abort',
    () => {
      if (lifetime.cause?.kind !== 'request-timeout') return;
      // The stage that owns the response may write one safe failure now; whatever it needs beyond this
      // turn of the event loop would be extra delivery time, which an expired request does not get.
      setImmediate(() => {
        if (!res.writableFinished && !res.destroyed) res.destroy();
      });
    },
    { once: true },
  );

  if (streaming) watchStream(res, lifetime, streaming);
}

/**
 * Once a text/event-stream response is established the request deadline stops and the idle policy
 * takes over: every write the transport actually flushes restarts the idle clock.
 */
function watchStream(res: ServerResponse, lifetime: RequestLifetime, policy: StreamingPolicy): void {
  let idle: (() => void) | undefined;
  const stop = () => {
    idle?.();
    idle = undefined;
  };
  const restart = () => {
    stop();
    if (res.writableEnded || res.destroyed) return;
    // Segmented: an accepted idle limit above the native timer's maximum must not expire at once.
    idle = startBoundedTimer(policy.idleMs, () => {
      idle = undefined;
      lifetime.record({ kind: 'operation-timeout', stage: 'delivery', limitMs: policy.idleMs, effect: 'unknown' });
      res.destroy();
    });
  };
  res.once('close', stop);
  res.once('finish', stop);

  const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
  res.writeHead = ((...args: unknown[]) => {
    const written = writeHead(...args);
    if (declaresEventStream(args)) {
      lifetime.releaseRequestBudget();
      restart();
    }
    return written;
  }) as typeof res.writeHead;

  const write = res.write.bind(res) as (chunk: unknown, ...rest: unknown[]) => boolean;
  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    const callback = rest.at(-1);
    const done = typeof callback === 'function' ? (callback as (error?: Error | null) => void) : undefined;
    const front = done ? rest.slice(0, -1) : rest;
    // Activity is the transport accepting the bytes, not the application asking for them to be sent.
    return write(chunk, ...front, (error?: Error | null) => {
      if (!error && idle !== undefined) restart();
      done?.(error);
    });
  }) as typeof res.write;
}
