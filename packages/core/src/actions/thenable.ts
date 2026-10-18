// Callbacks in this slice finish in the call that made them. A promise that arrives anyway cannot
// be awaited here, so it is refused loudly; its eventual rejection is handled so that refusing it
// never becomes an unhandled rejection of its own.

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/** Marks a thenable's outcome as handled. Used for values the runtime will not wait for. */
export function discardOutcome(thenable: PromiseLike<unknown>): void {
  try {
    thenable.then(undefined, () => undefined);
  } catch {
    // A hostile `then` that throws has nothing more to report.
  }
}
