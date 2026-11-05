/**
 * The request's own outcome, or `undefined` as soon as `signal` aborts, whichever comes first.
 * The request is not cancelled (the bridge offers no way to) and is not retried; its late result
 * or rejection is observed and dropped, so a rejection after the abort is never unhandled. The
 * caller checks the signal afterwards and reads the settlement of an ended view as `unavailable`,
 * never as the request's result.
 *
 * The abort listener is removed on every path: when the signal aborts, and when the request
 * settles first. A signal that has already aborted settles at once and gets no listener. A request
 * that never answers therefore leaves nothing of this helper on the signal.
 */
export function untilEnded<T>(
  request: Promise<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  if (signal === undefined) return request;
  return new Promise<T | undefined>((resolve, reject) => {
    let listening = false;
    const stopListening = (): void => {
      if (!listening) return;
      listening = false;
      signal.removeEventListener('abort', onAbort);
    };
    // `once` alone does not remove the listener when the request settles first.
    const onAbort = (): void => {
      stopListening();
      resolve(undefined);
    };
    // Observed before anything else, so a rejection after the abort is handled whichever side won.
    request.then(
      (value) => {
        stopListening();
        resolve(value);
      },
      (error: unknown) => {
        stopListening();
        reject(error);
      },
    );
    // The signal may have aborted between the caller's check and here; no event follows then.
    if (signal.aborted) {
      resolve(undefined);
      return;
    }
    listening = true;
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
