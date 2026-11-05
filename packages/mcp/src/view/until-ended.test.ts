import { describe, expect, it } from 'vitest';
import { untilEnded } from './until-ended.js';

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
    // Neither an unhandled rejection nor a second settlement follows.
    rejectLate(new Error('late'));
    await Promise.resolve();
  });

  it('removes its abort listener once the request has settled', async () => {
    const lifetime = new AbortController();
    let added = 0;
    let removed = 0;
    const add = lifetime.signal.addEventListener.bind(lifetime.signal);
    const remove = lifetime.signal.removeEventListener.bind(lifetime.signal);
    lifetime.signal.addEventListener = ((...args: Parameters<typeof add>) => {
      added += 1;
      add(...args);
    }) as typeof add;
    lifetime.signal.removeEventListener = ((
      ...args: Parameters<typeof remove>
    ) => {
      removed += 1;
      remove(...args);
    }) as typeof remove;
    await untilEnded(Promise.resolve('answer'), lifetime.signal);
    expect([added, removed]).toEqual([1, 1]);
  });
});
