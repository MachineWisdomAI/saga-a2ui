import type { ViewErrorPhase, ViewFailureKind } from '@saga-a2ui/mcp/view';

/**
 * Why a view did not become ready.
 *
 * - `policy`: the embedded content policy is malformed or not valid; no connection was made.
 * - `connect`: the handshake with the host failed.
 * - `ready`: the application's own readiness work rejected.
 * - `application`: an application callback threw while the view was starting. Cleanup completed
 *   before this was reported.
 * - `disposed`: the view was ended (dispose, host teardown or `pagehide`) before it was ready.
 */
export type StartFailureKind = 'policy' | ViewFailureKind;

/** The reason `ready` rejects. */
export class StartFailure extends Error {
  constructor(
    readonly kind: StartFailureKind,
    readonly cause?: unknown,
  ) {
    super(`The view did not become ready (${kind}).`);
    this.name = 'StartFailure';
  }
}

/** Where an application callback threw after the view was ready. */
export type ErrorPhase = ViewErrorPhase;

/** Misuse of `start`, thrown before any connection is made. */
export type StartMisuse = 'container-missing' | 'container-busy';

export class StartError extends Error {
  constructor(readonly code: StartMisuse) {
    super(
      code === 'container-busy'
        ? 'container-busy: a view is already running in this container; dispose it first.'
        : 'container-missing: the container is missing or not attached to the document.',
    );
    this.name = 'StartError';
  }
}
