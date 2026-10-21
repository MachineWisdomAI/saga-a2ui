import type { AudioPlayer } from './playback-view.js';

// The application's resource owner for the one foreground player. A Play invocation takes a lease
// from it in the synchronous activation prefix, and the shared action runtime hands the lease back
// by calling `end(lease)` when the invocation did not transfer it. The runtime never names the
// owner's whole-player `stop()`: `end` is scoped to the lease it was given, so a late release for
// an old acquisition cannot reach a newer player, and `teardown` (stopping everything the owner
// holds) is only ever called by the application's own selection, label, teardown and disposal paths.

/** One acquisition of the player. Opaque outside this module: only the owner reads its fields. */
export interface PlaybackLease {
  readonly id: number;
}

/** The lease was superseded or ended before the work that needed it finished. */
export class LeaseEndedError extends Error {
  constructor() {
    super('The playback lease is no longer current.');
    this.name = 'LeaseEndedError';
  }
}

export interface PlayerOwner {
  /**
   * Ends whatever played and prepares the player for a new lease, synchronously, inside the user's
   * activation. Throws when the browser cannot prepare audio; no lease exists then.
   */
  begin(): PlaybackLease;
  /**
   * Decodes and starts `bytes` for `lease`. Resolves `blocked` when the browser withheld audio and
   * needs a new gesture. Rejects with `LeaseEndedError` when the lease was superseded or ended
   * meanwhile, and with the player's own error when the bytes cannot be played.
   */
  start(
    lease: PlaybackLease,
    bytes: ArrayBuffer,
  ): Promise<'started' | 'blocked'>;
  /**
   * Synchronous hand-off from an invocation: the owner now holds `lease` as the running player and
   * the invocation's scope must not release it. Throws `LeaseEndedError` when the lease is no
   * longer current, which leaves the release with the scope.
   */
  retain(lease: PlaybackLease): void;
  /** Ends exactly this lease. Idempotent, and a no-op for a lease that is not current. */
  end(lease: PlaybackLease): void;
  isCurrent(lease: PlaybackLease): boolean;
  /** The lease the player is running under now, if any. */
  current(): PlaybackLease | undefined;
  /** Whether the audio under this lease reached its end, even before `start` was confirmed. */
  hasEnded(lease: PlaybackLease): boolean;
  /** Suspends the audio of this lease; called synchronously inside the user's activation. */
  pause(lease: PlaybackLease): Promise<void>;
  /** Continues the audio of this lease; called synchronously inside the user's activation. */
  resume(lease: PlaybackLease): Promise<'resumed' | 'blocked'>;
  /** The application's own whole-owner stop: ends every lease and releases the player. */
  teardown(): void;
  /** Registers the one listener told when the audio of the current lease reaches its end. */
  onEnded(listener: (lease: PlaybackLease) => void): void;
}

interface Held extends PlaybackLease {
  ended: boolean;
}

export function createPlayerOwner(player: AudioPlayer): PlayerOwner {
  let counter = 0;
  let held: Held | undefined;
  let endedListener: ((lease: PlaybackLease) => void) | undefined;

  const mine = (lease: PlaybackLease): lease is Held =>
    held !== undefined && lease === held;

  player.onEnded(() => {
    const lease = held;
    if (lease === undefined) return;
    lease.ended = true; // remembered even if the start has not been confirmed yet
    endedListener?.(lease);
  });

  const stopAll = (): void => {
    held = undefined;
    player.stop();
  };

  return {
    begin() {
      // Stopping releases the player's context, so preparing before it would destroy the context
      // this activation just unlocked.
      stopAll();
      player.prepare();
      const lease: Held = { id: (counter += 1), ended: false };
      held = lease;
      return lease;
    },
    async start(lease, bytes) {
      if (!mine(lease)) throw new LeaseEndedError();
      const started = await player.start(bytes);
      if (!mine(lease)) {
        // A start that settles for a superseded lease must not touch a newer player. Only when the
        // owner holds nothing now is there audio of this lease left to release.
        if (held === undefined) player.stop();
        throw new LeaseEndedError();
      }
      return started;
    },
    retain(lease) {
      if (!mine(lease)) throw new LeaseEndedError();
    },
    end(lease) {
      if (mine(lease)) stopAll();
    },
    isCurrent: (lease) => mine(lease),
    current: () => held,
    hasEnded: (lease) => mine(lease) && lease.ended,
    pause(lease) {
      if (!mine(lease)) return Promise.reject(new LeaseEndedError());
      return player.pause();
    },
    resume(lease) {
      if (!mine(lease)) return Promise.reject(new LeaseEndedError());
      return player.resume();
    },
    teardown: stopAll,
    onEnded(listener) {
      endedListener = listener;
    },
  };
}
