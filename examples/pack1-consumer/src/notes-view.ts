import type { LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { a2uiV0_9Decoder, createMessageSession } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createA2uiAppElement, defineElements } from '@saga-a2ui/lit';
import { ActionButton, createLitActions } from '@saga-a2ui/lit/actions';
import { connectToolResultView } from '@saga-a2ui/mcp/view';
import { createNotesActions } from './notes-actions.js';
import { ownEntries } from './notes-catalog.js';
import { NotesOutputSchema } from './notes-contract.js';
import { RowHolds } from './row-holds.js';
import { CATALOG_ID, SURFACE_ID, notesData, notesSurface, ownBody, statusAt, type BodyEntry } from './notes-surface.js';

// The composition shared by both consumers. The own-catalog consumer calls it with nothing else;
// the second consumer adds one optional component through `extension`. Everything here uses
// public package exports, and the page it builds is served by server/notes-server.ts as the MCP
// App view of `list_notes`.

export interface NotesExtension {
  /** Extra catalog entries (the optional FaithfulCard), already registered with `defineElements`. */
  readonly entries: readonly LitComponentApi[];
  readonly body: BodyEntry;
  /** Runs when the notes element connects; the returned function runs when it disconnects. */
  connected?(element: HTMLElement): () => void;
}

export const PROBLEM_TEXT = 'Your notes could not be shown.';
export const CLOSED_TEXT = 'This view was closed.';
const WAITING_TEXT = 'Waiting for your notes…';

/** `extension` is a function of the bridge so an optional component can use the host (for links). */
export async function startNotesView(extension?: (app: App) => NotesExtension): Promise<void> {
  const app = new App({ name: 'pack1-notes-view', version: '0.0.0' });
  const added: NotesExtension = extension?.(app) ?? { entries: [], body: ownBody };
  const entries = [...ownEntries, ...added.entries];
  const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', entries);
  defineElements(entries);

  const status = document.querySelector('[data-testid="view-status"]');
  const readLog = document.querySelector('[data-testid="read-log"]');
  const say = (text: string): void => void (status && (status.textContent = text));
  say(WAITING_TEXT);
  const read: string[] = [];

  const element = (): (HTMLElement & { ingest(input: unknown): unknown }) | null => document.querySelector('notes-app');
  const holdsPending = document.querySelector('[data-testid="holds-pending"]');
  const holdsConfirmed = document.querySelector('[data-testid="holds-confirmed"]');
  const holds = new RowHolds((pending, confirmed) => {
    if (holdsPending) holdsPending.textContent = pending.join(',');
    if (holdsConfirmed) holdsConfirmed.textContent = confirmed.join(',');
  });
  const actions = createNotesActions({
    holds,
    transport: app,
    present: (dataPath, text) => void element()?.ingest(statusAt(dataPath, text)),
    recordRead: (noteId) => {
      read.push(noteId);
      if (readLog) readLog.textContent = read.join(',');
    },
  });

  class NotesApp extends createA2uiAppElement({
    createSession: () => createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder }),
    initialInput: notesSurface(added.body),
    surfaceId: SURFACE_ID,
    actions: createLitActions({
      // The same two definitions are bound to every rendered row: directly, through each instance's own handle.
      attach: (view) => {
        view.watchById('row-archive', ActionButton, (handle) => void handle.bindAction('activate', actions.archiveNote, { subject: () => handle.read('id') }));
        view.watchById('row-read', ActionButton, (handle) => void handle.bindAction('activate', actions.markRead));
      },
      onSetupError: () => say(PROBLEM_TEXT),
    }),
  }) {
    #end?: () => void;
    override connectedCallback() {
      this.#end = added.connected?.(this);
      super.connectedCallback();
    }
    override disconnectedCallback() {
      super.disconnectedCallback();
      this.#end?.();
      this.#end = undefined;
    }
  }
  customElements.define('notes-app', NotesApp);

  const show = (result: { readonly isError?: boolean; readonly structuredContent?: unknown }): void => {
    const parsed = result.isError === true ? undefined : NotesOutputSchema.safeParse(result.structuredContent);
    element()?.ingest(notesData(parsed?.success ? parsed.data.notes : []));
    say(parsed?.success ? 'Your notes' : PROBLEM_TEXT);
  };

  // The application's one way to end its view, for a host teardown and for the page going away
  // alike. Removing the notes element disposes its bindings (local actions, the optional card)
  // and cancels what is still undecided, so a retained button no longer does anything. Idempotent.
  let retired = false;
  const retire = (): void => {
    if (retired) return;
    retired = true;
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
