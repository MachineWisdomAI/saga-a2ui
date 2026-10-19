// The two bounds an action runs under, and how each is resolved. Resolution is per setting and
// happens in one order: the action's own override, then the configuration of the SDK instance that
// owns the binding, then the product default. A value is checked where it is supplied, whether or
// not another layer would shadow it, so a mistake is never silently hidden by an override.

/**
 * Optional on every action and on every SDK instance. `deadlineMs` bounds the prerequisites and
 * the handler together, counted from the end of the synchronous activation prefix. `hookMs`
 * bounds each awaited hook and each cleanup or release step on its own. An omitted setting is
 * inherited; it never disables its bound. A supplied value must be a finite number greater than
 * zero (an `undefined` property counts as omitted).
 */
export interface Limits {
  readonly deadlineMs?: number;
  readonly hookMs?: number;
}

/** What an invocation actually runs under: every setting resolved, immutable. */
export interface ResolvedLimits {
  readonly deadlineMs: number;
  readonly hookMs: number;
}

/** Documented product defaults for usable behavior, not measured latency guarantees. */
const defaults: ResolvedLimits = Object.freeze({ deadlineMs: 30_000, hookMs: 5_000 });

/** The longest delay `setTimeout` honors; a longer one would fire at once instead of later. */
const longestTimerMs = 2_147_483_647;

/** A delay a timer can really wait. Anything longer is capped at about 24.8 days. */
export function timerDelay(ms: number): number {
  return Math.min(ms, longestTimerMs);
}

function readSetting(owner: string, name: keyof Limits, value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${owner}: ${name} must be a finite number greater than zero.`);
  }
  return value;
}

/**
 * Checks what a caller supplied and copies it, so that later changes to the caller's object reach
 * nothing. `owner` names the declaration in the error. Throws a `TypeError` for anything that is
 * not an object (or `undefined`) and for any supplied setting that is not a finite positive number.
 */
export function readLimits(owner: string, given: unknown): Limits {
  if (given === undefined) return Object.freeze({});
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    throw new TypeError(`${owner}: limits must be an object with optional deadlineMs and hookMs.`);
  }
  const { deadlineMs, hookMs } = given as { deadlineMs?: unknown; hookMs?: unknown };
  const checkedDeadline = readSetting(owner, 'deadlineMs', deadlineMs);
  const checkedHook = readSetting(owner, 'hookMs', hookMs);
  return Object.freeze({
    ...(checkedDeadline === undefined ? {} : { deadlineMs: checkedDeadline }),
    ...(checkedHook === undefined ? {} : { hookMs: checkedHook }),
  });
}

/**
 * Validates `limits` the way the instance host does and returns an immutable copy. An adapter
 * calls it when its own configuration is supplied, so that a bad value fails there and not later
 * when a surface is presented.
 */
export function snapshotLimits(limits?: Limits): Limits {
  return readLimits('Limits', limits);
}

/** Per-setting resolution: the action's override, then the instance configuration, then the default. */
export function resolveLimits(action: Limits, instance: Limits): ResolvedLimits {
  return Object.freeze({
    deadlineMs: action.deadlineMs ?? instance.deadlineMs ?? defaults.deadlineMs,
    hookMs: action.hookMs ?? instance.hookMs ?? defaults.hookMs,
  });
}
