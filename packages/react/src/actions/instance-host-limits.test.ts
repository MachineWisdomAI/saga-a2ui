// @vitest-environment jsdom
import { Action, type InstanceHandle } from '@saga-a2ui/core/actions';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ActionButton,
  type ActionButtonActivation,
  type ActionButtonEvents,
} from './action-button.js';
import {
  mount,
  openSession,
  surfaceView,
  type Mounted,
  type Session,
} from './fixture.test-support.js';
import type { Limits } from '@saga-a2ui/core/actions';

// The provider hands the application's action limits to the one host it owns. A real
// `A2uiSurface` renders a real `ActionButton`; the click is a real DOM click and the clock is
// controlled.

type Handle = InstanceHandle<ActionButtonEvents>;

let mounted: Mounted | undefined;
let session: Session | undefined;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  mounted?.unmount();
  session?.dispose();
  mounted = undefined;
  session = undefined;
  vi.useRealTimers();
});

const waiting = Action.local<ActionButtonActivation>('wait')
  .run(() => new Promise<void>(() => undefined))
  .build();

/** Renders the surface under a provider with `limits`, presses Mark A once and returns its binding's phase reader. */
function pressWithLimits(
  limits: Limits | undefined,
  options: { readonly render?: boolean } = {},
): () => string {
  session = openSession();
  mounted = mount({ strict: true });
  let phase = (): string => 'unbound';
  mounted.render(
    surfaceView({
      surface: session.surface,
      ...(limits === undefined ? {} : { limits }),
      setup: (view) =>
        void view.watchById('mark-a', ActionButton, (handle: Handle) => {
          const binding = handle.bindAction('activate', waiting);
          phase = () => binding.state.phase;
        }),
    }),
  );
  if (options.render !== false) mounted.press(mounted.button('Mark A'));
  return () => phase();
}

describe('InstanceHostProvider limits', () => {
  it('gives the actions under it the application’s limits', async () => {
    const phase = pressWithLimits({ deadlineMs: 2_000 });
    expect(phase()).toBe('running');

    await act(async () => void (await vi.advanceTimersByTimeAsync(1_999)));
    expect(phase()).toBe('running');
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(phase()).toBe('idle');
  });

  it('uses the 30,000 ms default when the application configures nothing', async () => {
    const phase = pressWithLimits(undefined);

    await act(async () => void (await vi.advanceTimersByTimeAsync(29_999)));
    expect(phase()).toBe('running');
    await act(async () => void (await vi.advanceTimersByTimeAsync(1)));
    expect(phase()).toBe('idle');
  });

  it('is not changed by mutating the application’s object after the provider mounted', async () => {
    const limits = { deadlineMs: 2_000 };
    const phase = pressWithLimits(limits);
    limits.deadlineMs = 60_000;

    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));

    expect(phase()).toBe('idle');
  });

  it('refuses an invalid value before the surface mounts or anything binds', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      expect(() => pressWithLimits({ hookMs: 0 }, { render: false })).toThrow(
        /hookMs/,
      );
      expect(() =>
        pressWithLimits({ deadlineMs: Number.NaN }, { render: false }),
      ).toThrow(/deadlineMs/);
    } finally {
      error.mockRestore();
    }
  });
});
