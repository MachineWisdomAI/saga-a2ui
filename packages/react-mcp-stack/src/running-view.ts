import {
  runToolResultView,
  startOwnSizing,
  ViewStartFailure,
  type HostContext,
  type ToolInput,
  type ToolResult,
} from '@saga-a2ui/mcp/view';
import { applicationFailureOf } from './application-call.js';
import type { HostConnection } from './host-connection.js';
import { StartFailure, type ErrorPhase } from './start-failure.js';

// What both entries of the stack share once they have something to show: one view in one container
// whose lifetime is `runToolResultView`'s. It adds what is the stack’s alone: the typed failure,
// own sizing that starts only once the host can be told, the claim on the container, and when a
// view that has ended leaves the screen. It decides nothing about what is shown.

/** The handle both entries return, synchronously. */
export interface RunningView {
  /**
   * Settles when the embedded policy was valid, the host connected with the handlers installed
   * first, the latest host context was applied and the application's readiness work finished.
   * Rejects with a {@link StartFailure} otherwise. Ignoring it never causes an unhandled rejection.
   */
  readonly ready: Promise<void>;
  /**
   * Ends the view and removes what it showed, whatever state it is in: ready, still starting, or
   * failed (a failed view keeps its failure text on screen until it is disposed). Idempotent;
   * settles after cleanup and never rejects. Afterwards the container may be started again.
   */
  dispose(): Promise<void>;
}

export interface RunViewOptions {
  readonly connection: HostConnection;
  /** Aborts when the view ends. Anything the view started for the host (links, sizing) listens to it. */
  readonly lifetime: AbortController;
  /** Frees the container; called once, after `unmount`. */
  readonly releaseContainer: () => void;
  readonly sizing: 'own' | 'host';
  readonly readyWhen?: (signal: AbortSignal) => Promise<void>;
  readonly hostContext?: (
    context: HostContext | undefined,
    hostName: string | undefined,
  ) => void;
  /** Called for each delivered result once the view is ready (the held one at that moment). */
  readonly onToolResult: (result: ToolResult) => void;
  /** Called for the tool call that is starting, once the view is ready and before the held result. */
  readonly onToolInput?: (input: ToolInput) => void;
  readonly onError?: (error: unknown, phase: ErrorPhase) => void;
  /** The first step of ending, once, before the connection ends: retire consent and the surface. */
  readonly retire: () => void;
  /** Removes everything the view rendered. Called once. */
  readonly unmount: () => void;
  /**
   * Shows why the view did not start. Returns true when the failure is now on screen, which keeps
   * the view mounted until it is disposed. Not asked for `disposed`, which shows nothing.
   */
  readonly showFailure?: (failure: StartFailure) => boolean;
}

function startFailureOf(failure: unknown): StartFailure {
  if (failure instanceof ViewStartFailure) {
    // Readiness work the stack itself holds for an application callback (the action setup).
    const own = applicationFailureOf(failure.cause);
    return own === undefined
      ? new StartFailure(failure.kind, failure.cause)
      : new StartFailure('application', own.cause);
  }
  return new StartFailure('application', failure);
}

export function runView(options: RunViewOptions): RunningView {
  const { app, transport } = options.connection;
  const report = options.onError ?? ((error: unknown) => console.error(error));
  let onScreen = true;
  let failureShown = false;
  let sizingStarted = false;

  const reportError = (error: unknown, phase: ErrorPhase): void => {
    try {
      report(error, phase);
    } catch {
      // A reporter that throws must not stop cleanup.
    }
  };

  /** The view is gone from the screen: unmount, then free the container, whatever unmount did. */
  const leave = (): void => {
    if (!onScreen) return;
    onScreen = false;
    try {
      options.unmount();
    } finally {
      options.releaseContainer();
    }
  };

  const running = runToolResultView({
    app,
    transport,
    ...(options.readyWhen === undefined
      ? {}
      : { readyWhen: options.readyWhen }),
    onToolResult: options.onToolResult,
    ...(options.onToolInput === undefined
      ? {}
      : { onToolInput: options.onToolInput }),
    onHostContext(context, hostName) {
      // Told only once the host can hear it: sizing before the handshake would be dropped, and the
      // size it measured would then count as sent.
      if (options.sizing === 'own' && !sizingStarted) {
        sizingStarted = true;
        startOwnSizing(app, options.lifetime.signal);
      }
      options.hostContext?.(context, hostName);
    },
    onTeardown(startupFailure) {
      options.lifetime.abort();
      const failures: unknown[] = [];
      try {
        options.retire();
      } catch (error) {
        failures.push(error);
      }
      // Whatever ended the view, nothing it showed may outlast its connection. Only a start that
      // failed keeps something on screen: the failure, which is known only after the connection
      // has ended (see below).
      if (startupFailure === undefined) {
        try {
          leave();
        } catch (error) {
          reportError(error, 'teardown');
        }
      }
      queueMicrotask(() => {
        void running.dispose().then(() => {
          if (!failureShown) {
            try {
              leave();
            } catch (error) {
              reportError(error, 'teardown');
            }
          }
        });
      });
      // Every step ran; the runner reports the first thing that threw and still ends the connection.
      if (failures.length > 0) throw failures[0];
    },
    onFailure(failure) {
      const startFailure = startFailureOf(failure);
      if (startFailure.kind !== 'disposed')
        failureShown = options.showFailure?.(startFailure) ?? false;
    },
    onError: options.onError ?? ((error, phase) => reportError(error, phase)),
  });

  const readiness = running.ready.then(
    () => undefined,
    (failure: unknown) => {
      throw startFailureOf(failure);
    },
  );
  readiness.catch(() => undefined);

  return {
    ready: readiness,
    async dispose() {
      await running.dispose();
      try {
        leave();
      } catch (error) {
        reportError(error, 'teardown');
      }
    },
  };
}

/**
 * The view of a start that failed before it connected to anything (an invalid embedded policy):
 * its failure is already on screen, `ready` rejects with it, and disposing it removes it.
 */
export function viewFailedBeforeConnecting(options: {
  readonly failure: StartFailure;
  readonly unmount: () => void;
  readonly releaseContainer: () => void;
  readonly onError?: (error: unknown, phase: ErrorPhase) => void;
}): RunningView {
  let onScreen = true;
  const ready = Promise.reject<void>(options.failure);
  ready.catch(() => undefined);
  return {
    ready,
    async dispose() {
      if (!onScreen) return;
      onScreen = false;
      try {
        options.unmount();
      } catch (error) {
        try {
          (options.onError ?? ((e) => console.error(e)))(error, 'teardown');
        } catch {
          // Nothing more to do for a reporter that throws.
        }
      } finally {
        options.releaseContainer();
      }
    },
  };
}

/**
 * The view of a start whose application callback threw before anything ran: the stack already took
 * back what it had made and freed the container, so `ready` rejects with the failure and there is
 * nothing left to dispose.
 */
export function viewThatNeverStarted(cause: unknown): RunningView {
  const ready = Promise.reject<void>(new StartFailure('application', cause));
  ready.catch(() => undefined);
  return { ready, dispose: () => Promise.resolve() };
}
