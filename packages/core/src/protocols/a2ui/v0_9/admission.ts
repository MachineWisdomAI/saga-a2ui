/**
 * Admission of untrusted A2UI input: finite structural, byte, item and retained-state limits
 * that are checked before Zod parses the input, before anything else copies it and before a
 * session keeps it. The upstream schemas are built on Zod 3, which accepts arrays and nesting of
 * any size, so the bound has to be ours. Every walk here is iterative: depth never costs stack.
 *
 * Admission is also the one read of caller input. It returns a snapshot of plain data that it
 * built while charging the limits, and everything after it (schema validation, copying, the
 * session) works on that snapshot. A getter or a proxy is therefore read once, and the value
 * that was measured is the value that is used.
 */

/** Limits on one `decode` call. Each is a positive integer. */
export interface InputLimits {
  /** Messages in one list. */
  readonly maxMessages: number;
  /** UTF-8 bytes of every string and property name, plus the length of binary values. */
  readonly maxBytes: number;
  /** Values visited (objects, arrays and primitives), counting a shared value each time. */
  readonly maxNodes: number;
  /** Levels of nested objects and arrays, and segments of a data path. */
  readonly maxDepth: number;
  /** Items of any one array. The upstream data model refuses indexes past 10000. */
  readonly maxArrayItems: number;
}

/** Limits on what one session keeps. Each is a positive integer. */
export interface RetainedLimits {
  /** Values held in surface data, component properties, themes and metadata. */
  readonly maxNodes: number;
  /** UTF-8 bytes of the strings and property names among them. */
  readonly maxBytes: number;
}

export const DEFAULT_INPUT_LIMITS: InputLimits = {
  maxMessages: 1_000,
  maxBytes: 4 * 1024 * 1024,
  maxNodes: 200_000,
  maxDepth: 64,
  maxArrayItems: 10_000,
};

export const DEFAULT_RETAINED_LIMITS: RetainedLimits = {
  maxNodes: 500_000,
  maxBytes: 16 * 1024 * 1024,
};

/** What state weighs: the unit of the session's retained accounting. */
export interface MessageSize {
  readonly nodes: number;
  readonly bytes: number;
}

type Exceeded =
  'messages' | 'bytes' | 'nodes' | 'depth' | 'array-items' | 'unsupported';

/** Throws, naming the limit, unless every supplied limit is a positive safe integer. */
export function checkedLimits<Limits extends InputLimits | RetainedLimits>(
  defaults: Limits,
  supplied: Partial<Limits> | undefined,
): Limits {
  const limits = { ...defaults, ...supplied };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || (value as number) < 1)
      throw new RangeError(`${name} must be a positive integer.`);
  }
  return limits;
}

/** Exact UTF-8 length, without allocating. Callers bound the string's length first. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (
      unit >= 0xd800 &&
      unit <= 0xdbff &&
      (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

interface AdmitLimits {
  readonly maxMessages: number;
  readonly maxBytes: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxArrayItems: number;
}

/** A container whose items are still to be read from `source` into `target`. */
type Frame =
  | {
      readonly source: unknown[];
      readonly target: unknown[];
      readonly depth: number;
      readonly length: number;
    }
  | {
      readonly source: object;
      readonly target: Record<string, unknown>;
      readonly depth: number;
    };

export const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Plain data only: an object whose prototype is `null` or an object prototype. A `Map`, a
 * `Set`, a `Date` or a class instance keeps its content where no property read can measure it,
 * so it is refused rather than charged as a single value and copied later.
 */
export function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/**
 * Reads `root` once, with an explicit stack, into a snapshot of plain arrays and objects, and
 * stops at the first limit crossed. The work and the snapshot are bounded by the limits, never
 * by the input: a value is charged before it is stored, an array's length is checked before
 * its items are read, and an object's keys are read one at a time (`for...in`), so this code
 * builds no list of them and a key past the budget is never reached. Residual risk: the engine
 * may still allocate enumeration metadata for an already-materialized wide object before the
 * first iteration, and JavaScript has no bounded one-key enumeration of own keys at this
 * boundary, so that is accepted as such, not removed. A cycle revisits values until
 * the node budget ends the walk. Every property, item and length is read exactly once, so a
 * getter or a proxy cannot show the walk one value and the caller another.
 */
export function admit(
  root: unknown,
  limits: AdmitLimits,
):
  | { readonly ok: true; readonly value: unknown; readonly size: MessageSize }
  | { readonly ok: false; readonly exceeded: Exceeded } {
  let nodes = 0;
  let bytes = 0;
  let exceeded: Exceeded | undefined;
  const frames: Frame[] = [];

  /** Charges `text` as bytes; false when that crosses the limit. */
  const chargeText = (text: string): boolean => {
    // A string takes at least one byte per UTF-16 unit, so a long one is refused unmeasured.
    if (text.length > limits.maxBytes - bytes) return false;
    bytes += utf8Length(text);
    return bytes <= limits.maxBytes;
  };

  /** The snapshot of `raw`; sets `exceeded` instead when `raw` cannot be admitted. */
  const visit = (raw: unknown, depth: number, messageList = false): unknown => {
    if (depth > limits.maxDepth) {
      exceeded = 'depth';
      return undefined;
    }
    nodes += 1;
    if (nodes > limits.maxNodes) {
      exceeded = 'nodes';
      return undefined;
    }
    if (typeof raw === 'string') {
      if (!chargeText(raw)) exceeded = 'bytes';
      return raw;
    }
    if (typeof raw !== 'object' || raw === null) return raw;
    if (ArrayBuffer.isView(raw) || raw instanceof ArrayBuffer) {
      if (raw.byteLength > limits.maxBytes - bytes) {
        exceeded = 'bytes';
        return undefined;
      }
      // The copy is what is kept, so its length is what is charged.
      const copy = structuredClone(raw);
      bytes += copy.byteLength;
      if (bytes > limits.maxBytes) exceeded = 'bytes';
      return copy;
    }
    if (Array.isArray(raw)) {
      const length = raw.length;
      // The message list is the root array or the envelope's `messages`; its length is
      // read here, once, with every other array's.
      if (messageList && length > limits.maxMessages) {
        exceeded = 'messages';
        return undefined;
      }
      if (length > limits.maxArrayItems) {
        exceeded = 'array-items';
        return undefined;
      }
      const target: unknown[] = [];
      frames.push({
        source: raw as unknown[],
        target,
        depth,
        length,
      });
      return target;
    }
    if (!isPlainObject(raw)) {
      exceeded = 'unsupported';
      return undefined;
    }
    const target: Record<string, unknown> = {};
    frames.push({ source: raw, target, depth });
    return target;
  };

  const value = visit(root, 0, true);
  while (frames.length > 0 && exceeded === undefined) {
    const frame = frames.pop()!;
    if ('length' in frame) {
      for (let index = 0; index < frame.length; index += 1) {
        const item = visit(frame.source[index], frame.depth + 1);
        if (exceeded !== undefined) break;
        frame.target.push(item);
      }
      continue;
    }
    for (const key in frame.source) {
      if (!chargeText(key)) {
        exceeded = 'bytes';
        break;
      }
      if (!hasOwn(frame.source, key)) continue;
      const item = visit(
        (frame.source as Record<string, unknown>)[key],
        frame.depth + 1,
        frame.depth === 0 && key === 'messages',
      );
      if (exceeded !== undefined) break;
      // Defined, not assigned: a key named `__proto__` is data here, never a prototype.
      Object.defineProperty(frame.target, key, {
        value: item,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return exceeded === undefined
    ? { ok: true, value, size: { nodes, bytes } }
    : { ok: false, exceeded };
}

/**
 * What state a session already holds, or is about to keep, for the retained budget. It reads
 * session-owned state and validated messages (data the session admitted and the upstream
 * processor stored), not caller input, so it only counts: every value, with a hole in an array
 * counted as a value because the data model's auto-vivified arrays are measured by length. It
 * stops when a limit is crossed, and also at a value that is not plain data (a `Map`, a `Set`,
 * a class instance): its content is out of reach of a property read, so it cannot be charged
 * and is never retained. The session reads every message, from the default decoder or a
 * custom one, through `admit` first, which refuses such a value, so this is the second line.
 */
export function measure(
  roots: readonly unknown[],
  limits: { readonly maxNodes: number; readonly maxBytes: number },
): MessageSize | undefined {
  let nodes = 0;
  let bytes = 0;
  const stack: unknown[] = [];
  for (const root of roots) {
    nodes += 1;
    if (nodes > limits.maxNodes) return undefined;
    stack.push(root);
  }
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === 'string') {
      if (value.length > limits.maxBytes - bytes) return undefined;
      bytes += utf8Length(value);
    } else if (typeof value === 'object' && value !== null) {
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        bytes += value.byteLength;
      } else if (Array.isArray(value)) {
        nodes += value.length;
        if (nodes > limits.maxNodes) return undefined;
        for (let index = 0; index < value.length; index += 1)
          stack.push(value[index]);
      } else {
        if (!isPlainObject(value)) return undefined;
        for (const key in value) {
          if (!hasOwn(value, key)) continue;
          if (key.length > limits.maxBytes - bytes) return undefined;
          bytes += utf8Length(key);
          nodes += 1;
          if (nodes > limits.maxNodes) return undefined;
          stack.push((value as Record<string, unknown>)[key]);
        }
      }
    }
    if (bytes > limits.maxBytes) return undefined;
  }
  return { nodes, bytes };
}

/** Why `decode` refused input over a limit. Plain text, safe to display. */
export function describeExceeded(
  exceeded: Exceeded,
  limits: InputLimits,
): string {
  switch (exceeded) {
    case 'messages':
      return `A2UI input has more than ${limits.maxMessages} messages.`;
    case 'bytes':
      return `A2UI input is larger than ${limits.maxBytes} bytes.`;
    case 'nodes':
      return `A2UI input has more than ${limits.maxNodes} values.`;
    case 'depth':
      return `A2UI input is nested deeper than ${limits.maxDepth} levels.`;
    case 'array-items':
      return `A2UI input has an array with more than ${limits.maxArrayItems} items.`;
    case 'unsupported':
      return 'A2UI input has a value that is not plain data (only objects, arrays, strings, numbers, booleans, null and binary data are accepted).';
  }
}

/** Whether a data path stays within the depth limit (each `/` starts a segment). */
export function pathWithinDepth(path: string, maxDepth: number): boolean {
  let segments = 0;
  for (
    let index = path.indexOf('/');
    index !== -1;
    index = path.indexOf('/', index + 1)
  ) {
    segments += 1;
    if (segments > maxDepth) return false;
  }
  return true;
}
