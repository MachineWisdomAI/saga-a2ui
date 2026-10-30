import { describe, expect, it } from 'vitest';
import {
  createMemoryGameStore,
  type GameStore,
} from '../examples/tic-tac-toe/server/game-store.js';
import {
  applyMove,
  emptyGame,
  LINES,
  playerOnMove,
  type GameState,
  type Move,
} from '../examples/tic-tac-toe/server/rules.js';
import { GameSchema } from '../examples/tic-tac-toe/src/contract.js';

// The tic-tac-toe example's rules and its game store (examples/tic-tac-toe/server). Both are
// deterministic: no test here depends on a clock, a random number or an assistant's choice.

/** Freezes a game all the way down, so any attempt to change it throws in strict mode. */
function frozen<T>(value: T): T {
  if (typeof value === 'object' && value !== null)
    for (const inner of Object.values(value)) frozen(inner);
  return Object.freeze(value);
}

/** Plays moves for alternating players from the first move; every move must be accepted. */
function play(squares: readonly number[]): GameState {
  let state = emptyGame();
  for (const square of squares) {
    const result = applyMove(state, {
      player: state.turn,
      square,
      expectedMoveNumber: state.moveNumber,
    });
    if (!result.ok)
      throw new Error(`move ${square} was refused: ${result.reason}`);
    state = result.state;
  }
  return state;
}

const move = (state: GameState, square: number): Move => ({
  player: state.turn,
  square,
  expectedMoveNumber: state.moveNumber,
});

describe('the rules', () => {
  it('starts with an empty board and X to move', () => {
    expect(emptyGame()).toEqual({
      board: Array.from({ length: 9 }, () => null),
      turn: 'X',
      moveNumber: 0,
      status: 'playing',
      winner: null,
      line: null,
      history: [],
    });
  });

  it('alternates turns, X first, and records every move', () => {
    const afterOne = play([4]);
    expect(afterOne.turn).toBe('O');
    expect(afterOne.moveNumber).toBe(1);
    const afterTwo = play([4, 0]);
    expect(afterTwo.turn).toBe('X');
    expect(afterTwo.board[4]).toBe('X');
    expect(afterTwo.board[0]).toBe('O');
    expect(afterTwo.history).toEqual([
      { player: 'X', square: 4 },
      { player: 'O', square: 0 },
    ]);
    expect([0, 1, 2, 3].map(playerOnMove)).toEqual(['X', 'O', 'X', 'O']);
  });

  it('has the eight lines: three rows, three columns and two diagonals', () => {
    expect(LINES).toHaveLength(8);
    expect(new Set(LINES.map((line) => line.join())).size).toBe(8);
  });

  describe.each(LINES.map((line) => [line.join('-'), line] as const))(
    'the line %s',
    (_name, line) => {
      // The other player's squares come from outside the line and cannot complete a line themselves.
      const others = [0, 1, 2, 3, 4, 5, 6, 7, 8]
        .filter((square) => !line.includes(square))
        .slice(0, 2);

      it('is won by X, who then moves no more', () => {
        const state = play([line[0], others[0]!, line[1], others[1]!, line[2]]);
        expect(state.status).toBe('won');
        expect(state.winner).toBe('X');
        expect(state.line).toEqual([...line]);
        expect(state.moveNumber).toBe(5);
      });

      it('is won by O', () => {
        const spare = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(
          (square) => !line.includes(square),
        );
        // X plays three squares outside the line that do not make a line of their own.
        const x = pickNoLine(spare);
        const state = play([x[0]!, line[0], x[1]!, line[1], x[2]!, line[2]]);
        expect(state.status).toBe('won');
        expect(state.winner).toBe('O');
        expect(state.line).toEqual([...line]);
      });
    },
  );

  it('ends a full board with no line as a draw, on X’s ninth move', () => {
    // X O X / X O O / O X X
    const state = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(state.status).toBe('draw');
    expect(state.winner).toBeNull();
    expect(state.line).toBeNull();
    expect(state.moveNumber).toBe(9);
    expect(state.history.at(-1)).toEqual({ player: 'X', square: 8 });
  });

  it('counts a line completed by the ninth move as a win, not a draw', () => {
    // X O X / O X O / O X X: the last move completes the 0-4-8 diagonal.
    const state = play([0, 1, 2, 5, 4, 3, 7, 6, 8]);
    expect(state.status).toBe('won');
    expect(state.winner).toBe('X');
    expect(state.line).toEqual([0, 4, 8]);
  });

  describe('refusals leave the game exactly as it was', () => {
    const refuse = (state: GameState, attempt: Move, reason: string) => {
      const before = structuredClone(state);
      const result = applyMove(frozen(structuredClone(state)), attempt);
      expect(result).toEqual({ ok: false, reason });
      expect(state).toEqual(before);
    };

    it('refuses the wrong player’s turn', () => {
      const state = play([4]);
      refuse(state, { ...move(state, 0), player: 'X' }, 'not_your_turn');
      refuse(
        emptyGame(),
        { ...move(emptyGame(), 0), player: 'O' },
        'not_your_turn',
      );
    });

    it('refuses an occupied square', () => {
      const state = play([4]);
      refuse(state, move(state, 4), 'occupied');
    });

    it('refuses a move for an older board', () => {
      const state = play([4, 0]);
      refuse(state, { ...move(state, 8), expectedMoveNumber: 1 }, 'stale_move');
      refuse(state, { ...move(state, 8), expectedMoveNumber: 3 }, 'stale_move');
    });

    it('refuses a square off the board', () => {
      for (const square of [-1, 9, 1.5, Number.NaN])
        refuse(emptyGame(), move(emptyGame(), square), 'occupied');
    });

    it('refuses every move after a win or a draw', () => {
      const won = play([0, 3, 1, 4, 2]);
      const drawn = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
      for (const finished of [won, drawn])
        for (const square of [0, 5, 8])
          refuse(
            finished,
            {
              player: finished.turn,
              square,
              expectedMoveNumber: finished.moveNumber,
            },
            'game_over',
          );
    });

    it('answers a move that has several faults with one fixed reason: over, stale, turn, square', () => {
      const state = play([4]);
      refuse(
        state,
        { player: 'X', square: 4, expectedMoveNumber: 0 },
        'stale_move',
      );
      refuse(
        state,
        { player: 'X', square: 4, expectedMoveNumber: 1 },
        'not_your_turn',
      );
      const won = play([0, 3, 1, 4, 2]);
      refuse(
        won,
        { player: 'X', square: 0, expectedMoveNumber: 0 },
        'game_over',
      );
    });
  });

  it('does not change the state it is given', () => {
    const start = frozen(emptyGame());
    const result = applyMove(start, move(start, 4));
    expect(result.ok).toBe(true);
    expect(start).toEqual(emptyGame());
  });
});

/** Three squares from `pool` that are not a line, so the player who takes them has not won. */
function pickNoLine(pool: readonly number[]): number[] {
  for (const a of pool)
    for (const b of pool)
      for (const c of pool) {
        if (!(a < b && b < c)) continue;
        const isLine = LINES.some((line) =>
          line.every((square) => [a, b, c].includes(square)),
        );
        if (!isLine) return [a, b, c];
      }
  throw new Error(
    'no three squares outside the line avoid a line of their own',
  );
}

describe('the in-memory game store', () => {
  const storeAt = (
    clock: { at: number },
    options: Parameters<typeof createMemoryGameStore>[0] = {},
  ): GameStore => {
    let next = 0;
    return createMemoryGameStore({
      now: () => clock.at,
      newId: () => `game-${String((next += 1)).padStart(12, '0')}`,
      ...options,
    });
  };

  it('creates games whose identifiers are random, unguessable and valid for the contract', async () => {
    const store = createMemoryGameStore();
    const first = await store.create();
    const second = await store.create();
    expect(GameSchema.safeParse(first).success).toBe(true);
    expect(first.gameId).not.toBe(second.gameId);
    expect(first.gameId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await store.get(first.gameId)).toEqual(first);
  });

  it('plays a game through to its end', async () => {
    const store = createMemoryGameStore();
    const { gameId } = await store.create();
    let state = emptyGame();
    for (const square of [0, 3, 1, 4, 2]) {
      const result = await store.play(gameId, move(state, square));
      if (result.kind !== 'played') throw new Error(result.kind);
      const { gameId: _id, ...rest } = result.game;
      state = rest;
    }
    expect(state.status).toBe('won');
    expect(state.winner).toBe('X');
    expect((await store.get(gameId))?.line).toEqual([0, 1, 2]);
  });

  it('refuses without any effect and returns the current game', async () => {
    const store = createMemoryGameStore();
    const game = await store.create();
    await store.play(game.gameId, {
      player: 'X',
      square: 4,
      expectedMoveNumber: 0,
    });
    const before = await store.get(game.gameId);
    const refused = await store.play(game.gameId, {
      player: 'O',
      square: 4,
      expectedMoveNumber: 1,
    });
    expect(refused).toEqual({
      kind: 'refused',
      reason: 'occupied',
      game: before,
    });
    expect(await store.get(game.gameId)).toEqual(before);
  });

  it('commits only one of two requests that name the same move number', async () => {
    const store = createMemoryGameStore();
    const { gameId } = await store.create();
    const results = await Promise.all([
      store.play(gameId, { player: 'X', square: 0, expectedMoveNumber: 0 }),
      store.play(gameId, { player: 'X', square: 8, expectedMoveNumber: 0 }),
    ]);
    expect(results.map((result) => result.kind).sort()).toEqual([
      'played',
      'refused',
    ]);
    const game = await store.get(gameId);
    expect(game?.moveNumber).toBe(1);
    expect(game?.board.filter((cell) => cell !== null)).toHaveLength(1);
  });

  it('does not know an identifier it never issued', async () => {
    const store = createMemoryGameStore();
    expect(await store.get('does-not-exist-123456')).toBeUndefined();
    expect(
      await store.play('does-not-exist-123456', {
        player: 'X',
        square: 0,
        expectedMoveNumber: 0,
      }),
    ).toEqual({ kind: 'unknown' });
  });

  it('forgets a game that was not played within its time to live, and a move extends it', async () => {
    const clock = { at: 1_000 };
    const store = storeAt(clock, { ttlMs: 100 });
    const { gameId } = await store.create();
    clock.at += 99;
    await store.play(gameId, { player: 'X', square: 0, expectedMoveNumber: 0 });
    clock.at += 99;
    expect(await store.get(gameId)).toBeDefined();
    clock.at += 1;
    expect(await store.get(gameId)).toBeUndefined();
    expect(
      await store.play(gameId, {
        player: 'O',
        square: 1,
        expectedMoveNumber: 1,
      }),
    ).toEqual({ kind: 'unknown' });
  });

  it('holds a bounded number of games and drops the one played longest ago', async () => {
    const clock = { at: 0 };
    const store = storeAt(clock, { capacity: 2 });
    const first = await store.create();
    const second = await store.create();
    // Playing the first game makes the second one the least recently played.
    await store.play(first.gameId, {
      player: 'X',
      square: 0,
      expectedMoveNumber: 0,
    });
    const third = await store.create();
    expect(await store.get(second.gameId)).toBeUndefined();
    expect(await store.get(first.gameId)).toBeDefined();
    expect(await store.get(third.gameId)).toBeDefined();
  });

  it('refuses an unusable configuration', () => {
    expect(() => createMemoryGameStore({ capacity: 0 })).toThrow(RangeError);
    expect(() => createMemoryGameStore({ ttlMs: 0 })).toThrow(RangeError);
  });
});

describe('the game server a host composes', () => {
  it('announces the icons it is given, and none by default', async () => {
    const [{ Client, StreamableHTTPClientTransport }, { createMcpFetchApp }] =
      await Promise.all([
        import('@modelcontextprotocol/client'),
        import('@saga-a2ui/react-mcp-stack/server/http'),
      ]);
    const { createGameServer, prepareBoardViews } =
      await import('../examples/tic-tac-toe/server/operations.js');
    const { VIEW_MARKER } =
      await import('../examples/tic-tac-toe/src/contract.js');
    const views = prepareBoardViews(`<div id="root"></div>${VIEW_MARKER}`);
    const store = createMemoryGameStore();
    const icons = [
      { src: 'https://games.example/icon.png', mimeType: 'image/png' },
    ];

    async function announcedBy(given: typeof icons | undefined) {
      const app = createMcpFetchApp({
        path: '/mcp',
        allowedHosts: ['games.example'],
        allowedOrigins: ['games.example'],
        createServer: (lifetime) =>
          createGameServer({
            views,
            store,
            lifetime,
            ...(given === undefined ? {} : { icons: given }),
          }),
      });
      const client = new Client({ name: 'icons-spec', version: '0.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL('https://games.example/mcp'),
          {
            // A Request built in Node carries no Host header; the Worker runtime derives it from the URL.
            fetch: (input, init) => {
              const headers = new Headers(init?.headers);
              headers.set('host', 'games.example');
              return app.fetch(
                new Request(input instanceof Request ? input.url : input, {
                  ...init,
                  headers,
                }),
              );
            },
          },
        ),
      );
      try {
        return client.getServerVersion()?.icons;
      } finally {
        await client.close();
        await app.close();
      }
    }

    expect(await announcedBy(icons)).toEqual(icons);
    expect(await announcedBy(undefined)).toBeUndefined();
  });
});
