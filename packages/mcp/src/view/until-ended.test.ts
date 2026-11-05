import { describe, expect, it } from 'vitest';
import { untilEnded } from './until-ended.js';

/** Counts the abort listeners that are added and removed, and so how many remain. */
function watchListeners(signal: AbortSignal): { remaining: () => number } {
  let added = 0;
  let removed = 0;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((...args: Parameters<typeof add>) => {
    added += 1;
    add(...args);
  }) as typeof add;
  signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
    removed += 1;
    remove(...args);
  }) as typeof remove;
  return { remaining: () => added - removed };
}

describe('racing a request against the lifetime that owns it', () => {
  it('returns the request itself when there is no signal', async () => {
    const request = Promise.resolve('answer');
    expect(untilEnded(request)).toBe(request);
  });

  it("answers with the request's own result when it settles first", async () => {
    const lifetime = new AbortController();
    await expect(
      untilEnded(Promise.resolve('answer'), lifetime.signal),
    ).resolves.toBe('answer');
  });

  it("rejects with the request's own rejection when it settles first", async () => {
    const lifetime = new AbortController();
    await expect(
      untilEnded(Promise.reject(new Error('refused')), lifetime.signal),
    ).rejects.toThrow('refused');
  });

  it('settles as soon as the signal aborts when the request never settles', async () => {
    const lifetime = new AbortController();
    const pending = untilEnded(
      new Promise<string>(() => undefined),
      lifetime.signal,
    );
    lifetime.abort();
    await expect(pending).resolves.toBeUndefined();
  });

  it('settles at once for a signal that has already aborted', async () => {
    const lifetime = new AbortController();
    lifetime.abort();
    await expect(
      untilEnded(new Promise<string>(() => undefined), lifetime.signal),
    ).resolves.toBeUndefined();
  });

  it('drops the late result or rejection of a request after the abort', async () => {
    const lifetime = new AbortController();
    let rejectLate: (error: Error) => void = () => undefined;
    const pending = untilEnded(
      new Promise<string>((_, reject) => (rejectLate = reject)),
      lifetime.signal,
    );
    lifetime.abort();
    await expect(pending).resolves.toBeUndefined();
    // Neither an unhandled rejection (the run fails on one) nor a second settlement follows.
    rejectLate(new Error('late'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('handles the rejection of a request that fails after a signal that had already aborted', async () => {
    const lifetime = new AbortController();
    lifetime.abort();
    let rejectLate: (error: Error) => void = () => undefined;
    const pending = untilEnded(
      new Promise<string>((_, reject) => (rejectLate = reject)),
      lifetime.signal,
    );
    await expect(pending).resolves.toBeUndefined();
    rejectLate(new Error('late'));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  describe('the abort listener it owns', () => {
    it('is removed once the request has settled first', async () => {
      const lifetime = new AbortController();
      const listeners = watchListeners(lifetime.signal);
      await untilEnded(Promise.resolve('answer'), lifetime.signal);
      expect(listeners.remaining()).toBe(0);
    });

    it('is removed once the request has rejected first', async () => {
      const lifetime = new AbortController();
      const listeners = watchListeners(lifetime.signal);
      await expect(
        untilEnded(Promise.reject(new Error('refused')), lifetime.signal),
      ).rejects.toThrow('refused');
      expect(listeners.remaining()).toBe(0);
    });

    it('is removed when the signal aborts while the request is outstanding', async () => {
      const lifetime = new AbortController();
      const listeners = watchListeners(lifetime.signal);
      const pending = untilEnded(
        new Promise<string>(() => undefined),
        lifetime.signal,
      );
      expect(listeners.remaining()).toBe(1);
      lifetime.abort();
      await pending;
      expect(listeners.remaining()).toBe(0);
    });

    it('is not left behind by a signal that had already aborted and a request that never settles', async () => {
      const lifetime = new AbortController();
      lifetime.abort();
      const listeners = watchListeners(lifetime.signal);
      await untilEnded(new Promise<string>(() => undefined), lifetime.signal);
      expect(listeners.remaining()).toBe(0);
    });

    it('is not removed twice or added again by the late settlement of the request', async () => {
      const lifetime = new AbortController();
      const listeners = watchListeners(lifetime.signal);
      let resolveLate: (value: string) => void = () => undefined;
      const pending = untilEnded(
        new Promise<string>((resolve) => (resolveLate = resolve)),
        lifetime.signal,
      );
      lifetime.abort();
      await pending;
      resolveLate('late');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(listeners.remaining()).toBe(0);
    });
  });
});
