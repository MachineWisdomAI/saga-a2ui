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

/**
 * Guard for a callback that must finish in the call that made it. Used as a rest parameter, it
 * asks for an extra argument nothing can supply when the callback's inferred return type has any
 * thenable constituent, so an `async` callback or `Promise<T> | undefined` does not compile. A
 * callback that always throws returns `never` and stays valid. The types cannot see a promise
 * hidden behind a declared `unknown` or `void`, so the runtime checks the returned value too.
 */
export type Synchronous<Returned> = [
  Extract<Returned, PromiseLike<unknown>>,
] extends [never]
  ? []
  : [returnedAThenable: never];

/** Marks a thenable's outcome as handled. Used for values the runtime will not wait for. */
export function discardOutcome(thenable: PromiseLike<unknown>): void {
  try {
    thenable.then(undefined, () => undefined);
  } catch {
    // A hostile `then` that throws has nothing more to report.
  }
}
