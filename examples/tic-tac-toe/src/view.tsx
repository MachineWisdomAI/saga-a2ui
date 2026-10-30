import {
  ActionButton,
  createReactActions,
  startA2uiView,
  type HostLinks,
} from '@saga-a2ui/react-mcp-stack';
import { createGameActions } from './actions.js';
import { createBoardCatalog } from './catalog.js';
import { createGameController, readGameReply } from './controller.js';
import { boardSurface, CHECK_ID, NEW_GAME_ID, SQUARE_ID } from './surface.js';
import { VIEW_TEXT } from './text.js';

// The composition root of the view. It uses public package exports only, and the page it builds is
// served by server/operations.ts as the MCP App view of `new_game` and `show_game`. The React stack
// connects to the host, holds a result that arrives early, presents the surface over the catalog and
// ends the view when the host or the page does. This file states only the application's own
// decisions: which components exist (catalog.tsx), which action each control has (below), what a
// result means and what ending the view takes with it.

export async function startView(): Promise<void> {
  const container = document.getElementById('root');
  if (container === null) throw new Error('the page has no #root');

  // The server is the host's proxy, so the controller is built once the stack hands it over.
  let controller: ReturnType<typeof createGameController> | undefined;
  const ready = (): ReturnType<typeof createGameController> => {
    if (controller === undefined) throw new Error('the view has not started');
    return controller;
  };

  // The host's way to open a link, for the framework credit. The stack hands it over when the view
  // starts, before the board first renders.
  let links: HostLinks | undefined;

  const view = startA2uiView({
    container,
    layout: boardSurface,
    catalog: createBoardCatalog(() => links),
    identity: { name: 'saga-tic-tac-toe-view', version: '0.0.0' },
    actions: (host) => {
      links = host.links;
      controller = createGameController(host.server);
      const game = controller;
      const actions = createGameActions(host, game);
      return createReactActions({
        // Runs once for each presented surface. One definition is attached to each rendered
        // control: the nine squares share the square action, each keeping its own state.
        // #region saga-snippet:bind-action
        attach: (surfaceView) => {
          surfaceView.watchById(
            SQUARE_ID,
            ActionButton,
            (handle) =>
              void handle.bindAction('activate', actions.playSquare, {
                // The game and move number on screen: when either changes, a request still
                // in flight for the old one can no longer reach the board.
                subject: () => game.subject(),
              }),
          );
          surfaceView.watchById(
            NEW_GAME_ID,
            ActionButton,
            (handle) => void handle.bindAction('activate', actions.newGame),
          );
          surfaceView.watchById(
            CHECK_ID,
            ActionButton,
            (handle) =>
              void handle.bindAction('activate', actions.checkForMove, {
                subject: () => game.subject(),
              }),
          );
        },
        // #endregion saga-snippet:bind-action
        onSetupError: () => game.say(VIEW_TEXT.problem),
      });
    },
    // The result that opened the card, and any later one a host delivers to it, selects its game.
    onToolResult: (result, running) => {
      const game = ready();
      game.attach(running.surface);
      const read = readGameReply(result);
      if (read.kind === 'game') {
        game.present(read.game, 'select');
        // Hosts can replay an old result when remounting a card. Read the current game before
        // offering squares, including when the saved snapshot says it is X's turn.
        void game.refresh();
      } else
        game.say(read.kind === 'gone' ? VIEW_TEXT.gone : VIEW_TEXT.problem);
    },
    // The stack has retired the surface, which ended its action bindings, before this runs. This
    // ends only what the application owns itself: the wait.
    onTeardown: () => controller?.retire(),
  });
  await view.ready;
}
