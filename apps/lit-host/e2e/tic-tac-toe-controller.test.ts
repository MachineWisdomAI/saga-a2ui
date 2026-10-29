import { describe, expect, it, vi } from 'vitest';
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
  it('does not offer squares from an unverified saved result when the current-game read fails', async () => {
    let offline = true;
    const { controller, playable, last } = attachedController({
      callServerTool: async () => {
        if (offline) throw new Error('offline');
        return { content: [], structuredContent: { game: gameAfter(OLD, []) } };
      },
    });
    controller.present(gameAfter(OLD, []), 'select');
    await controller.refresh();
    expect(playable()).toBe(0);
    offline = false;
    await controller.refresh();
    expect(playable()).toBe(9);
    expect(last().status).toBe(VIEW_TEXT.yourTurn);
    controller.retire();
  });

  it('turns the squares off while the read is in flight, and on again when it settles', async () => {
    const { server, held } = heldServer();
    const { controller, playable } = attachedController(server);
    controller.present(gameAfter(OLD, []), 'select');
    expect(playable()).toBe(9);

    const recovery = controller.refresh();
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
    const recovery = controller.refresh();
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
    const recovery = controller.refresh();
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
    const first = controller.refresh();
    const second = controller.refresh();

    held[0]?.(gameAfter(OLD, []));
    await first;
    expect(playable()).toBe(0); // the second read is still out

    held[1]?.(gameAfter(OLD, []));
    await second;
    expect(playable()).toBe(9);
  });
});

describe('waiting for a host-confirmed assistant turn', () => {
  it('updates the same board after a confirmation takes three minutes, and stops reading on retirement', async () => {
    vi.useFakeTimers();
    let game = gameAfter(OLD, [4]);
    let reads = 0;
    const server: GameServer = {
      callServerTool: async () => {
        reads += 1;
        return { content: [], structuredContent: { game } };
      },
    };
    const { controller, playable, last } = attachedController(server);
    try {
      controller.present(game, 'select');
      controller.startWait();
      await vi.advanceTimersByTimeAsync(180_000);
      game = gameAfter(OLD, [4, 0]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(controller.current()?.moveNumber).toBe(2);
      expect(playable()).toBe(7);
      expect(last().canCheck).toBe('');
      controller.retire();
      const before = reads;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reads).toBe(before);
    } finally {
      controller.retire();
      vi.useRealTimers();
    }
  });
});

it('stops repeated failed reads and reports a connection problem without claiming O has not played', async () => {
  vi.useFakeTimers();
  let reads = 0;
  const { controller, last } = attachedController({
    callServerTool: async () => {
      reads++;
      throw new Error('offline');
    },
  });
  try {
    controller.present(gameAfter(OLD, [4]), 'select');
    controller.startWait();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(last().status).toBe(
      'Could not read the game. Check the connection.',
    );
    expect(last().canCheck).toBe('yes');
    expect(reads).toBe(40);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads).toBe(40);
  } finally {
    controller.retire();
    vi.useRealTimers();
  }
});
