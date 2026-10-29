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
