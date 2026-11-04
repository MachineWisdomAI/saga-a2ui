// The one admission budget for what a host delivers to a view. A host's tool result and tool input
// arrive from the bridge unchecked, so a view keeps, walks, maps and forwards them only after
// this walk has counted them and found them within finite limits. The walk allocates nothing
// proportional to its input: it is iterative (depth never costs stack), reads each array and
// object once, and stops at the first limit crossed.

/** Limits on one delivered result or input. Each is a positive safe integer. */
export interface ToolResultLimits {
  /** UTF-8 bytes of every string and property name, plus the length of binary values. */
  readonly maxBytes: number;
  /** Values visited (objects, arrays and primitives), counting a shared value each time. */
  readonly maxNodes: number;
  /** Levels of nested objects and arrays. */
  readonly maxDepth: number;
  /** Items of any one array. */
  readonly maxArrayItems: number;
  /** Blocks in the result's `content` list. */
  readonly maxContentBlocks: number;
}

export const DEFAULT_TOOL_RESULT_LIMITS: ToolResultLimits = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  maxNodes: 200_000,
  maxDepth: 64,
  maxArrayItems: 10_000,
  maxContentBlocks: 1_000,
});

/** Which limit a delivered value crossed, or that it holds something that is not wire data. */
export type ToolResultExceeded =
  | 'bytes'
  | 'nodes'
  | 'depth'
  | 'array-items'
  | 'content-blocks'
  | 'unsupported';

export type ToolResultAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly exceeded: ToolResultExceeded };

/**
 * Why a delivered result or input was refused. A `TypeError`, so a caller that already treats a
 * result it cannot carry as a failed reading handles it the same way. It names the limit that was
 * crossed and never repeats any of the content.
 */
export class ToolResultRefused extends TypeError {
  constructor(
    readonly exceeded: ToolResultExceeded,
    readonly limits: ToolResultLimits,
  ) {
    super(describeExceeded(exceeded, limits));
    this.name = 'ToolResultRefused';
  }
}

/** Throws, naming the limit, unless every supplied limit is a positive safe integer. */
export function toolResultLimits(
  supplied?: Partial<ToolResultLimits>,
): ToolResultLimits {
  if (supplied === undefined) return DEFAULT_TOOL_RESULT_LIMITS;
  const limits = { ...DEFAULT_TOOL_RESULT_LIMITS, ...supplied };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`${name} must be a positive integer.`);
  }
  return limits;
}

function describeExceeded(
  exceeded: ToolResultExceeded,
  limits: ToolResultLimits,
): string {
  switch (exceeded) {
    case 'bytes':
      return `The tool result is larger than ${limits.maxBytes} bytes.`;
    case 'nodes':
      return `The tool result has more than ${limits.maxNodes} values.`;
    case 'depth':
      return `The tool result is nested deeper than ${limits.maxDepth} levels.`;
    case 'array-items':
      return `The tool result has an array with more than ${limits.maxArrayItems} items.`;
    case 'content-blocks':
      return `The tool result has more than ${limits.maxContentBlocks} content blocks.`;
    case 'unsupported':
      return 'The tool result has a value that is not plain data (only objects, arrays, strings, numbers, booleans, null and binary data are carried).';
  }
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

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Plain data only: an object whose prototype is `null` or an object prototype. A `Map`, a `Set`,
 * a `Date` or a class instance keeps its content where no property read can measure it, so it is
 * refused rather than charged as a single value and carried on.
 */
function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

interface Pending {
  readonly value: unknown;
  readonly depth: number;
  /** The root's `content` list, which has a count limit of its own. */
  readonly contentList: boolean;
}

/**
 * Counts `root` against `limits` without copying it, and stops at the first limit crossed. The
 * work is bounded by the limits, never by the input: a value is counted before it is queued, an
 * array's length is checked before its items are read, and an object's keys are read one at a
 * time (`for...in`), so this builds no list of them and a key past the budget is never reached.
 * Residual risk: the engine may still allocate enumeration metadata for an already-materialized
 * wide object before the first iteration, and JavaScript has no bounded one-key enumeration of
 * own keys at this boundary, so that is accepted as such, not removed. A cycle revisits values
 * until the node budget ends the walk.
 *
 * Primitives are an explicit allowlist: a `bigint` can hold millions of bits that neither the
 * node nor the byte count would see, and a symbol or a function is not wire data at all.
 */
export function admitToolResult(
  root: unknown,
  limits: ToolResultLimits = DEFAULT_TOOL_RESULT_LIMITS,
): ToolResultAdmission {
  let nodes = 1;
  let bytes = 0;
  const pending: Pending[] = [{ value: root, depth: 0, contentList: false }];

  const refuse = (exceeded: ToolResultExceeded): ToolResultAdmission => ({
    ok: false,
    exceeded,
  });
  /** Charges `text` as bytes; false when that crosses the limit. */
  const chargeText = (text: string): boolean => {
    // A string takes at least one byte per UTF-16 unit, so a long one is refused unmeasured.
    if (text.length > limits.maxBytes - bytes) return false;
    bytes += utf8Length(text);
    return bytes <= limits.maxBytes;
  };
  /** Counts and queues a child value; the limit it crossed, if any. */
  const queue = (
    value: unknown,
    depth: number,
    contentList = false,
  ): ToolResultExceeded | undefined => {
    if (depth > limits.maxDepth) return 'depth';
    nodes += 1;
    if (nodes > limits.maxNodes) return 'nodes';
    pending.push({ value, depth, contentList });
    return undefined;
  };

  while (pending.length > 0) {
    const { value, depth, contentList } = pending.pop()!;
    if (typeof value === 'string') {
      if (!chargeText(value)) return refuse('bytes');
      continue;
    }
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null ||
      value === undefined
    )
      continue;
    if (typeof value !== 'object') return refuse('unsupported');
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
      bytes += value.byteLength;
      if (bytes > limits.maxBytes) return refuse('bytes');
      continue;
    }
    if (Array.isArray(value)) {
      const length = value.length;
      if (contentList && length > limits.maxContentBlocks)
        return refuse('content-blocks');
      if (length > limits.maxArrayItems) return refuse('array-items');
      for (let index = 0; index < length; index += 1) {
        const exceeded = queue(value[index], depth + 1);
        if (exceeded !== undefined) return refuse(exceeded);
      }
      continue;
    }
    if (!isPlainObject(value)) return refuse('unsupported');
    for (const key in value) {
      if (!chargeText(key)) return refuse('bytes');
      if (!hasOwn(value, key)) continue;
      const exceeded = queue(
        (value as Record<string, unknown>)[key],
        depth + 1,
        depth === 0 && key === 'content',
      );
      if (exceeded !== undefined) return refuse(exceeded);
    }
  }
  return { ok: true };
}
