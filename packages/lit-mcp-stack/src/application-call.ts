// An application callback that runs while the stack is still setting up (before there is a running
// view to report through). A throw from it must not escape `start`: the stack cleans up what it had
// made and returns a handle whose `ready` rejects with `StartFailure('application')`. Marking the
// throw keeps that apart from a misuse or a defect of the stack itself, which still throws.

class ApplicationCallFailure {
  constructor(readonly cause: unknown) {}
}

/** Runs one application callback of the synchronous part of a start. */
export function callApplication<T>(call: () => T): T {
  try {
    return call();
  } catch (cause) {
    throw new ApplicationCallFailure(cause);
  }
}

/** The application's own throw, when `error` came out of {@link callApplication}. */
export function applicationFailureOf(
  error: unknown,
): { readonly cause: unknown } | undefined {
  return error instanceof ApplicationCallFailure
    ? { cause: error.cause }
    : undefined;
}
