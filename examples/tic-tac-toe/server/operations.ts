import { McpServer } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import {
  registerPublicOperation,
  viewUriForHtml,
  type OperationOutcome,
  type OperationView,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { z } from 'zod';
import {
  GameIdInputSchema,
  GameOutputSchema,
  GET_GAME_TOOL,
  MoveInputSchema,
  MoveOutputSchema,
  NEW_GAME_TOOL,
  PLAY_MOVE_TOOL,
  READS,
  SHOW_GAME_TOOL,
  TEXT,
  VIEW_MARKER,
  WRITES,
  type Game,
  type Refusal,
} from '../src/contract.js';
import type { GameStore, PlayResult } from './game-store.js';

// The game's MCP operations, declared with SAGA's server export. The application owns the listener
// (listener.ts), the rules (rules.ts), the games (game-store.ts) and the built view it serves.
// Each request builds its own server; the one store is shared by all of them.

/** The built view is required before the server can claim to serve anything. */
export class ViewArtifactMissing extends Error {
  constructor() {
    super(
      'The view has not been built: the server needs the built page and will not start without it.',
    );
    this.name = 'ViewArtifactMissing';
  }
}

/** The board, declared once for each operation that opens it. */
export interface BoardViews {
  readonly newGame: OperationView;
  readonly showGame: OperationView;
}

/**
 * Validate and fingerprint the deployment document once, before listening.
 *
 * `new_game` and `show_game` both open the board. A server registers a view's resource once per
 * address, and an operation's view is registered with it, so two operations cannot declare one
 * view object on the same server. Each therefore declares the same page under its own address
 * (`new-game` and `show-game`); a host that mounts either gets the same bytes.
 */
export function prepareBoardViews(html: unknown): BoardViews {
  if (typeof html !== 'string' || !html.includes(VIEW_MARKER))
    throw new ViewArtifactMissing();
  const board = (filename: string, title: string): OperationView =>
    Object.freeze({
      uri: viewUriForHtml(html, filename),
      title,
      html,
      csp: CLOSED_VIEW_CSP,
    });
  return Object.freeze({
    newGame: board('new-game.html', 'Tic-tac-toe board (new game)'),
    showGame: board('show-game.html', 'Tic-tac-toe board (show game)'),
  });
}

/** What the model reads beside the structured game: the state in a few words. */
export function describeGame(game: Game): string {
  const rows = [0, 3, 6]
    .map((start) =>
      game.board
        .slice(start, start + 3)
        .map((cell) => cell ?? '-')
        .join(''),
    )
    .join('/');
  const where =
    game.status === 'won'
      ? `${game.winner} won with squares ${game.line?.join(', ')}.`
      : game.status === 'draw'
        ? 'The game ended in a draw.'
        : `It is ${game.turn}'s turn.`;
  return `Tic-tac-toe game ${game.gameId}, after move ${game.moveNumber}. Squares 0 to 8, row by row, with - for empty: ${rows}. ${where}`;
}

const REFUSAL_TEXT: Record<Refusal, string> = {
  game_over: 'The game is over.',
  stale_move: 'The board has moved on since that move was chosen.',
  not_your_turn: 'It is not that player’s turn.',
  occupied: 'That square is not available.',
};

const gameFound = (game: Game | undefined) =>
  game === undefined
    ? ({ kind: 'absent' } as const)
    : ({ kind: 'record', record: game } as const);

export interface GameServerOptions {
  /** The immutable views prepared before the listener opened. */
  readonly views: BoardViews;
  /** The request this server was built for, started by the listener at admission. */
  readonly lifetime: RequestLifetime;
  /** Every request's server shares this one store. */
  readonly store: GameStore;
}

const failures = {
  absent: TEXT.noGame,
  unavailable: TEXT.unavailable,
  invalidOutput: TEXT.invalidOutput,
} as const;

// #region saga-snippet:register-game-operations
/**
 * The four operations. `new_game` and `show_game` open the board; `get_game` and `play_move` omit
 * `view`, so they return the game as data and open no card. The person's click and the assistant's
 * tool call reach the same `play_move`.
 */
export function createGameServer({
  views,
  lifetime,
  store,
}: GameServerOptions): McpServer {
  const server = new McpServer({ name: 'saga-tic-tac-toe', version: '0.0.0' });
  const project = (game: Game) => ({
    text: describeGame(game),
    data: { game },
  });

  registerPublicOperation(
    server,
    {
      name: NEW_GAME_TOOL,
      title: 'Start a new game',
      description:
        'Starts a new game of tic-tac-toe and shows the board. The person plays X and moves first; you play O.',
      annotations: WRITES,
      input: z.strictObject({}),
      output: GameOutputSchema,
      view: views.newGame,
      failures,
      handle: async () => ({ kind: 'record', record: await store.create() }),
      project,
    },
    { lifetime },
  );

  registerPublicOperation(
    server,
    {
      name: SHOW_GAME_TOOL,
      title: 'Show a game',
      description:
        'Shows the board of an existing game, as it is now. Use it to display a game again; use get_game to read one.',
      annotations: READS,
      input: GameIdInputSchema,
      output: GameOutputSchema,
      view: views.showGame,
      failures,
      handle: async ({ gameId }) => gameFound(await store.get(gameId)),
      project,
    },
    { lifetime },
  );

  registerPublicOperation(
    server,
    {
      name: GET_GAME_TOOL,
      title: 'Read a game',
      description:
        'Reads the current state of a game, without showing a board: the squares, whose turn it is, the move number and how the game stands.',
      annotations: READS,
      input: GameIdInputSchema,
      output: GameOutputSchema,
      failures,
      handle: async ({ gameId }) => gameFound(await store.get(gameId)),
      project,
    },
    { lifetime },
  );

  registerPublicOperation(
    server,
    {
      name: PLAY_MOVE_TOOL,
      title: 'Play a move',
      description: [
        'Plays one square (0 to 8, row by row from the top left) for X or O and returns the game afterwards.',
        'You play O. Place X only when the person tells you their move in the conversation; their own clicks on the board place X for them.',
        'Give expectedMoveNumber as the moveNumber of the game you are answering. A move for an older board, a taken square, the wrong turn or a finished game is refused with no effect, and the result carries the current game.',
        'If the board is not in your context, read it with get_game first.',
        'If the board card cannot call the server, call show_game to display the board.',
      ].join(' '),
      annotations: WRITES,
      input: MoveInputSchema,
      output: MoveOutputSchema,
      failures,
      handle: async ({
        gameId,
        ...move
      }): Promise<
        OperationOutcome<Exclude<PlayResult, { kind: 'unknown' }>>
      > => {
        const result = await store.play(gameId, move);
        return result.kind === 'unknown'
          ? ({ kind: 'absent' } as const)
          : ({ kind: 'record', record: result } as const);
      },
      project: (result) =>
        result.kind === 'refused'
          ? {
              text: `Refused, and nothing changed: ${REFUSAL_TEXT[result.reason]} ${describeGame(result.game)}`,
              data: {
                game: result.game,
                outcome: 'refused' as const,
                reason: result.reason,
              },
            }
          : {
              text: describeGame(result.game),
              data: { game: result.game, outcome: 'played' as const },
            },
    },
    { lifetime },
  );
  return server;
}
// #endregion saga-snippet:register-game-operations
