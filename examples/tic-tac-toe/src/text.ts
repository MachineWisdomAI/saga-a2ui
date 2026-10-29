import type { Game, Refusal } from './contract.js';
import type { RequestOutcome } from '@saga-a2ui/react-mcp-stack';

// Everything the person reads or the conversation receives, in one place. Fixed sentences: none of
// them repeats a backend message.

export const VIEW_TEXT = {
  waiting: 'Waiting for a game…',
  checking: 'Checking the current game…',
  yourTurn: 'Your move. You are X.',
  assistantTurn: 'Waiting for the assistant to play O…',
  assistantSlow: 'Could not read the game. Check the connection.',
  stillWaiting: 'Still no move from the assistant.',
  won: 'You won!',
  lost: 'The assistant won.',
  draw: 'It is a draw.',
  gone: 'That game is not available any more. Start a new game.',
  problem: 'This could not be shown.',
  mismatch:
    'This could not be shown: the view and its server are from different builds. Reopen it; if this continues, update the server and the view together.',
  unconfirmed: 'Could not read the current game. Check the connection.',
  closed: 'This view was closed.',
} as const;

/** An unconfirmed message may still have arrived; do not resend it automatically. */
export const MESSAGE_FAILURE: Record<RequestOutcome, string> = {
  unavailable: 'This host does not support messages from this card.',
  denied: 'The host declined the message. Check its confirmation controls.',
  failed:
    'The host did not confirm the message. Check for a pending confirmation.',
};

export const REFUSAL_TEXT: Record<Refusal, string> = {
  game_over: 'That game is over.',
  stale_move: 'The board had moved on, so that move was not played.',
  not_your_turn: 'It is not your turn.',
  occupied: 'That square is taken.',
};

/** "Row 1, column 2, empty": what a screen reader says for a square. */
export function squareLabel(index: number, mark: 'X' | 'O' | null): string {
  return `Row ${Math.floor(index / 3) + 1}, column ${(index % 3) + 1}, ${mark ?? 'empty'}`;
}

/** One move in words, for the history: "You: row 2, column 2". */
export function moveText(
  move: Game['history'][number],
  at: number,
): { text: string } {
  return {
    text: `${at + 1}. ${move.player === 'X' ? 'You' : 'Assistant'}: row ${Math.floor(move.square / 3) + 1}, column ${(move.square % 3) + 1}`,
  };
}

/** The status line for a game, before any note is added. */
export function headline(
  game: Game,
  assistant: 'idle' | 'waiting' | 'expired',
): string {
  if (game.status === 'won')
    return game.winner === 'X' ? VIEW_TEXT.won : VIEW_TEXT.lost;
  if (game.status === 'draw') return VIEW_TEXT.draw;
  if (game.turn === 'X') return VIEW_TEXT.yourTurn;
  return assistant === 'expired'
    ? VIEW_TEXT.assistantSlow
    : VIEW_TEXT.assistantTurn;
}

// The words the board sends to the conversation, as the person. The message names the game and
// never the board: the server owns the state.

export const CONVERSATION = {
  newGame:
    'Start a new tic-tac-toe game with new_game and show its card. I will play X; you play O.',
  /** Gives the assistant its turn. */
  yourMove: (gameId: string): string =>
    `Your move in tic-tac-toe game ${gameId}. The board is in your context; if it isn't, read it with get_game. Then play O with play_move.`,
  /** Reports how a game that X's move ended came out, and asks for no move. */
  result: (game: Game): string =>
    game.winner === 'X'
      ? 'I won our tic-tac-toe game.'
      : 'Our tic-tac-toe game ended in a draw.',
  /** The context that goes with the move message: for the assistant, not shown in the conversation. */
  boardForAssistant: (game: Game): string =>
    `Tic-tac-toe game ${game.gameId} after move ${game.moveNumber}. Squares 0 to 8, row by row, with - for empty: ${[
      0, 3, 6,
    ]
      .map((start) =>
        game.board
          .slice(start, start + 3)
          .map((cell) => cell ?? '-')
          .join(''),
      )
      .join('/')}. It is ${game.turn}'s turn.`,
} as const;
