import type { ActionBinding } from '@saga-a2ui/core/actions';
import {
  ActionButton,
  createLitActions,
  startA2uiView,
  type BoundSurface,
} from '@saga-a2ui/lit-mcp-stack';
import { createStarterActions } from './actions.js';
import { starterCatalog } from './catalog.js';
import { AccountOutputSchema, StatusOutputSchema } from './contract.js';
import { CLEAR_ID, starterSurface, type StarterData } from './surface.js';

// The composition root of the view. It uses public package exports only, and the page it builds is
// served by server/operations.ts as the MCP App view of both operations. The Lit stack connects to
// the host, holds a result that arrives early, presents the surface over the catalog and ends the
// view when the host or the page does. This file states only the application's own decisions:
// which components exist (catalog.ts), which action each control has (below), what a result means
// and what ending the view takes with it.

export const PROBLEM_TEXT = 'This could not be shown.';
/** A successful result this view's contract does not accept comes from a server of another build. */
export const MISMATCH_TEXT =
  'This could not be shown: the view and its server are from different builds. Reopen it; if this continues, update the server and the view together.';
export const CLOSED_TEXT = 'This view was closed.';

function requireElement<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`the page has no ${selector}`);
  return found;
}

export async function startView(): Promise<void> {
  const status = requireElement('[data-testid="view-status"]');
  const say = (text: string): void => void (status.textContent = text);
  const actions = createStarterActions({
    noteInput: requireElement<HTMLInputElement>('[data-testid="note"]'),
  });

  // What the application must end itself. The binding is the attachment of one definition to one
  // rendered control; the discovery subscription finds that control. Ending a binding stops the
  // control reacting. It does not prove that work a server action started has stopped: the
  // application owns whatever such work holds.
  const bindings: ActionBinding[] = [];
  const stopWatching: Array<() => void> = [];

  const show = (
    result: {
      readonly isError?: boolean;
      readonly structuredContent?: unknown;
    },
    surface: BoundSurface<StarterData>,
  ): void => {
    const account =
      result.isError === true
        ? undefined
        : AccountOutputSchema.safeParse(result.structuredContent);
    const running =
      result.isError === true || account?.success
        ? undefined
        : StatusOutputSchema.safeParse(result.structuredContent);
    const headline = account?.success
      ? `Signed in as ${account.data.accountId}`
      : running?.success
        ? 'The service is running'
        : '';
    surface.update({ headline });
    say(
      result.isError === true
        ? PROBLEM_TEXT
        : headline === ''
          ? MISMATCH_TEXT
          : 'Ready',
    );
  };

  // The application's one way to end what it holds: the discovery ends, then every binding, so a
  // retained button no longer does anything. The stack calls it once, after the surface has left
  // the page and before the connection ends, on a host teardown request and on the page going away
  // alike.
  const retire = (): void => {
    for (const stop of stopWatching.splice(0)) stop();
    for (const binding of bindings.splice(0)) binding.dispose();
    say(CLOSED_TEXT);
  };

  // The first result is shown once the view is ready; a later one replaces what is shown.
  const view = startA2uiView({
    container: requireElement('starter-app'),
    layout: starterSurface,
    catalog: starterCatalog,
    identity: { name: 'saga-starter-view', version: '0.0.0' },
    actions: createLitActions({
      // #region saga-snippet:bind-action
      // Runs once for each presented surface. The same definition could be attached to any number
      // of controls; here it is attached directly to the one rendered Clear control.
      attach: (surfaceView) => {
        stopWatching.push(
          surfaceView.watchById(CLEAR_ID, ActionButton, (handle) => {
            bindings.push(handle.bindAction('activate', actions.clearNote));
          }),
        );
      },
      // #endregion saga-snippet:bind-action
      onSetupError: () => say(PROBLEM_TEXT),
    }),
    onToolResult: (result, running) => show(result, running.surface),
    onTeardown: retire,
  });
  await view.ready;
}
