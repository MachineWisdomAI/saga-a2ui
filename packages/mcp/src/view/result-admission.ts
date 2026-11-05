// The one admission budget for what a host delivers to a view. A host's tool result and tool input
// arrive from the bridge unchecked, so a view keeps, walks, maps and forwards them only after
// this walk has counted them and found them within finite limits. The walk allocates nothing
// proportional to its input: it is iterative (depth never costs stack), reads each array and
// object once, and stops at the first limit crossed.
//
// The byte limit bounds the SERIALIZED size: the number of UTF-8 bytes of the value's JSON text
// (`JSON.stringify`), counted as an upper bound that never underestimates it. Strings, property
// names and the structure around them (braces, brackets, quotes, colons, commas) are counted
// exactly, so a text full of characters that JSON escapes (a quote, a backslash, a control
// character) costs what its escaped form costs. A number, boolean or null is charged the most its
// text can take, which keeps the count cheap and independent of how the engine prints a number.

/** Limits on one delivered result or input. Each is a positive safe integer. */
export interface ToolResultLimits {
  /**
   * An upper bound on the UTF-8 length of the value's JSON text: exact for strings, property names
   * and structure, the most a number or literal can take, and a conservative charge for binary
   * values: the serialized cost of each view plus the full length of each distinct backing buffer
   * (see {@link admitToolResult}).
   */
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
  /** The limits that applied: a frozen copy, so a callback holding it cannot change the budget. */
  readonly limits: ToolResultLimits;

  constructor(
    readonly exceeded: ToolResultExceeded,
    limits: ToolResultLimits,
  ) {
    super(describeExceeded(exceeded, limits));
    this.name = 'ToolResultRefused';
    this.limits = Object.isFrozen(limits)
      ? limits
      : Object.freeze({ ...limits });
  }
}

/**
 * Throws, naming the limit, unless every supplied limit is a positive safe integer. The result is
 * frozen, so a holder of it (a refusal handler, for one) cannot raise the budget later.
 */
export function toolResultLimits(
  supplied?: Partial<ToolResultLimits>,
): ToolResultLimits {
  if (supplied === undefined) return DEFAULT_TOOL_RESULT_LIMITS;
  const limits = { ...DEFAULT_TOOL_RESULT_LIMITS, ...supplied };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`${name} must be a positive integer.`);
  }
  return Object.freeze(limits);
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

/**
 * Exact UTF-8 length of `text` as a JSON string literal, quotes included, without allocating. It
 * follows `JSON.stringify`: a quote, a backslash and the controls \b \f \n \r \t take two bytes,
 * any other control character and any lone surrogate takes six (\uXXXX), and everything else
 * takes its UTF-8 length. Callers bound the string's length first.
 */
function jsonStringBytes(text: string): number {
  let bytes = 2;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) {
      if (unit === 0x22 || unit === 0x5c) bytes += 2;
      else if (unit >= 0x20) bytes += 1;
      else if (
        unit === 8 ||
        unit === 9 ||
        unit === 10 ||
        unit === 12 ||
        unit === 13
      )
        bytes += 2;
      else bytes += 6;
    } else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      if ((text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
        bytes += 4;
        index += 1;
      } else bytes += 6;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) bytes += 6;
    else bytes += 3;
  }
  return bytes;
}

/** The longest text of a finite number (`-1.7976931348623157e+308`). */
const NUMBER_BYTES = 24;
/** The longest literal (`false`); `null` and an absent array item take less. */
const LITERAL_BYTES = 5;
/**
 * Charged for each byte of a typed array or `DataView`. `JSON.stringify` writes a typed array as an
 * object of its elements (`{"0":1,"1":2}`), each at most a quoted index, a colon, a comma and a
 * number, 38 bytes for an element, so charging this much per byte of storage cannot underestimate
 * it for any element size. An `ArrayBuffer` is charged its length: its JSON text is `{}`, but the
 * bytes are retained. A view also keeps its ENTIRE backing buffer alive, however small the window
 * it shows, so each distinct backing buffer is charged its full length once, in addition to the
 * serialized cost of every view of it. Neither is charged less than `EMPTY_OBJECT_BYTES`, the `{}`
 * that an empty or one-byte value still serializes to.
 */
const BINARY_VIEW_BYTES_PER_BYTE = 38;
/** The braces of `{}`, the least that a binary value's JSON text takes. */
const EMPTY_OBJECT_BYTES = 2;

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
  // Backing buffers already charged. At most one entry per value visited, so the node budget
  // bounds it.
  const backings = new Set<ArrayBufferLike>();

  const refuse = (exceeded: ToolResultExceeded): ToolResultAdmission => ({
    ok: false,
    exceeded,
  });
  /** Charges `count` serialized bytes; false when that crosses the limit. */
  const charge = (count: number): boolean => {
    bytes += count;
    return bytes <= limits.maxBytes;
  };
  /** Charges `text` as a JSON string; false when that crosses the limit. */
  const chargeText = (text: string): boolean => {
    // A string literal takes at least one byte per UTF-16 unit and its quotes, so a long one is
    // refused unmeasured.
    if (text.length + 2 > limits.maxBytes - bytes) return false;
    return charge(jsonStringBytes(text));
  };
  /**
   * Charges the whole length of a view's backing buffer, once however many views and buffers in
   * the value share it; false when that crosses the limit. A host schema and `structuredClone`
   * keep the entire buffer of a view, so the window the view shows is not what is retained.
   */
  const chargeBacking = (buffer: ArrayBufferLike): boolean => {
    if (backings.has(buffer)) return true;
    backings.add(buffer);
    return charge(buffer.byteLength);
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
    if (typeof value === 'number') {
      if (!charge(NUMBER_BYTES)) return refuse('bytes');
      continue;
    }
    if (typeof value === 'boolean' || value === null || value === undefined) {
      if (!charge(LITERAL_BYTES)) return refuse('bytes');
      continue;
    }
    if (typeof value !== 'object') return refuse('unsupported');
    if (ArrayBuffer.isView(value)) {
      // The view's own JSON text, and the whole backing buffer it keeps alive.
      if (
        !charge(
          Math.max(
            value.byteLength * BINARY_VIEW_BYTES_PER_BYTE,
            EMPTY_OBJECT_BYTES,
          ),
        ) ||
        !chargeBacking(value.buffer)
      )
        return refuse('bytes');
      continue;
    }
    if (value instanceof ArrayBuffer) {
      if (
        !charge(
          backings.has(value)
            ? EMPTY_OBJECT_BYTES
            : Math.max(value.byteLength, EMPTY_OBJECT_BYTES),
        )
      )
        return refuse('bytes');
      backings.add(value);
      continue;
    }
    if (Array.isArray(value)) {
      const length = value.length;
      if (contentList && length > limits.maxContentBlocks)
        return refuse('content-blocks');
      if (length > limits.maxArrayItems) return refuse('array-items');
      // Brackets, and a comma between neighbours.
      if (!charge(2 + Math.max(length - 1, 0))) return refuse('bytes');
      for (let index = 0; index < length; index += 1) {
        const exceeded = queue(value[index], depth + 1);
        if (exceeded !== undefined) return refuse(exceeded);
      }
      continue;
    }
    if (!isPlainObject(value)) return refuse('unsupported');
    // Braces; then for each member its key, a colon and, between neighbours, a comma.
    if (!charge(2)) return refuse('bytes');
    let first = true;
    for (const key in value) {
      if (!chargeText(key)) return refuse('bytes');
      if (!hasOwn(value, key)) continue;
      if (!charge(first ? 1 : 2)) return refuse('bytes');
      first = false;
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
