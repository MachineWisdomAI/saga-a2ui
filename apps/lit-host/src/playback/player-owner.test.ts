import { describe, expect, it } from 'vitest';
import { createPlayerOwner, LeaseEndedError } from './player-owner.js';
import type { AudioPlayer } from './playback-view.js';

// The application's resource owner for the one foreground player, exercised through its own
// interface with a recording player. The invariants: a release is scoped to the lease it names, an
// old acquisition can never end a newer one, and the whole-owner stop is a separate call.

interface Recorded extends AudioPlayer {
  readonly calls: string[];
  /** Settles the next `start` when the test chooses. */
  holdNextStart(): { resolve(outcome?: 'started' | 'blocked'): void };
  end(): void;
}

function recordingPlayer(): Recorded {
  let ended: (() => void) | undefined;
  let hold = false;
  let release: ((outcome: 'started' | 'blocked') => void) | undefined;
  const player: Recorded = {
    calls: [],
    prepare: () => void player.calls.push('prepare'),
    start() {
      player.calls.push('start');
      if (!hold) return Promise.resolve('started');
      hold = false;
      return new Promise((resolve) => void (release = resolve));
    },
    pause: () => (player.calls.push('pause'), Promise.resolve()),
    resume: () => (
      player.calls.push('resume'),
      Promise.resolve('resumed' as const)
    ),
    stop: () => void player.calls.push('stop'),
    onEnded: (listener) => void (ended = listener),
    holdNextStart() {
      hold = true;
      return { resolve: (outcome = 'started') => release?.(outcome) };
    },
    end: () => ended?.(),
  };
  return player;
}

const bytes = new ArrayBuffer(4);

describe('the player owner’s leases', () => {
  it('prepares a new lease after stopping what played, so the unlocked context is the one that starts', () => {
    const player = recordingPlayer();
    const owner = createPlayerOwner(player);

    owner.begin();

    expect(player.calls).toEqual(['stop', 'prepare']);
  });

  it('gives no lease when the browser cannot prepare audio', () => {
    const player = recordingPlayer();
    player.prepare = () => {
      throw new Error('no audio');
    };
    const owner = createPlayerOwner(player);

    expect(() => owner.begin()).toThrow('no audio');
    expect(owner.current()).toBeUndefined();
  });

  it('ends exactly the lease it is given, and ending it twice stops nothing more', () => {
    const player = recordingPlayer();
    const owner = createPlayerOwner(player);
    const lease = owner.begin();
    player.calls.length = 0;

    owner.end(lease);
    owner.end(lease);

    expect(player.calls).toEqual(['stop']);
    expect(owner.isCurrent(lease)).toBe(false);
  });

  it('lets an old lease’s release do nothing to a newer lease’s player', () => {
    const player = recordingPlayer();
    const owner = createPlayerOwner(player);
    const older = owner.begin();
    const newer = owner.begin();
    player.calls.length = 0;

    owner.end(older); // the late release of the superseded acquisition

    expect(player.calls).toEqual([]);
    expect(owner.isCurrent(newer)).toBe(true);
  });

  it('rejects a start for a superseded lease, and leaves the newer player alone', async () => {
    const player = recordingPlayer();
    const owner = createPlayerOwner(player);
    const older = owner.begin();
    const held = player.holdNextStart();
    const starting = owner.start(older, bytes);
    const newer = owner.begin();
    player.calls.length = 0;

    held.resolve('started');

    await expect(starting).rejects.toBeInstanceOf(LeaseEndedError);
    expect(player.calls).toEqual([]);
    expect(owner.isCurrent(newer)).toBe(true);
  });

  it('releases the player when a superseded start settles and no lease holds it any more', async () => {
    const player = recordingPlayer();
    const owner = createPlayerOwner(player);
    const lease = owner.begin();
    const held = player.holdNextStart();
    const starting = owner.start(lease, bytes);
    owner.teardown();
    player.calls.length = 0;

    held.resolve('started');

    await expect(starting).rejects.toBeInstanceOf(LeaseEndedError);
    expect(player.calls).toEqual(['stop']);
  });

  it('refuses to start, pause or resume a lease it no longer holds', async () => {
    const owner = createPlayerOwner(recordingPlayer());
    const lease = owner.begin();
    owner.begin();

    await expect(owner.start(lease, bytes)).rejects.toBeInstanceOf(
      LeaseEndedError,
    );
    await expect(owner.pause(lease)).rejects.toBeInstanceOf(LeaseEndedError);
    await expect(owner.resume(lease)).rejects.toBeInstanceOf(LeaseEndedError);
  });

  it('hands a lease over only while it is current, and a refused hand-over leaves the release to the caller', () => {
    const owner = createPlayerOwner(recordingPlayer());
    const older = owner.begin();
    const newer = owner.begin();

    expect(() => owner.retain(older)).toThrow(LeaseEndedError);
    expect(() => owner.retain(newer)).not.toThrow();
  });

  it('remembers an end that arrives before the start is confirmed, for that lease only', async () => {
    const player = recordingPlayer();
    const owner = createPlayerOwner(player);
    const heard: number[] = [];
    owner.onEnded((lease) => void heard.push(lease.id));
    const lease = owner.begin();
    const held = player.holdNextStart();
    const starting = owner.start(lease, bytes);

    player.end(); // a very short episode finished before the start resolved
    held.resolve('started');
    await starting;

    expect(owner.hasEnded(lease)).toBe(true);
    expect(heard).toEqual([lease.id]);
    expect(owner.hasEnded(owner.begin())).toBe(false);
  });

  it('ignores an end when no lease holds the player', () => {
    const player = recordingPlayer();
    const owner = createPlayerOwner(player);
    const heard: unknown[] = [];
    owner.onEnded((lease) => void heard.push(lease));

    player.end();

    expect(heard).toEqual([]);
  });

  it('stops everything it holds when the application tears it down', () => {
    const player = recordingPlayer();
    const owner = createPlayerOwner(player);
    const lease = owner.begin();
    player.calls.length = 0;

    owner.teardown();

    expect(player.calls).toEqual(['stop']);
    expect(owner.isCurrent(lease)).toBe(false);
    expect(owner.current()).toBeUndefined();
  });
});
