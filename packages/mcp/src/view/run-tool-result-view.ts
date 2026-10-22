import type {
  App,
  McpUiToolInputNotification,
  McpUiToolResultNotification,
} from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/client';

// Browser-side lifetime of an MCP Apps view. Everything imported above is a type, so this module
// adds no server code and no renderer to a view bundle.

export type ToolResult = McpUiToolResultNotification['params'];
export type ToolInput = McpUiToolInputNotification['params'];
/** What the host tells a view about its environment (`ui/initialize` and later changes). */
export type HostContext = NonNullable<ReturnType<App['getHostContext']>>;

/**
 * Why a view did not become ready.
 *
 * - `connect`: the handshake with the host failed.
 * - `ready`: the caller's `readyWhen` work rejected.
 * - `application`: a caller's callback threw while the view was starting (or while it was being
 *   ended during start). Cleanup completed before this was reported.
 * - `disposed`: the view was ended (dispose, host teardown or `pagehide`) before it was ready.
 */
export type ViewFailureKind = 'connect' | 'ready' | 'application' | 'disposed';

/** The reason `ready` rejects, and what `onFailure` receives. */
export class ViewStartFailure extends Error {
  constructor(
    readonly kind: ViewFailureKind,
    readonly cause?: unknown,
  ) {
    super(`The view did not become ready (${kind}).`);
    this.name = 'ViewStartFailure';
  }
}

/** Where a callback threw after the view was ready. */
export type ViewErrorPhase = 'input' | 'result' | 'host-context' | 'teardown';

export interface ToolResultViewDependencies {
  /** The MCP Apps view bridge. Its transport is chosen by the composition root. */
  readonly app: App;
  readonly transport: Transport;
  /**
   * Optional. Work the view needs before it can show anything, such as embedded fonts. It starts
   * with the handshake, not after it. `signal` aborts when the view ends, so abandoned work can
   * stop; an outcome that arrives afterwards is ignored.
   */
  readonly readyWhen?: (signal: AbortSignal) => Promise<void>;
  /**
   * Called for each delivered result, and only once the view is ready: a result that arrives
   * earlier is held, a later one replaces it, and the latest is delivered once, after the host
   * context. Never called after the view has ended.
   */
  readonly onToolResult: (result: ToolResult) => void;
  /**
   * Optional. The notification that a tool call is starting, with its own params. It carries the
   * business arguments of that call, the only place they appear; it is not that call's response
   * and does not authenticate a later `toolresult`. Held and delivered like a result, before the
   * held result.
   */
  readonly onToolInput?: (input: ToolInput) => void;
  /**
   * Optional. The latest negotiated host context (possibly `undefined`) with the host's reported
   * name, once before the view is ready and so before the first result, then on every change with
   * the merged context.
   */
  readonly onHostContext?: (
    context: HostContext | undefined,
    hostName: string | undefined,
  ) => void;
  /**
   * Called once, whichever way the view ends (host teardown request, `dispose()`, `pagehide`, or a
   * startup failure), before the connection ends. An application that holds something outside
   * the page's own rendering releases it here. It must tolerate being called on a view that
   * never showed anything. It is told the startup failure that ended the view, so a caller that
   * shows that failure can keep what it shows; for any other ending (including a `dispose()`,
   * host teardown or `pagehide` while still starting) it is told nothing.
   */
  readonly onTeardown: (failure?: ViewStartFailure) => void;
  /** Optional. Called once if the view did not become ready; `ready` rejects with the same value. */
  readonly onFailure?: (failure: ViewStartFailure) => void;
  /**
   * Optional. Receives a throw from a callback after the view was ready; the connection stays up.
   * Defaults to `console.error`.
   */
  readonly onError?: (error: unknown, phase: ViewErrorPhase) => void;
}

export interface ToolResultView {
  /**
   * Settles when the view is ready: connected, `readyWhen` done, host context and any held input
   * applied. Rejects with a `ViewStartFailure` otherwise. Already handled by the runner, so
   * ignoring it never causes an unhandled rejection.
   */
  readonly ready: Promise<void>;
  /**
   * Ends the view. Idempotent; settles after cleanup, and never rejects: a callback that throws
   * is reported, not thrown.
   */
  dispose(): Promise<void>;
}

/**
 * Runs the lifetime of an MCP Apps view so that no caller sequences the handshake, holds early
 * results or orders teardown. What to show and what to release belong to the caller; this module
 * only decides when.
 *
 * Starting:
 * - Every handler is installed before `connect`, so a result the host sends right after
 *   initialization is handled, once.
 * - Input and results that arrive before the view is ready are held (the latest of each).
 * - When the handshake and `readyWhen` have both succeeded, the caller receives the host context,
 *   then the held input, then the held result, and `ready` resolves. A callback that throws
 *   during this fails startup as `application`.
 *
 * Ending, by `dispose()`, a host teardown request or `pagehide`, at any point:
 * 1. Delivery stops, the readiness signal aborts and held input and results are dropped. An
 *    outcome that arrives later delivers nothing and reports nothing new.
 * 2. `onTeardown` runs once.
 * 3. The listeners are removed and the connection is closed, whatever `onTeardown` did. On a host
 *    teardown request the host is answered first.
 * Nothing the caller's callbacks changed is rolled back: a callback that throws is reported
 * (`onFailure` while starting, `onError` afterwards) and cleanup still happens. Retiring this
 * view says nothing about server work started on its behalf; that is not cancelled here.
 */
export function runToolResultView(
  deps: ToolResultViewDependencies,
): ToolResultView {
  const { app } = deps;
  const lifetime = new AbortController();
  const report = deps.onError ?? ((error) => console.error(error));

  let phase: 'starting' | 'ready' | 'ended' = 'starting';
  let heldInput: ToolInput | undefined;
  let heldResult: ToolResult | undefined;
  let ending: Promise<void> | undefined;

  const readiness = deferred();
  // The caller may never look at `ready`; a failure is still reported through `onFailure`.
  readiness.promise.catch(() => undefined);

  const reportError = (error: unknown, errorPhase: ViewErrorPhase): void => {
    try {
      report(error, errorPhase);
    } catch {
      // A reporter that throws must not stop the event's remaining cleanup.
    }
  };
  const guarded = (errorPhase: ViewErrorPhase, call: () => void): void => {
    try {
      call();
    } catch (error) {
      reportError(error, errorPhase);
    }
  };

  const onToolInput = (input: ToolInput): void => {
    if (phase === 'starting') heldInput = input;
    else if (phase === 'ready')
      guarded('input', () => deps.onToolInput?.(input));
  };
  const onToolResult = (result: ToolResult): void => {
    if (phase === 'starting') heldResult = result;
    else if (phase === 'ready')
      guarded('result', () => deps.onToolResult(result));
  };
  const onHostContextChanged = (): void => {
    // The App merges each partial change into its context; the caller receives the whole.
    if (phase === 'ready') guarded('host-context', () => applyHostContext());
  };
  const applyHostContext = (): void =>
    deps.onHostContext?.(app.getHostContext(), app.getHostVersion()?.name);
  const onPageHide = (): void => void end();

  /**
   * The one ending. Everything happens in this order and at most once; later callers share the
   * outcome. `failure` is the reason a view that was still starting ends; `answerFirst` defers
   * closing the connection until the host's teardown request has been answered.
   */
  function end(failure?: ViewStartFailure, answerFirst = false): Promise<void> {
    if (ending !== undefined) return ending;
    const done = deferred();
    ending = done.promise;

    const wasStarting = phase === 'starting';
    phase = 'ended';
    lifetime.abort();
    heldInput = undefined;
    heldResult = undefined;
    removeHandlers();

    let teardownFailed: { readonly error: unknown } | undefined;
    try {
      deps.onTeardown(failure);
    } catch (error) {
      teardownFailed = { error };
    }

    void (async () => {
      if (answerFirst) await new Promise((resolve) => setTimeout(resolve, 0));
      await app.close().catch(() => undefined);

      // A teardown that threw while the view was still starting is the failure to report, unless
      // startup had already failed for its own reason; then it is reported as an error.
      let startupFailure = wasStarting
        ? (failure ?? new ViewStartFailure('disposed'))
        : undefined;
      if (teardownFailed !== undefined) {
        if (startupFailure?.kind === 'disposed')
          startupFailure = new ViewStartFailure(
            'application',
            teardownFailed.error,
          );
        else reportError(teardownFailed.error, 'teardown');
      }
      if (startupFailure !== undefined) {
        const reason = startupFailure;
        try {
          deps.onFailure?.(reason);
        } catch {
          // Reported as far as it can be; the rejection below is the caller's other channel.
        }
        readiness.reject(reason);
      }
      done.resolve();
    })();
    return done.promise;
  }

  function removeHandlers(): void {
    app.removeEventListener('toolresult', onToolResult);
    if (deps.onToolInput) app.removeEventListener('toolinput', onToolInput);
    app.removeEventListener('hostcontextchanged', onHostContextChanged);
    app.onteardown = undefined;
    if (typeof globalThis.removeEventListener === 'function')
      globalThis.removeEventListener('pagehide', onPageHide);
  }

  async function start(): Promise<void> {
    const connected = app.connect(deps.transport);
    // Started now, beside the handshake. A `readyWhen` that throws instead of rejecting is the
    // same failure.
    let prepared: Promise<void | undefined>;
    try {
      prepared = Promise.resolve(deps.readyWhen?.(lifetime.signal));
    } catch (error) {
      prepared = Promise.reject(error);
    }
    try {
      await Promise.all([
        connected.catch((cause: unknown) => {
          throw new ViewStartFailure('connect', cause);
        }),
        prepared.catch((cause: unknown) => {
          throw new ViewStartFailure('ready', cause);
        }),
      ]);
    } catch (failure) {
      // A failure that arrives after the view has ended is not news.
      if (phase === 'starting') await end(failure as ViewStartFailure);
      return;
    }
    if (phase !== 'starting') return;

    try {
      applyHostContext();
      if (heldInput !== undefined) deps.onToolInput?.(heldInput);
      if (heldResult !== undefined) deps.onToolResult(heldResult);
    } catch (cause) {
      if (phase === 'starting')
        await end(new ViewStartFailure('application', cause));
      return;
    }
    if (phase !== 'starting') return; // a callback ended the view
    heldInput = undefined;
    heldResult = undefined;
    phase = 'ready';
    readiness.resolve();
  }

  // Handlers first, then connect: nothing the host sends can arrive unobserved.
  if (deps.onToolInput) app.addEventListener('toolinput', onToolInput);
  app.addEventListener('toolresult', onToolResult);
  app.addEventListener('hostcontextchanged', onHostContextChanged);
  // The host closes the connection once its request is answered, but the view closes it too (after
  // answering), so the cleanup does not depend on the host.
  app.onteardown = async () => {
    void end(undefined, true);
    return {};
  };
  if (typeof globalThis.addEventListener === 'function')
    globalThis.addEventListener('pagehide', onPageHide);

  void start();

  return {
    ready: readiness.promise,
    dispose: () => end(),
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
