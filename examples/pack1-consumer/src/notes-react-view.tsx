import type { ReactCatalogComponent } from '@a2ui/react/v0_9';
import { Catalog } from '@a2ui/web_core/v0_9';
import {
  ActionButton,
  createReactActions,
  startA2uiView,
} from '@saga-a2ui/react-mcp-stack';
import { createNotesController } from './notes-controller.js';
import { VIEW_TEXT } from './notes-contract.js';
import { notesReactEntries } from './notes-react-catalog.js';
import { CATALOG_ID, notesLayout, ownBody } from './notes-surface.js';

// The React composition of the notes view: the same application, contract, actions, controller and
// server as the Lit consumers, with a catalog of React components of its own. The React stack
// connects to the host, holds early results, renders the surface under one action scope and
// unmounts it, which is the explicit teardown of every instance and binding beneath it. The page it
// builds is served by server/notes-server.ts as the MCP App view of `list_notes`.

export function startNotesReactView(): Promise<void> {
  const container = document.getElementById('root');
  if (container === null) throw new Error('The page has no #root element.');

  const catalog = new Catalog<ReactCatalogComponent>(CATALOG_ID, 'v0.9', [
    ...notesReactEntries,
  ]);
  const controller = createNotesController();

  const view = startA2uiView({
    container,
    layout: notesLayout(ownBody),
    catalog,
    actions: (host) => {
      const actions = controller.actions(host.server);
      return createReactActions({
        // The same two definitions are bound to every rendered row, directly, through each instance's own handle.
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
    onTeardown: () => controller.retire(),
  });
  return view.ready;
}
