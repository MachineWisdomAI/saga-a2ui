import { z } from 'zod';

// The wire contract shared by the server and the board view. It imports only `zod`, so a view
// bundle that includes it carries no server code. Application-owned: nothing here is a SAGA export.

export const NEW_GAME_TOOL = 'new_game';
export const SHOW_GAME_TOOL = 'show_game';
export const GET_GAME_TOOL = 'get_game';
export const PLAY_MOVE_TOOL = 'play_move';

/** The person plays X and moves first; the assistant plays O. */
export const PlayerSchema = z.enum(['X', 'O']);
export type Player = z.infer<typeof PlayerSchema>;

/** A square, numbered 0 to 8 across the rows from the top left. */
export const SquareSchema = z.number().int().min(0).max(8);

/**
 * An unguessable random identifier. It names a game and authorizes nothing else: the game is an
 * example, not an adversarial service, and anyone who holds the identifier may play either side.
 */
export const GameIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

export const GameSchema = z.strictObject({
  gameId: GameIdSchema,
  /** The nine squares, `null` while empty. */
  board: z.array(PlayerSchema.nullable()).length(9),
  /** Who plays next. */
  turn: PlayerSchema,
  /** How many moves have been made. A move names the number it expects. */
  moveNumber: z.number().int().min(0).max(9),
  status: z.enum(['playing', 'won', 'draw']),
  winner: PlayerSchema.nullable(),
  /** The three winning squares, or `null`. */
  line: z.tuple([SquareSchema, SquareSchema, SquareSchema]).nullable(),
  /** Every move so far, in order. */
  history: z
    .array(z.strictObject({ player: PlayerSchema, square: SquareSchema }))
    .max(9),
});
export type Game = z.infer<typeof GameSchema>;

/** Why `play_move` changed nothing. */
export const RefusalSchema = z.enum([
  'game_over',
  'stale_move',
  'not_your_turn',
  'occupied',
]);
export type Refusal = z.infer<typeof RefusalSchema>;

/** `new_game`, `show_game` and `get_game`: the whole game, always. */
export const GameOutputSchema = z.strictObject({ game: GameSchema });

/**
 * `play_move`: the game after the move, or, when the move was refused, the current game unchanged
 * and why. A refusal is a normal result that carries the game, not a failure.
 */
export const MoveOutputSchema = z.strictObject({
  game: GameSchema,
  outcome: z.enum(['played', 'refused']),
  reason: RefusalSchema.optional(),
});
export type MoveOutput = z.infer<typeof MoveOutputSchema>;

export const GameIdInputSchema = z.strictObject({ gameId: GameIdSchema });
export const MoveInputSchema = z.strictObject({
  gameId: GameIdSchema,
  square: SquareSchema,
  player: PlayerSchema,
  expectedMoveNumber: z.number().int().min(0).max(9),
});
export type MoveInput = z.infer<typeof MoveInputSchema>;

/** Fixed sentences. A failure never repeats a backend message or an identifier. */
export const TEXT = {
  noGame:
    'That game is not available any more, so there is no board to show. Start a new one with new_game.',
  unavailable: 'The game is unavailable right now.',
  invalidOutput: 'The game could not be shown.',
} as const;

/** The tool annotations: what each operation does to the stored games. */
export const READS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
export const WRITES = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/**
 * What the built page must contain for the server to serve it: the element the view renders into.
 * The server refuses to start with a page that lacks it, so a missing or wrong build fails early.
 */
export const VIEW_MARKER = '<div id="root"';
