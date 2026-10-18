import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Action,
  prerequisite,
  proceed,
  refuse,
  type InstanceEvent,
  type Outcome,
  type PrerequisiteContext,
  type ServerCallOptions,
  type ServerReply,
  type ServerRequest,
  type ServerRequestOptions,
  type ServerTransport,
} from './index.js';
import { elapse, gate, rig, settle } from './fake-adapter.test-support.js';

// ACT6: a server action goes through the same public builder and binding as a local one. The
// transport is the application's seam (in the example application, `App.callServerTool`), so every
// test supplies a transport double that records the requests it receives and answers when the test
// chooses. Nothing here proves that a server stopped, forwarded cancellation or rolled back.

type Press = InstanceEvent<string>;
type Reply = ServerReply;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

interface Recorded {
  readonly request: ServerRequest;
  readonly options: ServerRequestOptions | undefined;
  readonly answer: ReturnType<typeof gate<Reply>>;
}

/** A transport the test controls: each request waits for the test to answer or reject it. */
function controlledTransport(): { readonly transport: ServerTransport; readonly requests: Recorded[] } {
  const requests: Recorded[] = [];
  const transport: ServerTransport = {
    callServerTool(request, options) {
      const answer = gate<Reply>();
      requests.push({ request, options, answer });
      return answer.promise;
    },
  };
  return { transport, requests };
}

const ok: Reply = { content: [{ type: 'text', text: 'archived' }] };
const toolError: Reply = { content: [{ type: 'text', text: 'declined' }], isError: true };

describe('a server action', () => {
  it('sends its request only after every prerequisite proceeded, with the invocation signal and the time left on the work deadline', async () => {
    const { transport, requests } = controlledTransport();
    const sessionReady = gate<void>();
    const order: string[] = [];
    const session = prerequisite('session', async () => {
      order.push('session');
      await sessionReady.promise;
      return proceed({ user: 'u-1' });
    });
    const outcomes: Outcome<Reply>[] = [];
    const archive = Action.server<Press>('archive', transport)
      .input((event) => ({ noteId: String(event.read('id')) }))
      .before(session)
      .run(({ params, provided, call }) => {
        order.push('run');
        return call('archive_note', { noteId: params.noteId, user: provided.user });
      })
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(archive, { data: { id: 'n-1' } });

    control.press();
    await settle();
    expect(requests).toHaveLength(0); // the prerequisite has not proceeded

    await elapse(300);
    sessionReady.resolve();
    await settle();

    expect(order).toEqual(['session', 'run']);
    expect(requests).toHaveLength(1);
    const [sent] = requests;
    expect(sent?.request).toEqual({ name: 'archive_note', arguments: { noteId: 'n-1', user: 'u-1' } });
    // 300 ms of the 1000 ms work deadline went to the prerequisite.
    expect(sent?.options?.timeout).toBe(700);
    expect(sent?.options?.signal).toBeInstanceOf(AbortSignal);
    expect(sent?.options?.signal?.aborted).toBe(false);

    sent?.answer.resolve(ok);
    await settle();
    expect(outcomes).toEqual([{ status: 'succeeded', result: ok }]);
  });

  it('never sends a request when a prerequisite refuses, and counts the prerequisite’s own request apart', async () => {
    const { transport, requests } = controlledTransport();
    let sessionChecks = 0;
    const signedOut = prerequisite('session', () => {
      sessionChecks += 1;
      return refuse('sign-in-required');
    });
    const outcomes: Outcome<Reply>[] = [];
    const archive = Action.server<Press>('archive', transport)
      .before(signedOut)
      .run(({ call }) => call('archive_note', {}))
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(archive);

    control.press();
    await settle();

    expect(sessionChecks).toBe(1);
    expect(requests).toHaveLength(0);
    expect(outcomes).toEqual([
      { status: 'failed', stage: 'prerequisites', failure: { kind: 'refused', prerequisite: 'session', reason: 'sign-in-required' } },
    ]);
  });

  it('shares one reusable prerequisite with a local action, and a local pass does not stand in for the server’s own check', async () => {
    const session = prerequisite('session', () => proceed({ user: 'u-1' }));
    const localRuns: string[] = [];
    const local = Action.local<Press>('local')
      .before(session)
      .run(({ provided }) => void localRuns.push(provided.user))
      .build();
    const { transport, requests } = controlledTransport();
    const server = Action.server<Press>('server', transport)
      .before(session)
      .run(({ call }) => call('protected', {}))
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .build();

    rig(local).control.press();
    expect(localRuns).toEqual(['u-1']);

    const { control, binding } = rig(server);
    control.press();
    await settle();
    // The prerequisite passed locally, and the request still went to the server to be authorized.
    expect(requests).toHaveLength(1);
    requests[0]?.answer.resolve(toolError); // the server refuses
    await settle();
    expect(binding.state.phase).toBe('idle');
    expect(localRuns).toEqual(['u-1']);
  });

  it('lets a handler narrow the request timeout but never widen it or replace the invocation signal', async () => {
    const { transport, requests } = controlledTransport();
    let narrowed: Promise<Reply> | undefined;
    let widened: Promise<Reply> | undefined;
    const smuggled = new AbortController();
    const archive = Action.server<Press>('archive', transport)
      .run(({ call }) => {
        narrowed = call('narrowed', {}, { timeoutMs: 250 });
        // A caller that bypasses the types: unknown options are not forwarded.
        widened = call('widened', {}, { timeoutMs: 60_000, timeout: 90_000, signal: smuggled.signal } as unknown as ServerCallOptions);
        return Promise.all([narrowed, widened]);
      })
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .build();
    rig(archive).control.press();
    await settle();

    expect(requests.map((sent) => sent.options?.timeout)).toEqual([250, 1_000]);
    expect(requests[0]?.options?.signal).toBe(requests[1]?.options?.signal);
    expect(requests[1]?.options?.signal).not.toBe(smuggled.signal);
    expect(Object.keys(requests[1]?.options ?? {}).sort()).toEqual(['signal', 'timeout']);
    for (const sent of requests) sent.answer.resolve(ok);
    await settle();
  });

  it('refuses a call timeout that is not a finite positive number, and sends nothing', async () => {
    const { transport, requests } = controlledTransport();
    const failures: unknown[] = [];
    const archive = Action.server<Press>('archive', transport)
      .run(async ({ call }) => {
        for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5']) {
          await call('bad', {}, { timeoutMs: bad as number }).catch((error: unknown) => failures.push(error));
        }
        return ok;
      })
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .build();
    rig(archive).control.press();
    await settle();

    expect(requests).toHaveLength(0);
    expect(failures).toHaveLength(5);
    expect(failures.every((error) => error instanceof TypeError)).toBe(true);
  });

  it('gives a local handler no server-call capability', async () => {
    let context: object | undefined;
    const local = Action.local<Press>('local')
      .run((given) => {
        context = given;
      })
      .build();
    rig(local).control.press();
    await settle();
    expect(context).toBeDefined();
    expect('call' in (context ?? {})).toBe(false);
  });

  it('cannot be built without a work deadline and a hook budget, even by a caller that bypasses the types', () => {
    const { transport } = controlledTransport();
    const base = Action.server<Press>('archive', transport).run(({ call }) => call('x', {}));
    const untyped = base as unknown as { build(): unknown; limits(limits: unknown): { build(): unknown } };
    expect(() => untyped.build()).toThrow(/limits/);
    expect(() => untyped.limits({ hookMs: 10 })).toThrow(/deadlineMs/);
    expect(() => untyped.limits({ deadlineMs: 0, hookMs: 10 })).toThrow(/deadlineMs/);
    expect(() => untyped.limits({ deadlineMs: 10, hookMs: Number.NaN })).toThrow(/hookMs/);
    expect(() => untyped.limits({ deadlineMs: 10, hookMs: 10 }).build()).not.toThrow();
  });

  it('refuses a transport that is not an object with callServerTool', () => {
    for (const bad of [undefined, null, {}, { callServerTool: 'x' }, () => undefined]) {
      expect(() => Action.server<Press>('archive', bad as unknown as ServerTransport)).toThrow(TypeError);
    }
  });

  it('calls the transport as a method, so an App-style transport keeps its own state', async () => {
    class AppLike {
      readonly seen: string[] = [];
      callServerTool(request: ServerRequest): Promise<Reply> {
        this.seen.push(request.name);
        return Promise.resolve(ok);
      }
    }
    const app = new AppLike();
    const archive = Action.server<Press>('archive', app)
      .run(({ call }) => call('archive_note', {}))
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .build();
    rig(archive).control.press();
    await settle();
    expect(app.seen).toEqual(['archive_note']);
  });
});

// ---------------------------------------------------------------------------------------------
// What each way of ending says about the server effect. The runtime knows how far the handler
// got and nothing more, so these tests assert stage and failure kind, the retained result, and
// the number of requests the transport saw. None asserts that a server stopped or rolled back.
// ---------------------------------------------------------------------------------------------

class Declined extends Error {}

interface Archived {
  readonly archivedAt: number;
}

/** The Blueprint's archive shape, reduced to what the outcomes need: input, one request, hooks. */
function archiveWith(transport: ServerTransport, report: { outcomes: Outcome<Archived>[]; shown: string[] }, hooks: { failSuccess?: boolean } = {}) {
  return Action.server<Press>('archive', transport)
    .input((event) => ({ noteId: String(event.read('id')) }))
    .run(async ({ params, call }) => {
      const reply = await call('archive_note', { noteId: params.noteId });
      if (reply.isError === true) throw new Declined('The server declined to archive the note');
      return { archivedAt: 7 } satisfies Archived;
    })
    .limits({ deadlineMs: 1_000, hookMs: 100 })
    .onSuccess(({ current }) => {
      if (hooks.failSuccess === true) throw new Error('the view could not record it');
      if (current()) report.shown.push('archived');
    })
    .onFinally(({ outcome }) => void report.outcomes.push(outcome))
    .build();
}

function reportOf(): { outcomes: Outcome<Archived>[]; shown: string[] } {
  return { outcomes: [], shown: [] };
}

describe('how a server action ends', () => {
  it('succeeds when the reply is good and the required success work completes', async () => {
    const { transport, requests } = controlledTransport();
    const report = reportOf();
    const { control, binding } = rig(archiveWith(transport, report), { data: { id: 'n-1' } });

    control.press();
    await settle();
    requests[0]?.answer.resolve(ok);
    await settle();

    expect(report.outcomes).toEqual([{ status: 'succeeded', result: { archivedAt: 7 } }]);
    expect(report.shown).toEqual(['archived']);
    expect(binding.state.phase).toBe('idle');
    expect(requests).toHaveLength(1);
  });

  it('tells a returned tool-level failure from a rejected transport: only the second leaves the effect unknown by itself', async () => {
    const { transport, requests } = controlledTransport();
    const report = reportOf();
    const { control } = rig(archiveWith(transport, report), { data: { id: 'n-1' } });

    control.press();
    await settle();
    requests[0]?.answer.resolve(toolError);
    await settle();
    control.press();
    await settle();
    requests[1]?.answer.reject(new Error('connection lost'));
    await settle();

    const [declined, lost] = report.outcomes;
    expect(declined).toMatchObject({ status: 'failed', stage: 'running', failure: { kind: 'handler-error' } });
    expect(declined?.status === 'failed' && declined.stage === 'running' && declined.failure.kind === 'handler-error' && declined.failure.error).toBeInstanceOf(Declined);
    expect(lost).toMatchObject({ status: 'failed', stage: 'running', failure: { kind: 'handler-error', error: new Error('connection lost') } });
    // No automatic retry follows either: each press sent exactly one request.
    expect(requests).toHaveLength(2);
    expect(report.shown).toEqual([]);
  });

  it('does not reinterpret a returned tool-level failure: a handler that returns it has succeeded with it', async () => {
    const { transport, requests } = controlledTransport();
    const outcomes: Outcome<Reply>[] = [];
    const passthrough = Action.server<Press>('passthrough', transport)
      .run(({ call }) => call('archive_note', {}))
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    rig(passthrough).control.press();
    await settle();
    requests[0]?.answer.resolve(toolError);
    await settle();
    expect(outcomes).toEqual([{ status: 'succeeded', result: toolError }]);
  });

  it('keeps the returned result when the required success work fails, and sends nothing again', async () => {
    const { transport, requests } = controlledTransport();
    const report = reportOf();
    const { control } = rig(archiveWith(transport, report, { failSuccess: true }), { data: { id: 'n-1' } });

    control.press();
    await settle();
    requests[0]?.answer.resolve(ok);
    await settle();

    expect(report.outcomes).toMatchObject([
      { status: 'failed', stage: 'running', failure: { kind: 'success-hook-error', result: { archivedAt: 7 } } },
    ]);
    expect(requests).toHaveLength(1);
  });

  it('keeps the returned result when the required success work outlasts its budget', async () => {
    const { transport, requests } = controlledTransport();
    const outcomes: Outcome<Archived>[] = [];
    const never = gate<void>();
    const archive = Action.server<Press>('archive', transport)
      .run(async ({ call }) => {
        await call('archive_note', {});
        return { archivedAt: 9 } satisfies Archived;
      })
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .onSuccess(() => never.promise)
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    rig(archive).control.press();
    await settle();
    requests[0]?.answer.resolve(ok);
    await elapse(100);

    expect(outcomes).toEqual([
      { status: 'failed', stage: 'running', failure: { kind: 'success-hook-timeout', result: { archivedAt: 9 } } },
    ]);
    expect(requests).toHaveLength(1);
  });

  it('decides a timeout when the work deadline expires first, aborts the request signal, and drops a late reply', async () => {
    const { transport, requests } = controlledTransport();
    const report = reportOf();
    const { control, binding } = rig(archiveWith(transport, report), { data: { id: 'n-1' } });

    control.press();
    await settle();
    const signal = requests[0]?.options?.signal;
    await elapse(1_000);

    expect(signal?.aborted).toBe(true);
    expect(report.outcomes).toEqual([{ status: 'failed', stage: 'running', failure: { kind: 'timeout' } }]);
    expect(binding.state.phase).toBe('idle');

    // The reply that arrives afterwards is a late settlement: no success work, nothing reported.
    requests[0]?.answer.resolve(ok);
    await settle();
    expect(report.outcomes).toHaveLength(1);
    expect(report.shown).toEqual([]);
  });

  it('reports the transport’s own timeout as a failed handler, not as a refusal', async () => {
    const { transport, requests } = controlledTransport();
    const report = reportOf();
    const { control } = rig(archiveWith(transport, report), { data: { id: 'n-1' } });

    control.press();
    await settle();
    await elapse(900);
    requests[0]?.answer.reject(new Error('Request timed out'));
    await settle();

    expect(report.outcomes).toMatchObject([
      { status: 'failed', stage: 'running', failure: { kind: 'handler-error', error: new Error('Request timed out') } },
    ]);
  });

  it('cancels with the effect unknown when the binding is disposed after the request was sent, and says nothing about the server', async () => {
    const { transport, requests } = controlledTransport();
    const report = reportOf();
    const { control, binding } = rig(archiveWith(transport, report), { data: { id: 'n-1' } });

    control.press();
    await settle();
    const signal = requests[0]?.options?.signal;
    binding.dispose();
    await settle();

    expect(signal?.aborted).toBe(true);
    expect(report.outcomes).toEqual([{ status: 'canceled', cause: 'disposed', stage: 'running' }]);
    // The runtime made no further request, and a late reply changes nothing.
    requests[0]?.answer.resolve(ok);
    await settle();
    expect(requests).toHaveLength(1);
    expect(report.outcomes).toHaveLength(1);
    expect(report.shown).toEqual([]);
  });

  it('sends nothing when it is canceled, or its deadline passes, while a prerequisite is still working', async () => {
    const { transport, requests } = controlledTransport();
    const slowSession = gate<ReturnType<typeof proceed>>();
    let sessionRequests = 0;
    const session = prerequisite('session', () => {
      sessionRequests += 1;
      return slowSession.promise;
    });
    const outcomes: Outcome<Reply>[] = [];
    const archive = Action.server<Press>('archive', transport)
      .before(session)
      .run(({ call }) => call('archive_note', {}))
      .limits({ deadlineMs: 500, hookMs: 100 })
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();

    const canceled = rig(archive);
    canceled.control.press();
    await settle();
    canceled.binding.dispose();
    await settle();

    const slow = rig(archive);
    slow.control.press();
    await elapse(500);
    slowSession.resolve(proceed());
    await settle();

    expect(outcomes).toEqual([
      { status: 'canceled', cause: 'disposed', stage: 'prerequisites' },
      { status: 'failed', stage: 'prerequisites', failure: { kind: 'timeout' } },
    ]);
    expect(requests).toHaveLength(0); // the protected operation was never requested
    expect(sessionRequests).toBe(2); // the prerequisite’s own requests are counted apart
  });

  it('refuses a call from a handler that kept going after its deadline, and sends nothing', async () => {
    const { transport, requests } = controlledTransport();
    const lateCalls: Promise<unknown>[] = [];
    const stubborn = Action.server<Press>('stubborn', transport)
      .run(async ({ call }) => {
        await elapse(2_000); // ignores the signal and the deadline
        lateCalls.push(call('late', {}).catch((error: unknown) => error));
        return 1;
      })
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .build();
    rig(stubborn).control.press();
    await elapse(2_000);
    await settle();

    expect(requests).toHaveLength(0);
    expect(await Promise.all(lateCalls)).toEqual([expect.any(Error)]);
  });

  it('does not send a request for an invocation whose subject changed, even from a running handler', async () => {
    const { transport, requests } = controlledTransport();
    const first = gate<void>();
    const archive = Action.server<Press>('archive', transport)
      .run(async ({ call }) => {
        await first.promise;
        return call('archive_note', {});
      })
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .build();
    let shown = 'a';
    const { control } = rig(archive, { bind: { subject: () => shown } });
    control.press();
    await settle();
    shown = 'b'; // the row now shows another note, with no notification
    first.resolve();
    await settle();
    expect(requests).toHaveLength(0);
  });
});

describe('a server action and its binding', () => {
  it('drops a second activation while busy under ignore: one request', async () => {
    const { transport, requests } = controlledTransport();
    const report = reportOf();
    const { control } = rig(archiveWith(transport, report), { data: { id: 'n-1' } });
    control.press();
    control.press();
    await settle();
    expect(requests).toHaveLength(1);
  });

  it('cancels the running request under replace and sends the newer one, each with its own signal', async () => {
    const { transport, requests } = controlledTransport();
    const outcomes: Outcome<Reply>[] = [];
    const archive = Action.server<Press>('archive', transport)
      .input((event) => ({ noteId: String(event.read('id')) }))
      .run(({ params, call }) => call('archive_note', { noteId: params.noteId }))
      .limits({ deadlineMs: 1_000, hookMs: 100 })
      .whenBusy('replace')
      .onFinally(({ outcome }) => void outcomes.push(outcome))
      .build();
    const { control } = rig(archive, { data: { id: 'n-1' } });

    control.press();
    await settle();
    control.press();
    await settle();

    expect(requests).toHaveLength(2);
    expect(requests[0]?.options?.signal?.aborted).toBe(true);
    expect(requests[1]?.options?.signal?.aborted).toBe(false);
    expect(outcomes).toEqual([{ status: 'canceled', cause: 'replaced', stage: 'running' }]);
  });

  it('serves two instances of one definition independently, each from its own data and with its own state', async () => {
    const { transport, requests } = controlledTransport();
    const report = reportOf();
    const archive = archiveWith(transport, report);
    const first = rig(archive, { id: 'row-archive', data: { id: 'note-0' } });
    const second = rig(archive, { id: 'row-archive', data: { id: 'note-1' } }); // the same component id

    second.control.press();
    await settle();
    expect(requests.map((sent) => sent.request.arguments)).toEqual([{ noteId: 'note-1' }]);
    expect(second.binding.state.phase).toBe('running');
    expect(first.binding.state.phase).toBe('idle');

    first.control.press();
    await settle();
    expect(requests.map((sent) => sent.request.arguments)).toEqual([{ noteId: 'note-1' }, { noteId: 'note-0' }]);
    requests[0]?.answer.resolve(ok);
    await settle();
    expect(second.binding.state.phase).toBe('idle');
    expect(first.binding.state.phase).toBe('running');
  });
});

// Type-level cases, checked by `npm run typecheck` against the package's real exports and its own
// tsconfig, with no stand-in declarations. Each `@ts-expect-error` must suppress a real error: an
// unused directive fails the check.
describe('what the types allow and refuse for a server action', () => {
  it('accepts the complete authoring chain and refuses each misuse', () => {
    const { transport } = controlledTransport();

    // Positive: the reply type flows to the handler, the result to the success hook, and a local
    // action still needs no deadline.
    const complete = Action.server<Press>('complete', transport)
      .input((event) => ({ noteId: String(event.read('id')) }))
      .before(prerequisite('session', () => proceed({ user: 'u-1' })))
      .run(async ({ params, provided, call }) => {
        const reply = await call('archive_note', { noteId: params.noteId, user: provided.user }, { timeoutMs: 5 });
        const failed: boolean | undefined = reply.isError;
        return { failed, parts: reply.content.length };
      })
      .limits({ deadlineMs: 10, hookMs: 5 })
      .onSuccess(({ result }) => void (result.parts + 1))
      .whenBusy('replace')
      .build();
    expect(complete.label).toBe('complete');
    Action.local<Press>('no-deadline').run(() => 1).limits({ hookMs: 5 }).onSuccess(() => undefined).build();

    // A transport keeps its own reply type, and the handler sees it without a cast.
    interface RichReply extends ServerReply {
      readonly structuredContent?: { readonly archivedAt: number };
    }
    const rich: ServerTransport<RichReply> = { callServerTool: () => Promise.resolve({ content: [] }) };
    Action.server<Press, RichReply>('rich', rich)
      .run(async ({ call }) => (await call('x', {})).structuredContent?.archivedAt)
      .limits({ deadlineMs: 1, hookMs: 1 })
      .build();

    // Negative. Some of these throw if they ran, so they are compiled and never called.
    const refusedByTheCompiler = (): void => {
    // @ts-expect-error a server action cannot be built before it has limits
    Action.server<Press>('n13', transport).run(() => 0).build();
    Action.server<Press>('n14', transport)
      .run(() => 0)
      // @ts-expect-error hooks wait for limits, so every hook has a budget
      .onSuccess(() => undefined);
    Action.server<Press>('n15', transport)
      .run(() => 0)
      // @ts-expect-error a server action’s limits must include the work deadline
      .limits({ hookMs: 1 })
      .build();
    Action.server<Press>('hook-ms', transport)
      .run(() => 0)
      // @ts-expect-error and the hook budget
      .limits({ deadlineMs: 1 })
      .build();
    Action.local<Press>('n8').run(
      // @ts-expect-error a local handler has no server call
      ({ call }) => call('x', {}),
    );
    Action.server<Press>('arguments', transport).run(
      // @ts-expect-error the tool name is a string
      ({ call }) => call(1, {}),
    );
    Action.server<Press>('options', transport).run(
      // @ts-expect-error the handler may only narrow the timeout: it has no signal or timeout of its own to supply
      ({ call }) => call('x', {}, { signal: new AbortController().signal }),
    );
    Action.server<Press>('result', transport)
      .run(() => ({ n: 1 }))
      .limits({ deadlineMs: 1, hookMs: 1 })
      // @ts-expect-error the success hook sees the handler’s actual result
      .onSuccess(({ result }) => result.n.toUpperCase());
    // @ts-expect-error a transport must return a reply with content
    Action.server<Press>('transport', { callServerTool: () => Promise.resolve({}) });
    // @ts-expect-error the transport is required
    Action.server<Press>('no-transport');
    };
    void refusedByTheCompiler;
  });
});
