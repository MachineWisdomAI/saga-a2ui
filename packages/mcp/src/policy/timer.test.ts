import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startBoundedTimer } from './index.js';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const NATIVE_MAX = 2_147_483_647;

describe('startBoundedTimer', () => {
  it('fires once after a short wait', () => {
    const fired = vi.fn();
    startBoundedTimer(100, fired);
    vi.advanceTimersByTime(99);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('waits the whole of a limit that no single native timer can hold', () => {
    const fired = vi.fn();
    startBoundedTimer(2 * NATIVE_MAX + 1_000, fired);
    vi.advanceTimersByTime(NATIVE_MAX);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(NATIVE_MAX);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('never hands the platform a delay above its maximum', () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    startBoundedTimer(3_000_000_000, () => undefined);
    for (const [, delay] of spy.mock.calls)
      expect(delay as number).toBeLessThanOrEqual(NATIVE_MAX);
  });

  it('cancels, leaving no timer behind', () => {
    const fired = vi.fn();
    const cancel = startBoundedTimer(3_000_000_000, fired);
    cancel();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(3_000_000_000);
    expect(fired).not.toHaveBeenCalled();
  });
});
