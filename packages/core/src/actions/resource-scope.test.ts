import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Action,
  InvocationEndedError,
  prerequisite,
  proceed,
  type CleanupError,
  type InstanceEvent,
  type ObservedEvent,
  type Outcome,
} from './index.js';
import { elapse, gate, rig, settle, type Gate } from './fake-adapter.test-support.js';

// Resource ownership (ACT5) through the public builder and the binding a handle returns. The
// application's owner below is the fixture the Blueprint requires: an observable single-resource
// owner whose `end(lease)` is token-scoped and idempotent, and whose `begin()` supersedes the
// previous lease. SAGA never calls the owner's whole-owner `endCurrent()`; a test that sees it
// called by the runtime fails. Promises are gated by the test and the clock is controlled.

type Press = InstanceEvent<string>;

interface Lease {
  readonly id: number;
}

class PlayerOwner {
  private count = 0;
  private current: Lease | undefined;
  /** Every call the owner received, in order. */
  readonly calls: string[] = [];
  /** The leases whose audio is playing right now. */
  readonly audible = new Set<number>();
  /** The leases the owner deliberately retains past their invocation. */
  readonly kept = new Set<number>();
  /** Set to make the next `start` report a blocked start. */
  blockNextStart = false;

  /** Supersedes the previous lease: the single player now belongs to the new acquisition. */
  begin(): Lease {
    const lease = { id: ++this.count };
    if (this.current !== undefined) this.audible.delete(this.current.id);
    this.current = lease;
    this.calls.push(`begin:${lease.id}`);
    return lease;
  }

  start(lease: Lease): Promise<'started' | 'blocked'> {
    this.calls.push(`start:${lease.id}`);
    if (this.current !== lease) return Promise.reject(new Error(`lease ${lease.id} was superseded`));
    if (this.blockNextStart) {
      this.blockNextStart = false;
      return Promise.resolve('blocked');
    }
    this.audible.add(lease.id);
    return Promise.resolve('started');
  }

  keep(lease: Lease): void {
    this.calls.push(`keep:${lease.id}`);
    this.kept.add(lease.id);
  }

  /** Token-scoped and idempotent: a no-op for a lease that was superseded or already ended. */
  end(lease: Lease): void {
    this.calls.push(`end:${lease.id}`);
    if (this.current === lease) {
      this.audible.delete(lease.id);
      this.kept.delete(lease.id);
    }
  }

  /** The owner's own teardown. An invocation must never reach it. */
  endCurrent(): void {
    this.calls.push('endCurrent');
    if (this.current !== undefined) this.end(this.current);
  }

}

type Presented = 'playing' | 'gesture-needed';

/** The Blueprint's Play example, with its chosen policy, over the fixture owner. */
function playAction(
  owner: PlayerOwner,
  report: string[],
  options: { startGate?: Gate<void>; present?: (state: Presented) => void | PromiseLike<void> } = {},
) {
  return Action.local<Press>('play')
    .atActivation(({ scope }) => scope.own(owner.begin(), (lease) => owner.end(lease)))
    .run(async ({ activation }) => {
      if (options.startGate !== undefined) await options.startGate.promise;
      const started = await owner.start(activation.token);
      // Not started: the scope still owns the lease. Started: hand it over with no await in between.
      if (started === 'blocked') return { state: 'gesture-needed' } as const;
      return activation.transfer((lease) => owner.keep(lease))
        ? ({ state: 'playing', lease: activation.token } as const)
        : ({ state: 'gesture-needed' } as const);
    })
    .limits({ deadlineMs: 20_000, hookMs: 1_000 })
    .onSuccess(({ result }) => options.present?.(result.state))
    .onCanceled(({ activation }) => owner.end(activation.token))
    .onFailure((context) => {
      if (context.stage === 'input') {
        report.push('failed:input');
        return;
      }
      if (context.stage === 'running') {
        const { failure } = context;
        if (failure.kind === 'success-hook-error' || failure.kind === 'success-hook-timeout') {
          // Chosen policy: only a result that records a started, transferred lease stays owner-held.
          if (failure.result.state === 'playing') {
            report.push('playing-but-view-failed');
            return;
          }
        }
      }
      owner.end(context.activation.token);
      report.push('failed');
    })
    .build();
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('activation work, ownership of an existing token and acquisition after the event turn', () => {
  it('takes a lease in the event call stack, before any prerequisite or handler can wait', async () => {
    const owner = new PlayerOwner();
    const order: string[] = [];
    const slow = gate<void>();
    const action = Action.local<Press>('play')
      .atActivation(({ scope }) => {
        order.push('activation');
        return scope.own(owner.begin(), (lease) => owner.end(lease));
      })
      .before(
        prerequisite('later', async () => {
          await slow.promise;
          order.push('prerequisite');
          return proceed();
        }),
      )
      .run(({ activation }) => void order.push(`run:${activation.token.id}`))
      .limits({ hookMs: 100 })
      .build();
    const { control, binding } = rig(action);

    control.press();

    // Nothing has been awaited: the event's own call stack has already taken the lease.
    expect(owner.calls).toEqual(['begin:1']);
    expect(order).toEqual(['activation']);
    expect(binding.state.phase).toBe('running');

    slow.resolve();
    await settle();
    expect(order).toEqual(['activation', 'prerequisite', 'run:1']);
    // Not transferred, so the invocation gave the lease back when it ended.
    expect(owner.calls).toEqual(['begin:1', 'end:1']);
    expect(binding.state.phase).toBe('idle');
  });

  it('owns a token it already holds, and the same token reaches the handler and every hook through activation', async () => {
    const existing: Lease = { id: 99 };
    const seen: unknown[] = [];
    const released: Lease[] = [];
    const action = Action.local<Press>('own-existing')
      .atActivation(({ scope }) => scope.own(existing, (lease) => void released.push(lease)))
      .run(({ activation }) => seen.push(['run', activation.token]))
      .limits({ hookMs: 100 })
      .onSuccess(({ activation }) => void seen.push(['success', activation.token]))
      .build();
    const { control } = rig(action);

    control.press();

    expect(seen).toEqual([
      ['run', existing],
      ['success', existing],
    ]);
    expect(released).toEqual([existing]);
  });

  it('acquires after the event turn: the token is held from its arrival and released at the end', async () => {
    const owner = new PlayerOwner();
    const arrival = gate<void>();
    const done = gate<void>();
    const action = Action.local<Press>('acquire-late')
      .run(async ({ scope }) => {
        const held = await scope.acquire(
          async () => {
            await arrival.promise;
            return owner.begin();
          },
          (lease) => owner.end(lease),
        );
        await done.promise;
        return held.token.id;
      })
      .limits({ hookMs: 100 })
      .build();
    const { control, binding } = rig(action);

    control.press();
    await settle();
    expect(owner.calls).toEqual([]);

    arrival.resolve();
    await settle();
    expect(owner.calls).toEqual(['begin:1']);
    expect(binding.state.phase).toBe('running');

    done.resolve();
    await settle();
    expect(owner.calls).toEqual(['begin:1', 'end:1']);
    expect(binding.state.phase).toBe('idle');
  });

  it('does not continue inside the activation callback: a disposal from inside it waits, then the canceled hook still gets the lease', async () => {
    const owner = new PlayerOwner();
    const order: string[] = [];
    const holder: { dispose?: () => void } = {};
    let ran = false;
    const action = Action.local<Press>('dispose-in-activation')
      .atActivation(({ scope }) => {
        const held = scope.own(owner.begin(), (lease) => owner.end(lease));
        holder.dispose?.();
        order.push('activation returned');
        return held;
      })
      .run(() => void (ran = true))
      .limits({ hookMs: 100 })
      .onCanceled((context) => void order.push(`canceled:${context.stage}:${context.cause}:${context.activation.token.id}`))
      .build();
    const { control, binding } = rig(action);
    holder.dispose = () => binding.dispose();

    control.press();
    await settle();

    expect(ran).toBe(false);
    expect(order).toEqual(['activation returned', 'canceled:prerequisites:disposed:1']);
    expect(owner.calls).toEqual(['begin:1', 'end:1']);
  });

  it('reports the scope active until the outcome is decided, which is work activity and not freshness', async () => {
    const seen: Record<string, boolean> = {};
    const action = Action.local<Press>('active')
      .atActivation(({ scope }) => {
        seen.activation = scope.active;
        return scope;
      })
      .run(({ activation, scope }) => {
        seen.handler = scope.active && activation.active;
        throw new Error('handler failed');
      })
      .limits({ hookMs: 100 })
      .onFailure(({ stage, ...context }) => {
        if (stage === 'running' && 'activation' in context) seen.failureHook = context.activation.active;
      })
      .build();
    rig(action).control.press();
    await settle();

    expect(seen).toEqual({ activation: true, handler: true, failureHook: false });
  });

  it('gives the event-turn callback no way to wait: its scope has no acquire', () => {
    let activationScope: object | undefined;
    const action = Action.local<Press>('no-acquire')
      .atActivation(({ scope }) => {
        activationScope = scope;
        return 1;
      })
      .run(() => 0)
      .build();
    rig(action).control.press();

    expect(activationScope).toBeDefined();
    expect('acquire' in (activationScope ?? {})).toBe(false);
    expect('own' in (activationScope ?? {})).toBe(true);
  });
});

describe('release at the end of the invocation', () => {
  type Ending = 'succeeds' | 'fails' | 'is canceled';

  it.each<Ending>(['succeeds', 'fails', 'is canceled'])(
    'when the invocation %s it releases every token still held in reverse order, after the outcome hook and before onFinally',
    async (ending) => {
      const log: string[] = [];
      const stop = gate<void>();
      const fetched = gate<void>();
      const action = Action.local<Press>('reverse')
        .atActivation(({ scope }) => scope.own('a', (token) => void log.push(`release:${token}`)))
        .before(
          prerequisite('acquires', async ({ scope }) => {
            await scope.acquire(
              () => 'b',
              (token) => void log.push(`release:${token}`),
            );
            return proceed();
          }),
        )
        .run(async ({ scope }) => {
          await scope.acquire(
            () => 'c',
            (token) => void log.push(`release:${token}`),
          );
          if (ending === 'fails') throw new Error('handler failed');
          if (ending === 'is canceled') {
            fetched.resolve();
            await stop.promise;
          }
          return 'result';
        })
        .limits({ hookMs: 100 })
        .onSuccess(() => void log.push('onSuccess'))
        .onFailure(() => void log.push('onFailure'))
        .onCanceled(() => void log.push('onCanceled'))
        .onFinally(({ outcome }) => void log.push(`onFinally:${outcome.status}`))
        .build();
      const { control, binding } = rig(action);

      control.press();
      await settle();
      if (ending === 'is canceled') {
        await fetched.promise;
        binding.dispose();
        await settle();
      }

      const hook = { succeeds: 'onSuccess', fails: 'onFailure', 'is canceled': 'onCanceled' }[ending];
      const status = { succeeds: 'succeeded', fails: 'failed', 'is canceled': 'canceled' }[ending];
      expect(log).toEqual(
        ending === 'succeeds'
          ? [hook, 'release:c', 'release:b', 'release:a', `onFinally:${status}`]
          : [hook, 'release:c', 'release:b', 'release:a', `onFinally:${status}`],
      );
    },
  );

  it('gives each release its own signal and budget: a stalled release cannot hold settling, and the outcome is untouched', async () => {
    const signals = new Map<string, AbortSignal>();
    const released: string[] = [];
    const finals: { outcome: Outcome<unknown>; cleanupErrors: readonly CleanupError[] }[] = [];
    const abortedWhenReleased: Record<string, boolean> = {};
    const action = Action.local<Press>('stalled-release')
      .atActivation(({ scope }) => {
        for (const name of ['a', 'b', 'c']) {
          scope.own(name, (token, { signal }) => {
            signals.set(token, signal);
            released.push(token);
            abortedWhenReleased[token] = signal.aborted;
            // b never settles and ignores its signal.
            return token === 'b' ? new Promise<void>(() => undefined) : undefined;
          });
        }
      })
      .run(() => 'result')
      .limits({ hookMs: 100 })
      .onFinally(({ outcome, cleanupErrors }) => void finals.push({ outcome, cleanupErrors }))
      .build();
    const { control, binding } = rig(action);

    control.press();
    // c released at once; b has stalled and is now being waited for, so a has not started.
    expect(released).toEqual(['c', 'b']);
    expect(binding.state.phase).toBe('settling');
    expect(signals.get('b')?.aborted).toBe(false);

    await elapse(99);
    expect(released).toEqual(['c', 'b']);
    await elapse(1);

    // b's budget expired: its own signal aborted, the runtime stopped waiting and went on to a.
    expect(signals.get('b')?.aborted).toBe(true);
    expect(released).toEqual(['c', 'b', 'a']);
    expect(signals.get('a')?.aborted).toBe(false);
    expect(abortedWhenReleased).toEqual({ a: false, b: false, c: false });
    expect(binding.state.phase).toBe('idle');
    expect(finals).toEqual([
      { outcome: { status: 'succeeded', result: 'result' }, cleanupErrors: [{ step: 'release', reason: 'budget-exceeded' }] },
    ]);
  });

  it('bounds settling by hookMs times the tokens held plus the outcome and final hooks, and no more', async () => {
    const never = (): Promise<void> => new Promise<void>(() => undefined);
    const action = Action.local<Press>('bound')
      .atActivation(({ scope }) => {
        scope.own(1, never);
        scope.own(2, never);
      })
      .run(() => 'r')
      .limits({ hookMs: 100 })
      .onSuccess(never)
      .onFinally(never)
      .build();
    const { control, binding } = rig(action);

    control.press();
    // onSuccess stalls first and, being required work, fails the invocation; that is the running phase.
    await elapse(100);
    expect(binding.state.phase).toBe('settling');
    // The failure outcome has no hook here; two releases and the final hook remain: 3 x hookMs.
    await elapse(299);
    expect(binding.state.phase).toBe('settling');
    await elapse(1);
    expect(binding.state.phase).toBe('idle');
  });

  it('records a release that throws or rejects, keeps releasing the rest, and leaves the outcome as decided', async () => {
    const log: string[] = [];
    const phases: ObservedEvent[] = [];
    let finalContext: { outcome: Outcome<unknown>; cleanupErrors: readonly CleanupError[] } | undefined;
    const boom = new Error('boom');
    const action = Action.local<Press>('release-fails')
      .atActivation(({ scope }) => {
        scope.own('a', () => void log.push('a'));
        scope.own('b', () => {
          log.push('b');
          return Promise.reject(boom);
        });
        scope.own('c', () => {
          log.push('c');
          throw boom;
        });
      })
      .run(() => 'result')
      .limits({ hookMs: 100 })
      .onFinally(({ outcome, cleanupErrors }) => void (finalContext = { outcome, cleanupErrors }))
      .observe((event) => void phases.push(event))
      .build();
    const { control, binding } = rig(action);

    control.press();
    await settle();

    expect(log).toEqual(['c', 'b', 'a']);
    expect(finalContext).toEqual({
      outcome: { status: 'succeeded', result: 'result' },
      cleanupErrors: [
        { step: 'release', reason: 'threw', error: boom },
        { step: 'release', reason: 'threw', error: boom },
      ],
    });
    expect(phases.filter((event) => event.phase === 'cleanup-error').map((event) => event.cleanupStep)).toEqual(['release', 'release']);
    expect(binding.state.phase).toBe('idle');
  });

  it('releases after the outcome hook even when the invocation became obsolete, and an absent onFinally does not skip it', async () => {
    const log: string[] = [];
    const action = Action.local<Press>('obsolete-release')
      .atActivation(({ scope }) => scope.own('a', () => void log.push('released')))
      .run(() => new Promise<never>(() => undefined))
      .limits({ hookMs: 100 })
      .build();
    const { control, binding } = rig(action);

    control.press();
    binding.dispose();
    await settle();

    expect(log).toEqual(['released']);
  });
});

describe('a token acquired after retirement', () => {
  it('is released at once when it arrives after the invocation was canceled, and the acquisition rejects', async () => {
    const owner = new PlayerOwner();
    const arrival = gate<void>();
    const outcomes: unknown[] = [];
    let acquired: Promise<unknown> | undefined;
    let releaseSignal: AbortSignal | undefined;
    const action = Action.local<Press>('late-acquire')
      .run(({ scope }) => {
        acquired = scope.acquire(
          async () => {
            await arrival.promise;
            return owner.begin();
          },
          (lease, { signal }) => {
            releaseSignal = signal;
            owner.end(lease);
          },
        );
        return acquired.then(() => 'unreachable');
      })
      .limits({ hookMs: 100 })
      .onCanceled(() => void outcomes.push('canceled'))
      .build();
    const { control, binding } = rig(action);

    control.press();
    await settle();
    binding.dispose();
    await settle();
    expect(outcomes).toEqual(['canceled']);
    expect(owner.calls).toEqual([]);

    arrival.resolve();
    const rejection = acquired?.catch((error: unknown) => error);
    await settle();

    // The release ran as soon as the token existed, with its own live signal, and the caller learned.
    expect(owner.calls).toEqual(['begin:1', 'end:1']);
    expect(releaseSignal?.aborted).toBe(false);
    expect(await rejection).toBeInstanceOf(InvocationEndedError);
  });

  it('is released at once by own after the outcome was decided, and own throws', async () => {
    const released: string[] = [];
    let attempt: unknown;
    const stop = gate<void>();
    const action = Action.local<Press>('late-own')
      .run(async ({ scope }) => {
        await stop.promise;
        try {
          scope.own('late', (token) => void released.push(token));
        } catch (error) {
          attempt = error;
        }
      })
      .limits({ hookMs: 100 })
      .build();
    const { control, binding } = rig(action);

    control.press();
    binding.dispose();
    await settle();
    stop.resolve();
    await settle();

    expect(released).toEqual(['late']);
    expect(attempt).toBeInstanceOf(InvocationEndedError);
  });

  it('does not start an acquisition for an invocation that has already ended', async () => {
    const started: string[] = [];
    const stop = gate<void>();
    let rejection: unknown;
    const action = Action.local<Press>('no-acquire-after-end')
      .run(async ({ scope }) => {
        await stop.promise;
        await scope.acquire(
          () => void started.push('acquire'),
          () => undefined,
        ).catch((error: unknown) => void (rejection = error));
      })
      .limits({ hookMs: 100 })
      .build();
    const { control, binding } = rig(action);

    control.press();
    binding.dispose();
    stop.resolve();
    await settle();

    expect(started).toEqual([]);
    expect(rejection).toBeInstanceOf(InvocationEndedError);
  });

  it('reports a late release that fails or stalls to the observer only', async () => {
    const events: ObservedEvent[] = [];
    const stop = gate<void>();
    const action = Action.local<Press>('late-release-fails')
      .run(async ({ scope }) => {
        await stop.promise;
        try {
          scope.own('x', () => {
            throw new Error('release failed');
          });
        } catch {
          // The caller learns the invocation ended.
        }
        try {
          scope.own('y', () => new Promise<void>(() => undefined));
        } catch {
          // Likewise.
        }
      })
      .limits({ hookMs: 100 })
      .observe((event) => void events.push(event))
      .build();
    const { control, binding } = rig(action);

    control.press();
    binding.dispose();
    stop.resolve();
    await settle();
    await elapse(100);

    expect(events.filter((event) => event.phase === 'cleanup-error').map((event) => event.cleanupStep)).toEqual(['release', 'release']);
  });
});

describe('an owner scopes release to exactly one acquisition', () => {
  it('lets a superseded invocation end its own lease without reaching the newer one', async () => {
    const owner = new PlayerOwner();
    const report: string[] = [];
    const firstStart = gate<void>();
    const secondStart = gate<void>();
    const starts = [firstStart, secondStart];
    const action = Action.local<Press>('play')
      .atActivation(({ scope }) => scope.own(owner.begin(), (lease) => owner.end(lease)))
      .run(async ({ activation }) => {
        await starts[activation.token.id - 1]?.promise;
        await owner.start(activation.token);
        return activation.transfer((lease) => owner.keep(lease));
      })
      .limits({ hookMs: 100 })
      .onCanceled(({ activation }) => owner.end(activation.token))
      .onFailure(({ stage }) => void report.push(`failure:${stage}`))
      .whenBusy('replace')
      .build();
    const { control } = rig(action);

    control.press();
    control.press();
    secondStart.resolve();
    await settle();
    expect(owner.audible).toEqual(new Set([2]));

    // The first invocation was canceled; its old start finally gives up. Its cleanup cannot touch lease 2.
    firstStart.resolve();
    await settle();

    expect(owner.audible).toEqual(new Set([2]));
    expect(owner.calls.filter((call) => call === 'end:1').length).toBeGreaterThanOrEqual(1);
    expect(owner.calls).not.toContain('end:2');
    expect(owner.calls).not.toContain('endCurrent');
  });

  it('is idempotent: ending the same acquisition again changes nothing', () => {
    const owner = new PlayerOwner();
    const first = owner.begin();
    const second = owner.begin();
    void owner.start(second);

    owner.end(first);
    owner.end(first);

    expect(owner.audible).toEqual(new Set([2]));
  });
});

describe('transfer', () => {
  it('adopts synchronously while the invocation is active, and the scope no longer releases the token', async () => {
    const owner = new PlayerOwner();
    const report: string[] = [];
    const { control, binding } = rig(playAction(owner, report));

    control.press();
    await settle();

    expect(owner.calls).toEqual(['begin:1', 'start:1', 'keep:1']);
    expect(owner.audible).toEqual(new Set([1]));
    expect(owner.kept).toEqual(new Set([1]));
    expect(binding.state.phase).toBe('idle');
    // Nothing of the scope's own: no release, no whole-owner teardown.
    expect(owner.calls).not.toContain('end:1');
    expect(owner.calls).not.toContain('endCurrent');
  });

  it('transfers nothing for an invocation that ended: adopt is not called, and the scope releases the token', async () => {
    const owner = new PlayerOwner();
    const adopted: Lease[] = [];
    const stop = gate<void>();
    let transferred: boolean | undefined;
    const action = Action.local<Press>('ended-transfer')
      .atActivation(({ scope }) => scope.own(owner.begin(), (lease) => owner.end(lease)))
      .run(async ({ activation }) => {
        await stop.promise;
        transferred = activation.transfer((lease) => void adopted.push(lease));
      })
      .limits({ hookMs: 100 })
      .build();
    const { control, binding } = rig(action);

    control.press();
    binding.dispose();
    await settle();
    stop.resolve();
    await settle();

    expect(transferred).toBe(false);
    expect(adopted).toEqual([]);
    expect(owner.calls).toEqual(['begin:1', 'end:1']);
  });

  it('transfers nothing once the outcome is decided, even before the scope has released the token', async () => {
    const owner = new PlayerOwner();
    const adopted: Lease[] = [];
    const answers: boolean[] = [];
    const action = Action.local<Press>('decided-transfer')
      .atActivation(({ scope }) => scope.own(owner.begin(), (lease) => owner.end(lease)))
      .run(() => {
        throw new Error('handler failed');
      })
      .limits({ hookMs: 100 })
      .onFailure(({ stage, ...context }) => {
        // The failure is decided and this hook runs before the release step: the token is still held.
        if (stage === 'running' && 'activation' in context) {
          answers.push(context.activation.transfer((lease) => void adopted.push(lease)));
        }
      })
      .build();
    rig(action).control.press();
    await settle();

    expect(answers).toEqual([false]);
    expect(adopted).toEqual([]);
    // The scope still released it, after the hook.
    expect(owner.calls).toEqual(['begin:1', 'end:1']);
  });

  it('keeps ownership with the scope when adoption throws, and the throw reaches the caller', async () => {
    const owner = new PlayerOwner();
    const failure = new Error('owner refused');
    let caught: unknown;
    const action = Action.local<Press>('adopt-throws')
      .atActivation(({ scope }) => scope.own(owner.begin(), (lease) => owner.end(lease)))
      .run(({ activation }) => {
        try {
          activation.transfer(() => {
            throw failure;
          });
        } catch (error) {
          caught = error;
        }
      })
      .limits({ hookMs: 100 })
      .build();
    const { control } = rig(action);

    control.press();
    await settle();

    expect(caught).toBe(failure);
    expect(owner.calls).toEqual(['begin:1', 'end:1']);
  });

  it('refuses a hidden thenable: ownership stays with the scope, a late rejection is reported, the effect is not claimed undone', async () => {
    const owner = new PlayerOwner();
    const adoption = gate<void>();
    const started: string[] = [];
    const events: ObservedEvent[] = [];
    let caught: unknown;
    // The types cannot see a promise behind a declared `unknown`, so only the runtime check stops it.
    const hidden = (lease: Lease): unknown => {
      started.push(`adopt:${lease.id}`);
      return adoption.promise;
    };
    const action = Action.local<Press>('adopt-thenable')
      .atActivation(({ scope }) => scope.own(owner.begin(), (lease) => owner.end(lease)))
      .run(({ activation }) => {
        try {
          activation.transfer(hidden);
        } catch (error) {
          caught = error;
        }
      })
      .limits({ hookMs: 100 })
      .observe((event) => void events.push(event))
      .build();
    const { control } = rig(action);

    control.press();
    await settle();

    expect(caught).toBeInstanceOf(TypeError);
    // The scope kept the lease and released it; the adoption the callback started is not recalled.
    expect(started).toEqual(['adopt:1']);
    expect(owner.calls).toEqual(['begin:1', 'end:1']);
    expect(events.filter((event) => event.cleanupStep === 'adopt')).toEqual([]);

    adoption.reject(new Error('late failure'));
    await settle();

    expect(events.filter((event) => event.phase === 'cleanup-error').map((event) => event.cleanupStep)).toEqual(['adopt']);
  });

  it('transfers a token once: a second transfer adopts nothing', async () => {
    const adopted: string[] = [];
    let second: boolean | undefined;
    const action = Action.local<Press>('twice')
      .atActivation(({ scope }) => scope.own('t', () => void adopted.push('released')))
      .run(({ activation }) => {
        activation.transfer((token) => void adopted.push(`first:${token}`));
        second = activation.transfer((token) => void adopted.push(`second:${token}`));
      })
      .limits({ hookMs: 100 })
      .build();
    rig(action).control.press();

    expect(second).toBe(false);
    expect(adopted).toEqual(['first:t']);
  });

  it('owns the token again when the invocation ends while adoption is still running', async () => {
    const released: string[] = [];
    const holder: { binding?: { dispose(): void } } = {};
    const action = Action.local<Press>('adopt-disposes')
      .atActivation(({ scope }) => scope.own('t', () => void released.push('released')))
      .run(async ({ activation }) => {
        await Promise.resolve();
        activation.transfer(() => {
          holder.binding?.dispose();
          throw new Error('adoption failed after the binding was disposed');
        });
      })
      .limits({ hookMs: 100 })
      .build();
    const { control, binding } = rig(action);
    holder.binding = binding;

    control.press();
    await settle();

    // Nothing owns the token and nothing will take it: the scope releases it rather than leak it.
    expect(released).toEqual(['released']);
  });
});

describe('cancellation before and after transfer', () => {
  it('before the transfer, the canceled hook receives the lease and the scope releases it too', async () => {
    const owner = new PlayerOwner();
    const startGate = gate<void>();
    const { control, binding } = rig(playAction(owner, [], { startGate }));

    control.press();
    await settle();
    binding.dispose();
    await settle();

    expect(owner.audible.size).toBe(0);
    // The canceled hook ended exactly the lease, then the scope repeated it harmlessly.
    expect(owner.calls).toEqual(['begin:1', 'end:1', 'end:1']);
    expect(owner.calls).not.toContain('start:1');
  });

  it('after the transfer but before the runtime observes the handler result, the canceled hook ends exactly that lease', async () => {
    const owner = new PlayerOwner();
    const observed = gate<void>();
    const canceled: unknown[] = [];
    const action = Action.local<Press>('transfer-then-wait')
      .atActivation(({ scope }) => scope.own(owner.begin(), (lease) => owner.end(lease)))
      .run(async ({ activation }) => {
        await owner.start(activation.token);
        activation.transfer((lease) => owner.keep(lease));
        // The handler has transferred but has not yet returned its answer to the runtime.
        await observed.promise;
        return { state: 'playing' } as const;
      })
      .limits({ hookMs: 100 })
      .onSuccess(() => void canceled.push('success'))
      .onCanceled((context) => {
        canceled.push([context.stage, context.cause, 'result' in context]);
        owner.end(context.activation.token);
      })
      .build();
    const { control, binding } = rig(action);

    control.press();
    await settle();
    expect(owner.kept).toEqual(new Set([1]));
    binding.dispose();
    await settle();

    expect(canceled).toEqual([['running', 'disposed', false]]);
    expect(owner.audible.size).toBe(0);
    // The scope did not release it: it had been transferred, so only the hook's end ran.
    expect(owner.calls.filter((call) => call === 'end:1')).toHaveLength(1);

    // The handler answers late; that is a late settlement and success is never reported.
    observed.resolve();
    await settle();
    expect(canceled).toEqual([['running', 'disposed', false]]);
  });

  it('does not let a canceled invocation end a newer lease: replace supersedes, then the old cleanup is a no-op', async () => {
    const owner = new PlayerOwner();
    const first = gate<void>();
    const action = Action.local<Press>('replaced')
      .atActivation(({ scope }) => scope.own(owner.begin(), (lease) => owner.end(lease)))
      .run(async ({ activation }) => {
        if (activation.token.id === 1) await first.promise;
        await owner.start(activation.token);
        return activation.transfer((lease) => owner.keep(lease));
      })
      .limits({ hookMs: 100 })
      .onCanceled(({ activation }) => owner.end(activation.token))
      .whenBusy('replace')
      .build();
    const { control } = rig(action);

    control.press();
    await settle();
    control.press();
    await settle();

    expect(owner.audible).toEqual(new Set([2]));
    expect(owner.calls).toContain('end:1');
    expect(owner.calls).not.toContain('end:2');

    first.resolve();
    await settle();
    expect(owner.audible).toEqual(new Set([2]));
  });

  it.each(['prerequisites', 'running', 'completing'] as const)(
    'carries the activation token into the canceled hook at stage %s',
    async (stage) => {
      const seen: { stage: string; token: number }[] = [];
      const wait = gate<void>();
      const builder = Action.local<Press>('stages')
        .atActivation(({ scope }) => scope.own({ id: 7 }, () => undefined))
        .before(
          prerequisite('maybe-waits', async () => {
            if (stage === 'prerequisites') await wait.promise;
            return proceed();
          }),
        )
        .run(async () => {
          if (stage === 'running') await wait.promise;
          return 'result';
        })
        .limits({ hookMs: 100 })
        .onSuccess(async () => {
          if (stage === 'completing') await wait.promise;
        })
        .onCanceled((context) => void seen.push({ stage: context.stage, token: context.activation.token.id }))
        .build();
      const { control, binding } = rig(builder);

      control.press();
      await settle();
      binding.dispose();
      await settle();

      expect(seen).toEqual([{ stage, token: 7 }]);
    },
  );
});

describe('a deliberately retained resource', () => {
  it('outlives a successful invocation, and a later disposal of the binding does not take over its teardown', async () => {
    const owner = new PlayerOwner();
    const presented: Presented[] = [];
    const { control, binding } = rig(playAction(owner, [], { present: (state) => void presented.push(state) }));

    control.press();
    await settle();
    expect(presented).toEqual(['playing']);

    binding.dispose();
    await settle();

    expect(owner.audible).toEqual(new Set([1]));
    expect(owner.calls).not.toContain('end:1');
    expect(owner.calls).not.toContain('endCurrent');

    // Stopping a retained lease is the owner's own teardown.
    owner.endCurrent();
    expect(owner.audible.size).toBe(0);
  });

  it('outlives the success hook failing after a started, transferred start, under the chosen policy', async () => {
    const owner = new PlayerOwner();
    const report: string[] = [];
    const { control, binding } = rig(
      playAction(owner, report, {
        present: () => {
          throw new Error('view update failed');
        },
      }),
    );

    control.press();
    await settle();
    binding.dispose();
    await settle();

    expect(report).toEqual(['playing-but-view-failed']);
    expect(owner.audible).toEqual(new Set([1]));
    expect(owner.kept).toEqual(new Set([1]));
    expect(owner.calls).not.toContain('end:1');
  });

  it('does not report a blocked start as playing when the success hook fails, and ends only its own lease', async () => {
    const owner = new PlayerOwner();
    const report: string[] = [];
    const presented: Presented[] = [];
    const { control } = rig(
      playAction(owner, report, {
        present: (state) => {
          presented.push(state);
          throw new Error('view update failed');
        },
      }),
    );
    owner.blockNextStart = true;

    control.press();
    await settle();

    expect(presented).toEqual(['gesture-needed']);
    expect(report).toEqual(['failed']);
    expect(owner.kept.size).toBe(0);
    expect(owner.audible.size).toBe(0);
    expect(owner.calls.filter((call) => call.startsWith('end:'))).toEqual(['end:1', 'end:1']);
  });

  it('does not let a blocked start’s failure hook release a newer owner’s lease', async () => {
    const owner = new PlayerOwner();
    const report: string[] = [];
    const hold = gate<void>();
    const { control } = rig(
      playAction(owner, report, {
        present: async () => {
          await hold.promise;
          throw new Error('view update failed');
        },
      }),
    );
    owner.blockNextStart = true;

    control.press();
    await settle();
    // Another acquisition takes the single player while the success hook is still working.
    const newer = owner.begin();
    await owner.start(newer);
    hold.resolve();
    await settle();

    expect(report).toEqual(['failed']);
    expect(owner.audible).toEqual(new Set([newer.id]));
  });
});

describe('failures of the event-turn callback', () => {
  it('ends as activation-error, never runs the handler, and still releases what was owned before the throw', async () => {
    const released: string[] = [];
    let ran = false;
    const failures: unknown[] = [];
    const boom = new Error('activation failed');
    const action = Action.local<Press>('activation-throws')
      .atActivation(({ scope }) => {
        scope.own('first', (token) => void released.push(token));
        throw boom;
      })
      .run(() => void (ran = true))
      .limits({ hookMs: 100 })
      .onFailure((context) => void failures.push([context.stage, context.failure, released.length]))
      .build();
    const { control, binding } = rig(action);

    control.press();
    await settle();

    expect(ran).toBe(false);
    // The failure hook runs first; the release follows it.
    expect(failures).toEqual([['input', { kind: 'activation-error', error: boom }, 0]]);
    expect(released).toEqual(['first']);
    expect(binding.state.phase).toBe('idle');
  });

  it('hands the error to the event caller when no failure hook receives it, after releasing', () => {
    const released: string[] = [];
    const boom = new Error('activation failed');
    const action = Action.local<Press>('activation-throws-sync')
      .atActivation(({ scope }) => {
        scope.own('first', (token) => void released.push(token));
        throw boom;
      })
      .run(() => 0)
      .limits({ hookMs: 100 })
      .build();
    const { control, binding } = rig(action);

    expect(() => control.press()).toThrow(boom);
    expect(released).toEqual(['first']);
    expect(binding.state.phase).toBe('idle');
  });

  it('never runs for an event whose input or subject already failed', async () => {
    const ran: string[] = [];
    const failures: unknown[] = [];
    const base = (label: string) =>
      Action.local<Press>(label).input(() => {
        if (label === 'bad-input') throw new Error('input failed');
        return 1;
      });
    const badInput = base('bad-input')
      .atActivation(() => void ran.push('bad-input'))
      .run(() => 0)
      .limits({ hookMs: 100 })
      .onFailure((context) => void failures.push(context.stage === 'input' ? context.failure.kind : context.stage))
      .build();
    const badSubject = base('bad-subject')
      .atActivation(() => void ran.push('bad-subject'))
      .run(() => 0)
      .limits({ hookMs: 100 })
      .onFailure((context) => void failures.push(context.stage === 'input' ? context.failure.kind : context.stage))
      .build();

    rig(badInput).control.press();
    rig(badSubject, {
      bind: {
        subject: () => {
          throw new Error('subject failed');
        },
      },
    }).control.press();
    await settle();

    expect(ran).toEqual([]);
    expect(failures).toEqual(['invalid-input', 'invalid-input']);
  });

  it('refuses a promise the types could not see, as activation-error, without running the handler', async () => {
    let ran = false;
    let seen: unknown;
    const hidden = (): unknown => Promise.reject(new Error('settled later'));
    const action = Action.local<Press>('activation-promise')
      .atActivation(hidden)
      .run(() => void (ran = true))
      .limits({ hookMs: 100 })
      .onFailure((context) => void (seen = context.stage === 'input' ? context.failure : undefined))
      .build();
    rig(action).control.press();
    await settle();

    expect(ran).toBe(false);
    expect(seen).toMatchObject({ kind: 'activation-error', error: expect.any(TypeError) });
  });

  it('refuses to hold a resource without limits, and a release that is not a function', async () => {
    let activationFailure: unknown;
    let handlerFailure: unknown;
    const noLimits = Action.local<Press>('no-limits')
      .atActivation(({ scope }) => scope.own('t', () => undefined))
      .run(() => 0)
      .build();
    expect(() => rig(noLimits).control.press()).toThrow(/hookMs/);

    const badRelease = Action.local<Press>('bad-release')
      .atActivation(({ scope }) => scope.own('t', 'not a function' as never))
      .run(() => 0)
      .limits({ hookMs: 10 })
      .onFailure((context) => void (activationFailure = context.stage === 'input' ? context.failure : undefined))
      .build();
    rig(badRelease).control.press();
    expect(activationFailure).toMatchObject({ kind: 'activation-error', error: expect.any(TypeError) });

    const handlerNoLimits = Action.local<Press>('handler-no-limits')
      .run(async ({ scope }) => {
        await Promise.resolve();
        try {
          scope.own('t', () => undefined);
        } catch (error) {
          handlerFailure = error;
        }
      })
      .build();
    rig(handlerNoLimits).control.press();
    await settle();
    expect(handlerFailure).toBeInstanceOf(Error);
  });

  it('keeps the busy policy over a settling invocation that still holds a token to release', async () => {
    const releaseGate = gate<void>();
    const started: number[] = [];
    const action = Action.local<Press>('busy-release')
      .atActivation(({ scope }) => scope.own('t', () => releaseGate.promise))
      .run(() => void started.push(started.length))
      .limits({ hookMs: 1_000 })
      .build();
    const { control, binding } = rig(action);

    control.press();
    expect(binding.state.phase).toBe('settling');
    control.press();

    // Ignored: a second activation cannot overlap the release of what the first still holds.
    expect(started).toEqual([0]);
    releaseGate.resolve();
    await settle();
    expect(binding.state.phase).toBe('idle');
  });
});

describe('what the types guarantee', () => {
  it('refuses at runtime what the order of the builder forbids, when the types are bypassed', () => {
    // A draft as JavaScript, or an `any` cast, would see it: every step offered.
    interface Anything {
      input(extract: unknown): Anything;
      atActivation(perform: unknown): Anything;
      before(candidate: unknown): Anything;
    }
    const draft = (): Anything => Action.local<Press>('order') as unknown as Anything;
    const afterActivation = draft().atActivation(() => 1);
    const afterBefore = draft().before(prerequisite('p', () => proceed()));

    expect(() => afterActivation.input(() => 2)).toThrow(/input can be declared once/);
    expect(() => afterActivation.atActivation(() => 2)).toThrow(/atActivation can be declared once/);
    expect(() => afterBefore.atActivation(() => 2)).toThrow(/atActivation can be declared once/);
    expect(() => draft().atActivation('not a function')).toThrow(/needs a function/);
  });

  // These lines are checked by `npm run typecheck`, not at runtime: the function is never called.
  it('keeps the event turn synchronous, the scope narrow and the adoption synchronous', () => {
    const needsAsync = Math.random() > 2;
    const compileOnly = (): void => {
      Action.local<Press>('n16')
        // @ts-expect-error atActivation must return synchronously
        .atActivation(async () => 1)
        .run(() => 0)
        .build();

      Action.local<Press>('n17')
        // @ts-expect-error the callback may return a Promise
        .atActivation(() => (needsAsync ? Promise.resolve(1) : undefined))
        .run(() => 0)
        .build();

      // A callback that always throws returns never and stays valid.
      Action.local<Press>('p4')
        .atActivation(() => {
          throw new Error('activation failed synchronously');
        })
        .run(() => 0)
        .build();

      Action.local<Press>('n22')
        // @ts-expect-error the activation scope has no acquire
        .atActivation(({ scope }) => void scope.acquire)
        .run(() => 0)
        .build();

      Action.local<Press>('n20')
        .atActivation(({ scope }) => scope.own(1, () => undefined))
        .run(({ activation }) =>
          // @ts-expect-error adoption must finish synchronously
          activation.transfer(async (token) => {
            await Promise.resolve(token);
          }),
        )
        .build();

      Action.local<Press>('n11b')
        .atActivation(() => 1)
        // @ts-expect-error input is not available after atActivation
        .input(() => ({ noteId: 'b' }))
        .run(() => 0)
        .build();

      // The activation value is typed through the handler and the hooks that carry it.
      Action.local<Press>('typed')
        .atActivation(({ scope }) => scope.own({ id: 1 }, () => undefined))
        .run(({ activation }) => activation.token.id)
        .limits({ hookMs: 1 })
        .onSuccess(({ activation, result }) => void (activation.token.id + result))
        .onFailure((context) => {
          // @ts-expect-error a failure in the activation prefix has no activation to carry
          if (context.stage === 'input') void context.activation;
          else void context.activation.token.id;
        })
        .onCanceled((context) => {
          void context.activation.token.id;
          // @ts-expect-error result exists only at stage completing
          if (context.stage === 'running') void context.result;
        })
        .build();
    };
    expect(compileOnly).toBeTypeOf('function');
  });
});
