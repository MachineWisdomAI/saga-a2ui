// One timer for every configurable limit. A native timer cannot wait longer than 2^31-1 ms: a longer
// delay is silently replaced by about 1 ms, so an accepted large finite limit would expire at once.
// Limits are accepted up to any finite value, so every wait is made of segments, each followed by a
// check of what is left on a monotonic clock. No runtime imports: browser and Node share it.

/** The longest delay a single native timer honors. */
const MAX_SEGMENT_MS = 2_147_483_647;

/**
 * Calls `onExpire` once, after `ms` of monotonic time, however large `ms` is. Returns a function
 * that cancels it. A timer that fires early re-arms for the remainder instead of expiring early.
 */
export function startBoundedTimer(
  ms: number,
  onExpire: () => void,
): () => void {
  const deadline = performance.now() + ms;
  let handle: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const arm = (): void => {
    handle = undefined;
    if (cancelled) return;
    const left = deadline - performance.now();
    if (left <= 0) {
      cancelled = true;
      onExpire();
      return;
    }
    handle = setTimeout(arm, Math.min(left, MAX_SEGMENT_MS));
  };
  arm();
  return () => {
    cancelled = true;
    if (handle !== undefined) clearTimeout(handle);
    handle = undefined;
  };
}
