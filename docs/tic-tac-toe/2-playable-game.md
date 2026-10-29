# Build the playable game

The first card connected a server value to a React component. Now replace the welcome message with a game: the server decides which moves are legal, the view draws its state, and a click hands the next turn to the assistant.

Stop the game server and leave the tunnel running. Work through the four parts below in the same app directory. Each part explains the application files it adds or replaces; expand a file to copy or compare the complete code. Your Vite-generated configuration and installed dependencies stay in place.

## 1. Describe a game and its legal moves

The welcome card returned one string. A game needs a board, whose turn it is, and enough information to reject an old click. Add `src/contract.ts`, `server/rules.ts` and `server/game-store.ts` using the complete files below.

`contract.ts` defines the shapes shared by the server and view. A board has nine entries, numbered 0–8 across rows; an entry is `null`, `X` or `O`. A game also carries `gameId`, `moveNumber`, `turn`, `status` and its history. The Zod schemas check tool inputs and results at runtime; TypeScript types help while editing.

`rules.ts` implements `applyMove` without a server or clock. Before placing a mark, it checks that the game is still running, that the submitted move number matches, that the player has the turn, and that the square is empty. It then checks the eight winning lines and whether the board is full. A refused move returns a reason and leaves the board unchanged.

Why send `expectedMoveNumber`? Suppose the view shows move 2, but another call has already applied move 3. The old click must not change the newer board. The server refuses it and returns the current game so the view can catch up.

`game-store.ts` gives those rules somewhere to keep their result. Its memory store creates game identifiers, expires idle games after 30 minutes and bounds the number retained. Each request uses the same store. Restarting the process clears it.

<details>
<summary>Complete src/contract.ts</summary>

```ts file=src/contract.ts
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
```

</details>

<details>
<summary>Complete server/rules.ts</summary>

```ts file=server/rules.ts
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
```

</details>

<details>
<summary>Complete server/game-store.ts</summary>

```ts file=server/game-store.ts
import { randomBytes } from 'node:crypto';
import type { Game, Refusal } from '../src/contract.js';
import { applyMove, emptyGame, type GameState, type Move } from './rules.js';

// Where the games live. `GameStore` is the seam: a deployment that outgrows one Node process
// replaces `createMemoryGameStore` with a store of its own (a key-value store, a Durable Object)
// and keeps the interface. The operations never see the map.

export type PlayResult =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'played'; readonly game: Game }
  | { readonly kind: 'refused'; readonly reason: Refusal; readonly game: Game };

export interface GameStore {
  /** Starts a game under a new unguessable identifier. */
  create(): Promise<Game>;
  /** The current game, or `undefined` when the identifier is unknown or the game has expired. */
  get(gameId: string): Promise<Game | undefined>;
  /**
   * Checks the move against the game as it is now and applies it, as one step: two requests that
   * name the same `expectedMoveNumber` cannot both be applied. A refused move changes nothing and
   * returns the current game.
   */
  play(gameId: string, move: Move): Promise<PlayResult>;
}

export interface MemoryGameStoreOptions {
  /** How many games are kept. When full, the game that was played longest ago is dropped. */
  readonly capacity?: number;
  /** How long a game lives after it was created or last played. */
  readonly ttlMs?: number;
  readonly now?: () => number;
  /** Supplies identifiers; the default is 128 random bits. */
  readonly newId?: () => string;
}

interface Stored {
  state: GameState;
  expiresAt: number;
}

export const DEFAULT_CAPACITY = 200;
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

const randomId = (): string => randomBytes(16).toString('base64url');

/**
 * A bounded map of short-lived games, in one process. Entries are ordered by when they were last
 * played, so the first entry is the one to drop when the map is full.
 *
 * Every method does its whole work before it returns control: `play` reads the game, checks the
 * move and stores the result without an `await` between, so on one thread no other request can
 * come between the check and the write. A store over a remote service must give the same
 * guarantee in its own way (a conditional write on the move number).
 */
export function createMemoryGameStore(
  options: MemoryGameStoreOptions = {},
): GameStore {
  const capacity = options.capacity ?? DEFAULT_CAPACITY;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomId;
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new RangeError('capacity must be a positive integer');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0)
    throw new RangeError('ttlMs must be a positive number');
  const games = new Map<string, Stored>();

  const live = (gameId: string): Stored | undefined => {
    const stored = games.get(gameId);
    if (stored === undefined) return undefined;
    if (stored.expiresAt <= now()) {
      games.delete(gameId);
      return undefined;
    }
    return stored;
  };
  const snapshot = (gameId: string, state: GameState): Game => ({
    gameId,
    ...state,
    board: [...state.board],
    history: state.history.map((entry) => ({ ...entry })),
    line: state.line === null ? null : [...state.line],
  });
  const dropExpired = (): void => {
    const at = now();
    for (const [gameId, stored] of games)
      if (stored.expiresAt <= at) games.delete(gameId);
  };

  return {
    async create() {
      dropExpired();
      while (games.size >= capacity) {
        const oldest = games.keys().next();
        if (oldest.done) break;
        games.delete(oldest.value);
      }
      let gameId = newId();
      while (games.has(gameId)) gameId = newId();
      const state = emptyGame();
      games.set(gameId, { state, expiresAt: now() + ttlMs });
      return snapshot(gameId, state);
    },
    async get(gameId) {
      const stored = live(gameId);
      return stored && snapshot(gameId, stored.state);
    },
    async play(gameId, move) {
      const stored = live(gameId);
      if (stored === undefined) return { kind: 'unknown' };
      const result = applyMove(stored.state, move);
      if (!result.ok)
        return {
          kind: 'refused',
          reason: result.reason,
          game: snapshot(gameId, stored.state),
        };
      games.delete(gameId); // re-inserted last: the map stays in the order games were played
      games.set(gameId, { state: result.state, expiresAt: now() + ttlMs });
      return { kind: 'played', game: snapshot(gameId, result.state) };
    },
  };
}
```

</details>

## 2. Expose the game as operations

Replace `server/operations.ts`. The registration pattern is the one you used for the welcome message: input schema, handler, output schema and projection. The new handlers call the store.

There are four tools. `new_game` creates a game and `show_game` opens an existing one; both attach the board view. `get_game` reads the state and `play_move` applies a move; these return data without opening another card. That distinction lets both players change the game while keeping the original board on screen.

For a move, the input contains the game identifier, the expected move number, the player and the square. The projection returns the updated game as structured data and a short board description as text. The assistant can reason about the same state the view displays. Tool descriptions tell it that the person is X and it plays O.

Add `server/listener.ts` and replace `server/main.ts`. The listener wrapper creates the store and prepares the view once, then closes over them in `createServer`. The SDK still creates the MCP server for each request. Moving the store into that callback would lose the game between calls.

The startup file reads the built HTML, calls this wrapper, prints the endpoint and handles shutdown. No HTTP routing or transport implementation belongs in these app files.

<details>
<summary>Complete server/operations.ts</summary>

```ts file=server/operations.ts
import { McpServer } from '@modelcontextprotocol/server';
import {
  registerPublicOperation,
  operationViewFromHtml,
  type OperationOutcome,
  type OperationView,
  type RequestLifetime,
} from '@saga-a2ui/react-mcp-stack/server';
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

// The game's MCP operations, declared with SAGA's server export. The application supplies the
// rules, store and built view; the SDK's local listener handles HTTP and MCP delivery.
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
    operationViewFromHtml({ html, filename, title });
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
```

</details>

<details>
<summary>Complete server/listener.ts</summary>

```ts file=server/listener.ts
import type { BudgetSettings } from '@saga-a2ui/react-mcp-stack/server';
import {
  startLocalMcpServer,
  type LocalMcpServer,
} from '@saga-a2ui/react-mcp-stack/server/node';
import { createMemoryGameStore, type GameStore } from './game-store.js';
import { createGameServer, prepareBoardViews } from './operations.js';

export interface ListenerOptions {
  readonly html: string;
  readonly port: number;
  readonly store?: GameStore;
  readonly budgets?: BudgetSettings;
}

export function startListener(
  options: ListenerOptions,
): Promise<LocalMcpServer> {
  const views = prepareBoardViews(options.html);
  const store = options.store ?? createMemoryGameStore();
  return startLocalMcpServer({
    port: options.port,
    budgets: options.budgets,
    createServer: (lifetime) => createGameServer({ views, store, lifetime }),
  });
}
```

</details>

<details>
<summary>Complete server/main.ts</summary>

```ts file=server/main.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startListener } from './listener.js';

// The server entry. It reads the built view before it opens a port, so a missing build stops the
// process instead of serving a listener without its view. `npm run build` writes the view beside
// this file; `npm start` runs it.
const html = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'),
  'utf8',
);
const listener = await startListener({
  html,
  port: Number(process.env.PORT ?? 3000),
});

console.log(`Tic-tac-toe MCP endpoint: ${listener.url}`);

// Stop the MCP handler and every HTTP exchange before allowing Node to exit.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void listener.close().catch(() => {
      process.exitCode = 1;
    });
  });
}
```

</details>

## 3. Draw the board from data

The welcome view kept its component and layout together. Separate them now so you can change the board's appearance without changing its data flow. Add `src/text.ts`, `src/catalog.tsx` and `src/surface.ts`; replace `src/index.css` with the styles below. Keep the generated HTML and the `src/main.tsx` entry from the first lesson.

`catalog.tsx` implements the components in React. `Column` and `Row` arrange children, `Board` makes the grid, and `SquareFace` displays a mark with its accessible label. `ActionButton` comes from SAGA and handles the control's interaction state. The catalog identifier matches the one in `surface.ts`.

`surface.ts` defines the data and connects it to those components. The `Board` repeats its child over `/squares`. Each square binds its mark and label from that row of data. The `playable` check disables a square when it is occupied, O has the turn, or the game has ended. The layout describes what appears; application code attaches its actions in the next section.

`text.ts` turns game state into status messages, accessible square labels, move descriptions and the message asking the assistant to play. `index.css` controls the grid, focus indicators and colours. Try changing a border or the grid gap after the game is running; that should change its appearance without affecting a move.

<details>
<summary>Complete src/text.ts</summary>

```ts file=src/text.ts
import type { Game, Refusal } from './contract.js';

// Everything the person reads or the conversation receives, in one place. Fixed sentences: none of
// them repeats a backend message.

export const VIEW_TEXT = {
  waiting: 'Waiting for a game…',
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
  unconfirmed:
    'Your last move could not be confirmed. Look at the board before you play again.',
  closed: 'This view was closed.',
  /** The host took no message, so the assistant has not been told. */
  tellTheAssistant: "Tell the assistant it's their move.",
  tellTheAssistantResult: 'Tell the assistant how the game ended.',
} as const;

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
```

</details>

<details>
<summary>Complete src/catalog.tsx</summary>

```tsx file=src/catalog.tsx
import {
  ActionButtonEntry,
  Catalog,
  ColumnApi,
  CommonSchemas,
  createComponentImplementation,
  ListApi,
  RowApi,
  z,
  type ReactCatalogComponent,
} from '@saga-a2ui/react-mcp-stack';
import type { ReactNode } from 'react';
import { CATALOG_ID } from './surface.js';

// The application-owned catalog: the components its layout may name, and nothing else. Every
// component here is this application's own and shows supplied text as text, never as markup;
// `ActionButton` is SAGA's opt-in control. Nothing is registered globally by the SDK.

type ChildReference =
  string | { readonly id: string; readonly basePath: string };

// The view hands a child list over as tokens, or `{ id, basePath }` for a template item.
function childrenOf(
  buildChild: (id: string, basePath?: string) => ReactNode,
  value: unknown,
): ReactNode[] {
  const list = Array.isArray(value) ? (value as ChildReference[]) : [];
  return list.map((child) =>
    typeof child === 'string'
      ? buildChild(child)
      : buildChild(child.id, child.basePath),
  );
}

const LineApi = {
  name: 'Line',
  schema: z
    .object({
      text: CommonSchemas.DynamicString,
      kind: z.enum(['body', 'status']),
    })
    .strict(),
};

const Line: ReactCatalogComponent = createComponentImplementation(
  LineApi,
  ({ props }) => {
    const text = String(props.text ?? '');
    // The status element is present before it speaks, so a screen reader announces each change.
    return props.kind === 'status' ? (
      <p className="status" role="status">
        {text}
      </p>
    ) : (
      <span>{text}</span>
    );
  },
);

const Column: ReactCatalogComponent = createComponentImplementation(
  ColumnApi,
  ({ props, buildChild }) => (
    <div className="column">{childrenOf(buildChild, props.children)}</div>
  ),
);

const Row: ReactCatalogComponent = createComponentImplementation(
  RowApi,
  ({ props, buildChild }) => (
    <div className="row">{childrenOf(buildChild, props.children)}</div>
  ),
);

/** The nine squares in a three-by-three grid. */
const Board: ReactCatalogComponent = createComponentImplementation(
  { ...ListApi, name: 'Board' },
  ({ props, buildChild }) => (
    <div className="board" role="group" aria-label="Tic-tac-toe board">
      {childrenOf(buildChild, props.children)}
    </div>
  ),
);

const SquareFaceApi = {
  name: 'SquareFace',
  schema: z
    .object({
      mark: CommonSchemas.DynamicString,
      label: CommonSchemas.DynamicString,
      winning: CommonSchemas.DynamicString,
    })
    .strict(),
};

/**
 * What goes inside a square's button: the mark for the eye, and the full name for assistive
 * technology ("Row 1, column 2, empty"), which becomes the button's accessible name.
 */
const SquareFace: ReactCatalogComponent = createComponentImplementation(
  SquareFaceApi,
  ({ props }) => (
    <span className={props.winning ? 'square winning' : 'square'}>
      <span aria-hidden="true">{String(props.mark ?? '')}</span>
      <span className="visually-hidden">{String(props.label ?? '')}</span>
    </span>
  ),
);

const ShownApi = {
  name: 'Shown',
  schema: z
    .object({
      when: CommonSchemas.DynamicString,
      child: CommonSchemas.ComponentId,
    })
    .strict(),
};

/** Shows its child only while `when` is not empty, so a control can be absent instead of disabled. */
const Shown: ReactCatalogComponent = createComponentImplementation(
  ShownApi,
  ({ props, buildChild }) =>
    String(props.when ?? '') !== '' && typeof props.child === 'string'
      ? buildChild(props.child)
      : null,
);

export const boardEntries: readonly ReactCatalogComponent[] = [
  Column,
  Row,
  Board,
  Line,
  SquareFace,
  Shown,
  ActionButtonEntry,
];

/**
 * The one function the layout calls: the squares' `checks` use it to disable a control. A catalog
 * holds only the functions its application declares, so this one is the application's own; it
 * is `required` from the A2UI basic catalog, written out: a value that is missing or empty fails.
 */
const required = {
  name: 'required',
  returnType: 'boolean',
  schema: z.object({ value: z.any() }).strict(),
  execute: (args: Record<string, unknown>): boolean =>
    args.value !== undefined && args.value !== null && args.value !== '',
};

/** What the stack presents the layout over. */
export const boardCatalog = new Catalog<ReactCatalogComponent>(
  CATALOG_ID,
  'v0.9',
  [...boardEntries],
  [required],
);
```

</details>

<details>
<summary>Complete src/surface.ts</summary>

```ts file=src/surface.ts
import { defineSurface, z } from '@saga-a2ui/react-mcp-stack';

// The layout of the board: its data and its components. The layout gives the markup its IDs and its
// structure and nothing else: it names no action, no handler and no function. Which behavior a
// control has is decided by application code that attaches an action to the rendered instance
// (view.tsx), never by a name in this layout.

export const CATALOG_ID = 'https://tic-tac-toe.example/catalogs/board/v1';

/** The IDs the application attaches actions to. */
export const SQUARE_ID = 'square';
export const NEW_GAME_ID = 'new-game';
export const CHECK_ID = 'check-move';

const SquareDataSchema = z.object({
  /** The square's number, 0 to 8, which the square action sends. */
  index: z.number(),
  /** What a screen reader says: "Row 1, column 2, empty". */
  label: z.string(),
  /** "X", "O" or empty. */
  mark: z.string(),
  /** Non-empty when the square can be played now; an empty string disables the control. */
  playable: z.string(),
  /** Non-empty for the three squares of a winning line. */
  winning: z.string(),
});

const BoardDataSchema = z.object({
  /** The one status line: whose turn it is, how the game ended, or what to do next. */
  status: z.string(),
  squares: z.array(SquareDataSchema),
  /** Non-empty when "Check for the assistant's move" should be offered. */
  canCheck: z.string(),
  /** The moves so far, in words, one line each. */
  history: z.array(z.object({ text: z.string() })),
});

export const boardSurface = defineSurface({
  surfaceId: 'board',
  catalogId: CATALOG_ID,
  data: BoardDataSchema,
  initial: { status: '', squares: [], canCheck: '', history: [] },
  root: {
    component: 'Column',
    bind: {},
    props: { children: ['status', 'board', 'controls'] },
  },
  components: [
    {
      id: 'status',
      component: 'Line',
      kind: 'status',
      text: { path: '/status' },
    },
    {
      id: 'board',
      component: 'Board',
      children: { componentId: SQUARE_ID, path: '/squares' },
    },
    {
      id: SQUARE_ID,
      component: 'ActionButton',
      child: 'square-face',
      // A control whose check fails is disabled, so an occupied square, the assistant's turn and a
      // finished game all leave nothing to press.
      checks: [
        {
          condition: {
            call: 'required',
            args: { value: { path: 'playable' } },
          },
          message: 'This square cannot be played now.',
        },
      ],
    },
    {
      id: 'square-face',
      component: 'SquareFace',
      mark: { path: 'mark' },
      label: { path: 'label' },
      winning: { path: 'winning' },
    },
    {
      id: 'controls',
      component: 'Row',
      children: [NEW_GAME_ID, 'check-slot'],
    },
    { id: NEW_GAME_ID, component: 'ActionButton', child: 'new-game-label' },
    {
      id: 'new-game-label',
      component: 'Line',
      kind: 'body',
      text: 'New game',
    },
    {
      id: 'check-slot',
      component: 'Shown',
      when: { path: '/canCheck' },
      child: CHECK_ID,
    },
    { id: CHECK_ID, component: 'ActionButton', child: 'check-label' },
    {
      id: 'check-label',
      component: 'Line',
      kind: 'body',
      text: "Check for the assistant's move",
    },
  ],
});

/** The data the surface shows: replaced whole by each update. */
export type BoardData = z.infer<typeof BoardDataSchema>;
```

</details>

<details>
<summary>Complete src/index.css</summary>

```css file=src/index.css
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}
body {
  margin: 0;
  padding: 1rem;
}
.column {
  display: grid;
  gap: 0.75rem;
  justify-items: start;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.status {
  margin: 0;
  min-height: 1.5em;
  font-size: 1.05rem;
}
.board {
  display: grid;
  grid-template-columns: repeat(3, 5rem);
  gap: 0.4rem;
}
.board button {
  width: 5rem;
  height: 5rem;
  padding: 0;
  font-size: 2.25rem;
  font-weight: 600;
  border: 2px solid currentColor;
  border-radius: 0.5rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.board button:disabled {
  cursor: default;
}
.board button:not(:disabled):hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.board button:focus-visible,
.row button:focus-visible {
  outline: 3px solid Highlight;
  outline-offset: 2px;
}
.square.winning {
  text-decoration: underline;
  text-decoration-thickness: 0.2rem;
}
.row button {
  padding: 0.45rem 0.9rem;
  font: inherit;
  border: 2px solid currentColor;
  border-radius: 0.5rem;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
```

</details>

## 4. Connect a click to the next turn

Add `src/controller.ts` and `src/actions.ts`, then replace `src/view.tsx`. These files connect the server and board you have just defined. Trace one click through them before running the game:

1. `view.tsx` attaches `playSquare` to each rendered square. The repeated button supplies its square index.
2. In `actions.ts`, `playSquare` reads that index and the displayed game's identifier and move number. It locks the board while calling `play_move` as X.
3. On success, `game.present` displays the returned state. If the server refused the move, the board explains why and uses the server's current game.
4. After an accepted move, `handOver` appends a conversation message asking the assistant to play O, with the game as context. The host may ask the person to send or confirm it.
5. While O has the turn, the controller reads `get_game`. When O's tool call changes the state, it presents the newer board and enables the available squares.

The controller owns the displayed game, pending click and wait for O. It ignores older replies and cancels the old wait when you select another game or leave the view. A failed move request is uncertain: the server may have applied it before the connection failed. `recover` reads the game before offering another click instead of submitting the move again.

The complete controller also slows its reads after about a minute while continuing to wait for a host confirmation. This is why a delayed confirmation does not require a typed turn prompt or a page refresh. The optional “Check for the assistant's move” control is for recovering a failed read.

In `view.tsx`, `onToolResult` now reads a game instead of a message. `createReactActions` binds the three actions to the controls. Each square binding has a subject containing the game and move number; a late action result for an old subject cannot overwrite the current board. `onTeardown` stops the application's wait when the host closes the view.

<details>
<summary>Complete src/controller.ts</summary>

```ts file=src/controller.ts
import {
  GameOutputSchema,
  GET_GAME_TOOL,
  TEXT,
  type Game,
} from './contract.js';
import type { BoardData } from './surface.js';
import { headline, moveText, squareLabel, VIEW_TEXT } from './text.js';

// The part of the view that does not depend on React: which game the board shows, what it says,
// which squares can be played, and the wait for the assistant's move. The stack's bound surface is
// the only thing it draws on. Every game the board shows goes through `present`.

/** The stack's bound surface, as far as the controller needs it. */
export interface BoardSurface {
  /** Replaces the data shown, in place. Does nothing once the view is gone. */
  update(data: BoardData): unknown;
}

/** The server as the view reaches it; the host proxies each call. */
export interface GameServer {
  callServerTool(
    request: {
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    },
    options?: { readonly signal?: AbortSignal },
  ): Promise<{
    readonly isError?: boolean;
    readonly content: readonly unknown[];
    readonly structuredContent?: unknown;
  }>;
}

/** The game and move a request was made for. */
export interface Shown {
  readonly gameId: string;
  readonly moveNumber: number;
}

/** Keep watching while the game exists, including time spent confirming a host message. */
export const WAIT = {
  everyMs: 1_500,
  slowMs: 5_000,
  fastReads: 40,
  failures: 40,
} as const;

export type ReadResult =
  | { readonly kind: 'game'; readonly game: Game }
  | { readonly kind: 'gone' }
  | { readonly kind: 'failed' };

interface Reply {
  readonly isError?: boolean;
  readonly content: readonly unknown[];
  readonly structuredContent?: unknown;
}

/** An error whose fixed text says the server has no such game: unknown, or expired. */
export function replyIsGone(reply: Reply): boolean {
  if (reply.isError !== true) return false;
  const first = reply.content[0] as { text?: unknown } | undefined;
  return first?.text === TEXT.noGame;
}

/** What a `get_game`-shaped reply says. */
export function readGameReply(reply: Reply): ReadResult {
  if (replyIsGone(reply)) return { kind: 'gone' };
  if (reply.isError === true) return { kind: 'failed' };
  const parsed = GameOutputSchema.safeParse(reply.structuredContent);
  return parsed.success
    ? { kind: 'game', game: parsed.data.game }
    : { kind: 'failed' };
}

export async function readGame(
  server: GameServer,
  gameId: string,
  signal?: AbortSignal,
): Promise<ReadResult> {
  try {
    return readGameReply(
      await server.callServerTool(
        { name: GET_GAME_TOOL, arguments: { gameId } },
        signal === undefined ? undefined : { signal },
      ),
    );
  } catch {
    return { kind: 'failed' };
  }
}

type Assistant = 'idle' | 'waiting' | 'expired';

export interface GameController {
  /** Draws on this surface from now on. */
  attach(surface: BoardSurface): void;
  /**
   * Shows a game. One function for every game the board shows, and it checks the game's identity
   * before its move number: a game other than the selected one is ignored (a late answer for the
   * previous game cannot replace the current one), and within the selected game an older move
   * number is ignored. Only `select` changes which game is selected. Returns whether it was shown.
   */
  present(game: Game, mode?: 'follow' | 'select'): boolean;
  /** The game on screen. */
  current(): Game | undefined;
  /** Whether this game and move are on screen, that is, nothing newer has replaced them. */
  isShowing(shown: Shown): boolean;
  /** The identity the square actions compare: it changes when the game or its move number does. */
  subject(): string;
  /** A note after the status line, shown until a newer move replaces it. */
  say(note: string): void;
  /** The selected game is not there any more. */
  markGone(): void;
  /** Takes the squares away from the person while their request is in flight; give the token back to `unlock`. */
  lock(): object;
  unlock(token: object): void;
  /** Reads the game again, with the squares off until the answer arrives. */
  recover(): Promise<void>;
  /** Starts the wait for the assistant's move on the game on screen. */
  startWait(): void;
  /** Ends the view: nothing is drawn or read afterwards. */
  retire(): void;
}

export function createGameController(server: GameServer): GameController {
  let surface: BoardSurface | undefined;
  let game: Game | undefined;
  let note = '';
  let gone = false;
  let retired = false;
  // Recovery reads in flight for the selected game. Selecting another game empties it, so an old
  // read neither holds the new game's squares off nor, when it settles, changes anything.
  const readings = new Set<object>();
  const locks = new Set<object>();
  let assistant: Assistant = 'idle';
  let wait: { readonly stop: () => void } | undefined;
  let waitingFor = '';

  const render = (): void => {
    if (retired || surface === undefined) return;
    const open =
      game !== undefined &&
      !gone &&
      game.status === 'playing' &&
      game.turn === 'X' &&
      readings.size === 0 &&
      locks.size === 0;
    const text =
      game === undefined
        ? VIEW_TEXT.waiting
        : gone
          ? VIEW_TEXT.gone
          : [headline(game, assistant), note].filter(Boolean).join(' ');
    surface.update({
      status: text,
      canCheck:
        game !== undefined &&
        !gone &&
        game.status === 'playing' &&
        game.turn === 'O' &&
        assistant === 'expired'
          ? 'yes'
          : '',
      history: (game?.history ?? []).map(moveText),
      squares: (game?.board ?? Array.from({ length: 9 }, () => null)).map(
        (mark, index) => ({
          index,
          label: squareLabel(index, mark),
          mark: mark ?? '',
          playable: open && mark === null ? 'yes' : '',
          winning: game?.line?.includes(index) ? 'yes' : '',
        }),
      ),
    });
  };

  const stopWait = (): void => {
    wait?.stop();
    wait = undefined;
    if (assistant === 'waiting') assistant = 'idle';
  };

  const controller: GameController = {
    attach(target) {
      surface = target;
      render();
    },

    present(next, mode = 'follow') {
      if (retired) return false;
      if (game !== undefined && next.gameId !== game.gameId) {
        if (mode !== 'select') return false;
        stopWait();
        assistant = 'idle';
        gone = false;
        note = '';
        readings.clear(); // a read for the previous game no longer concerns the board
        game = next;
        render();
        return true;
      }
      if (game !== undefined && next.moveNumber < game.moveNumber) return false;
      if (game === undefined || next.moveNumber > game.moveNumber) note = '';
      gone = false;
      game = next;
      if (game.status !== 'playing' || game.turn === 'X') {
        stopWait();
        assistant = 'idle';
      }
      render();
      return true;
    },

    current: () => game,

    isShowing: (shown) =>
      game !== undefined &&
      game.gameId === shown.gameId &&
      game.moveNumber === shown.moveNumber,

    subject: () =>
      game === undefined ? '' : `${game.gameId}:${game.moveNumber}`,

    say(text) {
      note = text;
      render();
    },

    markGone() {
      stopWait();
      gone = true;
      render();
    },

    lock() {
      const token = {};
      locks.add(token);
      render();
      return token;
    },

    unlock(token) {
      locks.delete(token);
      render();
    },

    async recover() {
      const shown = game;
      if (shown === undefined) return;
      const token = {};
      readings.add(token);
      render();
      const result = await readGame(server, shown.gameId);
      // Selecting another game, or ending the view, drops the token: the answer is ignored.
      if (!readings.delete(token) || retired) return;
      if (result.kind === 'game') {
        controller.present(result.game);
        // The move did land, and nobody told the assistant: it is O's turn and nothing has asked.
        if (result.game.status === 'playing' && result.game.turn === 'O') {
          note = VIEW_TEXT.tellTheAssistant;
          controller.startWait();
        }
      } else if (result.kind === 'gone') controller.markGone();
      else note = VIEW_TEXT.unconfirmed;
      render();
    },

    startWait() {
      const waiting = game;
      if (
        retired ||
        waiting === undefined ||
        waiting.status !== 'playing' ||
        waiting.turn !== 'O'
      )
        return;
      if (wait !== undefined && waitingFor === waiting.gameId) return; // already waiting on this game
      stopWait();
      waitingFor = waiting.gameId;
      const ended = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let reads = 0;
      let failures = 0;
      const mine = {
        stop: () => {
          ended.abort();
          clearTimeout(timer);
        },
      };
      wait = mine;
      assistant = 'waiting';
      render();

      const schedule = (): void => {
        timer = setTimeout(
          () => void tick(),
          reads < WAIT.fastReads ? WAIT.everyMs : WAIT.slowMs,
        );
      };
      const tick = async (): Promise<void> => {
        if (wait !== mine) return;
        reads += 1;
        const result = await readGame(server, waiting.gameId, ended.signal);
        if (wait !== mine) return; // another game, the assistant's move, the limit or the end of the view
        if (result.kind === 'game') {
          failures = 0;
          controller.present(result.game);
          if (wait !== mine) return; // `present` ended the wait: the assistant moved
        } else if (result.kind === 'gone') {
          controller.markGone();
          return;
        }
        if (result.kind === 'failed') failures += 1;
        if (failures >= WAIT.failures) {
          wait = undefined;
          assistant = 'expired';
          render();
          return;
        }
        schedule();
      };
      schedule();
    },

    retire() {
      retired = true;
      wait?.stop();
      wait = undefined;
      surface = undefined;
    },
  };
  return controller;
}
```

</details>

<details>
<summary>Complete src/actions.ts</summary>

```ts file=src/actions.ts
import {
  Action,
  type ActionButtonActivation,
  type ViewHost,
} from '@saga-a2ui/react-mcp-stack';
import {
  GameOutputSchema,
  GET_GAME_TOOL,
  MoveOutputSchema,
  NEW_GAME_TOOL,
  PLAY_MOVE_TOOL,
  type Game,
  type MoveOutput,
} from './contract.js';
import {
  readGameReply,
  replyIsGone,
  type GameController,
} from './controller.js';
import { CONVERSATION, REFUSAL_TEXT, VIEW_TEXT } from './text.js';

// The board's actions, each defined once. A definition is immutable and holds no pending state, so
// one definition can be attached to the nine squares; each attachment keeps its own state. The
// application attaches them (view.tsx); no markup names them.

type Reply = Awaited<ReturnType<ViewHost['server']['callServerTool']>>;

/** The server said the game is not there. Nothing was played. */
class GameGone extends Error {}

/** `play_move`'s reply, or why it is not one. Anything but "gone" leaves the move's fate unknown. */
function readMove(reply: Reply): MoveOutput {
  if (replyIsGone(reply)) throw new GameGone('the game is gone');
  const parsed = MoveOutputSchema.safeParse(reply.structuredContent);
  if (reply.isError === true || !parsed.success)
    throw new Error('the reply could not be read');
  return parsed.data;
}

export function createGameActions(host: ViewHost, game: GameController) {
  // #region saga-snippet:play-square-action
  /** The square action: one definition for all nine squares. Its subject is the game and move. */
  const playSquare = Action.server<ActionButtonActivation, Reply>(
    'play-square',
    host.server,
  )
    .input((event) => {
      const shown = game.current();
      if (shown === undefined) throw new Error('no game is on screen');
      return {
        gameId: shown.gameId,
        expectedMoveNumber: shown.moveNumber,
        square: Number(event.read('index')),
      };
    })
    // Inside the event turn: the squares go off until this request is settled.
    .atActivation(({ scope }) =>
      scope.own(game.lock(), (token) => game.unlock(token)),
    )
    .run(async ({ params, call }) =>
      readMove(await call(PLAY_MOVE_TOOL, { ...params, player: 'X' })),
    )
    .onSuccess(({ result, current }) => {
      if (!current()) return; // another game or move is on screen
      game.present(result.game);
      if (result.outcome === 'refused') {
        // Nothing changed on the server. The board shows the current game and says why.
        game.say(REFUSAL_TEXT[result.reason ?? 'stale_move']);
        // If the current game is waiting for the assistant, the board waits for it too.
        game.startWait();
        return;
      }
      handOver(result.game);
    })
    .onFailure((context) => {
      if (context.stage !== 'running' || !context.current()) return;
      const { failure } = context;
      if (failure.kind === 'handler-error' && failure.error instanceof GameGone)
        game.markGone();
      // A failed or timed-out request may or may not have been applied: read the game again
      // before offering a square.
      else void game.recover();
    })
    .build();
  // #endregion saga-snippet:play-square-action

  /**
   * Gives the assistant its turn, or reports the end of the game. The append is started here and
   * not waited for: a host may wait for the person to confirm the message, and the action's
   * `current()` is already false when it settles. So the outcome is applied only while the board
   * still shows this game and move.
   */
  function handOver(played: Game): void {
    const shown = { gameId: played.gameId, moveNumber: played.moveNumber };
    const playing = played.status === 'playing';
    const appended = playing
      ? host.conversation.appendMessage(CONVERSATION.yourMove(played.gameId), {
          // Best effort: the message tells the assistant to read get_game if the board is missing.
          context: {
            text: CONVERSATION.boardForAssistant(played),
            data: { game: played },
            bestEffort: true,
          },
        })
      : host.conversation.appendMessage(CONVERSATION.result(played));
    if (playing) game.startWait();
    void appended.then((outcome) => {
      if (!game.isShowing(shown)) return; // a newer game or move is on screen
      if (outcome.outcome !== 'appended')
        game.say(
          playing
            ? VIEW_TEXT.tellTheAssistant
            : VIEW_TEXT.tellTheAssistantResult,
        );
    });
  }

  /** New game: asks the server for a game and selects it. Nothing from an old request can reach it. */
  const newGame = Action.server<ActionButtonActivation, Reply>(
    'new-game',
    host.server,
  )
    .run(async ({ call }) => {
      const reply = await call(NEW_GAME_TOOL, {});
      const parsed = GameOutputSchema.safeParse(reply.structuredContent);
      if (reply.isError === true || !parsed.success)
        throw new Error('the reply could not be read');
      return parsed.data.game;
    })
    .onSuccess(({ result, current }) => {
      if (!current()) return;
      game.present(result, 'select');
    })
    .onFailure((context) => {
      if (context.stage === 'running' && context.current())
        game.say(VIEW_TEXT.problem);
    })
    .build();

  /** "Check for the assistant's move": one read, shown if it is newer. It retries nothing. */
  const checkForMove = Action.server<ActionButtonActivation, Reply>(
    'check-move',
    host.server,
  )
    .input(() => {
      const shown = game.current();
      if (shown === undefined) throw new Error('no game is on screen');
      return { gameId: shown.gameId };
    })
    .run(({ params, call }) => call(GET_GAME_TOOL, params))
    .onSuccess(({ result, current }) => {
      if (!current()) return;
      const read = readGameReply(result);
      if (read.kind === 'gone') game.markGone();
      else if (read.kind === 'failed') game.say(VIEW_TEXT.unconfirmed);
      else {
        const before = game.current()?.moveNumber;
        game.present(read.game);
        if (read.game.moveNumber === before) game.say(VIEW_TEXT.stillWaiting);
      }
    })
    .onFailure((context) => {
      if (context.stage === 'running' && context.current())
        game.say(VIEW_TEXT.unconfirmed);
    })
    .build();

  return { playSquare, newGame, checkForMove };
}
```

</details>

<details>
<summary>Complete src/view.tsx</summary>

```tsx file=src/view.tsx
import {
  ActionButton,
  createReactActions,
  startA2uiView,
} from '@saga-a2ui/react-mcp-stack';
import { createGameActions } from './actions.js';
import { boardCatalog } from './catalog.js';
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

  const view = startA2uiView({
    container,
    layout: boardSurface,
    catalog: boardCatalog,
    identity: { name: 'saga-tic-tac-toe-view', version: '0.0.0' },
    actions: (host) => {
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
        // A card opened on a game that is waiting for the assistant waits for it too.
        game.startWait();
      } else
        game.say(read.kind === 'gone' ? VIEW_TEXT.gone : VIEW_TEXT.problem);
    },
    // The stack has retired the surface, which ended its action bindings, before this runs. This
    // ends only what the application owns itself: the wait.
    onTeardown: () => controller?.retire(),
  });
  await view.ready;
}
```

</details>

## Play and check the flow

Run `npm run typecheck`, `npm run build`, then `npm start`. Return to [Build and play the game](../build-tic-tac-toe-with-react.md#3-build-and-play-the-game) to refresh the host's tools and open the board in a new chat.

Click the centre square. X should appear there and the board should disable its empty squares while O has the turn. Confirm the generated message if the host asks. O's move should appear in this same board, then the remaining squares should become available. Finish a game and use **New game** to start another.

To check your understanding, find the two places that prevent a move on an occupied square: the layout disables the control, and the server rules refuse the move. The server check is still needed because an assistant or another client can call the tool without using your board.

When this works, [add a move list](3-move-list.md) by extending the catalog and layout.
