import type { HostLinks } from '@saga-a2ui/core/host-links';
import {
  ActionButton,
  createLitActions,
  startA2uiView,
} from '@saga-a2ui/lit-mcp-stack';
import { createNotesController } from './notes-controller.js';
import { notesCatalog, type CatalogEntry } from './notes-catalog.js';
import { VIEW_TEXT } from './notes-contract.js';
import { notesLayout, ownBody, type BodyEntry } from './notes-surface.js';

// The Lit composition shared by both Lit consumers. The own-catalog consumer calls it with nothing
// else; the second consumer adds one optional component through `extension`. Everything here uses
// public package exports, and the page it builds is served by server/notes-server.ts as the MCP
// App view of `list_notes`. The Lit stack connects to the host, holds early results, defines the
// catalog's elements and ends the view; what does not depend on the renderer is notes-controller.ts.

export interface NotesExtension {
  /** Extra catalog entries (the optional FaithfulCard). The stack defines their elements. */
  readonly entries: readonly CatalogEntry[];
  readonly body: BodyEntry;
  /** Runs before the view starts, with the element it will render in; the returned function runs when the view ends. */
  connected?(container: HTMLElement): () => void;
}

/** `extension` is a function of the host's link opener so an optional component can use the host (for links). */
export function startNotesView(
  extension?: (hostLinks: HostLinks) => NotesExtension,
): Promise<void> {
  // The host's link opener exists once the view starts; the card asks for it only when a link is activated.
  let links: HostLinks | undefined;
  const hostLinks: HostLinks = {
    open: (url) => links?.open(url) ?? Promise.resolve('unavailable'),
  };
  const added: NotesExtension = extension?.(hostLinks) ?? {
    entries: [],
    body: ownBody,
  };
  const container = document.querySelector<HTMLElement>('notes-app');
  if (container === null) throw new Error('The page has no notes-app element.');
  const controller = createNotesController();
  const endExtension = added.connected?.(container);

  const view = startA2uiView({
    container,
    layout: notesLayout(added.body),
    catalog: notesCatalog(added.entries),
    actions: (host) => {
      links = host.links;
      const actions = controller.actions(host.server);
      return createLitActions({
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
      });
    },
    onToolResult: (result, running) => controller.show(result, running.surface),
    onTeardown: () => {
      endExtension?.();
      controller.retire();
    },
  });
  return view.ready;
}
