import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OPERATION_MS, DEFAULT_REQUEST_MS } from '../policy/index.js';
import { BudgetConfigurationError, createServerBudgets, StageFailure, type LifetimeCause } from './lifetime.js';

// The lifetime is portable (no Node HTTP types), so it is exercised directly with fake timers: a
// request deadline starts at admission, every wait is clamped to what remains, and nothing that
// happens inside a stage (progress, retries, later stages) renews an enclosing budget.

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const never = () => new Promise<never>(() => undefined);
const causeOf = async (outcome: Promise<{ ok: boolean; cause?: LifetimeCause }>) => (await outcome).cause;

describe('budget configuration', () => {
  it('defaults to 3,000 ms per operation and 10,000 ms per request', () => {
    const budgets = createServerBudgets();
    expect([budgets.operationMs, budgets.requestMs]).toEqual([3_000, 10_000]);
    expect([DEFAULT_OPERATION_MS, DEFAULT_REQUEST_MS]).toEqual([3_000, 10_000]);
  });

  it('resolves each field independently: route override, then SDK instance, then default', () => {
    const instance = createServerBudgets({ operationMs: 1_500 });
    expect([instance.operationMs, instance.requestMs]).toEqual([1_500, 10_000]);
    const route = instance.forRoute({ requestMs: 4_000 });
    expect([route.operationMs, route.requestMs]).toEqual([1_500, 4_000]);
    const both = instance.forRoute({ operationMs: 200, requestMs: 400 });
    expect([both.operationMs, both.requestMs]).toEqual([200, 400]);
  });

  it('keeps two SDK instances apart and snapshots the settings it was given', () => {
    const settings = { operationMs: 700 };
    const first = createServerBudgets(settings);
    const second = createServerBudgets({ operationMs: 900 });
    settings.operationMs = 1;
    expect([first.operationMs, second.operationMs]).toEqual([700, 900]);
  });

  it.each([
    ['a string', '3000'],
    ['zero', 0],
    ['a negative number', -1],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['null', null],
  ])('rejects %s before anything runs, even for a field a route would shadow', (_name, bad) => {
    const invalid = bad as unknown as number;
    expect(() => createServerBudgets({ operationMs: invalid })).toThrow(BudgetConfigurationError);
    expect(() => createServerBudgets({ requestMs: invalid })).toThrow(BudgetConfigurationError);
    // The route sets both fields, so the instance value is shadowed; it is still validated.
    expect(() => createServerBudgets({ operationMs: invalid }).forRoute({ operationMs: 5, requestMs: 5 })).toThrow(BudgetConfigurationError);
    expect(() => createServerBudgets().forRoute({ requestMs: invalid })).toThrow(BudgetConfigurationError);
  });
});

describe('one request deadline', () => {
  it('starts at admission and retires the request at the configured limit, whatever stage is waiting', async () => {
    const lifetime = createServerBudgets({ requestMs: 1_000 }).startRequest();
    const waiting = lifetime.run('authentication', never);
    await vi.advanceTimersByTimeAsync(999);
    expect(lifetime.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await causeOf(waiting)).toMatchObject({ kind: 'request-timeout', stage: 'authentication', effect: 'none' });
    expect(lifetime.signal.aborted).toBe(true);
  });

  it('gives a later stage only what the earlier stages left', async () => {
    const lifetime = createServerBudgets({ operationMs: 3_000, requestMs: 1_000 }).startRequest();
    const authenticated = lifetime.run('authentication', () => new Promise((resolve) => setTimeout(resolve, 800)));
    await vi.advanceTimersByTimeAsync(800);
    await authenticated;
    const body = lifetime.run('body', never);
    await vi.advanceTimersByTimeAsync(200);
    expect(await causeOf(body)).toMatchObject({ kind: 'request-timeout', stage: 'body' });
  });

  it('never lets an operation limit above the request limit extend the request', async () => {
    const lifetime = createServerBudgets({ operationMs: 60_000, requestMs: 500 }).startRequest();
    const handler = lifetime.run('handler', never);
    await vi.advanceTimersByTimeAsync(500);
    expect(await causeOf(handler)).toMatchObject({ kind: 'request-timeout' });
  });

  it('times a single operation out at its own limit while the request stays live', async () => {
    const lifetime = createServerBudgets({ operationMs: 300, requestMs: 10_000 }).startRequest();
    const lookup = lifetime.run('authorization', never);
    await vi.advanceTimersByTimeAsync(300);
    expect(await causeOf(lookup)).toMatchObject({ kind: 'operation-timeout', stage: 'authorization', limitMs: 300, effect: 'unknown' });
    expect(lifetime.signal.aborted).toBe(false);
    // A sibling may begin its own operation budget because the request budget remains.
    expect((await lifetime.run('storage', () => 'bytes')).ok).toBe(true);
  });

  it('starts no stage after the request has been retired', async () => {
    const lifetime = createServerBudgets({ requestMs: 100 }).startRequest();
    await vi.advanceTimersByTimeAsync(100);
    const work = vi.fn();
    const outcome = await lifetime.run('body', work);
    expect(work).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, cause: { kind: 'request-timeout' } });
  });

  it('clears the request timer when the response finishes, and refuses later stages', async () => {
    const lifetime = createServerBudgets({ requestMs: 100 }).startRequest();
    lifetime.finish();
    expect(vi.getTimerCount()).toBe(0);
    const work = vi.fn();
    expect(await lifetime.run('handler', work)).toMatchObject({ ok: false, cause: { kind: 'completed' } });
    expect(work).not.toHaveBeenCalled();
  });

  it('records a disconnect as its own cause and stops waiting stages', async () => {
    const lifetime = createServerBudgets().startRequest();
    const waiting = lifetime.run('body', never);
    lifetime.disconnect();
    expect(await causeOf(waiting)).toMatchObject({ kind: 'disconnected', stage: 'body' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps two requests on one instance independent', async () => {
    const budgets = createServerBudgets({ requestMs: 100 });
    const first = budgets.startRequest();
    await vi.advanceTimersByTimeAsync(60);
    const second = budgets.startRequest();
    await vi.advanceTimersByTimeAsync(40);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(second.remainingMs()).toBe(60);
  });

  it('lets a request that released its budget (an established stream) outlive the limit', async () => {
    const lifetime = createServerBudgets({ requestMs: 100 }).startRequest();
    lifetime.releaseRequestBudget();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lifetime.signal.aborted).toBe(false);
    // Each later finite operation still has its operation bound.
    const lookup = lifetime.run('storage', never, { limitMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await causeOf(lookup)).toMatchObject({ kind: 'operation-timeout' });
  });
});

describe('nested operations', () => {
  it('shares one aggregate budget across sequential nested waits and retries', async () => {
    const lifetime = createServerBudgets({ operationMs: 3_000, requestMs: 10_000 }).startRequest();
    const attempts: LifetimeCause['kind'][] = [];
    const handler = lifetime.run('handler', async (scope) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const outcome = await scope.run('storage', () => new Promise((resolve) => setTimeout(resolve, 1_000)).then(() => Promise.reject(new Error('transient'))));
        if (!outcome.ok) attempts.push(outcome.cause.kind);
      }
    }, { limitMs: 2_500 });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await handler;
    // Two attempts used 2,000 ms, the third was clamped to the remaining 500 ms and the aggregate expired.
    expect(attempts.slice(0, 2)).toEqual(['dependency-failure', 'dependency-failure']);
    expect(result).toMatchObject({ ok: false, cause: { kind: 'operation-timeout', stage: 'handler', limitMs: 2_500 } });
  });

  it('clamps a nested wait to the parent remainder even when its own limit is larger', async () => {
    const lifetime = createServerBudgets({ operationMs: 1_000, requestMs: 10_000 }).startRequest();
    let nestedCause: LifetimeCause | undefined;
    const handler = lifetime.run('handler', async (scope) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const nested = await scope.run('storage', never, { limitMs: 5_000 });
      if (!nested.ok) nestedCause = nested.cause;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await handler;
    expect(nestedCause).toMatchObject({ kind: 'operation-timeout', stage: 'handler' });
  });

  it('cannot renew an enclosing deadline through progress, callbacks or a revisited stage', async () => {
    const lifetime = createServerBudgets({ operationMs: 500, requestMs: 10_000 }).startRequest();
    const handler = lifetime.run('handler', async (scope) => {
      // A stage that keeps revisiting its dependency; the loop ends only when the aggregate does.
      while ((await scope.run('dependency', () => new Promise((resolve) => setTimeout(resolve, 100)))).ok);
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(await causeOf(handler)).toMatchObject({ kind: 'operation-timeout', limitMs: 500 });
  });

  it('aborts the signal handed to uncooperative work and ignores its late result', async () => {
    const lifetime = createServerBudgets({ operationMs: 100 }).startRequest();
    let seen: AbortSignal | undefined;
    const late = new Promise<string>((resolve) => setTimeout(() => resolve('late'), 500));
    const outcome = lifetime.run('storage', (scope) => {
      seen = scope.signal;
      return late;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toMatchObject({ ok: false });
    expect(seen?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(vi.getTimerCount()).toBe(1); // only the request deadline remains
  });

  it('never starts work for a pre-aborted upstream signal, and reports the cancellation', async () => {
    const lifetime = createServerBudgets().startRequest();
    const work = vi.fn();
    const upstream = AbortSignal.abort();
    expect(await lifetime.run('handler', work, { upstream })).toMatchObject({ ok: false, cause: { kind: 'cancelled', stage: 'handler' } });
    expect(work).not.toHaveBeenCalled();
    expect(lifetime.signal.aborted).toBe(false); // an operation was cancelled, not the whole request
  });

  it('combines upstream cancellation with the owner and detaches its listeners', async () => {
    const lifetime = createServerBudgets().startRequest();
    const controller = new AbortController();
    const waiting = lifetime.run('handler', never, { upstream: controller.signal });
    controller.abort();
    expect(await causeOf(waiting)).toMatchObject({ kind: 'cancelled' });
    expect(vi.getTimerCount()).toBe(1);
  });

  it('keeps the original error as an inspectable dependency failure without exposing it as text', async () => {
    const lifetime = createServerBudgets().startRequest();
    const original = new Error('connection string leaked here');
    const outcome = await lifetime.run('authorization', () => Promise.reject(original));
    expect(outcome).toMatchObject({ ok: false, cause: { kind: 'dependency-failure', stage: 'authorization', error: original } });
  });

  it('lets a stage failure thrown from nested code keep its own typed cause', async () => {
    const lifetime = createServerBudgets({ operationMs: 100 }).startRequest();
    const outer = lifetime.run('handler', async (scope) => {
      const inner = await scope.run('storage', never, { limitMs: 20 });
      if (!inner.ok) throw new StageFailure(inner.cause);
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(await causeOf(outer)).toMatchObject({ kind: 'operation-timeout', stage: 'storage', limitMs: 20 });
  });

  it('rejects an invalid per-stage limit before calling the work', () => {
    const lifetime = createServerBudgets().startRequest();
    const work = vi.fn();
    expect(() => lifetime.run('storage', work, { limitMs: 0 })).toThrow(BudgetConfigurationError);
    expect(work).not.toHaveBeenCalled();
  });
});
