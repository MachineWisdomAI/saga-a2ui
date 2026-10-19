import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Action,
  ActionError,
  createInstanceHost,
  prerequisite,
  proceed,
  refuse,
  snapshotLimits,
  type ErrorCategory,
  type InstanceEvent,
  type Limits,
  type ObservedEvent,
  type Outcome,
  type ServerReply,
  type ServerRequestOptions,
  type ServerTransport,
} from './index.js';
import { elapse, gate, rig, settle } from './fake-adapter.test-support.js';

// The configurable defaults and the evidence-based error categories, through the public builder,
// the instance host's configuration and the binding a handle returns. The clock is controlled, so
// every bound is read at the millisecond at which the runtime gave up waiting. Nothing here claims
// that a server stopped, rolled back or forwarded an abort.

type Press = InstanceEvent<string>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const never = (): Promise<void> => new Promise<void>(() => undefined);

/** Not numbers a bound can be: every one is refused, wherever it is supplied. */
const badValues: readonly unknown[] = [0, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '5', '', null, true, {}, [5], () => 5];

/**
 * When the work deadline decided the outcome and when a stalled failure hook was given up on, for a
 * handler and a failure hook that never settle. Both are read from the observer's own clock.
 */
async function bounds(overrides: Limits, instance: Limits | undefined): Promise<{ deadlineMs: number | undefined; hookMs: number | undefined }> {
  const events: ObservedEvent[] = [];
  const action = Action.local<Press>('measure')
    .run(never)
    .limits(overrides)
    .observe((event) => void events.push(event))
    .onFailure(never)
    .build();
  rig(action, { ...(instance === undefined ? {} : { limits: instance }) }).control.press();
  await elapse(200_000);
  const decided = events.find((event) => event.phase === 'outcome-decided');
  const gaveUp = events.find((event) => event.phase === 'cleanup-error' && event.cleanupStep === 'onFailure');
  return {
    deadlineMs: decided?.elapsedMs,
    hookMs: gaveUp === undefined || decided === undefined ? undefined : gaveUp.elapsedMs - decided.elapsedMs,
  };
}

describe('an action declared without any limit', () => {
  it('runs a local action with a hook and an owned resource under 30,000 ms of work and 5,000 ms per bounded step', async () => {
    const events: ObservedEvent[] = [];
    const action = Action.local<Press>('defaults')
      .atActivation(({ scope }) => scope.own('lease', never))
      .run(never)
      .observe((event) => void events.push(event))
      .onFailure(never)
      .onFinally(never)
      .build();
    const { control, binding } = rig(action);

    control.press();
    await elapse(29_999);
    expect(binding.state.phase).toBe('running');
    await elapse(1);
    expect(binding.state.phase).toBe('settling'); // the work deadline, at 30,000 ms

    // The failure hook, the release of the lease and onFinally each wait their own 5,000 ms.
    await elapse(14_999);
    expect(binding.state.phase).toBe('settling');
    await elapse(1);
    expect(binding.state.phase).toBe('idle');

    const steps = events.filter((event) => event.phase === 'cleanup-error').map((event) => [event.cleanupStep, event.elapsedMs]);
    expect(steps).toEqual([
      ['onFailure', 35_000],
      ['release', 40_000],
      ['onFinally', 45_000],
    ]);
    // No whole-invocation cap: the invocation outlasted 35 seconds because every step has its own budget.
    expect(events.find((event) => event.phase === 'finished')?.elapsedMs).toBe(45_000);
  });

  it('gives a server action the same defaults, and its request the time left on the 30,000 ms work deadline', async () => {
    const requests: { options: ServerRequestOptions | undefined }[] = [];
    const transport: ServerTransport = {
      callServerTool(_request, options) {
        requests.push({ options });
        return new Promise<ServerReply>(() => undefined);
      },
    };
    const outcomes: Outcome<ServerReply>[] = [];
    const slow = prerequisite('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return proceed();
    });
    const archive = Action.server<Press>('archive', transport)
      .before(slow)
      .run(({ call }) => call('archive_note', {}))
      .onSuccess(() => undefined)
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(archive);

    control.press();
    await elapse(10_000);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.options?.timeout).toBe(20_000);

    await elapse(20_000);
    expect(outcomes).toEqual([{ status: 'failed', stage: 'running', failure: { kind: 'timeout', category: 'timeout' } }]);
  });

  it('keeps a synchronous action synchronous, with no timer left behind', () => {
    const ran: string[] = [];
    const action = Action.local<Press>('sync')
      .atActivation(({ scope }) => scope.own('lease', () => void ran.push('release')))
      .run(() => void ran.push('run'))
      .onSuccess(() => void ran.push('success'))
      .onFinally(() => void ran.push('finally'))
      .build();
    const { control, binding } = rig(action);

    control.press();

    expect(ran).toEqual(['run', 'success', 'release', 'finally']);
    expect(binding.state.phase).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends the wait at the original work deadline however long prerequisites and the handler keep making progress', async () => {
    const outcomes: Outcome<unknown>[] = [];
    const late: string[] = [];
    const step = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const steady = prerequisite('steady', async () => {
      await step(20_000);
      return proceed();
    });
    const action = Action.local<Press>('progress')
      .before(steady)
      .run(async ({ current }) => {
        await step(20_000); // would finish at 40,000 ms
        late.push(`finished:${String(current())}`);
        return 'done';
      })
      .onSuccess(() => void late.push('success'))
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(action);

    control.press();
    await elapse(60_000);

    expect(outcomes).toEqual([{ status: 'failed', stage: 'running', failure: { kind: 'timeout', category: 'timeout' } }]);
    expect(late).toEqual(['finished:false']); // the late result revived nothing
  });

  it('counts the work deadline from the end of the activation prefix, not from the first wait', async () => {
    const outcomes: Outcome<unknown>[] = [];
    const action = Action.local<Press>('blocked-then-async')
      .before(
        prerequisite('blocks', () => {
          // A synchronous callback that holds the event loop for 10 seconds: no timer can fire meanwhile.
          vi.setSystemTime(Date.now() + 10_000);
          return proceed();
        }),
      )
      .run(never)
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(action);

    control.press();
    await elapse(19_999);
    expect(outcomes).toEqual([]);
    await elapse(1);

    expect(outcomes).toEqual([{ status: 'failed', stage: 'running', failure: { kind: 'timeout', category: 'timeout' } }]);
  });

  it('releases a resource acquired after the invocation ended within the resolved hook budget', async () => {
    const observed: ObservedEvent[] = [];
    const lateAcquire = gate<string>();
    const action = Action.local<Press>('late-lease')
      .run(async ({ scope }) => {
        // The acquisition starts while the invocation is active; its token arrives after the invocation ended.
        await scope.acquire(() => lateAcquire.promise, () => never()).catch(() => undefined);
      })
      .observe((event) => void observed.push(event))
      .build();
    const { control, binding } = rig(action, { limits: { hookMs: 700 } });

    control.press();
    binding.dispose();
    lateAcquire.resolve('go');
    await elapse(700);

    const stalled = observed.find((event) => event.phase === 'cleanup-error' && event.cleanupStep === 'release');
    expect(stalled).toBeDefined();
    expect(stalled!.elapsedMs).toBe(700);
  });

  it('does not let an enormous bound fire at once', async () => {
    const action = Action.local<Press>('huge')
      .run(never)
      .limits({ deadlineMs: 1e12, hookMs: 1e12 })
      .build();
    const { control, binding } = rig(action);

    control.press();
    await elapse(86_400_000);

    expect(binding.state.phase).toBe('running');
  });
});

describe('each limit resolves on its own: action override, then the instance configuration, then the default', () => {
  it.each([
    ['nothing configured', {}, undefined, 30_000, 5_000],
    ['an action overriding hookMs under an instance setting deadlineMs', { hookMs: 2_000 }, { deadlineMs: 45_000 }, 45_000, 2_000],
    ['an action overriding hookMs with no instance setting', { hookMs: 2_000 }, undefined, 30_000, 2_000],
    ['an action overriding both over an instance setting both', { deadlineMs: 1_000, hookMs: 700 }, { deadlineMs: 45_000, hookMs: 3_000 }, 1_000, 700],
    ['an action overriding deadlineMs only', { deadlineMs: 1_000 }, { deadlineMs: 45_000, hookMs: 3_000 }, 1_000, 3_000],
    ['an instance setting hookMs only', {}, { hookMs: 700 }, 30_000, 700],
    ['an instance setting both', {}, { deadlineMs: 12_345, hookMs: 678 }, 12_345, 678],
  ] as const)('%s', async (_name, overrides, instance, deadlineMs, hookMs) => {
    expect(await bounds(overrides, instance)).toEqual({ deadlineMs, hookMs });
  });

  it('treats an omitted or undefined setting as inherited, never as an instruction to disable a bound', async () => {
    expect(await bounds({ deadlineMs: undefined, hookMs: undefined }, { deadlineMs: undefined, hookMs: 900 })).toEqual({
      deadlineMs: 30_000,
      hookMs: 900,
    });
  });

  it('gives a server action the instance’s work deadline for its request, and lets an override change it', async () => {
    const timeouts: (number | undefined)[] = [];
    const transport: ServerTransport = {
      callServerTool(_request, options) {
        timeouts.push(options?.timeout);
        return new Promise<ServerReply>(() => undefined);
      },
    };
    const inherits = Action.server<Press>('inherits', transport).run(({ call }) => call('t', {})).build();
    const overrides = Action.server<Press>('overrides', transport)
      .run(({ call }) => call('t', {}))
      .limits({ deadlineMs: 8_000 })
      .build();

    rig(inherits, { limits: { deadlineMs: 45_000 } }).control.press();
    rig(overrides, { limits: { deadlineMs: 45_000 } }).control.press();

    expect(timeouts).toEqual([45_000, 8_000]);
  });

  it('lets a longer action override meet a shorter transport limit: the transport’s own boundary still ends the wait', async () => {
    const outcomes: Outcome<ServerReply>[] = [];
    const transport: ServerTransport = {
      callServerTool(_request, options) {
        return new Promise<ServerReply>((_resolve, reject) => {
          const own = Math.min(options?.timeout ?? Infinity, 3_000); // the transport's own, shorter request limit
          setTimeout(() => reject(new DOMException('request timed out', 'TimeoutError')), own);
        });
      },
    };
    const action = Action.server<Press>('long', transport)
      .run(({ call }) => call('slow', {}))
      .limits({ deadlineMs: 120_000 })
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(action);

    control.press();
    await elapse(3_000);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      status: 'failed',
      stage: 'running',
      failure: { kind: 'handler-error', category: 'timeout' },
    });
  });

  it('still lets a handler narrow its request and never widen it', async () => {
    const timeouts: (number | undefined)[] = [];
    const transport: ServerTransport = {
      callServerTool(_request, options) {
        timeouts.push(options?.timeout);
        return new Promise<ServerReply>(() => undefined);
      },
    };
    const action = Action.server<Press>('narrow', transport)
      .run(async ({ call }) => {
        void call('t', {}, { timeoutMs: 1_000 });
        void call('t', {}, { timeoutMs: 90_000 });
      })
      .build();

    rig(action).control.press();
    await settle();

    expect(timeouts).toEqual([1_000, 30_000]);
  });
});

describe('instances are isolated and their configuration is a snapshot', () => {
  it('keeps two SDK instances’ settings apart for one definition', async () => {
    const events: ObservedEvent[] = [];
    const action = Action.local<Press>('shared')
      .run(never)
      .observe((event) => void events.push(event))
      .build();

    const first = rig(action, { limits: { deadlineMs: 1_000 } });
    const second = rig(action, { id: 'other' });
    first.control.press();
    second.control.press();
    await elapse(60_000);

    const decidedAt = (bindingId: string) =>
      events.find((event) => event.bindingId === bindingId && event.phase === 'outcome-decided')?.elapsedMs;
    expect(decidedAt(first.binding.id)).toBe(1_000);
    expect(decidedAt(second.binding.id)).toBe(30_000); // nothing of the first instance's configuration leaked
  });

  it('is not changed by mutating the configuration object after construction, even during an invocation', async () => {
    const configuration = { deadlineMs: 2_000, hookMs: 400 };
    const declared = { hookMs: 300 };
    const events: ObservedEvent[] = [];
    const action = Action.local<Press>('snapshot')
      .run(never)
      .limits(declared)
      .observe((event) => void events.push(event))
      .onFailure(never)
      .build();
    const { control } = rig(action, { limits: configuration });

    configuration.deadlineMs = 10;
    declared.hookMs = 10;
    control.press();
    await elapse(1_000);
    configuration.deadlineMs = 60_000; // mid-invocation
    declared.hookMs = 60_000;
    await elapse(60_000);

    const decided = events.find((event) => event.phase === 'outcome-decided')?.elapsedMs;
    const gaveUp = events.find((event) => event.cleanupStep === 'onFailure')?.elapsedMs;
    expect(decided).toBe(2_000);
    expect(gaveUp).toBe(2_300);
  });

  it('returns a frozen copy from snapshotLimits', () => {
    const given = { deadlineMs: 5, hookMs: 6 };
    const copy = snapshotLimits(given);
    given.deadlineMs = 99;

    expect(copy).toEqual({ deadlineMs: 5, hookMs: 6 });
    expect(Object.isFrozen(copy)).toBe(true);
    expect(snapshotLimits(undefined)).toEqual({});
  });
});

describe('a supplied value is validated where it is supplied, before any activation or effect', () => {
  const place = {
    'the builder’s deadlineMs': (bad: unknown) => Action.local<Press>('x').run(() => undefined).limits({ deadlineMs: bad } as never),
    'the builder’s hookMs': (bad: unknown) => Action.local<Press>('x').run(() => undefined).limits({ hookMs: bad } as never),
    'a server action’s deadlineMs': (bad: unknown) =>
      Action.server<Press>('x', { callServerTool: () => never() as never }).run(() => undefined).limits({ deadlineMs: bad } as never),
    'the instance’s deadlineMs': (bad: unknown) => createInstanceHost({ onSetupError: () => undefined, limits: { deadlineMs: bad } as never }),
    'the instance’s hookMs': (bad: unknown) => createInstanceHost({ onSetupError: () => undefined, limits: { hookMs: bad } as never }),
    'snapshotLimits': (bad: unknown) => snapshotLimits({ hookMs: bad } as never),
  };

  for (const [where, supply] of Object.entries(place)) {
    it(`refuses zero, negatives, NaN, infinities and non-numbers in ${where}`, () => {
      for (const bad of badValues) expect(() => supply(bad), String(bad)).toThrow(TypeError);
    });
  }

  it('refuses a bad instance value even when every action overrides that setting', () => {
    const calls: string[] = [];
    const prerequisiteSpy = prerequisite('spy', () => {
      calls.push('prerequisite');
      return proceed();
    });
    const action = Action.local<Press>('shadowed')
      .before(prerequisiteSpy)
      .run(() => void calls.push('run'))
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .build();

    expect(() => rig(action, { limits: { deadlineMs: 0, hookMs: 50 } })).toThrow(/deadlineMs/);
    expect(() => rig(action, { limits: { hookMs: -5 } })).toThrow(/hookMs/);
    expect(calls).toEqual([]);
  });

  it('refuses a bad action value even when the instance configuration would have been shadowed by it', () => {
    expect(() => Action.local<Press>('x').run(() => undefined).limits({ hookMs: Number.NaN })).toThrow(/hookMs/);
    expect(() => Action.local<Press>('x').run(() => undefined).limits(null as never)).toThrow(TypeError);
    expect(() => createInstanceHost({ onSetupError: () => undefined, limits: null as never })).toThrow(TypeError);
  });

  it('accepts a limit of one millisecond and any omitted setting', () => {
    expect(() => Action.local<Press>('x').run(() => undefined).limits({ hookMs: 1 }).build()).not.toThrow();
    expect(() => Action.local<Press>('x').run(() => undefined).limits({}).build()).not.toThrow();
    expect(() => createInstanceHost({ onSetupError: () => undefined })).not.toThrow();
    expect(() => createInstanceHost({ onSetupError: () => undefined, limits: {} })).not.toThrow();
  });
});

describe('error categories supplement the stage and the failure kind', () => {
  type Define = (report: (outcome: Outcome<unknown>) => void) => unknown;

  /** Presses a control bound to the definition `define` builds, and returns the outcome `onFinally` received. */
  async function run(define: Define, options: { elapseMs?: number } = {}): Promise<Outcome<unknown>> {
    const finished = gate<Outcome<unknown>>();
    rig(define((outcome) => finished.resolve(outcome))).control.press();
    await elapse(options.elapseMs ?? 0);
    return finished.promise;
  }

  const failing =
    (label: string, work: () => unknown): Define =>
    (report) =>
      Action.local<Press>(label)
        .run(work)
        .onFailure(() => undefined)
        .onFinally(({ outcome }) => report(outcome))
        .build();

  it('distinguishes authentication from permission only when the cause says so', async () => {
    const original = new Error('token expired');
    const auth = await run(
      failing('auth', () => {
        throw new ActionError('authentication-required', 'Sign in again', { cause: original });
      }),
    );
    const denied = await run(
      failing('denied', () => {
        throw new ActionError('permission-denied', 'Not yours');
      }),
    );

    expect(auth).toMatchObject({ status: 'failed', stage: 'running', failure: { kind: 'handler-error', category: 'authentication-required' } });
    expect(denied).toMatchObject({ status: 'failed', failure: { kind: 'handler-error', category: 'permission-denied' } });
    // The original cause stays inspectable, and nothing was formatted for display.
    const failure = (auth as Extract<Outcome<unknown>, { status: 'failed' }>).failure as { error: unknown };
    expect(failure.error).toBeInstanceOf(ActionError);
    expect((failure.error as ActionError).cause).toBe(original);
  });

  it('falls back to unknown for an error nobody classified, however much it sounds like authentication', async () => {
    const unfamiliar = [
      new Error('401 Unauthorized'),
      Object.assign(new Error('forbidden'), { status: 403, category: 'authentication-required' }),
      Object.assign(new Error('unauthorized'), { status: 401, code: 'UNAUTHENTICATED' }),
      'sign in required',
      undefined,
    ];
    for (const thrown of unfamiliar) {
      const outcome = await run(
        failing('unknown', () => {
          throw thrown;
        }),
      );
      expect(outcome, String(thrown)).toMatchObject({ status: 'failed', failure: { kind: 'handler-error', category: 'unknown' } });
      expect(((outcome as { failure: { error: unknown } }).failure.error)).toBe(thrown); // the cause is the original value
    }
  });

  it('accepts a category the SDK does not know, and refuses an empty one', async () => {
    const outcome = await run(
      failing('custom', () => {
        throw new ActionError('quota-exceeded', 'Daily quota used');
      }),
    );
    expect(outcome).toMatchObject({ failure: { category: 'quota-exceeded' } });
    expect(() => new ActionError('', 'no category')).toThrow(TypeError);
    expect(() => new ActionError(7 as never, 'no category')).toThrow(TypeError);
  });

  it('reads the platform’s own timeout and abort errors as such, and nothing else it merely resembles', async () => {
    const timeout = await run(
      failing('platform-timeout', () => {
        throw new DOMException('timed out', 'TimeoutError');
      }),
    );
    const aborted = await run(
      failing('platform-abort', () => {
        throw new DOMException('aborted', 'AbortError');
      }),
    );
    const lookalike = await run(
      failing('lookalike', () => {
        throw Object.assign(new Error('x'), { name: 'TimeoutErrorish' });
      }),
    );

    expect(timeout).toMatchObject({ failure: { kind: 'handler-error', category: 'timeout' } });
    expect(aborted).toMatchObject({ failure: { kind: 'handler-error', category: 'canceled' } });
    expect(lookalike).toMatchObject({ failure: { category: 'unknown' } });
  });

  it('categorizes what the runtime itself decided: refusal, deadline, input and the prerequisite error', async () => {
    const refused = await run((report) =>
      Action.local<Press>('refused')
        .before(prerequisite('session', () => refuse('sign-in-required')))
        .run(() => undefined)
        .onFailure(() => undefined)
        .onFinally(({ outcome }) => report(outcome))
        .build(),
    );
    const invalid = await run((report) =>
      Action.local<Press>('invalid')
        .input(() => {
          throw new Error('bad');
        })
        .run(() => undefined)
        .onFailure(() => undefined)
        .onFinally(({ outcome }) => report(outcome))
        .build(),
    );
    const brokenPrerequisite = await run((report) =>
      Action.local<Press>('broken')
        .before(
          prerequisite('store', () => {
            throw new ActionError('unavailable', 'store down');
          }),
        )
        .run(() => undefined)
        .onFailure(() => undefined)
        .onFinally(({ outcome }) => report(outcome))
        .build(),
    );
    const prerequisiteTimeout = await run(
      (report) =>
        Action.local<Press>('slow-prerequisite')
          .before(
            prerequisite('slow', async () => {
              await never();
              return proceed();
            }),
          )
          .run(() => undefined)
          .onFinally(({ outcome }) => report(outcome))
          .build(),
      { elapseMs: 30_000 },
    );

    // A refusal is the application's own answer: the reason string is not evidence of authentication.
    expect(refused).toMatchObject({ stage: 'prerequisites', failure: { kind: 'refused', category: 'application' } });
    expect(invalid).toMatchObject({ stage: 'input', failure: { kind: 'invalid-input', category: 'validation' } });
    expect(brokenPrerequisite).toMatchObject({ stage: 'prerequisites', failure: { kind: 'prerequisite-error', category: 'unavailable' } });
    expect(prerequisiteTimeout).toMatchObject({ stage: 'prerequisites', failure: { kind: 'timeout', category: 'timeout' } });
  });

  it('does not put a category, a cause or any error text into what the observer receives', async () => {
    const observed: ObservedEvent[] = [];
    const action = Action.local<Press>('observed')
      .run(() => {
        throw new ActionError('authentication-required', 'SECRET-MESSAGE', { cause: new Error('SECRET-CAUSE') });
      })
      .onFailure(() => undefined)
      .observe((event) => void observed.push(event))
      .build();

    rig(action).control.press();
    await settle();

    expect(JSON.stringify(observed)).not.toContain('SECRET');
    for (const event of observed) {
      expect(Object.keys(event).every((key) => ['label', 'bindingId', 'invocationId', 'elapsedMs', 'phase', 'status', 'failureKind', 'cleanupStep'].includes(key))).toBe(true);
    }
    expect(observed.find((event) => event.phase === 'outcome-decided')).toMatchObject({ failureKind: 'handler-error' });
  });
});

describe('what an outcome says about the server effect', () => {
  interface Sent {
    readonly answer: ReturnType<typeof gate<ServerReply>>;
  }
  function transportDouble(): { readonly transport: ServerTransport; readonly sent: Sent[] } {
    const sent: Sent[] = [];
    return {
      sent,
      transport: {
        callServerTool() {
          const answer = gate<ServerReply>();
          sent.push({ answer });
          return answer.promise;
        },
      },
    };
  }
  const written: ServerReply = { content: [{ type: 'text', text: 'archived' }] };

  it('keeps a known successful write, and reports only the client step, when the success hook then times out', async () => {
    const { transport, sent } = transportDouble();
    const outcomes: Outcome<ServerReply>[] = [];
    const action = Action.server<Press>('archive', transport)
      .run(({ call }) => call('archive_note', { id: 'n-1' }))
      .onSuccess(never) // the view update that never finishes
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(action);

    control.press();
    sent[0]?.answer.resolve(written);
    await elapse(5_000 + 10);

    expect(outcomes).toEqual([
      { status: 'failed', stage: 'running', failure: { kind: 'success-hook-timeout', category: 'timeout', result: written } },
    ]);
    expect(sent).toHaveLength(1); // nothing was replayed
  });

  it('keeps the result when the success hook throws, with the hook’s own error as the inspectable cause', async () => {
    const { transport, sent } = transportDouble();
    const outcomes: Outcome<ServerReply>[] = [];
    const viewFailed = new Error('view update failed');
    const action = Action.server<Press>('archive', transport)
      .run(({ call }) => call('archive_note', {}))
      .onSuccess(() => {
        throw viewFailed;
      })
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(action);

    control.press();
    sent[0]?.answer.resolve(written);
    await settle();

    expect(outcomes).toEqual([
      { status: 'failed', stage: 'running', failure: { kind: 'success-hook-error', category: 'unknown', error: viewFailed, result: written } },
    ]);
    expect(sent).toHaveLength(1);
  });

  it('keeps the effect unknown, without a result or a retry, when the deadline passes before any reply', async () => {
    const { transport, sent } = transportDouble();
    const outcomes: Outcome<ServerReply>[] = [];
    const action = Action.server<Press>('archive', transport)
      .run(({ call }) => call('archive_note', {}))
      .limits({ deadlineMs: 2_000 })
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(action);

    control.press();
    await elapse(2_000);
    sent[0]?.answer.resolve(written); // the write may well have happened; the client had stopped waiting

    await settle();
    expect(outcomes).toEqual([{ status: 'failed', stage: 'running', failure: { kind: 'timeout', category: 'timeout' } }]);
    expect(sent).toHaveLength(1);
  });

  it('keeps the effect unknown, without a result or a retry, when the request is canceled before any reply', async () => {
    const { transport, sent } = transportDouble();
    const outcomes: Outcome<ServerReply>[] = [];
    const action = Action.server<Press>('archive', transport)
      .run(({ call }) => call('archive_note', {}))
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control, binding } = rig(action);

    control.press();
    binding.dispose();
    sent[0]?.answer.resolve(written);
    await settle();

    expect(outcomes).toEqual([{ status: 'canceled', cause: 'disposed', stage: 'running' }]);
    expect(sent).toHaveLength(1);
  });
});

describe('what the types guarantee about limits and categories', () => {
  // Never called: these lines are checked by `npm run typecheck`, not at runtime.
  it('accepts hooks, resources and a build without limits, and every limit as optional', () => {
    const transport: ServerTransport = { callServerTool: () => never() as never };
    const compileOnly = (): void => {
      Action.local<Press>('local')
        .atActivation(({ scope }) => scope.own(1, () => undefined))
        .run(() => 1)
        .onSuccess(() => undefined)
        .onFailure(() => undefined)
        .onCanceled(() => undefined)
        .onFinally(() => undefined)
        .build();
      Action.server<Press>('server', transport)
        .run(({ call }) => call('t', {}))
        .onSuccess(() => undefined)
        .build();
      Action.local<Press>('empty').run(() => 1).limits({}).build();
      Action.local<Press>('hook-only').run(() => 1).limits({ hookMs: 1 }).build();
      Action.server<Press>('deadline-only', transport).run(({ call }) => call('t', {})).limits({ deadlineMs: 1 }).build();
      createInstanceHost({ onSetupError: () => undefined, limits: { hookMs: 1 } });

      // @ts-expect-error a setting is a number
      Action.local<Press>('text').run(() => 1).limits({ hookMs: '5' });
      // @ts-expect-error limits are declared once
      Action.local<Press>('twice').run(() => 1).limits({}).limits;
      // @ts-expect-error a hook is registered once
      Action.local<Press>('hook-twice').run(() => 1).onSuccess(() => undefined).onSuccess;
      // @ts-expect-error the instance configuration takes numbers
      createInstanceHost({ onSetupError: () => undefined, limits: { deadlineMs: 'soon' } });
    };
    expect(compileOnly).toBeTypeOf('function');
  });

  it('exposes an extensible category: the known ones narrow, any other string is allowed', () => {
    const compileOnly = (): void => {
      const known: ErrorCategory = 'authentication-required';
      const custom: ErrorCategory = 'quota-exceeded';
      void [known, custom];
      Action.local<Press>('categories')
        .run(() => 1)
        .onFailure((context) => {
          const category: ErrorCategory = context.failure.category;
          if (category === 'timeout') return;
          // @ts-expect-error a number is not a category
          const wrong: ErrorCategory = 7;
          void wrong;
        })
        .build();
    };
    expect(compileOnly).toBeTypeOf('function');
  });
});
