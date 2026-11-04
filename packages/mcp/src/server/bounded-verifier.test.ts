import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VerifierAbandonedError,
  VerifierSaturatedError,
  boundVerifier,
  type CancellableVerifier,
} from './bounded-verifier.js';
import { BudgetConfigurationError, createServerBudgets } from './lifetime.js';

// A verifier that ignores its signal and never answers is the case the request lifetime alone cannot
// stop: the stage gives up waiting, but the call is still running. The bound is on the calls themselves.

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A verifier whose calls the test settles by hand. It records every call and its signal. */
function manual() {
  const calls: {
    token: string;
    signal: AbortSignal | undefined;
    resolve(value: string): void;
    reject(error: unknown): void;
  }[] = [];
  const verifier: CancellableVerifier<string> = {
    verifyAccessToken: (token, signal) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ token, signal, resolve, reject });
      }),
  };
  return { calls, verifier };
}

describe('boundVerifier concurrency cap', () => {
  it('stops calling the verifier once its cap of unsettled calls is reached, and does not queue', async () => {
    const { calls, verifier } = manual();
    const bounded = boundVerifier(verifier, { maxConcurrent: 2 });
    void bounded.verifyAccessToken('a').catch(() => undefined);
    void bounded.verifyAccessToken('b').catch(() => undefined);

    await expect(bounded.verifyAccessToken('c')).rejects.toBeInstanceOf(
      VerifierSaturatedError,
    );
    expect(calls.map((call) => call.token)).toEqual(['a', 'b']); // 'c' never reached the application
  });

  it('keeps counting a call whose caller gave up, because the work is still running', async () => {
    const { calls, verifier } = manual();
    const bounded = boundVerifier(verifier, { maxConcurrent: 1 });
    const budgets = createServerBudgets({ operationMs: 5, requestMs: 5_000 });
    const lifetime = budgets.startRequest();
    const stage = await lifetime.run('authentication', (scope) =>
      bounded.verifyAccessToken('slow', scope.signal),
    );
    expect(stage).toMatchObject({ ok: false }); // the request stopped waiting …

    await expect(bounded.verifyAccessToken('next')).rejects.toBeInstanceOf(
      VerifierSaturatedError,
    ); // … but the call is not free
    expect(calls).toHaveLength(1);
    lifetime.finish();
  });

  it('frees the slot when the call settles, whichever way it ends', async () => {
    const { calls, verifier } = manual();
    const bounded = boundVerifier(verifier, { maxConcurrent: 1 });

    const first = bounded.verifyAccessToken('one');
    calls[0]?.resolve('ok');
    await expect(first).resolves.toBe('ok');

    const second = bounded.verifyAccessToken('two');
    calls[1]?.reject(new Error('provider down'));
    await expect(second).rejects.toThrow('provider down'); // passes through unchanged

    const third = bounded.verifyAccessToken('three');
    expect(calls).toHaveLength(3);
    calls[2]?.resolve('ok');
    await expect(third).resolves.toBe('ok');
  });

  it('frees the slot when the verifier throws synchronously, and passes the error through', async () => {
    const bounded = boundVerifier(
      {
        verifyAccessToken() {
          throw new Error('broken verifier');
        },
      } as CancellableVerifier<string>,
      { maxConcurrent: 1 },
    );
    await expect(bounded.verifyAccessToken('x')).rejects.toThrow(
      'broken verifier',
    );
    await expect(bounded.verifyAccessToken('y')).rejects.toThrow(
      'broken verifier',
    ); // not saturated: the failed call released its slot
  });
});

describe('boundVerifier cancellation', () => {
  it('aborts the signal the verifier received when the caller’s signal aborts', async () => {
    const { calls, verifier } = manual();
    const bounded = boundVerifier(verifier);
    const caller = new AbortController();
    void bounded.verifyAccessToken('t', caller.signal).catch(() => undefined);
    expect(calls[0]?.signal?.aborted).toBe(false);
    caller.abort(new Error('stage over'));
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('hands a verifier that honors its signal a way to stop, and frees the slot when it does', async () => {
    let reached = 0;
    const bounded = boundVerifier<string>(
      {
        verifyAccessToken: (_token, signal) => {
          reached += 1;
          return new Promise<string>((_resolve, reject) => {
            const stop = () => reject(new Error('stopped'));
            if (signal?.aborted) stop();
            else signal?.addEventListener('abort', stop);
          });
        },
      },
      { maxConcurrent: 1 },
    );
    const caller = new AbortController();
    const call = bounded.verifyAccessToken('t', caller.signal);
    caller.abort();
    await expect(call).rejects.toThrow('stopped');
    await settle();
    const again = bounded.verifyAccessToken('u', AbortSignal.abort()); // slot is free: this reaches the verifier
    await expect(again).rejects.toThrow('stopped');
    expect(reached).toBe(2);
  });

  it('abandons a call that never settles at its limit: aborts its signal and ends the wait, but keeps the slot', async () => {
    const { calls, verifier } = manual();
    const bounded = boundVerifier(verifier, {
      maxConcurrent: 1,
      abandonMs: 20,
    });
    const stuck = bounded.verifyAccessToken('stuck');
    await expect(bounded.verifyAccessToken('blocked')).rejects.toBeInstanceOf(
      VerifierSaturatedError,
    );

    await expect(stuck).rejects.toBeInstanceOf(VerifierAbandonedError); // the caller is not held past the limit
    expect(calls[0]?.signal?.aborted).toBe(true);
    await expect(bounded.verifyAccessToken('after')).rejects.toBeInstanceOf(
      VerifierSaturatedError,
    ); // the work did not stop, so its slot is not recycled
    expect(calls.map((call) => call.token)).toEqual(['stuck']);
  });

  it('frees the slot of an abandoned call only when the verifier finally settles, and observes a late rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const { calls, verifier } = manual();
      const bounded = boundVerifier(verifier, {
        maxConcurrent: 1,
        abandonMs: 10,
      });
      await expect(bounded.verifyAccessToken('late')).rejects.toBeInstanceOf(
        VerifierAbandonedError,
      );
      await expect(bounded.verifyAccessToken('x')).rejects.toBeInstanceOf(
        VerifierSaturatedError,
      );

      calls[0]?.reject(new Error('far too late'));
      await settle();
      await settle();
      expect(unhandled).toEqual([]); // a late outcome is observed, never a process-level error

      const next = bounded.verifyAccessToken('next'); // the slot is free once the work really ended
      calls[1]?.resolve('ok');
      await expect(next).resolves.toBe('ok');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('ignores a late successful answer from an abandoned call, and frees the slot', async () => {
    const { calls, verifier } = manual();
    const bounded = boundVerifier(verifier, {
      maxConcurrent: 1,
      abandonMs: 10,
    });
    const first = bounded.verifyAccessToken('late');
    await expect(first).rejects.toBeInstanceOf(VerifierAbandonedError);
    calls[0]?.resolve('too late'); // the caller already got its answer: this changes nothing
    await settle();
    await expect(first).rejects.toBeInstanceOf(VerifierAbandonedError);
    const next = bounded.verifyAccessToken('next');
    calls[1]?.resolve('ok');
    await expect(next).resolves.toBe('ok');
  });

  it('frees the slot as soon as a cooperative verifier stops after the abandonment abort', async () => {
    let reached = 0;
    const bounded = boundVerifier<string>(
      {
        verifyAccessToken: (_token, signal) => {
          reached += 1;
          return new Promise<string>((_resolve, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new Error('stopped')),
            );
          });
        },
      },
      { maxConcurrent: 1, abandonMs: 10 },
    );
    await expect(bounded.verifyAccessToken('a')).rejects.toBeInstanceOf(
      VerifierAbandonedError,
    );
    await settle();
    // Several windows in a row: each cooperative call ends, so each next call reaches the verifier.
    for (let n = 0; n < 3; n += 1)
      await expect(bounded.verifyAccessToken('b')).rejects.toBeInstanceOf(
        VerifierAbandonedError,
      );
    expect(reached).toBe(4);
  });

  it('does not call a verifier whose caller has already given up with a live slot leaked', async () => {
    const { calls, verifier } = manual();
    const bounded = boundVerifier(verifier, { maxConcurrent: 1 });
    const caller = new AbortController();
    caller.abort();
    void bounded.verifyAccessToken('t', caller.signal).catch(() => undefined);
    expect(calls[0]?.signal?.aborted).toBe(true); // the verifier is told at once
  });
});

describe('boundVerifier legitimate use', () => {
  it('returns the verifier’s answer unchanged, with no signal required', async () => {
    const bounded = boundVerifier<{ token: string }>({
      verifyAccessToken: async (token) => ({ token }),
    });
    await expect(bounded.verifyAccessToken('abc')).resolves.toEqual({
      token: 'abc',
    });
  });

  it('serves up to the cap concurrently and lets the rest in as calls finish', async () => {
    const { calls, verifier } = manual();
    const bounded = boundVerifier(verifier, { maxConcurrent: 3 });
    const results = [1, 2, 3].map((n) => bounded.verifyAccessToken(`t${n}`));
    calls.forEach((call, n) => call.resolve(`ok${n}`));
    await expect(Promise.all(results)).resolves.toEqual(['ok0', 'ok1', 'ok2']);
    const more = [4, 5, 6].map((n) => bounded.verifyAccessToken(`t${n}`));
    calls.slice(3).forEach((call) => call.resolve('ok'));
    await expect(Promise.all(more)).resolves.toEqual(['ok', 'ok', 'ok']);
  });

  it('shares one cap for the same verifier wrapped with default limits', () => {
    const { verifier } = manual();
    expect(boundVerifier(verifier)).toBe(boundVerifier(verifier));
  });

  it.each([
    [{ maxConcurrent: 0 }],
    [{ maxConcurrent: 1.5 }],
    [{ maxConcurrent: Number.NaN }],
    [{ abandonMs: 0 }],
    [{ abandonMs: Number.POSITIVE_INFINITY }],
    [{ abandonMs: -1 }],
  ])('refuses invalid limits %j before anything runs', (limits) => {
    const { verifier } = manual();
    expect(() => boundVerifier(verifier, limits)).toThrow(
      BudgetConfigurationError,
    );
  });
});

describe('boundVerifier actual work across repeated abandonment windows', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  /** Counts verifier calls that have started and not yet settled: the work really running. */
  function counting(ignoreSignal: boolean) {
    const state = { started: 0, running: 0, peak: 0 };
    const verifier: CancellableVerifier<string> = {
      verifyAccessToken: (_token, signal) => {
        state.started += 1;
        state.running += 1;
        state.peak = Math.max(state.peak, state.running);
        return new Promise<string>((_resolve, reject) => {
          if (!ignoreSignal)
            signal?.addEventListener('abort', () => {
              state.running -= 1;
              reject(new Error('stopped'));
            });
        });
      },
    };
    return { state, verifier };
  }

  it('never runs more verifier calls than the cap, however many windows pass, when the verifier ignores cancellation', async () => {
    const { state, verifier } = counting(true);
    const bounded = boundVerifier(verifier, {
      maxConcurrent: 3,
      abandonMs: 50,
    });
    const outcomes: unknown[] = [];
    for (let window = 0; window < 10; window += 1) {
      const wave = Array.from({ length: 8 }, (_unused, n) =>
        bounded.verifyAccessToken(`w${window}-${n}`).catch((error: unknown) => {
          outcomes.push(error);
        }),
      );
      await vi.advanceTimersByTimeAsync(60); // the abandonment window passes
      await Promise.all(wave);
      expect(state.running).toBeLessThanOrEqual(3);
    }
    expect(state.started).toBe(3); // later windows never reached the verifier
    expect(state.peak).toBe(3);
    expect(
      outcomes.filter((error) => error instanceof VerifierAbandonedError),
    ).toHaveLength(3); // the three calls that ran were released from waiting at the limit
    expect(
      outcomes.filter((error) => error instanceof VerifierSaturatedError),
    ).toHaveLength(77);
  });

  it('keeps serving across the same windows when the verifier honors cancellation', async () => {
    const { state, verifier } = counting(false);
    const bounded = boundVerifier(verifier, {
      maxConcurrent: 3,
      abandonMs: 50,
    });
    for (let window = 0; window < 10; window += 1) {
      const wave = Array.from({ length: 3 }, (_unused, n) =>
        bounded
          .verifyAccessToken(`w${window}-${n}`)
          .catch((error: unknown) => error),
      );
      await vi.advanceTimersByTimeAsync(60);
      const errors = await Promise.all(wave);
      expect(errors.every((e) => e instanceof VerifierAbandonedError)).toBe(
        true,
      );
      expect(state.running).toBe(0); // each call really ended, so its slot came back
    }
    expect(state.started).toBe(30);
    expect(state.peak).toBeLessThanOrEqual(3);
  });

  it('lets a partly stuck verifier recover as its stuck calls finally settle', async () => {
    const calls: { resolve(value: string): void }[] = [];
    const bounded = boundVerifier<string>(
      {
        verifyAccessToken: () =>
          new Promise<string>((resolve) => calls.push({ resolve })),
      },
      { maxConcurrent: 2, abandonMs: 50 },
    );
    const stuck = [
      bounded.verifyAccessToken('a'),
      bounded.verifyAccessToken('b'),
    ].map((call) => call.catch((error: unknown) => error));
    await vi.advanceTimersByTimeAsync(60);
    expect(
      (await Promise.all(stuck)).every(
        (e) => e instanceof VerifierAbandonedError,
      ),
    ).toBe(true);
    await expect(bounded.verifyAccessToken('c')).rejects.toBeInstanceOf(
      VerifierSaturatedError,
    );

    calls[0]?.resolve('late'); // one stuck call finally ends: exactly one slot returns
    await vi.advanceTimersByTimeAsync(0);
    const next = bounded.verifyAccessToken('d');
    await expect(bounded.verifyAccessToken('e')).rejects.toBeInstanceOf(
      VerifierSaturatedError,
    );
    calls[2]?.resolve('ok');
    await expect(next).resolves.toBe('ok');
  });
});
