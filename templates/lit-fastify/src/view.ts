import type { LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import type { ActionBinding } from '@saga-a2ui/core/actions';
import { a2uiV0_9Decoder, createMessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createA2uiAppElement, defineElements } from '@saga-a2ui/lit';
import { ActionButton, createLitActions } from '@saga-a2ui/lit/actions';
import { connectToolResultView } from '@saga-a2ui/mcp/view';
import { createStarterActions } from './actions.js';
import { starterEntries } from './catalog.js';
import { AccountOutputSchema, StatusOutputSchema } from './contract.js';
import { CATALOG_ID, CLEAR_ID, SURFACE_ID, headlineData, starterSurface } from './surface.js';

// The composition root of the view. It uses public package exports only, and the page it builds is
// served by server/operations.ts as the MCP App view of both operations. The application decides
// which components exist (catalog.ts), which action each control has (below) and when the view ends.

export const PROBLEM_TEXT = 'This could not be shown.';
/** A successful result this view's contract does not accept comes from a server of another build. */
export const MISMATCH_TEXT = 'This could not be shown: the view and its server are from different builds. Reopen it; if this continues, update the server and the view together.';
export const CLOSED_TEXT = 'This view was closed.';

function requireElement<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (found === null) throw new Error(`the page has no ${selector}`);
  return found;
}

export async function startView(): Promise<void> {
  const app = new App({ name: 'saga-starter-view', version: '0.0.0' });
  const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', [...starterEntries]);
  defineElements(starterEntries);

  const status = requireElement('[data-testid="view-status"]');
  const say = (text: string): void => void (status.textContent = text);
  const actions = createStarterActions({ noteInput: requireElement<HTMLInputElement>('[data-testid="note"]') });
  const element = (): (HTMLElement & { ingest(input: unknown): unknown }) | null => document.querySelector('starter-app');

  // What the application must end itself. The binding is the attachment of one definition to one
  // rendered control; the discovery subscription finds that control. Ending a binding stops the
  // control reacting. It does not prove that work a server action started has stopped: the
  // application owns whatever such work holds.
  const bindings: ActionBinding[] = [];
  const stopWatching: Array<() => void> = [];

  customElements.define(
    'starter-app',
    createA2uiAppElement({
      createSession: () => createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder }),
      initialInput: starterSurface,
      surfaceId: SURFACE_ID,
      actions: createLitActions({
        // #region saga-snippet:bind-action
        // Runs once for each presented surface. The same definition could be attached to any number
        // of controls; here it is attached directly to the one rendered Clear control.
        attach: (view) => {
          stopWatching.push(
            view.watchById(CLEAR_ID, ActionButton, (handle) => {
              bindings.push(handle.bindAction('activate', actions.clearNote));
            }),
          );
        },
        // #endregion saga-snippet:bind-action
        onSetupError: () => say(PROBLEM_TEXT),
      }),
    }),
  );

  const show = (result: { readonly isError?: boolean; readonly structuredContent?: unknown }): void => {
    const account = result.isError === true ? undefined : AccountOutputSchema.safeParse(result.structuredContent);
    const running = result.isError === true || account?.success ? undefined : StatusOutputSchema.safeParse(result.structuredContent);
    const headline = account?.success ? `Signed in as ${account.data.accountId}` : running?.success ? 'The service is running' : '';
    element()?.ingest(headlineData(headline));
    say(result.isError === true ? PROBLEM_TEXT : headline === '' ? MISMATCH_TEXT : 'Ready');
  };

  // The application's one way to end its view, for a host teardown and for the page going away
  // alike. Idempotent: the first call ends the discovery, then every binding, then removes the
  // element, so a retained button no longer does anything.
  let retired = false;
  const retire = (): void => {
    if (retired) return;
    retired = true;
    for (const stop of stopWatching.splice(0)) stop();
    for (const binding of bindings.splice(0)) binding.dispose();
    element()?.remove();
    say(CLOSED_TEXT);
  };

  const connection = await connectToolResultView({
    app,
    transport: new PostMessageTransport(window.parent, window.parent),
    onToolResult: show,
    // The host is closing this view; it ends the connection itself once it has the answer.
    onTeardown: retire,
  });
  // The page is going away: end the application's bindings first, then the connection.
  addEventListener('pagehide', () => {
    retire();
    connection.dispose();
  });
}
