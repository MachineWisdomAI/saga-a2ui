import { describe, expect, it } from 'vitest';
import {
  Action,
  prerequisite,
  proceed,
  refuse,
  type InstanceEvent,
  type PrerequisiteContext,
  type ServerTransport,
} from './index.js';
import { Control, newHost, renderInstance } from './fake-adapter.test-support.js';

// The Blueprint's authoring cases (positive P1-P8 and L1, negative N1-N25 of the evidence
// companion), run against the package's real exports and its own tsconfig instead of the
// companion's declaration stand-ins. This file is only compiled by `npm run typecheck`: the
// negative cases would throw if they ran, so they sit in a function that is never called, and each
// `@ts-expect-error` must suppress a real diagnostic or the check fails.
//
// Where an earlier slice already checks a case, this list only names it, so each rule stays
// checked in one place:
//   N1, N2, N3, N5, N12, N14      async-actions.test.ts ("what the types refuse")
//   N6, N7, N8, N19               actions.test.ts ("what the types refuse")
//   N16, N20, N21, N22            resource-scope.test.ts (type-level cases)
//   N8, N13, N14, N15             server-actions.test.ts (server)
// The renderer-facing cases (the Lit, React and Lynx declarations) are the fixtures themselves:
// `npm run typecheck` compiles the Lit and React consumers, the React package and the Lynx fixture
// against the published renderer packages.

type Press = InstanceEvent<string>;
interface NoteEvent extends InstanceEvent<string> {
  readonly noteId: string;
}

const session = prerequisite('session', () => proceed({ user: 'u-1' }));
const audit = prerequisite('audit', () => proceed());
const needsAsync = false as boolean;
const hiddenAsync = (): unknown => Promise.resolve(1);
const transport: ServerTransport = { callServerTool: () => Promise.resolve({ content: [] }) };

describe('the Blueprint authoring cases against the real exports', () => {
  it('accepts every positive case', async () => {
    // P1: a guard that provides nothing attaches, and earlier provided values are preserved.
    const guarded = Action.local<Press>('guarded')
      .before(session)
      .before(audit)
      .run(({ provided }) => provided.user)
      .build();

    // P2: a prerequisite that needs less than the action provides is accepted.
    const needsOnlyUser = prerequisite('needs-user', ({ provided }: PrerequisiteContext<{ readonly user: string }, unknown>) =>
      provided.user === '' ? refuse('empty') : proceed({ confirmed: true as const }),
    );
    const lessNeeded = Action.local<Press>('less-needed')
      .input(() => ({ noteId: 'note-1', extra: 1 }))
      .before(session)
      .before(needsOnlyUser)
      .run(({ params, provided }) => `${params.noteId}:${params.extra}:${String(provided.confirmed)}`)
      .build();

    // P3: a synchronous prerequisite attaches the same way.
    const syncGuard = Action.local<Press>('sync-guard').before(prerequisite('sync', () => proceed())).run(() => 1).build();

    // P4: a callback that always throws returns `never`, which is valid.
    const throwing = Action.local<Press>('throwing')
      .atActivation(() => {
        throw new Error('activation failed synchronously');
      })
      .run(() => 0)
      .build();

    // P5: a union without a thenable constituent is accepted.
    const optional = Action.local<Press>('optional')
      .atActivation(() => (needsAsync ? undefined : 1))
      .run(({ activation }) => activation ?? 0)
      .build();

    // P6: a retained alias is a branch: two branches each register one hook, and neither sees the other.
    const base = Action.local<Press>('branch').run(() => 1).limits({ hookMs: 1 });
    const branchA = base.onSuccess(() => undefined).build();
    const branchB = base.onSuccess(() => undefined).build();

    // P7: the primary outcome keeps the failure stage, so final reporting tells "never started" from "unknown".
    const kinds: string[] = [];
    const finalReport = Action.server<Press>('final-report', transport)
      .run(() => 0)
      .limits({ deadlineMs: 1, hookMs: 1 })
      .onFinally(({ outcome, cleanupErrors }) => {
        if (outcome.status === 'failed' && outcome.stage === 'prerequisites') kinds.push(outcome.failure.kind); // not started
        if (outcome.status === 'failed' && outcome.stage === 'running') kinds.push(outcome.failure.kind); // effect may be unknown
        void cleanupErrors.length; // diagnostics, kept apart from the outcome
      })
      .build();

    // P8: `current()` is available to a handler and to a prerequisite.
    const fresh = Action.local<Press>('fresh')
      .before(prerequisite('fresh-guard', ({ current }) => (current() ? proceed() : refuse('stale'))))
      .run(async ({ current }) => (current() ? 1 : 0))
      .build();

    // L1, a limit recorded rather than hidden: a promise behind a declared `unknown` compiles, and
    // the runtime check catches it instead (resource-scope.test.ts runs that case).
    const hidden = Action.local<Press>('hidden-async')
      .atActivation(hiddenAsync)
      .run(() => 0)
      .build();

    expect([guarded, lessNeeded, syncGuard, throwing, optional, branchA, branchB, finalReport, fresh, hidden].map((one) => one.label)).toEqual([
      'guarded',
      'less-needed',
      'sync-guard',
      'throwing',
      'optional',
      'branch',
      'branch',
      'final-report',
      'fresh',
      'hidden-async',
    ]);
    expect(branchA).not.toBe(branchB);
    expect(kinds).toEqual([]);
  });

  it('refuses the remaining negative cases at compile time', () => {
    const refusedByTheCompiler = (): void => {
      // N4: the success hook sees the handler's actual result type.
      Action.local<Press>('n4')
        .run(() => ({ savedAt: 1 }))
        .limits({ hookMs: 1 })
        // @ts-expect-error savedAt is a number
        .onSuccess(({ result }) => result.savedAt.toUpperCase())
        .build();

      // N9: telemetry events carry no params or results.
      Action.local<Press>('n9')
        .run(() => 0)
        // @ts-expect-error ObservedEvent has no `params`
        .observe((event) => void event.params)
        .build();

      // N10: input cannot be changed once a prerequisite that depends on it is attached.
      Action.local<Press>('n10')
        .input(() => ({ noteId: 'a' }))
        .before(session)
        // @ts-expect-error `input` is not available after `before`
        .input(() => ({}))
        .run(() => 0)
        .build();

      // N11: input is configured once, and before atActivation.
      Action.local<Press>('n11')
        .input(() => ({ noteId: 'a' }))
        // @ts-expect-error `input` is not available twice
        .input(() => ({ noteId: 'b' }))
        .run(() => 0)
        .build();

      // N17: a union with a thenable constituent is rejected too, not only a plain promise.
      Action.local<Press>('n17')
        // @ts-expect-error the callback may return a Promise
        .atActivation(() => (needsAsync ? Promise.resolve(1) : undefined))
        .run(() => 0)
        .build();

      // N18: the guard has no diagnostic-string escape.
      Action.local<Press>('n18')
        // @ts-expect-error a string is not assignable to the guard parameter
        .atActivation(async () => 1, 'atActivation must return synchronously; start awaited work in before or run')
        .run(() => 0)
        .build();

      // N23: the delivered outcome is the primary decision only; cleanup diagnostics are a separate list.
      Action.local<Press>('n23')
        .run(() => 0)
        .limits({ hookMs: 1 })
        .onFinally(({ outcome }) => {
          // @ts-expect-error Outcome has no cleanupErrors
          void outcome.cleanupErrors;
        })
        .build();

      // N24: an action written for the data-bearing row event cannot attach to a plain button, whose event has no noteId.
      const archiveRow = Action.local<NoteEvent>('archive-row').run(() => 0).build();
      const host = newHost();
      renderInstance(host, 'details-toggle');
      host.register((view) => {
        view.watchById('details-toggle', Control, (handle) => {
          // @ts-expect-error the control's event has no `noteId`
          handle.bindAction('activate', archiveRow);
          // N25: a plain handle has no data reader; it is never cast into one.
          // @ts-expect-error InstanceHandle has no readData
          void handle.readData();
        });
      });
    };
    void refusedByTheCompiler;
    expect(typeof Action.server).toBe('function');
  });
});
