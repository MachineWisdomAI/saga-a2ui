import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Action,
  prerequisite,
  proceed,
  refuse,
  type ActionBinding,
  type BindOptions,
  type CancelCause,
  type CleanupError,
  type InstanceEvent,
  type ObservedEvent,
  type Outcome,
  type PrerequisiteContext,
} from './index.js';
import {
  Control,
  elapse,
  gate,
  newHost,
  renderInstance,
  rig,
  settle,
  type ControlEvents,
  type FakeInstance,
  type Rig,
} from './fake-adapter.test-support.js';

// Everything here goes through the public builder and the binding a handle returns, with the
// renderer-free adapter and a controlled clock. Promises are gated by the test, so the order in
// which things settle is the test's choice and never an accident of scheduling.

type Press = InstanceEvent<string>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a Save-style local action', () => {
  it('runs ordered prerequisites that provide values, then the handler, and shows its binding state', async () => {
    const order: string[] = [];
    const session = prerequisite('session', async () => {
      order.push('session');
      return proceed({ user: 'u-1' });
    });
    const confirm = prerequisite(
      'confirm',
      ({
        provided,
        params,
      }: PrerequisiteContext<
        { readonly user: string },
        { readonly text: string }
      >) => {
        order.push(`confirm:${provided.user}:${params.text}`);
        return proceed({ confirmed: true as const });
      },
    );
    const savedAt = gate<number>();
    const save = Action.local<Press>('save')
      .input((event) => ({ text: String(event.read('text')) }))
      .before(session)
      .before(confirm)
      .run(async ({ params, provided }) => {
        order.push(
          `run:${provided.user}:${String(provided.confirmed)}:${params.text}`,
        );
        return { savedAt: await savedAt.promise };
      })
      .build();
    const { control, binding, phases } = rig(save, { data: { text: 'draft' } });

    control.press();
    expect(binding.state.phase).toBe('running');
    await settle();
    expect(order).toEqual([
      'session',
      'confirm:u-1:draft',
      'run:u-1:true:draft',
    ]);
    expect(binding.state.phase).toBe('running');

    savedAt.resolve(7);
    await settle();

    expect(phases).toEqual(['running', 'settling', 'idle']);
    expect(binding.state.phase).toBe('idle');
  });

  it('does not start a prerequisite until the previous one has proceeded', async () => {
    const first = gate<ReturnType<typeof proceed>>();
    const started: string[] = [];
    const slow = prerequisite('slow', () => {
      started.push('slow');
      return first.promise;
    });
    const next = prerequisite('next', () => {
      started.push('next');
      return proceed();
    });
    const action = Action.local<Press>('ordered')
      .before(slow)
      .before(next)
      .run(() => void started.push('run'))
      .build();
    const { control } = rig(action);

    control.press();
    await elapse(20_000);
    expect(started).toEqual(['slow']);

    first.resolve(proceed());
    await settle();
    expect(started).toEqual(['slow', 'next', 'run']);
  });

  it('a refusal stops the handler and reaches the failure hook as a refusal, not as an error', async () => {
    const stages: unknown[] = [];
    let ran = false;
    const signIn = prerequisite('session', async () =>
      refuse('sign-in-required'),
    );
    const never = prerequisite('never-reached', () => {
      stages.push('second prerequisite ran');
      return proceed();
    });
    const action = Action.local<Press>('save')
      .before(signIn)
      .before(never)
      .run(() => {
        ran = true;
      })
      .limits({ hookMs: 1000 })
      .onFailure((context) => {
        stages.push(context.stage, context.failure, 'provided' in context);
      })
      .build();
    const { control, binding } = rig(action);

    expect(() => control.press()).not.toThrow();
    await settle();

    expect(ran).toBe(false);
    expect(stages).toEqual([
      'prerequisites',
      {
        kind: 'refused',
        prerequisite: 'session',
        reason: 'sign-in-required',
        category: 'application',
      },
      false,
    ]);
    expect(binding.state.phase).toBe('idle');
  });

  it('a prerequisite that throws ends as prerequisite-error, with the earlier values never shown to the hook', async () => {
    const seen: unknown[] = [];
    const ok = prerequisite('ok', () => proceed({ kept: 1 }));
    const bad = prerequisite('bad', async () => {
      throw new Error('store down');
    });
    const action = Action.local<Press>('save')
      .before(ok)
      .before(bad)
      .run(() => undefined)
      .limits({ hookMs: 1000 })
      .onFailure(
        (context) =>
          void seen.push(
            context.stage,
            'provided' in context,
            context.failure.kind,
          ),
      )
      .build();
    const { control } = rig(action);

    control.press();
    await settle();

    expect(seen).toEqual(['prerequisites', false, 'prerequisite-error']);
  });

  it('refuses two prerequisites that provide the same key, and an answer that is neither proceed nor refuse', async () => {
    const kinds: string[] = [];
    const one = prerequisite('one', () => proceed({ key: 1 }));
    const two = prerequisite('two', () => proceed({ key: 2 }));
    const malformed = { label: 'malformed', run: () => ({ kind: 'maybe' }) };
    const collide = Action.local<Press>('collide')
      .before(one)
      .before(two as never)
      .run(() => undefined)
      .limits({ hookMs: 1000 })
      .onFailure((context) => void kinds.push(context.failure.kind))
      .build();
    const odd = Action.local<Press>('odd')
      .before(malformed as never)
      .run(() => undefined)
      .limits({ hookMs: 1000 })
      .onFailure((context) => void kinds.push(context.failure.kind))
      .build();

    rig(collide).control.press();
    rig(odd).control.press();
    await settle();

    expect(kinds).toEqual(['prerequisite-error', 'prerequisite-error']);
  });

  it('keeps the synchronous path synchronous: synchronous pieces reach idle before the event returns', () => {
    const order: string[] = [];
    const check = prerequisite('check', () => {
      order.push('prerequisite');
      return proceed({ ok: true });
    });
    const action = Action.local<Press>('quick')
      .before(check)
      .run(({ provided }) => void order.push(`run:${String(provided.ok)}`))
      .build();
    const { control, binding, phases } = rig(action);

    control.press();

    expect(order).toEqual(['prerequisite', 'run:true']);
    expect(phases).toEqual(['running', 'settling', 'idle']);
    expect(binding.state.phase).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hands a synchronous failure to the event caller only when no failure hook receives it', async () => {
    const boom = new Error('boom');
    const unhandled = Action.local<Press>('unhandled')
      .run(() => {
        throw boom;
      })
      .build();
    const handled = Action.local<Press>('handled')
      .run(() => {
        throw boom;
      })
      .limits({ hookMs: 1000 })
      .onFailure(() => undefined)
      .build();
    const refused = Action.local<Press>('refused')
      .before(prerequisite('no', () => refuse('no')))
      .run(() => undefined)
      .build();
    const later = Action.local<Press>('later')
      .run(async () => {
        throw boom;
      })
      .build();

    expect(() => rig(unhandled).control.press()).toThrow(boom);
    expect(() => rig(handled).control.press()).not.toThrow();
    expect(() => rig(refused).control.press()).not.toThrow();
    expect(() => rig(later).control.press()).not.toThrow();
    await settle();
  });
});

describe('the work deadline and the hook budget', () => {
  it('expires during a stalled prerequisite as a prerequisite-stage failure; the handler never starts', async () => {
    const outcomes: Outcome<unknown>[] = [];
    const stalled = gate<ReturnType<typeof proceed>>();
    let aborted = false;
    let ran = false;
    const action = Action.local<Press>('stall')
      .before(
        prerequisite('stall', ({ signal }) => {
          signal.addEventListener('abort', () => void (aborted = true));
          return stalled.promise;
        }),
      )
      .run(() => void (ran = true))
      .limits({ deadlineMs: 5000, hookMs: 1000 })
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control, binding } = rig(action);

    control.press();
    await elapse(4999);
    expect(binding.state.phase).toBe('running');
    await elapse(1);

    expect(outcomes).toEqual([
      {
        status: 'failed',
        stage: 'prerequisites',
        failure: { kind: 'timeout', category: 'timeout' },
      },
    ]);
    expect(aborted).toBe(true);
    expect(binding.state.phase).toBe('idle');

    stalled.resolve(proceed());
    await settle();
    expect(ran).toBe(false);
  });

  it('expires during the handler without waiting for it; its late result is dropped', async () => {
    const result = gate<string>();
    const seen: string[] = [];
    const observed: ObservedEvent[] = [];
    let handlerSignal: AbortSignal | undefined;
    let lateCurrent: boolean | undefined;
    const action = Action.local<Press>('work')
      .run(async ({ signal, current }) => {
        handlerSignal = signal;
        const value = await result.promise;
        lateCurrent = current();
        return value;
      })
      .limits({ deadlineMs: 2000, hookMs: 1000 })
      .observe((event) => void observed.push(event))
      .onSuccess(() => void seen.push('success'))
      .onFailure(
        (context) =>
          void seen.push(`failure:${context.stage}:${context.failure.kind}`),
      )
      .build();
    const { control, binding } = rig(action);

    control.press();
    await elapse(2000);
    expect(seen).toEqual(['failure:running:timeout']);
    expect(handlerSignal?.aborted).toBe(true);
    expect(binding.state.phase).toBe('idle');

    result.resolve('late');
    await settle();

    expect(seen).toEqual(['failure:running:timeout']);
    expect(lateCurrent).toBe(false);
    expect(observed.map((event) => event.phase)).toContain('late-settlement');
  });

  it('does not let the work deadline cover the required success hook', async () => {
    const outcomes: Outcome<unknown>[] = [];
    const action = Action.local<Press>('save')
      .run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return 'saved';
      })
      .limits({ deadlineMs: 500, hookMs: 1000 })
      .onSuccess(() =>
        new Promise((resolve) => setTimeout(resolve, 900)).then(
          () => undefined,
        ),
      )
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control, binding } = rig(action);

    control.press();
    await elapse(400);
    expect(binding.state.phase).toBe('running');
    await elapse(900);

    expect(outcomes).toEqual([{ status: 'succeeded', result: 'saved' }]);
    expect(binding.state.phase).toBe('idle');
  });

  it('awaits the success hook before deciding success: the binding stays running until it completes', async () => {
    const written = gate();
    const action = Action.local<Press>('save')
      .run(() => 'saved')
      .limits({ hookMs: 1000 })
      .onSuccess(() => written.promise)
      .build();
    const { control, binding, phases } = rig(action);

    control.press();
    expect(binding.state.phase).toBe('running');
    written.resolve();
    await settle();

    expect(phases).toEqual(['running', 'settling', 'idle']);
  });

  it('turns a success-hook exception or timeout into a failure that carries the result', async () => {
    const seen: unknown[] = [];
    const throwing = Action.local<Press>('throws')
      .run(() => ({ id: 1 }))
      .limits({ hookMs: 1000 })
      .onSuccess(async () => {
        throw new Error('view failed');
      })
      .onFailure(
        (context) =>
          void seen.push(
            context.stage === 'running' ? context.failure : context.stage,
          ),
      )
      .build();
    const overrunning = Action.local<Press>('overruns')
      .run(() => ({ id: 2 }))
      .limits({ hookMs: 1000 })
      .onSuccess(() => new Promise<void>(() => undefined))
      .onFailure(
        (context) =>
          void seen.push(
            context.stage === 'running' ? context.failure : context.stage,
          ),
      )
      .build();

    rig(throwing).control.press();
    rig(overrunning).control.press();
    await elapse(1000);

    expect(seen).toEqual([
      {
        kind: 'success-hook-error',
        error: new Error('view failed'),
        result: { id: 1 },
        category: 'unknown',
      },
      { kind: 'success-hook-timeout', result: { id: 2 }, category: 'timeout' },
    ]);
  });

  it('gives the outcome hook and the final hook separate budgets', async () => {
    const reported: CleanupError[][] = [];
    const slow = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));
    const action = Action.local<Press>('budgets')
      .run(() => {
        throw new Error('x');
      })
      .limits({ hookMs: 1000 })
      .onFailure(() => slow(900))
      .onFinally(async ({ cleanupErrors }) => {
        await slow(900);
        reported.push([...cleanupErrors]);
      })
      .build();
    const { control, binding } = rig(action);

    control.press();
    await elapse(900);
    expect(binding.state.phase).toBe('settling');
    await elapse(900);

    expect(reported).toEqual([[]]);
    expect(binding.state.phase).toBe('idle');
  });

  it('stops waiting for an outcome hook that never settles, records it, and still finalizes', async () => {
    const reported: CleanupError[][] = [];
    const observed: ObservedEvent[] = [];
    const action = Action.local<Press>('stuck')
      .run(() => {
        throw new Error('x');
      })
      .limits({ hookMs: 1000 })
      .observe((event) => void observed.push(event))
      .onFailure(() => new Promise<void>(() => undefined))
      .onFinally(({ cleanupErrors }) => void reported.push([...cleanupErrors]))
      .build();
    const { control, binding } = rig(action);

    control.press();
    await elapse(999);
    expect(binding.state.phase).toBe('settling');
    await elapse(1);

    expect(reported).toEqual([
      [{ step: 'onFailure', reason: 'budget-exceeded' }],
    ]);
    expect(binding.state.phase).toBe('idle');
    expect(
      observed
        .filter((event) => event.phase === 'cleanup-error')
        .map((event) => event.cleanupStep),
    ).toEqual(['onFailure']);
  });

  it('bounds a final hook that never settles or throws, reporting the step name only', async () => {
    const observed: ObservedEvent[] = [];
    const hang = Action.local<Press>('hang')
      .run(() => undefined)
      .limits({ hookMs: 1000 })
      .observe((event) => void observed.push(event))
      .onFinally(() => new Promise<void>(() => undefined))
      .build();
    const throwing = Action.local<Press>('throws')
      .run(() => undefined)
      .limits({ hookMs: 1000 })
      .observe((event) => void observed.push(event))
      .onFinally(() => {
        throw new Error('secret detail');
      })
      .build();
    const first = rig(hang);
    const second = rig(throwing, { id: 'other' });

    first.control.press();
    second.control.press();
    await elapse(1000);

    expect(first.binding.state.phase).toBe('idle');
    expect(second.binding.state.phase).toBe('idle');
    const reports = observed.filter((event) => event.phase === 'cleanup-error');
    expect(reports.map((event) => event.cleanupStep)).toEqual([
      'onFinally',
      'onFinally',
    ]);
    expect(JSON.stringify(observed)).not.toContain('secret detail');
  });

  it('arms no timer for work that answers synchronously, and leaves none behind when it settles', async () => {
    const action = Action.local<Press>('sync-with-hooks')
      .run(() => 'v')
      .limits({ deadlineMs: 5000, hookMs: 1000 })
      .onSuccess(() => undefined)
      .onFinally(() => undefined)
      .build();
    const asynchronous = Action.local<Press>('async-with-hooks')
      .run(async () => 'v')
      .limits({ deadlineMs: 5000, hookMs: 1000 })
      .onSuccess(async () => undefined)
      .onFinally(async () => undefined)
      .build();

    rig(action).control.press();
    expect(vi.getTimerCount()).toBe(0);
    rig(asynchronous, { id: 'async' }).control.press();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('callback eligibility', () => {
  it('a pending promise keeps its callback eligible until it settles; a finished callback never regains it', async () => {
    const wait = gate();
    const answers: boolean[] = [];
    let escaped: (() => boolean) | undefined;
    const action = Action.local<Press>('eligible')
      .run(async ({ current }) => {
        escaped = current;
        answers.push(current());
        await wait.promise;
        answers.push(current());
      })
      .build();
    const { control } = rig(action);

    control.press();
    await settle();
    expect(answers).toEqual([true]);

    wait.resolve();
    await settle();
    expect(answers).toEqual([true, true]);
    // The promise it returned has settled: its eligibility ended for good, though nothing else changed.
    expect(escaped?.()).toBe(false);
  });

  it('a closure scheduled by a finished callback is refused, and cannot overwrite a later presentation', async () => {
    const presentations: string[] = [];
    let step = 0;
    const action = Action.local<Press>('closure')
      .run(({ current }) => {
        const mine = ++step;
        setTimeout(() => {
          if (current()) presentations.push(`late write from ${mine}`);
        }, 100);
      })
      .build();
    const { control } = rig(action);

    control.press();
    control.press();
    await elapse(100);

    expect(presentations).toEqual([]);
  });

  it('after a success hook outlasts its budget, its own current() is false for good while the failure hook may present', async () => {
    const record = gate();
    const writes: string[] = [];
    let successCurrent: (() => boolean) | undefined;
    const action = Action.local<Press>('late-success')
      .run(() => ({ at: 1 }))
      .limits({ hookMs: 1000 })
      .onSuccess(async ({ current }) => {
        successCurrent = current;
        await record.promise;
        if (current()) writes.push('success view');
      })
      .onFailure(async ({ current, failure }) => {
        await settle();
        if (current()) writes.push(`failure view: ${failure.kind}`);
      })
      .build();
    const { control } = rig(action);

    control.press();
    await elapse(1000);
    expect(writes).toEqual(['failure view: success-hook-timeout']);

    record.resolve();
    await settle();

    expect(successCurrent?.()).toBe(false);
    expect(writes).toEqual(['failure view: success-hook-timeout']);
  });

  it('a failure hook that outlasts its budget is ineligible after finalization, and does not overwrite a newer invocation', async () => {
    const slow = gate();
    const writes: string[] = [];
    let call = 0;
    const action = Action.local<Press>('late-failure')
      .run(() => {
        throw new Error(`fail ${++call}`);
      })
      .limits({ hookMs: 1000 })
      .onFailure(async ({ current, failure }) => {
        const which = call;
        if (which === 1) await slow.promise;
        if (current() && failure.kind === 'handler-error')
          writes.push(`presented ${which}`);
      })
      .build();
    const { control } = rig(action);

    control.press();
    await elapse(1000);
    control.press();
    await settle();
    expect(writes).toEqual(['presented 2']);

    slow.resolve();
    await settle();
    expect(writes).toEqual(['presented 2']);
  });

  it('does not let a late handler result trigger success after cancellation', async () => {
    const result = gate<string>();
    const seen: string[] = [];
    const action = Action.local<Press>('late')
      .run(() => result.promise)
      .limits({ hookMs: 1000 })
      .onSuccess(() => void seen.push('success'))
      .onCanceled(
        ({ stage, cause }) => void seen.push(`canceled:${stage}:${cause}`),
      )
      .build();
    const { control, binding } = rig(action);

    control.press();
    binding.dispose();
    result.resolve('late');
    await settle();

    expect(seen).toEqual(['canceled:running:disposed']);
  });
});

describe('decided outcomes are immutable', () => {
  it('an obsolete failure stays failed, does not run onCanceled or the presentation hook, and still finalizes', async () => {
    const calls: string[] = [];
    let finalOutcome: Outcome<unknown> | undefined;
    let finalObsolete: boolean | undefined;
    let diagnostics: readonly CleanupError[] = [];
    let hookSignal: AbortSignal | undefined;
    let hookCurrent: (() => boolean) | undefined;
    const hookRelease = gate();
    const action = Action.local<Press>('failing-row')
      .run(() => {
        throw new Error('server said no');
      })
      .limits({ hookMs: 1000 })
      .onFailure(async ({ signal, current }) => {
        hookSignal = signal;
        hookCurrent = current;
        calls.push('onFailure started');
        await hookRelease.promise;
        if (current()) calls.push('presented after resuming');
      })
      .onCanceled(() => void calls.push('onCanceled'))
      .onFinally(({ outcome, obsolete, cleanupErrors }) => {
        finalOutcome = outcome;
        finalObsolete = obsolete;
        diagnostics = cleanupErrors;
      })
      .build();

    const row = rigRow(action);
    row.control.press();
    expect(calls).toEqual(['onFailure started']);
    expect(hookCurrent?.()).toBe(true);

    row.control.change({ id: 'b' });

    expect(hookSignal?.aborted).toBe(true);
    expect(hookCurrent?.()).toBe(false);
    await settle();
    expect(calls).toEqual(['onFailure started']);
    expect(finalOutcome).toMatchObject({
      status: 'failed',
      stage: 'running',
      failure: { kind: 'handler-error' },
    });
    expect(finalObsolete).toBe(true);
    expect(diagnostics).toEqual([{ step: 'onFailure', reason: 'obsolete' }]);
    expect(row.binding.state.phase).toBe('idle');

    hookRelease.resolve();
    await settle();
    expect(calls).toEqual(['onFailure started']);
  });

  it('does not start the failure hook for a failure decided after the invocation became obsolete', async () => {
    const calls: string[] = [];
    let diagnostics: readonly CleanupError[] = [];
    const action = Action.local<Press>('timeout-row')
      .run(() => new Promise<void>(() => undefined))
      .limits({ deadlineMs: 1000, hookMs: 1000 })
      .onFailure(() => void calls.push('onFailure'))
      .onFinally(({ cleanupErrors }) => void (diagnostics = cleanupErrors))
      .build();
    const row = rigRow(action);

    row.control.press();
    row.control.show({ id: 'b' });
    await elapse(1000);

    expect(calls).toEqual([]);
    expect(diagnostics).toEqual([{ step: 'onFailure', reason: 'obsolete' }]);
    expect(row.binding.state.phase).toBe('idle');
  });

  it('still runs onCanceled for a canceled outcome when the invocation is obsolete', async () => {
    const calls: string[] = [];
    const action = Action.local<Press>('canceled-row')
      .run(() => new Promise<void>(() => undefined))
      .limits({ hookMs: 1000 })
      .onCanceled(({ cause, stage }) => void calls.push(`${stage}:${cause}`))
      .build();
    const row = rigRow(action);

    row.control.press();
    row.control.change({ id: 'b' });
    await settle();

    expect(calls).toEqual(['running:subject-changed']);
  });

  it('finalizes without a final hook: a definition with hooks but no onFinally still returns to idle', async () => {
    const action = Action.local<Press>('no-final')
      .run(async () => {
        throw new Error('x');
      })
      .limits({ hookMs: 1000 })
      .onFailure(async () => undefined)
      .build();
    const { control, binding } = rig(action);

    control.press();
    await settle();

    expect(binding.state.phase).toBe('idle');
  });

  it('old settling work cannot return a newer invocation to idle, or undo disposal', async () => {
    const oldCleanup = gate();
    const secondHandler = gate();
    let call = 0;
    const action = Action.local<Press>('replace')
      .run(async () => {
        call += 1;
        if (call === 2) await secondHandler.promise;
      })
      .limits({ hookMs: 100_000 })
      .whenBusy('replace')
      .onFinally(async () => {
        if (call === 1) await oldCleanup.promise;
      })
      .build();
    const { control, binding } = rig(action);

    control.press();
    await settle();
    expect(binding.state.phase).toBe('settling');
    control.press();
    await settle();
    expect(binding.state.phase).toBe('running');

    oldCleanup.resolve();
    await settle();
    expect(binding.state.phase).toBe('running');

    binding.dispose();
    secondHandler.resolve();
    await settle();
    expect(binding.state.phase).toBe('disposed');
  });
});

/** A control showing one row whose item identity is `id`, with the subject reader attached. */
function rigRow(
  definition: unknown,
  initial: Record<string, unknown> = { id: 'a' },
  observable?: boolean,
): Rig {
  const host = newHost();
  const control = renderInstance(host, 'row', {
    data: initial,
    ...(observable === undefined ? {} : { observable }),
  });
  let binding: ActionBinding | undefined;
  host.register((view) => {
    view.watchById('row', Control, (handle) => {
      binding = handle.bindAction('activate', definition as never, {
        subject: () => handle.read('id'),
      });
    });
  });
  if (binding === undefined) throw new Error('nothing was bound');
  const phases: string[] = [];
  const bound = binding;
  bound.subscribe(() => phases.push(bound.state.phase));
  return { control, binding, phases };
}

describe('the busy policy', () => {
  it('ignore drops an activation while running or settling, and tells the observer which invocation was busy', async () => {
    const work = gate();
    const cleanup = gate();
    const observed: ObservedEvent[] = [];
    let runs = 0;
    const action = Action.local<Press>('ignore')
      .run(async () => {
        runs += 1;
        await work.promise;
      })
      .limits({ hookMs: 100_000 })
      .observe((event) => void observed.push(event))
      .onFinally(() => cleanup.promise)
      .build();
    const { control, binding } = rig(action);

    control.press();
    control.press();
    work.resolve();
    await settle();
    expect(binding.state.phase).toBe('settling');
    control.press();
    expect(runs).toBe(1);

    cleanup.resolve();
    await settle();
    control.press();
    await settle();
    expect(runs).toBe(2);

    const started = observed.find((event) => event.phase === 'started');
    const ignored = observed.filter((event) => event.phase === 'ignored');
    expect(ignored).toHaveLength(2);
    expect(ignored[0]).toMatchObject({
      ignoredReason: 'busy',
      busyInvocationId: started?.invocationId,
    });
    expect(ignored[0]).not.toHaveProperty('invocationId');
  });

  it('replace cancels a running invocation with cause replaced, aborts its signal and runs the new one at once', async () => {
    const first = gate<string>();
    const seen: string[] = [];
    const signals: AbortSignal[] = [];
    let call = 0;
    const action = Action.local<Press>('replace')
      .run(({ signal }) => {
        signals.push(signal);
        call += 1;
        return call === 1 ? first.promise : 'second';
      })
      .limits({ hookMs: 1000 })
      .whenBusy('replace')
      .onSuccess(({ result }) => void seen.push(`success:${result}`))
      .onCanceled(
        ({ cause, stage }) => void seen.push(`canceled:${stage}:${cause}`),
      )
      .build();
    const { control, binding } = rig(action);

    control.press();
    control.press();

    expect(seen).toEqual(['canceled:running:replaced', 'success:second']);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(binding.state.phase).toBe('idle');

    first.resolve('first');
    await settle();
    expect(seen).toEqual(['canceled:running:replaced', 'success:second']);
  });

  it('replace over an invocation that is already settling keeps its outcome and makes its presentation obsolete', async () => {
    const failureHook = gate();
    const seen: string[] = [];
    let diagnostics: readonly CleanupError[] = [];
    let call = 0;
    const action = Action.local<Press>('replace-settling')
      .run(() => {
        call += 1;
        if (call === 1) throw new Error('first fails');
        return new Promise<void>(() => undefined);
      })
      .limits({ hookMs: 100_000 })
      .whenBusy('replace')
      .onFailure(async ({ current }) => {
        await failureHook.promise;
        if (current()) seen.push('presented the first failure');
      })
      .onCanceled(() => void seen.push('canceled hook'))
      .onFinally(({ outcome, cleanupErrors }) => {
        if (outcome.status === 'failed') {
          diagnostics = cleanupErrors;
          seen.push('finalized the first');
        }
      })
      .build();
    const { control, binding } = rig(action);

    control.press();
    expect(binding.state.phase).toBe('settling');
    control.press();
    expect(binding.state.phase).toBe('running');
    failureHook.resolve();
    await settle();

    expect(seen).toEqual(['finalized the first']);
    expect(diagnostics).toEqual([{ step: 'onFailure', reason: 'obsolete' }]);
    expect(binding.state.phase).toBe('running');
  });

  it('revalidates the busy invocation before applying the policy: a press on item B ends item A first', async () => {
    const cleanup = gate();
    const started: string[] = [];
    const canceled: string[] = [];
    const action = Action.local<Press>('rows')
      .input((event) => ({ id: String(event.read('id')) }))
      .run(({ params }) => {
        started.push(params.id);
        return new Promise<void>(() => undefined);
      })
      .limits({ hookMs: 100_000 })
      .onCanceled(async ({ cause }) => {
        canceled.push(cause);
        await cleanup.promise;
      })
      .build();
    const row = rigRow(action);

    row.control.press();
    row.control.show({ id: 'b' }); // nobody told the runtime
    row.control.press(); // A is canceled by the revalidation, but its bounded cleanup is still pending

    expect(canceled).toEqual(['subject-changed']);
    expect(started).toEqual(['a']);

    cleanup.resolve();
    await settle();
    row.control.press();
    expect(started).toEqual(['a', 'b']);
  });

  it('under replace, a press on item B starts at once beside A cleanup', async () => {
    const cleanup = gate();
    const started: string[] = [];
    const action = Action.local<Press>('rows-replace')
      .input((event) => ({ id: String(event.read('id')) }))
      .run(({ params }) => {
        started.push(params.id);
        return new Promise<void>(() => undefined);
      })
      .limits({ hookMs: 100_000 })
      .whenBusy('replace')
      .onCanceled(() => cleanup.promise)
      .build();
    const row = rigRow(action);

    row.control.press();
    row.control.show({ id: 'b' });
    row.control.press();

    expect(started).toEqual(['a', 'b']);
    expect(row.binding.state.phase).toBe('running');
  });
});

describe('the success hook settles after the instance stopped being current', () => {
  // No wake-up is delivered in these cases: the adapter saw nothing, and the settlement of the
  // required success work is itself a checkpoint that reads the subject and liveness afresh.
  function successRig(extra: { fail?: boolean } = {}) {
    const hookGate = gate();
    const outcomes: Outcome<unknown>[] = [];
    const seen: string[] = [];
    const action = Action.local<Press>('save')
      .run(() => 42)
      .limits({ hookMs: 1000 })
      .onSuccess(async () => {
        seen.push('success-hook');
        await hookGate.promise;
        if (extra.fail === true) throw new Error('write failed');
      })
      .onCanceled(
        ({ cause, stage }) => void seen.push(`canceled:${stage}:${cause}`),
      )
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    return {
      hookGate,
      outcomes,
      seen,
      row: rigRow(action, { id: 'a' }, false),
    };
  }

  it('cancels with the result retained when the subject changed and nothing woke the runtime', async () => {
    const { hookGate, outcomes, seen, row } = successRig();

    row.control.press();
    await settle();
    expect(row.control.watching).toBe(0);
    row.control.show({ id: 'b' });
    hookGate.resolve();
    await settle();

    expect(outcomes).toEqual([
      {
        status: 'canceled',
        cause: 'subject-changed',
        stage: 'completing',
        result: 42,
      },
    ]);
    expect(seen).toEqual([
      'success-hook',
      'canceled:completing:subject-changed',
    ]);
    expect(row.binding.state.phase).toBe('idle');
  });

  it('cancels instead of reporting a success-hook failure when the subject changed meanwhile', async () => {
    const { hookGate, outcomes, row } = successRig({ fail: true });

    row.control.press();
    await settle();
    row.control.show({ id: 'b' });
    hookGate.resolve();
    await settle();

    expect(outcomes).toEqual([
      {
        status: 'canceled',
        cause: 'subject-changed',
        stage: 'completing',
        result: 42,
      },
    ]);
  });

  it('cancels with the result retained when the instance stopped being live and nothing woke the runtime', async () => {
    const { hookGate, outcomes, row } = successRig();

    row.control.press();
    await settle();
    row.control.goStale();
    hookGate.resolve();
    await settle();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      status: 'canceled',
      stage: 'completing',
      result: 42,
    });
    expect(row.binding.state.phase).toBe('disposed');
  });

  it('still succeeds when the subject is unchanged', async () => {
    const { hookGate, outcomes, seen, row } = successRig();

    row.control.press();
    await settle();
    row.control.show({ id: 'a' });
    hookGate.resolve();
    await settle();

    expect(outcomes).toEqual([{ status: 'succeeded', result: 42 }]);
    expect(seen).toEqual(['success-hook']);
  });

  it('keeps an outcome that was already decided when the subject changes afterwards', async () => {
    const outcomes: Outcome<unknown>[] = [];
    const cleanup = gate();
    const action = Action.local<Press>('save')
      .run(() => 42)
      .limits({ hookMs: 1000 })
      .onFinally(({ outcome }) => {
        outcomes.push(outcome);
        return cleanup.promise;
      })
      .build();
    const row = rigRow(action, { id: 'a' }, false);

    row.control.press();
    await settle();
    row.control.show({ id: 'b' });
    cleanup.resolve();
    await settle();

    expect(outcomes).toEqual([{ status: 'succeeded', result: 42 }]);
  });
});

describe('the work deadline ends the work callback before it announces the abort', () => {
  it('a handler abort listener already sees current() as false and cannot write', async () => {
    const written: string[] = [];
    const observed: boolean[] = [];
    const decisions: Outcome<unknown>[] = [];
    let failureCurrent: boolean | undefined;
    const action = Action.local<Press>('abort-listener')
      .run(({ signal, current }) => {
        signal.addEventListener('abort', () => {
          observed.push(current());
          if (current()) written.push('presentation write');
        });
        return new Promise<never>(() => undefined);
      })
      .limits({ deadlineMs: 10, hookMs: 1000 })
      .onFailure(({ current }) => void (failureCurrent = current()))
      .onFinally(({ outcome }) => void decisions.push(outcome))
      .build();
    const { control, binding } = rig(action);

    control.press();
    await elapse(10);

    expect(observed).toEqual([false]);
    expect(written).toEqual([]);
    expect(decisions).toEqual([
      {
        status: 'failed',
        stage: 'running',
        failure: { kind: 'timeout', category: 'timeout' },
      },
    ]);
    expect(failureCurrent).toBe(true);
    expect(binding.state.phase).toBe('idle');
  });

  it('a prerequisite abort listener already sees current() as false and cannot write', async () => {
    const written: string[] = [];
    const observed: boolean[] = [];
    const decisions: Outcome<unknown>[] = [];
    const action = Action.local<Press>('abort-listener')
      .before(
        prerequisite('slow', ({ signal, current }) => {
          signal.addEventListener('abort', () => {
            observed.push(current());
            if (current()) written.push('presentation write');
          });
          return new Promise<never>(() => undefined);
        }),
      )
      .run(() => 1)
      .limits({ deadlineMs: 10, hookMs: 1000 })
      .onFinally(({ outcome }) => void decisions.push(outcome))
      .build();
    const { control, binding } = rig(action);

    control.press();
    await elapse(10);

    expect(observed).toEqual([false]);
    expect(written).toEqual([]);
    expect(decisions).toEqual([
      {
        status: 'failed',
        stage: 'prerequisites',
        failure: { kind: 'timeout', category: 'timeout' },
      },
    ]);
    expect(binding.state.phase).toBe('idle');
  });

  it('decides the timeout exactly once when the abort listener re-enters the runtime', async () => {
    const decisions: Outcome<unknown>[] = [];
    const action = Action.local<Press>('reentrant')
      .run(({ signal, current }) => {
        signal.addEventListener('abort', () => void current());
        return new Promise<never>(() => undefined);
      })
      .limits({ deadlineMs: 10, hookMs: 1000 })
      .onFinally(({ outcome }) => void decisions.push(outcome))
      .build();
    const { control } = rig(action);

    control.press();
    await elapse(10);
    await elapse(1000);

    expect(decisions).toEqual([
      {
        status: 'failed',
        stage: 'running',
        failure: { kind: 'timeout', category: 'timeout' },
      },
    ]);
  });
});

describe('the optional subject reader', () => {
  it('detects same-position replacement: the old invocation is canceled, the callable stays, the new item runs', async () => {
    const result = gate<string>();
    const seen: string[] = [];
    let call = 0;
    const action = Action.local<Press>('archive')
      .input((event) => ({ id: String(event.read('id')) }))
      .run(({ params }) => {
        call += 1;
        return call === 1 ? result.promise : params.id;
      })
      .limits({ hookMs: 1000 })
      .onSuccess(
        ({ params, result: value }) =>
          void seen.push(`archived ${params.id} -> ${value}`),
      )
      .onCanceled(
        ({ params, cause }) =>
          void seen.push(`canceled ${params.id}: ${cause}`),
      )
      .build();
    const row = rigRow(action);

    row.control.press();
    row.control.change({ id: 'b' });
    expect(seen).toEqual(['canceled a: subject-changed']);
    expect(row.binding.state.phase).toBe('idle');

    result.resolve('late a');
    await settle();
    row.control.press();
    await settle();

    expect(seen).toEqual(['canceled a: subject-changed', 'archived b -> b']);
  });

  it('without a subject reader the same replacement goes unnoticed: the late result presents on the new item', async () => {
    const result = gate<string>();
    const seen: string[] = [];
    const action = Action.local<Press>('archive')
      .run(() => result.promise)
      .limits({ hookMs: 1000 })
      .onSuccess(({ result: value }) => void seen.push(value))
      .build();
    const { control } = rig(action, { data: { id: 'a' } });

    control.press();
    control.change({ id: 'b' });
    result.resolve('presented');
    await settle();

    expect(seen).toEqual(['presented']);
  });

  it('finds an unnotified change at the next checkpoint: when the result is observed', async () => {
    const result = gate<string>();
    const seen: string[] = [];
    const action = Action.local<Press>('archive')
      .run(() => result.promise)
      .limits({ hookMs: 1000 })
      .onSuccess(() => void seen.push('success'))
      .onCanceled(({ cause, stage }) => void seen.push(`${stage}:${cause}`))
      .build();
    const row = rigRow(action);

    row.control.press();
    row.control.show({ id: 'b' });
    result.resolve('a result');
    await settle();

    expect(seen).toEqual(['running:subject-changed']);
  });

  it('answers current() from a fresh read, so a callback sees the replacement before any wake-up', async () => {
    const answers: boolean[] = [];
    const wait = gate();
    const action = Action.local<Press>('fresh')
      .run(async ({ current }) => {
        answers.push(current());
        await wait.promise;
      })
      .build();
    const row = rigRow(action);

    row.control.press();
    expect(answers).toEqual([true]);
    row.control.show({ id: 'b' });
    wait.resolve();
    await settle();

    expect(row.binding.state.phase).toBe('idle');
  });

  it('cannot see an unobserved A, B, A; once B was observed a return to A does not revive the invocation', async () => {
    const result = gate<string>();
    const seen: string[] = [];
    const action = Action.local<Press>('a-b-a')
      .run(() => result.promise)
      .limits({ hookMs: 1000 })
      .onSuccess(() => void seen.push('success'))
      .onCanceled(({ cause }) => void seen.push(`canceled:${cause}`))
      .build();

    const unobserved = rigRow(action);
    unobserved.control.press();
    unobserved.control.show({ id: 'b' });
    unobserved.control.show({ id: 'a' });
    expect(unobserved.binding.state.phase).toBe('running');

    const observed = rigRow(action);
    observed.control.press();
    observed.control.change({ id: 'b' });
    observed.control.change({ id: 'a' });
    result.resolve('r');
    await settle();

    expect(seen).toContain('canceled:subject-changed');
    expect(seen.filter((entry) => entry === 'success')).toHaveLength(1); // only the unobserved round trip succeeded
  });

  it('detects an item recreated under one key when the application puts a revision in the subject', async () => {
    const seen: string[] = [];
    const action = Action.local<Press>('revision')
      .run(() => new Promise<void>(() => undefined))
      .limits({ hookMs: 1000 })
      .onCanceled(({ cause }) => void seen.push(cause))
      .build();
    const host = newHost();
    const control = renderInstance(host, 'row', {
      data: { id: 'a', revision: 1 },
    });
    host.register((view) =>
      view.watchById('row', Control, (handle) => {
        handle.bindAction('activate', action, {
          subject: () =>
            `${String(handle.read('id'))}:${String(handle.read('revision'))}`,
        });
      }),
    );

    control.press();
    control.change({ id: 'a', revision: 2 });

    expect(seen).toEqual(['subject-changed']);
  });

  it('ends the invocation as invalid-input when the reader throws at activation; a later throw counts as a change', async () => {
    const seen: string[] = [];
    let reads = 0;
    const action = Action.local<Press>('throwing-subject')
      .run(() => new Promise<void>(() => undefined))
      .limits({ hookMs: 1000 })
      .onFailure(
        (context) =>
          void seen.push(
            context.stage === 'input' ? context.failure.kind : 'other',
          ),
      )
      .onCanceled(({ cause }) => void seen.push(cause))
      .build();
    const host = newHost();
    const control = renderInstance(host, 'row');
    host.register((view) =>
      view.watchById('row', Control, (handle) => {
        handle.bindAction('activate', action, {
          subject: () => {
            reads += 1;
            if (reads === 1 || reads >= 3) throw new Error('reader broke');
            return 'k';
          },
        });
      }),
    );

    control.press();
    expect(seen).toEqual(['invalid-input']);
    control.press();
    control.change({});

    expect(seen).toEqual(['invalid-input', 'subject-changed']);
  });

  it('holds a wake-up subscription only for an invocation that is not settled', async () => {
    const work = gate();
    const action = Action.local<Press>('watching')
      .run(() => work.promise)
      .build();
    const row = rigRow(action);

    expect(row.control.watching).toBe(0);
    row.control.press();
    expect(row.control.watching).toBe(1);
    work.resolve();
    await settle();

    expect(row.control.watching).toBe(0);
  });

  it('ends the wake-up subscription when the invocation is replaced or the binding is disposed', async () => {
    const action = Action.local<Press>('watching')
      .run(() => new Promise<void>(() => undefined))
      .whenBusy('replace')
      .build();
    const row = rigRow(action);

    row.control.press();
    row.control.press();
    expect(row.control.watching).toBe(1);
    row.binding.dispose();

    expect(row.control.watching).toBe(0);
  });

  it('is not affected by a wake-up subscription that fails', async () => {
    const host = newHost();
    const action = Action.local<Press>('hostile-adapter')
      .run(async () => undefined)
      .build();
    const instance = host.open<ControlEvents>({
      kind: Control,
      componentId: 'c',
      dataPath: '/',
      events: ['activate', 'change'],
      isLive: () => true,
      read: () => undefined,
      watchScope: () => {
        throw new Error('adapter cannot observe');
      },
    });
    host.register((view) =>
      view.watchById(
        'c',
        Control,
        (handle) => void handle.bindAction('activate', action),
      ),
    );

    expect(instance.activate('activate', 'click')).toBe('started');
    await settle();

    expect(instance.attached('activate')?.state.phase).toBe('idle');
  });
});

describe('cancellation stops waiting on an uncooperative promise', () => {
  it('disposal during a prerequisite starts no further prerequisite and drops the late value', async () => {
    const waiting = gate<ReturnType<typeof proceed>>();
    const calls: string[] = [];
    const action = Action.local<Press>('disposal')
      .before(prerequisite('slow', () => waiting.promise))
      .before(
        prerequisite('next', () => {
          calls.push('next prerequisite');
          return proceed();
        }),
      )
      .run(() => void calls.push('handler'))
      .limits({ hookMs: 1000 })
      .onCanceled(
        ({ stage, cause }) => void calls.push(`canceled:${stage}:${cause}`),
      )
      .onFinally(({ outcome }) => void calls.push(`finally:${outcome.status}`))
      .build();
    const { control, binding } = rig(action);

    control.press();
    binding.dispose();
    waiting.resolve(proceed());
    await settle();

    expect(calls).toEqual([
      'canceled:prerequisites:disposed',
      'finally:canceled',
    ]);
    expect(binding.state.phase).toBe('disposed');
  });

  it('cancels during required success work as completing, with the result, and ignores that hook afterward', async () => {
    const hook = gate();
    const calls: unknown[] = [];
    let hookSignal: AbortSignal | undefined;
    const action = Action.local<Press>('completing')
      .run(() => ({ id: 9 }))
      .limits({ hookMs: 1000 })
      .onSuccess(({ signal }) => {
        hookSignal = signal;
        return hook.promise;
      })
      .onFailure(() => void calls.push('failure hook'))
      .onCanceled(
        (context) =>
          void calls.push(
            context.stage === 'completing' ? context.result : context.stage,
          ),
      )
      .build();
    const { control, binding } = rig(action);

    control.press();
    binding.dispose();
    expect(hookSignal?.aborted).toBe(true);
    hook.reject(new Error('late write failed'));
    await settle();

    expect(calls).toEqual([{ id: 9 }]);
  });

  it('treats an instance that is no longer live as disposal at the next checkpoint', async () => {
    const result = gate<string>();
    const seen: string[] = [];
    const action = Action.local<Press>('stale-instance')
      .run(() => result.promise)
      .limits({ hookMs: 1000 })
      .onSuccess(() => void seen.push('success'))
      .onCanceled(({ cause }) => void seen.push(cause))
      .build();
    const { control, binding } = rig(action);

    control.press();
    control.goStale();
    result.resolve('x');
    await settle();

    expect(seen).toEqual(['disposed']);
    expect(binding.state.phase).toBe('disposed');
  });

  it('retiring the instance cancels the invocation with cause disposed', async () => {
    const seen: string[] = [];
    const action = Action.local<Press>('retired')
      .run(() => new Promise<void>(() => undefined))
      .limits({ hookMs: 1000 })
      .onCanceled(({ cause }) => void seen.push(cause))
      .build();
    const { control } = rig(action);

    control.press();
    control.destroy();
    await settle();

    expect(seen).toEqual(['disposed']);
  });
});

describe('observers and listeners cannot affect the action or leak', () => {
  it('reports phases with opaque identifiers and no parameters, results or errors', async () => {
    const observed: ObservedEvent[] = [];
    const action = Action.local<Press>('save-secret')
      .input(() => ({ token: 'PARAM-SECRET' }))
      .run(async () => ({ value: 'RESULT-SECRET' }))
      .limits({ hookMs: 1000 })
      .observe((event) => void observed.push(event))
      .onSuccess(() => {
        throw new Error('ERROR-SECRET');
      })
      .build();
    const { control, binding } = rig(action);

    control.press();
    await settle();

    expect(observed.map((event) => event.phase)).toEqual([
      'started',
      'handler-settled',
      'outcome-decided',
      'finished',
    ]);
    const text = JSON.stringify(observed);
    for (const secret of ['PARAM-SECRET', 'RESULT-SECRET', 'ERROR-SECRET'])
      expect(text).not.toContain(secret);
    expect(new Set(observed.map((event) => event.bindingId))).toEqual(
      new Set([binding.id]),
    );
    expect(observed[2]).toMatchObject({
      status: 'failed',
      failureKind: 'success-hook-error',
    });
    expect(Object.keys(observed[0]!).sort()).toEqual([
      'bindingId',
      'elapsedMs',
      'invocationId',
      'label',
      'phase',
    ]);
  });

  it('is not changed by an observer or listener that throws or returns a rejected promise', async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      const seen: string[] = [];
      const action = Action.local<Press>('hostile')
        .run(async () => 'ok')
        .limits({ hookMs: 1000 })
        .observe(() => Promise.reject(new Error('observer rejected')))
        .onSuccess(() => void seen.push('success'))
        .build();
      const throwing = Action.local<Press>('hostile-throwing')
        .run(() => 'ok')
        .observe(() => {
          throw new Error('observer threw');
        })
        .build();
      const { control, binding } = rig(action);
      binding.subscribe(() => Promise.reject(new Error('listener rejected')));
      const second = rig(throwing, { id: 'second' });

      control.press();
      expect(() => second.control.press()).not.toThrow();
      await elapse(10);

      expect(seen).toEqual(['success']);
      expect(binding.state.phase).toBe('idle');
      expect(second.binding.state.phase).toBe('idle');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
    }
  });
});

describe('what the runtime refuses when the types are bypassed', () => {
  const draft = () =>
    Action.local<Press>('x') as unknown as Record<
      string,
      (...args: unknown[]) => never
    >;

  it('refuses limits that are not finite positive numbers, and accepts hooks without limits', () => {
    const withHandler = draft().run!(() => undefined) as unknown as Record<
      string,
      (...args: unknown[]) => never
    >;

    for (const bad of [
      { hookMs: 0 },
      { hookMs: -1 },
      { hookMs: Number.NaN },
      { hookMs: Number.POSITIVE_INFINITY },
      { hookMs: '5' },
    ]) {
      expect(() => withHandler.limits!(bad)).toThrow(/hookMs/);
    }
    expect(() => withHandler.limits!({ hookMs: 1, deadlineMs: 0 })).toThrow(
      /deadlineMs/,
    );
    expect(() => withHandler.onSuccess!(() => undefined)).not.toThrow();
    expect(() => draft().limits!({ hookMs: 1 })).toThrow(/can only follow run/);
    expect(() => withHandler.whenBusy!('queue')).toThrow(/ignore/);
  });

  it('refuses a repeated registration, and keeps two hooks on one retained alias separate', () => {
    const limited = (
      Action.local<Press>('x').run(() => undefined) as unknown as {
        limits(l: unknown): Record<string, (...args: unknown[]) => unknown>;
      }
    ).limits({
      hookMs: 1,
    });
    const first = limited.onSuccess!(() => undefined) as Record<
      string,
      (...args: unknown[]) => unknown
    >;

    expect(() => first.onSuccess!(() => undefined)).toThrow(/once/);
    expect(() => first.limits!({ hookMs: 2 })).toThrow(/once/);
    const a = limited.onFailure!(() => undefined) as { build(): unknown };
    const b = limited.onFailure!(() => undefined) as { build(): unknown };
    expect(a.build()).not.toBe(b.build());
  });

  it('refuses input after before, a prerequisite without a run function, and a non-function hook', () => {
    const afterBefore = (
      Action.local<Press>('x') as unknown as {
        before(p: unknown): Record<string, (...args: unknown[]) => unknown>;
      }
    ).before(prerequisite('ok', () => proceed()));
    expect(() => afterBefore.input!(() => 1)).toThrow(
      /input can be declared once/,
    );
    expect(() => draft().before!({ label: 'no run' })).toThrow(/prerequisite/);
    expect(() => prerequisite('', () => proceed())).toThrow(/label/);
  });
});

// Type-level cases. These lines are checked by `npm run typecheck`, not at runtime.
describe('what the types guarantee', () => {
  it('orders prerequisites by what they need and types the handler by what they provided', () => {
    // Never called: the lines below compile or fail to compile, and several would throw if they ran.
    const checks = (): void => {
      const session = prerequisite('session', () =>
        proceed({ session: { userKey: 'u' } }),
      );
      const confirm = prerequisite(
        'confirm',
        ({
          provided,
        }: PrerequisiteContext<
          { readonly session: { readonly userKey: string } },
          unknown
        >) => proceed({ confirmed: provided.session.userKey === 'u' }),
      );
      const needsNote = prerequisite(
        'needs-note',
        ({
          params,
        }: PrerequisiteContext<unknown, { readonly noteId: string }>) =>
          proceed({ n: params.noteId }),
      );

      // @ts-expect-error a prerequisite cannot come before the one that provides what it needs
      Action.local<Press>('misordered').before(confirm);
      // @ts-expect-error a prerequisite that needs params fails for an action that extracts none
      Action.local<Press>('no-params').before(needsNote);
      Action.local<Press>('ok')
        .input(() => ({ noteId: 'n' }))
        .before(session)
        .before(confirm)
        .before(needsNote)
        .run(
          ({ provided, params }) =>
            `${provided.session.userKey}${String(provided.confirmed)}${provided.n}${params.noteId}`,
        )
        .limits({ hookMs: 1 })
        .onSuccess(({ result }) => void result.toUpperCase())
        .build();

      Action.local<Press>('unknown-provided').run(
        // @ts-expect-error `provided` is unknown until a prerequisite provides something
        ({ provided }) => provided.session,
      );
      // Hooks need no limits: the SDK defaults apply.
      Action.local<Press>('no-limits')
        .run(() => 1)
        .onSuccess(() => undefined)
        .build();
      Action.local<Press>('twice')
        .run(() => 1)
        .limits({ hookMs: 1 })
        // @ts-expect-error a hook is registered once
        .onSuccess(() => undefined).onSuccess;
      Action.local<Press>('limits-twice')
        .run(() => 1)
        // @ts-expect-error limits are declared once
        .limits({ hookMs: 1 }).limits;
      // Each setting is optional on its own.
      Action.local<Press>('no-hook-budget')
        .run(() => 1)
        .limits({ deadlineMs: 1 })
        .build();
      Action.local<Press>('failure-union')
        .run(() => 1)
        .limits({ hookMs: 1 })
        .onFailure((context) =>
          // @ts-expect-error a failure before the handler started has no `provided`
          context.stage === 'prerequisites' ? context.provided : undefined,
        )
        .build();
      const cause: CancelCause = 'replaced';
      void cause;
    };
    expect(checks).toBeTypeOf('function');
  });
});
