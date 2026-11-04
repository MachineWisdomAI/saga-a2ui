/**
 * Admission of untrusted A2UI input: finite structural, byte, item and retained-state limits
 * that are checked before Zod parses the input, before anything is copied and before a session
 * keeps it. The upstream schemas are built on Zod 3, which accepts arrays and nesting of any
 * size, so the bound has to be ours. Every walk here is iterative: depth never costs stack.
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

/** What admitted input weighs; `size` of a decode result and the unit of retained accounting. */
export interface MessageSize {
  readonly nodes: number;
  readonly bytes: number;
}

type Exceeded = 'bytes' | 'nodes' | 'depth' | 'array-items';
type Scan =
  | { readonly ok: true; readonly size: MessageSize }
  | { readonly ok: false; readonly exceeded: Exceeded };

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
function utf8Length(text: string): number {
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

interface ScanLimits {
  readonly maxBytes: number;
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxArrayItems: number;
}

/**
 * Walks `roots` with an explicit stack and stops at the first limit crossed. Nothing is
 * allocated or copied in proportion to the input: a value is counted when it is pushed, so the
 * stack never outgrows `maxNodes`, and an array's length is checked before its items are read.
 * A cycle revisits values until the node budget ends the walk.
 */
export function scan(roots: readonly unknown[], limits: ScanLimits): Scan {
  let nodes = 0;
  let bytes = 0;
  const stack: { value: unknown; depth: number }[] = [];
  const push = (value: unknown, depth: number): Exceeded | undefined => {
    if (depth > limits.maxDepth) return 'depth';
    nodes += 1;
    if (nodes > limits.maxNodes) return 'nodes';
    stack.push({ value, depth });
    return undefined;
  };
  for (const root of roots) {
    const exceeded = push(root, 0);
    if (exceeded) return { ok: false, exceeded };
  }
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (typeof value === 'string') {
      // A string takes at least one byte per UTF-16 unit, so a long one is refused unmeasured.
      if (value.length > limits.maxBytes - bytes)
        return { ok: false, exceeded: 'bytes' };
      bytes += utf8Length(value);
    } else if (typeof value === 'object' && value !== null) {
      if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
        bytes += value.byteLength;
      } else if (Array.isArray(value)) {
        if (value.length > limits.maxArrayItems)
          return { ok: false, exceeded: 'array-items' };
        for (let index = 0; index < value.length; index += 1) {
          const exceeded = push(value[index], depth + 1);
          if (exceeded) return { ok: false, exceeded };
        }
      } else {
        for (const key of Object.keys(value)) {
          if (key.length > limits.maxBytes - bytes)
            return { ok: false, exceeded: 'bytes' };
          bytes += utf8Length(key);
          const exceeded = push(
            (value as Record<string, unknown>)[key],
            depth + 1,
          );
          if (exceeded) return { ok: false, exceeded };
        }
      }
    }
    if (bytes > limits.maxBytes) return { ok: false, exceeded: 'bytes' };
  }
  return { ok: true, size: { nodes, bytes } };
}

/** Why `decode` refused input over a limit. Plain text, safe to display. */
export function describeExceeded(
  exceeded: Exceeded,
  limits: InputLimits,
): string {
  switch (exceeded) {
    case 'bytes':
      return `A2UI input is larger than ${limits.maxBytes} bytes.`;
    case 'nodes':
      return `A2UI input has more than ${limits.maxNodes} values.`;
    case 'depth':
      return `A2UI input is nested deeper than ${limits.maxDepth} levels.`;
    case 'array-items':
      return `A2UI input has an array with more than ${limits.maxArrayItems} items.`;
  }
}

/** Admits one `decode` input as a whole, or says which limit it crossed. */
export function admitInput(
  input: unknown,
  limits: InputLimits,
):
  | { readonly ok: true; readonly size: MessageSize }
  | { readonly ok: false; readonly message: string } {
  const scanned = scan([input], limits);
  return scanned.ok
    ? scanned
    : { ok: false, message: describeExceeded(scanned.exceeded, limits) };
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
