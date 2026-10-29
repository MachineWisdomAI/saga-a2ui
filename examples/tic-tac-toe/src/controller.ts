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

/**
 * About every second and a half for up to a minute. These are proposals; a host run decides them
 * (MCP Apps gives a server no way to push to an open view, so the board reads instead).
 */
export const WAIT = { everyMs: 1_500, reads: 40 } as const;

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
  /** Starts the bounded wait for the assistant's move on the game on screen. */
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
        timer = setTimeout(() => void tick(), WAIT.everyMs);
      };
      const tick = async (): Promise<void> => {
        if (wait !== mine) return;
        reads += 1;
        const result = await readGame(server, waiting.gameId, ended.signal);
        if (wait !== mine) return; // another game, the assistant's move, the limit or the end of the view
        if (result.kind === 'game') {
          controller.present(result.game);
          if (wait !== mine) return; // `present` ended the wait: the assistant moved
        } else if (result.kind === 'gone') {
          controller.markGone();
          return;
        }
        if (reads >= WAIT.reads) {
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
