import { describe, expect, it } from 'vitest';
import {
  applyMove,
  emptyGame,
} from '../../../examples/tic-tac-toe/server/rules.js';
import {
  createGameController,
  type BoardSurface,
  type GameServer,
} from '../../../examples/tic-tac-toe/src/controller.js';
import type { Game } from '../../../examples/tic-tac-toe/src/contract.js';
import type { BoardData } from '../../../examples/tic-tac-toe/src/surface.js';
import { VIEW_TEXT } from '../../../examples/tic-tac-toe/src/text.js';

// The tic-tac-toe board's controller without React or a browser: which squares it offers while a
// recovery read is in flight. The reads are held and released by the test, so nothing here depends
// on a clock.

/** A game after the given squares have been played in turn, starting with X. */
function gameAfter(gameId: string, squares: readonly number[]): Game {
  let state = emptyGame();
  for (const square of squares) {
    const result = applyMove(state, {
      player: state.turn,
      square,
      expectedMoveNumber: state.moveNumber,
    });
    if (!result.ok) throw new Error(`move ${square} was refused`);
    state = result.state;
  }
  return { gameId, ...state };
}

const OLD = 'old-game-identifier-0001';
const NEW = 'new-game-identifier-0002';

/** A server whose `get_game` answers wait until the test releases them. */
function heldServer() {
  const held: ((game: Game) => void)[] = [];
  const server: GameServer = {
    callServerTool: () =>
      new Promise((resolve) => {
        held.push((game) =>
          resolve({ content: [], structuredContent: { game } }),
        );
      }),
  };
  return { server, held };
}

function attachedController(server: GameServer) {
  const controller = createGameController(server);
  const drawn: BoardData[] = [];
  const surface: BoardSurface = { update: (data) => void drawn.push(data) };
  controller.attach(surface);
  const last = (): BoardData => {
    const data = drawn.at(-1);
    if (data === undefined) throw new Error('nothing was drawn');
    return data;
  };
  const playable = (): number =>
    last().squares.filter((square) => square.playable === 'yes').length;
  return { controller, last, playable };
}

describe('the recovery read of the tic-tac-toe board', () => {
  it('turns the squares off while the read is in flight, and on again when it settles', async () => {
    const { server, held } = heldServer();
    const { controller, playable } = attachedController(server);
    controller.present(gameAfter(OLD, []), 'select');
    expect(playable()).toBe(9);

    const recovery = controller.recover();
    expect(playable()).toBe(0);

    held[0]?.(gameAfter(OLD, [])); // the move did not land: still X to play
    await recovery;
    expect(playable()).toBe(9);
  });

  it('does not let an old game’s read disable the new game, before or after it settles', async () => {
    const { server, held } = heldServer();
    const { controller, last, playable } = attachedController(server);
    controller.present(gameAfter(OLD, [4, 0]), 'select');

    // The reply to a move was lost; the recovery read for the old game is held.
    const recovery = controller.recover();
    expect(playable()).toBe(0);

    // The person starts a new game while that read is still outstanding.
    controller.present(gameAfter(NEW, []), 'select');
    expect(controller.current()?.gameId).toBe(NEW);
    expect(playable()).toBe(9);

    // The old read settles, and it neither changes the board nor takes the squares away.
    held[0]?.(gameAfter(OLD, [4, 0, 8]));
    await recovery;
    expect(controller.current()?.gameId).toBe(NEW);
    expect(playable()).toBe(9);
    expect(last().status).toBe(VIEW_TEXT.yourTurn);
  });

  it('does not start a wait or leave a note for the old game when its read settles late', async () => {
    const { server, held } = heldServer();
    const { controller, last } = attachedController(server);
    controller.present(gameAfter(OLD, [4]), 'select'); // O to play
    const recovery = controller.recover();
    controller.present(gameAfter(NEW, []), 'select');

    held[0]?.(gameAfter(OLD, [4])); // the old game is still waiting for O
    await recovery;

    expect(last().status).toBe(VIEW_TEXT.yourTurn);
    expect(held).toHaveLength(1); // no further read was started for the old game
    controller.retire();
  });

  it('keeps a second read for the same game from ending the first one’s hold early', async () => {
    const { server, held } = heldServer();
    const { controller, playable } = attachedController(server);
    controller.present(gameAfter(OLD, []), 'select');
    const first = controller.recover();
    const second = controller.recover();

    held[0]?.(gameAfter(OLD, []));
    await first;
    expect(playable()).toBe(0); // the second read is still out

    held[1]?.(gameAfter(OLD, []));
    await second;
    expect(playable()).toBe(9);
  });
});
