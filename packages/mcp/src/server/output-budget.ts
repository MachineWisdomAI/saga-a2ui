// The size and shape of an operation's result, bounded before anything is serialized. The
// projection is application code: its text and data are unchecked, and a contract that permits
// unbounded strings or arrays would otherwise let one record become an arbitrarily large response.
// The connector admits a result only while its estimated JSON size, its nesting depth and its node
// count stay inside a budget it owns. The check walks the value once, stops at the first limit it
// crosses, and never serializes it, so rejecting a huge value costs no more than the limit.

/** Limits for one operation result. An omitted field keeps the SDK default. */
export interface OutputLimits {
  /** Largest combined size, in bytes, of the result text and the structured result as JSON. */
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

class Exceeded extends Error {}

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

  /** Adds a string's UTF-8 size. Every UTF-16 unit takes at least one byte, so a long string fails before it is encoded. */
  addText(text: string): void {
    if (this.bytes + text.length > this.limits.maxBytes) throw new Exceeded();
    this.addBytes(Buffer.byteLength(text, 'utf8'));
  }

  walk(value: unknown, depth: number): void {
    this.addNode();
    if (value === null) return this.addBytes(4);
    switch (typeof value) {
      case 'string':
        // JSON quotes the string and may escape characters; two bytes of quotes plus the text is
        // the floor, and the escapes are charged by encoding the quoted form below the cap.
        if (this.bytes + value.length + 2 > this.limits.maxBytes)
          throw new Exceeded();
        return this.addBytes(Buffer.byteLength(JSON.stringify(value), 'utf8'));
      case 'number':
        return this.addBytes(Number.isFinite(value) ? String(value).length : 4);
      case 'boolean':
        return this.addBytes(value ? 4 : 5);
      case 'undefined':
      case 'function':
      case 'symbol':
        // Omitted from an object, `null` in an array; the larger charge is the safe one.
        return this.addBytes(4);
      case 'bigint':
        // JSON.stringify throws on a bigint: not data the transport can carry.
        throw new Exceeded();
      default:
        break;
    }
    if (depth >= this.limits.maxDepth) throw new Exceeded();
    if (value instanceof Date) return this.addBytes(26);
    // A `toJSON` method decides its own serialization, which this walk cannot see.
    if (typeof (value as { toJSON?: unknown }).toJSON === 'function')
      throw new Exceeded();
    if (Array.isArray(value)) {
      if (value.length > this.limits.maxNodes) throw new Exceeded();
      this.addBytes(2 + Math.max(0, value.length - 1));
      for (let index = 0; index < value.length; index += 1)
        this.walk(value[index], depth + 1);
      return;
    }
    const keys = Object.keys(value);
    if (keys.length > this.limits.maxNodes) throw new Exceeded();
    this.addBytes(2 + Math.max(0, keys.length - 1));
    for (const key of keys) {
      this.addNode();
      this.addBytes(Buffer.byteLength(JSON.stringify(key), 'utf8') + 1);
      this.walk((value as Record<string, unknown>)[key], depth + 1);
    }
  }
}

/** One result's budget: the text is charged once, then each structured value is charged against what remains. */
export interface OutputAdmission {
  /** Charges the model-facing text; call it once, first. Returns false when it alone exceeds the budget. */
  text(text: string): boolean;
  /** Charges one structured value. Returns false when it is too large, deep or numerous, or cannot be read. */
  data(value: unknown): boolean;
}

/**
 * Starts the budget for one result. A value that throws while it is read (a hostile getter or a
 * proxy) is not admitted: the walk reports it as over budget rather than letting the fault escape.
 */
export function admitOutput(
  limits: Required<OutputLimits> = DEFAULT_OUTPUT_LIMITS,
): OutputAdmission {
  const meter = new Meter(limits);
  let textBytes = 0;
  const guarded = (charge: () => void): boolean => {
    try {
      charge();
      return true;
    } catch {
      return false;
    }
  };
  return {
    text: (text) => {
      const admitted = guarded(() => meter.addText(text));
      textBytes = meter.bytes;
      return admitted;
    },
    data: (value) => {
      // The same structure is admitted before validation and again after it, so each call starts
      // from what the text cost and charges the value alone.
      meter.bytes = textBytes;
      meter.nodes = 0;
      return guarded(() => meter.walk(value, 0));
    },
  };
}
