import { describe, expect, it } from 'vitest';
import { createServerBudgets } from './lifetime.js';

// Real timers on purpose: these cases are about a deadline passing while the timer that would announce
// it has not been delivered (synchronous work), and about limits no native timer can hold. Neither is
// reproducible with a clock the test advances by hand.

/** Blocks the thread, so the promise continuation that follows runs before any timer. */
const blockFor = (ms: number) => {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    // Synchronous work that overruns the limit.
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('absolute deadlines are checked when a stage settles, not only when a timer fires', () => {
  it('refuses a result produced by synchronous work that overran the operation limit', async () => {
    const lifetime = createServerBudgets({ operationMs: 5, requestMs: 5_000 }).startRequest();
    const outcome = await lifetime.run('handler', () => {
      blockFor(20);
      return 'late but ready';
    });
    expect(outcome).toMatchObject({ ok: false, cause: { kind: 'operation-timeout', stage: 'handler', limitMs: 5 } });
    lifetime.finish();
  });

  it('refuses the same result from async work, whose continuation beats the timer', async () => {
    const lifetime = createServerBudgets({ operationMs: 5, requestMs: 5_000 }).startRequest();
    const outcome = await lifetime.run('handler', async () => {
      await Promise.resolve();
      blockFor(20);
      return 'late but ready';
    });
    expect(outcome).toMatchObject({ ok: false, cause: { kind: 'operation-timeout', limitMs: 5 } });
    lifetime.finish();
  });

  it('reports the expired limit, not the dependency error, when a late failure arrives after the deadline', async () => {
    const lifetime = createServerBudgets({ operationMs: 5, requestMs: 5_000 }).startRequest();
    const outcome = await lifetime.run('storage', async () => {
      blockFor(20);
      throw new Error('slow failure');
    });
    expect(outcome).toMatchObject({ ok: false, cause: { kind: 'operation-timeout', stage: 'storage' } });
    lifetime.finish();
  });

  it('ends the request deadline too when synchronous work overran it', async () => {
    const lifetime = createServerBudgets({ operationMs: 5_000, requestMs: 10 }).startRequest();
    const outcome = await lifetime.run('handler', () => {
      blockFor(30);
      return 'late but ready';
    });
    expect(outcome).toMatchObject({ ok: false, cause: { kind: 'request-timeout' } });
    expect(lifetime.cause).toMatchObject({ kind: 'request-timeout' });
  });

  it('lets work that finishes inside its limit through', async () => {
    const lifetime = createServerBudgets({ operationMs: 500 }).startRequest();
    expect(await lifetime.run('handler', async () => 'fine')).toEqual({ ok: true, value: 'fine' });
    lifetime.finish();
  });

  it('reports an overdue scope from check() and refuses to start nested work in it', async () => {
    const lifetime = createServerBudgets({ operationMs: 5, requestMs: 5_000 }).startRequest();
    let nested = 0;
    let sawCause: unknown;
    await lifetime.run('handler', async (scope) => {
      blockFor(20);
      sawCause = scope.check();
      await scope.run('storage', () => void (nested += 1));
    });
    expect(sawCause).toMatchObject({ kind: 'operation-timeout', limitMs: 5 });
    expect(nested).toBe(0);
    lifetime.finish();
  });
});

describe('nested operations resolve their own limit', () => {
  it('gives a nested stage with no override the SDK-instance operation limit, even inside a longer handler override', async () => {
    const lifetime = createServerBudgets({ operationMs: 60, requestMs: 5_000 }).startRequest();
    const begun = performance.now();
    const handler = await lifetime.run('handler', (scope) => scope.run('storage', () => new Promise<never>(() => undefined)), { limitMs: 2_000 });
    const outcome = handler.ok ? handler.value : handler; // the nested stage's own result: it gave up, the handler did not
    expect(outcome).toMatchObject({ ok: false, cause: { kind: 'operation-timeout', stage: 'storage', limitMs: 60 } });
    expect(performance.now() - begun).toBeLessThan(1_000);
    lifetime.finish();
  });

  it('still clamps a nested override to what the enclosing operation has left', async () => {
    const lifetime = createServerBudgets({ operationMs: 60, requestMs: 5_000 }).startRequest();
    const begun = performance.now();
    const handler = await lifetime.run('handler', (scope) => scope.run('storage', () => new Promise<never>(() => undefined), { limitMs: 4_000 }));
    expect(handler).toMatchObject({ ok: false, cause: { kind: 'operation-timeout', limitMs: 60 } }); // the handler's own 60 ms ended both
    expect(performance.now() - begun).toBeLessThan(1_000);
    lifetime.finish();
  });
});

describe('accepted large finite budgets are preserved', () => {
  it('does not expire a request whose limit exceeds the native timer maximum', async () => {
    const lifetime = createServerBudgets({ operationMs: 3_000_000_000, requestMs: 3_000_000_000 }).startRequest();
    const outcome = lifetime.run('handler', async () => {
      await sleep(80); // a 32-bit overflow would have expired both limits after about a millisecond
      return 'done';
    });
    expect(await outcome).toEqual({ ok: true, value: 'done' });
    expect(lifetime.cause).toBeUndefined();
    lifetime.finish();
  });

  it('does not expire a stage limit above the native timer maximum', async () => {
    const lifetime = createServerBudgets().startRequest();
    const outcome = await lifetime.run(
      'storage',
      async () => {
        await sleep(80);
        return 'done';
      },
      { limitMs: 3_000_000_000 },
    );
    expect(outcome).toEqual({ ok: true, value: 'done' });
    lifetime.finish();
  });
});
