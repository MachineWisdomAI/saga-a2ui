import type { ReactActions } from '@saga-a2ui/react/actions';
import { createElement, useEffect, type ReactNode } from 'react';
import { applicationFailureError } from './application-call.js';

// The application's action setup (`createReactActions`) runs in an effect of the first mount, and
// the actions boundary swallows a throw from it once the application's sink has heard it: nothing
// rejects and nothing is rendered, so on its own a start would be "ready" with an empty view. The
// setup is the application's own callback running while the view starts, so the stack watches it
// without taking it over. The sink still hears every error first; the stack then holds readiness
// until the setup has been attempted and fails the start as `application` if it threw.

export interface WatchedActionSetup {
  /** The same actions, with their sink also telling the watch. */
  readonly actions: ReactActions;
  /** Shown beside the surface inside the actions scope: its effect runs after the setup's. */
  readonly marker: ReactNode;
  /**
   * Settles once the setup was attempted: resolves when it did not throw; rejects with the
   * application's failure (see `applicationFailureOf`) when it did. Settles at most once.
   */
  readonly attempted: Promise<void>;
}

function SetupAttempted(props: { readonly attempted: () => void }): null {
  const { attempted } = props;
  useEffect(() => attempted(), [attempted]);
  return null;
}

export function watchActionSetup(actions: ReactActions): WatchedActionSetup {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const attempted = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Handled here: whether anyone awaits readiness or not is not this promise's concern.
  attempted.catch(() => undefined);
  return {
    actions: Object.freeze({
      ...actions,
      onSetupError(error: unknown): void {
        try {
          actions.onSetupError(error);
        } finally {
          reject(applicationFailureError(error));
        }
      },
    }),
    marker: createElement(SetupAttempted, { attempted: resolve }),
    attempted,
  };
}
