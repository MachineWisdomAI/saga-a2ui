import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { ErrorPhase } from './start-failure.js';

// A view's first render is part of starting it: the application's chrome or catalog components
// run in it, and a throw there is an application callback that threw during startup. React reports
// such a throw asynchronously (to `window` by default) and unmounts the tree, so left alone the
// view would be "ready" with nothing on screen. This renders the first tree synchronously and
// hands the throw back, so the caller can end the start as `StartFailure('application')` after
// its own cleanup.
//
// A throw in a later render (the chrome or a component rendering a result) is an application
// callback that threw after the view was ready: it goes to the view's `onError` with phase
// `result`, the render that the delivered result caused. React still unmounts the tree it could
// not render, and nothing the application already changed is rolled back.

export interface StackRoot {
  readonly root: Root;
  /**
   * Renders `tree` now. Returns the throw that React reported while doing so, if any; the root
   * is then empty and the caller owns the cleanup.
   */
  renderInitially(tree: ReactNode): { readonly cause: unknown } | undefined;
}

export function openStackRoot(
  container: Element,
  onError: ((error: unknown, phase: ErrorPhase) => void) | undefined,
): StackRoot {
  let initial: { readonly cause: unknown } | undefined;
  let rendering = false;
  const root = createRoot(container, {
    onUncaughtError(error) {
      if (rendering) {
        initial ??= { cause: error };
        return;
      }
      try {
        (onError ?? ((reported: unknown) => console.error(reported)))(
          error,
          'result',
        );
      } catch {
        // A reporter that throws must not break React's own cleanup of the failed tree.
      }
    },
  });
  return {
    root,
    renderInitially(tree) {
      rendering = true;
      try {
        flushSync(() => root.render(tree));
      } finally {
        rendering = false;
      }
      return initial;
    },
  };
}
