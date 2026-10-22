import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

// A view's first render is part of starting it: the application's chrome or catalog components
// run in it, and a throw there is an application callback that threw during startup. React reports
// such a throw asynchronously (to `window` by default) and unmounts the tree, so left alone the
// view would be "ready" with nothing on screen. This renders the first tree synchronously and
// hands the throw back, so the caller can end the start as `StartFailure('application')` after
// its own cleanup. Throws after the first render keep React's own reporting.

export interface StackRoot {
  readonly root: Root;
  /**
   * Renders `tree` now. Returns the throw that React reported while doing so, if any; the root
   * is then empty and the caller owns the cleanup.
   */
  renderInitially(tree: ReactNode): { readonly cause: unknown } | undefined;
}

/** What React does with an error nothing caught, when the root is not told otherwise. */
function reportLikeReact(error: unknown): void {
  if (typeof globalThis.reportError === 'function')
    globalThis.reportError(error);
  else console.error(error);
}

export function openStackRoot(container: Element): StackRoot {
  let initial: { readonly cause: unknown } | undefined;
  let rendering = false;
  const root = createRoot(container, {
    onUncaughtError(error) {
      if (!rendering) reportLikeReact(error);
      else initial ??= { cause: error };
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
