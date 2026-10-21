import {
  Action,
  componentKind,
  type ActionBinding,
  type InstanceEvent,
} from '@saga-a2ui/core/actions';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLitActions } from './lit-actions.js';
import { mountOwners } from './mount-owner.js';

// The Lit adapter forwards the application's action limits to the one host each presentation owns.
// The presentation is started the way the app element starts it, with a stand-in owner element;
// the host is reached through the same registry the real ActionButton reads. The clock is controlled.

interface Events {
  readonly activate: InstanceEvent<string>;
}
const Control = componentKind<Events>('Control');
type Press = InstanceEvent<string>;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Presents one surface and returns the binding of a never-settling action on one control, pressed once. */
function pressNeverSettling(
  actions: ReturnType<typeof createLitActions>,
  owner: object,
): { binding: ActionBinding; end: () => void } {
  const end = actions.begin({
    owner: owner as Element,
    surface: {} as never,
    mount: () => undefined,
  });
  const host = mountOwners.get(owner as Element)?.host;
  if (host === undefined) throw new Error('the presentation published no host');
  const instance = host.open<Events>({
    kind: Control,
    componentId: 'c',
    dataPath: '/',
    events: ['activate'],
    isLive: () => true,
    read: () => undefined,
  });
  const action = Action.local<Press>('wait')
    .run(() => new Promise<void>(() => undefined))
    .build();
  let binding: ActionBinding | undefined;
  // `attach` of the presentation already ran; a second registration binds the probe control.
  host.register((view) =>
    view.watchById(
      'c',
      Control,
      (handle) => void (binding = handle.bindAction('activate', action)),
    ),
  );
  instance.activate('activate', 'click');
  if (binding === undefined) throw new Error('nothing was bound');
  return { binding, end };
}

describe('createLitActions limits', () => {
  it('gives every presented surface’s host the application’s limits, and the default without them', async () => {
    const configured = createLitActions({
      attach: () => undefined,
      onSetupError: () => undefined,
      limits: { deadlineMs: 2_000 },
    });
    const plain = createLitActions({
      attach: () => undefined,
      onSetupError: () => undefined,
    });
    const first = pressNeverSettling(configured, {});
    const second = pressNeverSettling(configured, {});
    const third = pressNeverSettling(plain, {});

    await vi.advanceTimersByTimeAsync(2_000);
    expect([first.binding.state.phase, second.binding.state.phase]).toEqual([
      'idle',
      'idle',
    ]);
    expect(third.binding.state.phase).toBe('running'); // another configuration, untouched

    await vi.advanceTimersByTimeAsync(28_000);
    expect(third.binding.state.phase).toBe('idle'); // the 30,000 ms default
  });

  it('refuses an invalid value when the integration is created, before any surface is presented', () => {
    const attached: string[] = [];
    for (const bad of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '5',
      null,
    ]) {
      expect(() =>
        createLitActions({
          attach: () => void attached.push('attach'),
          onSetupError: () => undefined,
          limits: { hookMs: bad } as never,
        }),
      ).toThrow(/hookMs/);
    }
    expect(attached).toEqual([]);
  });

  it('is not changed by mutating the application’s object after the integration was created', async () => {
    const limits = { deadlineMs: 2_000 };
    const actions = createLitActions({
      attach: () => undefined,
      onSetupError: () => undefined,
      limits,
    });
    limits.deadlineMs = 60_000;
    const { binding } = pressNeverSettling(actions, {});

    await vi.advanceTimersByTimeAsync(2_000);

    expect(binding.state.phase).toBe('idle');
  });
});
