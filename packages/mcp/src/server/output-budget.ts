// The size and shape of an operation's result, bounded before anything is returned. The projection
// is application code: its text and data are unchecked, and a contract that permits unbounded
// strings or arrays would otherwise let one record become an arbitrarily large response.
//
// The connector reads the value once into a fresh, accessor-free copy (a snapshot) while it meters
// that copy, and the snapshot is what the contract parses and what the transport receives. A getter,
// a `toJSON` method or a later mutation of the application's own object therefore cannot change what
// was admitted. The meter measures the JSON the transport will write for the result envelope
// (`content` and `structuredContent`), string escapes included, and stops at the first limit it
// crosses, so a refusal reads no more of the value than the limit allows.

/** Limits for one operation result. An omitted field keeps the SDK default. */
export interface OutputLimits {
  /** Largest size, in UTF-8 bytes, of the result as JSON: the text, the structured result and the envelope around them. */
  readonly maxBytes?: number;
  /** Deepest nesting of arrays and objects in the structured result. */
  readonly maxDepth?: number;
  /** Most values (primitives, arrays, objects and object members) in the structured result. */
  readonly maxNodes?: number;
}

/** What a result may be when the operation declares no limits of its own. */
export const DEFAULT_OUTPUT_LIMITS: Required<OutputLimits> = {
  maxBytes: 1024 * 1024,
  maxDepth: 32,
  maxNodes: 100_000,
};

const isPositiveInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Names every limit that is not a positive integer. An empty list means the limits are usable. */
export function outputLimitProblems(limits: unknown): readonly string[] {
  if (limits === undefined) return [];
  if (typeof limits !== 'object' || limits === null)
    return ['outputLimits must be an object'];
  const problems: string[] = [];
  for (const key of ['maxBytes', 'maxDepth', 'maxNodes'] as const) {
    const value = (limits as Record<string, unknown>)[key];
    if (value !== undefined && !isPositiveInteger(value))
      problems.push(`outputLimits.${key} must be a positive integer`);
  }
  return problems;
}

export function resolveOutputLimits(
  limits: OutputLimits | undefined,
): Required<OutputLimits> {
  return {
    maxBytes: limits?.maxBytes ?? DEFAULT_OUTPUT_LIMITS.maxBytes,
    maxDepth: limits?.maxDepth ?? DEFAULT_OUTPUT_LIMITS.maxDepth,
    maxNodes: limits?.maxNodes ?? DEFAULT_OUTPUT_LIMITS.maxNodes,
  };
}

/**
 * Bytes of the result envelope that are neither the text nor the structured value:
 * `{"content":[{"type":"text","text":` and `}],"structuredContent":` and `}`. Taken from a real
 * serialization so it cannot drift from the shape the operation returns.
 */
const ENVELOPE_BYTES =
  Buffer.byteLength(
    JSON.stringify({
      content: [{ type: 'text', text: '' }],
      structuredContent: 0,
    }),
    'utf8',
  ) -
  2 - // the quotes of the empty text, which the text charge counts
  1; // the structured value `0`, which the data charge counts

/** Strings are measured in slices so a refused long string is never escaped in full. */
const SLICE = 4096;

class Exceeded extends Error {}

/** Stands for a value JSON leaves out of an object (and turns into `null` in an array). */
const OMIT: unique symbol = Symbol('omit');

const isHighSurrogate = (unit: number): boolean =>
  unit >= 0xd800 && unit <= 0xdbff;

/** The running total for one result; each addition may end the walk. */
class Meter {
  bytes = 0;
  nodes = 0;
  constructor(private readonly limits: Required<OutputLimits>) {}

  addBytes(count: number): void {
    this.bytes += count;
    if (this.bytes > this.limits.maxBytes) throw new Exceeded();
  }

  addNode(): void {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) throw new Exceeded();
  }

  /**
   * The size of `text` as the JSON string the transport writes, quotes and escapes included (a NUL
   * is six bytes, a lone surrogate six, a pair four). Every UTF-16 unit takes at least one byte, so
   * a string longer than what is left fails before anything is escaped, and a shorter one is
   * escaped one slice at a time and stops at the limit.
   */
  stringBytes(text: string): number {
    const room = this.limits.maxBytes - this.bytes;
    if (text.length + 2 > room) throw new Exceeded();
    let total = 2;
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + SLICE);
      // A surrogate pair is one character: never cut between its halves.
      if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1)))
        end += 1;
      total +=
        Buffer.byteLength(JSON.stringify(text.slice(start, end)), 'utf8') - 2;
      if (total > room) throw new Exceeded();
      start = end;
    }
    return total;
  }

  /**
   * Charges `value` and returns its copy: plain data with no accessor, method or shared
   * reference, in which every property is read exactly once. Throws `Exceeded` when it is too
   * large, too deep, too numerous or not JSON data.
   */
  walk(value: unknown, depth: number): unknown {
    this.addNode();
    if (value === null) {
      this.addBytes(4);
      return null;
    }
    switch (typeof value) {
      case 'string':
        this.addBytes(this.stringBytes(value));
        return value;
      case 'number':
        this.addBytes(Number.isFinite(value) ? String(value).length : 4);
        return value;
      case 'boolean':
        this.addBytes(value ? 4 : 5);
        return value;
      case 'undefined':
      case 'function':
      case 'symbol':
        // JSON omits these from an object and writes `null` in an array.
        return OMIT;
      case 'bigint':
        // JSON.stringify throws on a bigint: not data the transport can carry.
        throw new Exceeded();
      default:
        break;
    }
    if (depth >= this.limits.maxDepth) throw new Exceeded();
    if (value instanceof Date) {
      // A Date is copied by its time value and written as its ISO string (`null` when invalid).
      const time = Date.prototype.getTime.call(value);
      const copy = new Date(time);
      this.addBytes(
        Number.isNaN(time)
          ? 4
          : Buffer.byteLength(
              JSON.stringify(Date.prototype.toISOString.call(copy)),
              'utf8',
            ),
      );
      return copy;
    }
    // A `toJSON` method decides its own serialization, which this walk cannot see.
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function')
      throw new Exceeded();
    if (Array.isArray(value)) {
      const length = value.length;
      // Each element is at least one value, so a long array is refused before any is read.
      if (this.nodes + length > this.limits.maxNodes) throw new Exceeded();
      this.addBytes(2 + Math.max(0, length - 1));
      const items: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const item = this.walk(value[index], depth + 1);
        if (item === OMIT) this.addBytes(4);
        items.push(item === OMIT ? null : item);
      }
      return items;
    }
    // Listing the keys costs memory in proportion to this object's own key count, which the
    // application already holds. Each member is at least a key and a value, so a wide object is
    // refused after the listing and before any member is read.
    const keys = Object.keys(value);
    if (this.nodes + keys.length * 2 > this.limits.maxNodes)
      throw new Exceeded();
    this.addBytes(2);
    const members: Record<string, unknown> = {};
    let emitted = 0;
    for (const key of keys) {
      this.addNode();
      const keyBytes = this.stringBytes(key);
      const member = this.walk(
        (value as Record<string, unknown>)[key],
        depth + 1,
      );
      if (member === OMIT) continue;
      this.addBytes((emitted > 0 ? 1 : 0) + keyBytes + 1);
      emitted += 1;
      // `__proto__` must become a member, never the copy's prototype.
      Object.defineProperty(members, key, {
        value: member,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return members;
  }
}

/** A value the budget admitted. It is a copy: the caller's object is never returned. */
export interface Admitted {
  readonly value: unknown;
}

/** One result's budget: the text is charged once, then each structured value is charged against what remains. */
export interface OutputAdmission {
  /** Charges the model-facing text and the envelope; call it once, first. Returns false when they alone exceed the budget. */
  text(text: string): boolean;
  /**
   * Charges one structured value and returns the copy to use from here on, or `undefined` when it
   * is too large, deep or numerous, is not JSON data, or throws when read.
   */
  data(value: unknown): Admitted | undefined;
}

/**
 * Starts the budget for one result. A value that throws while it is read (a hostile getter or a
 * proxy) is not admitted: the walk reports it as over budget rather than letting the fault escape.
 */
export function admitOutput(
  limits: Required<OutputLimits> = DEFAULT_OUTPUT_LIMITS,
): OutputAdmission {
  const meter = new Meter(limits);
  let committed = 0;
  return {
    text: (text) => {
      try {
        meter.bytes = ENVELOPE_BYTES;
        if (meter.bytes > limits.maxBytes) return false;
        meter.addBytes(meter.stringBytes(text));
        committed = meter.bytes;
        return true;
      } catch {
        return false;
      }
    },
    data: (value) => {
      // The value is admitted before validation and again after it (a contract may transform what
      // it accepts), so each call starts from what the text cost and charges the value alone.
      meter.bytes = committed;
      meter.nodes = 0;
      try {
        const copy = meter.walk(value, 0);
        return { value: copy === OMIT ? undefined : copy };
      } catch {
        return undefined;
      }
    },
  };
}
