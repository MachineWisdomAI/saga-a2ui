import type { LitComponentApi } from '@a2ui/lit/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import { App } from '@modelcontextprotocol/ext-apps';
import {
  a2uiV0_9Decoder,
  createMessageSession,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createA2uiAppElement, defineElements } from '@saga-a2ui/lit';
import { ActionButton, createLitActions } from '@saga-a2ui/lit/actions';
import { createNotesController } from './notes-controller.js';
import { ownEntries } from './notes-catalog.js';
import { VIEW_TEXT } from './notes-contract.js';
import {
  CATALOG_ID,
  notesLayout,
  ownBody,
  type BodyEntry,
  type NotesData,
} from './notes-surface.js';

// The Lit composition shared by both Lit consumers. The own-catalog consumer calls it with nothing
// else; the second consumer adds one optional component through `extension`. Everything here uses
// public package exports, and the page it builds is served by server/notes-server.ts as the MCP
// App view of `list_notes`. What does not depend on the renderer is notes-controller.ts.

export interface NotesExtension {
  /** Extra catalog entries (the optional FaithfulCard), already registered with `defineElements`. */
  readonly entries: readonly LitComponentApi[];
  readonly body: BodyEntry;
  /** Runs when the notes element connects; the returned function runs when it disconnects. */
  connected?(element: HTMLElement): () => void;
}

/** `extension` is a function of the bridge so an optional component can use the host (for links). */
export async function startNotesView(
  extension?: (app: App) => NotesExtension,
): Promise<void> {
  const app = new App({ name: 'pack1-notes-view', version: '0.0.0' });
  const added: NotesExtension = extension?.(app) ?? {
    entries: [],
    body: ownBody,
  };
  const entries = [...ownEntries, ...added.entries];
  const catalog = new Catalog<LitComponentApi>(CATALOG_ID, 'v0.9', entries);
  defineElements(entries);

  const element = ():
    | (HTMLElement & {
        updateData(data: NotesData): unknown;
        relay(messages: unknown[]): unknown;
      })
    | null => document.querySelector('notes-app');
  const controller = createNotesController(app, {
    show: (data) => void element()?.updateData(data),
    ingest: (messages) => void element()?.relay(messages),
    remove: () => element()?.remove(),
  });
  const { actions } = controller;

  class NotesApp extends createA2uiAppElement({
    createSession: () =>
      createMessageSession({ catalogs: [catalog], decoder: a2uiV0_9Decoder }),
    layout: notesLayout(added.body),
    actions: createLitActions({
      // The same two definitions are bound to every rendered row: directly, through each instance's own handle.
      attach: (view) => {
        view.watchById(
          'row-archive',
          ActionButton,
          (handle) =>
            void handle.bindAction('activate', actions.archiveNote, {
              subject: () => handle.read('id'),
            }),
        );
        view.watchById(
          'row-read',
          ActionButton,
          (handle) => void handle.bindAction('activate', actions.markRead),
        );
      },
      onSetupError: () => controller.say(VIEW_TEXT.problem),
    }),
  }) {
    #end?: () => void;
    /** Applies the row-status messages the controller writes; a layout's update cannot express them. */
    relay(messages: unknown[]): void {
      this.ingest(messages);
    }
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

  await controller.connect();
}
