/**
 * The request's own outcome, or a settlement as soon as `signal` aborts, whichever comes first.
 * The request is not cancelled (the bridge offers no way to) and is not retried; its late result or
 * rejection is dropped. The abort listener is removed once either side has settled. A signal that
 * has already aborted settles at once. The caller checks the signal afterwards and reads the
 * settlement of an ended view as `unavailable`, never as the request's result.
 */
export function untilEnded<T>(
  request: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return request;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => resolve(undefined as T);
    // `once` alone would leave the listener behind when the request settles first.
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = (): void => signal.removeEventListener('abort', onAbort);
    // The signal may have aborted between the caller's check and here; no event follows then.
    if (signal.aborted) onAbort();
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
