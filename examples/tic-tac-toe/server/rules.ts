import type { Game, Player, Refusal } from '../src/contract.js';

// The rules of tic-tac-toe, as pure functions: no clock, no randomness, no storage and no
// mutation of what they are given. X moves first, the players alternate, the eight lines win, a
// full board with no line is a draw, and nothing is accepted after the game ends.

/** Everything about a game except its identifier. */
export type GameState = Omit<Game, 'gameId'>;

/** The eight winning lines: three rows, three columns and the two diagonals. */
export const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const playerOnMove = (moveNumber: number): Player =>
  moveNumber % 2 === 0 ? 'X' : 'O';

export function emptyGame(): GameState {
  return {
    board: Array.from({ length: 9 }, () => null),
    turn: 'X',
    moveNumber: 0,
    status: 'playing',
    winner: null,
    line: null,
    history: [],
  };
}

/** What a player asks for. `expectedMoveNumber` is the number of moves the player saw on the board. */
export interface Move {
  readonly player: Player;
  readonly square: number;
  readonly expectedMoveNumber: number;
}

export type MoveResult =
  | { readonly ok: true; readonly state: GameState }
  | { readonly ok: false; readonly reason: Refusal };

/**
 * Applies one move to a game that is left untouched, or says why not. The reasons are checked in
 * this order, so one move has exactly one answer: the game is over, the move was made for an
 * older board, it is not that player's turn, the square is taken.
 */
export function applyMove(state: GameState, move: Move): MoveResult {
  if (state.status !== 'playing') return { ok: false, reason: 'game_over' };
  if (move.expectedMoveNumber !== state.moveNumber)
    return { ok: false, reason: 'stale_move' };
  if (move.player !== state.turn) return { ok: false, reason: 'not_your_turn' };
  if (
    !Number.isInteger(move.square) ||
    move.square < 0 ||
    move.square > 8 ||
    state.board[move.square] !== null
  )
    return { ok: false, reason: 'occupied' };

  const board = state.board.map((cell, square) =>
    square === move.square ? move.player : cell,
  );
  const moveNumber = state.moveNumber + 1;
  const line = LINES.find(
    ([a, b, c]) =>
      board[a] === move.player &&
      board[b] === move.player &&
      board[c] === move.player,
  );
  const history = [
    ...state.history,
    { player: move.player, square: move.square },
  ];
  return {
    ok: true,
    state: {
      board,
      turn: playerOnMove(moveNumber),
      moveNumber,
      status: line ? 'won' : moveNumber === 9 ? 'draw' : 'playing',
      winner: line ? move.player : null,
      line: line ? [line[0], line[1], line[2]] : null,
      history,
    },
  };
}
