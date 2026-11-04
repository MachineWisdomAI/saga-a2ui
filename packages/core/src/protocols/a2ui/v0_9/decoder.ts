import {
  CreateSurfaceMessageSchema,
  DeleteSurfaceMessageSchema,
  UpdateComponentsMessageSchema,
  UpdateDataModelMessageSchema,
  formatZodIssue,
} from '@a2ui/web_core/v0_9';
import type { z } from '../zod3.js';
import type {
  CreateSurfaceMessage,
  DeleteSurfaceMessage,
  UpdateComponentsMessage,
  UpdateDataModelMessage,
} from '@a2ui/web_core/v0_9';
import {
  DEFAULT_INPUT_LIMITS,
  admit,
  checkedLimits,
  describeExceeded,
  pathWithinDepth,
  type InputLimits,
} from './admission.js';
import { deepFreeze } from './deep-freeze.js';
import type { ValidatedMessage } from './message.js';

/** Why input was rejected. `message` is plain text that is safe to display. */
export interface DecodeFailure {
  readonly kind: 'unsupported-version' | 'malformed';
  readonly message: string;
}

export type DecodeResult =
  | { readonly ok: true; readonly messages: readonly ValidatedMessage[] }
  | { readonly ok: false; readonly failure: DecodeFailure };

/**
 * Strategy for turning unchecked input into validated messages of one protocol version.
 * Callers pass the chosen decoder explicitly. `decode` never throws for bad input; either
 * every message is valid or the result is a single failure (no partial lists).
 */
export interface MessageDecoder {
  decode(input: unknown): DecodeResult;
}

const SUPPORTED_VERSIONS: readonly unknown[] = ['v0.9', 'v0.9.1'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const malformed = (message: string): DecodeFailure => ({
  kind: 'malformed',
  message,
});

/**
 * Wrap a message that `decodeCase` has just validated against its upstream schema. Private
 * to this module: these builders do not validate, so they must stay unreachable from callers.
 * The copy may throw (e.g. a function inside an any-valued field); `decodeCase` reports that.
 */
const validatedMessage = {
  createSurface: (message: CreateSurfaceMessage): ValidatedMessage => {
    const frozen = deepFreeze(structuredClone(message));
    return { accept: (visitor) => visitor.createSurface(frozen) };
  },
  updateComponents: (message: UpdateComponentsMessage): ValidatedMessage => {
    const frozen = deepFreeze(structuredClone(message));
    return { accept: (visitor) => visitor.updateComponents(frozen) };
  },
  updateDataModel: (message: UpdateDataModelMessage): ValidatedMessage => {
    const frozen = deepFreeze(structuredClone(message));
    return { accept: (visitor) => visitor.updateDataModel(frozen) };
  },
  deleteSurface: (message: DeleteSurfaceMessage): ValidatedMessage => {
    const frozen = deepFreeze(structuredClone(message));
    return { accept: (visitor) => visitor.deleteSurface(frozen) };
  },
} as const;

/** Validate one message with the public upstream schema for its case. */
function decodeCase<Schema extends z.ZodTypeAny>(
  tag: string,
  schema: Schema,
  raw: unknown,
  build: (message: z.infer<Schema>) => ValidatedMessage,
): ValidatedMessage | DecodeFailure {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return malformed(
      `Invalid ${tag} message: ${parsed.error.errors.map(formatZodIssue).join(', ')}`,
    );
  }
  try {
    return build(parsed.data);
  } catch {
    return malformed(
      `Invalid ${tag} message: it contains a value that cannot be copied.`,
    );
  }
}

/** Display text for an arbitrary version value; never throws (e.g. for bigint or cycles). */
function describeVersion(version: unknown): string {
  try {
    return JSON.stringify(version) ?? String(version);
  } catch {
    return typeof version;
  }
}

/** `raw` is a message from the admitted snapshot, never the caller's own object. */
function decodeMessage(
  raw: unknown,
  limits: InputLimits,
): ValidatedMessage | DecodeFailure {
  if (!isRecord(raw)) return malformed('Each message must be an object.');
  if (!SUPPORTED_VERSIONS.includes(raw.version)) {
    return {
      kind: 'unsupported-version',
      message: `Unsupported A2UI version: ${describeVersion(raw.version)}. Supported: v0.9.`,
    };
  }
  // The only place wire tags are inspected. Upstream schemas are strict, so a message with
  // extra operations or fields fails validation of its case.
  if ('createSurface' in raw) {
    return decodeCase(
      'createSurface',
      CreateSurfaceMessageSchema,
      raw,
      validatedMessage.createSurface,
    );
  }
  if ('updateComponents' in raw) {
    return decodeCase(
      'updateComponents',
      UpdateComponentsMessageSchema,
      raw,
      validatedMessage.updateComponents,
    );
  }
  if ('updateDataModel' in raw) {
    // A data path creates one level of retained state per segment, so it has the depth limit.
    const update = raw.updateDataModel;
    if (
      isRecord(update) &&
      typeof update.path === 'string' &&
      !pathWithinDepth(update.path, limits.maxDepth)
    )
      return malformed(
        `A2UI data path has more than ${limits.maxDepth} segments.`,
      );
    return decodeCase(
      'updateDataModel',
      UpdateDataModelMessageSchema,
      raw,
      validatedMessage.updateDataModel,
    );
  }
  if ('deleteSurface' in raw) {
    return decodeCase(
      'deleteSurface',
      DeleteSurfaceMessageSchema,
      raw,
      validatedMessage.deleteSurface,
    );
  }
  return malformed('Message has no supported operation.');
}

/** Whether `record` has a key besides `only`; stops at the first, builds no list of keys. */
function hasOtherKey(record: Record<string, unknown>, only: string): boolean {
  for (const key in record) if (key !== only) return true;
  return false;
}

function rawMessages(input: unknown): readonly unknown[] | DecodeFailure {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && 'messages' in input) {
    if (!Array.isArray(input.messages) || hasOtherKey(input, 'messages')) {
      return malformed(
        'A message list must be an object with only a "messages" array.',
      );
    }
    return input.messages;
  }
  return [input];
}

function decodeInput(unchecked: unknown, limits: InputLimits): DecodeResult {
  // Admission comes first and covers everything below, the message count included: neither
  // Zod nor a copy sees input that is over a limit, and the one traversal of the caller's
  // value also measures the message list, so nothing is read before or beside it.
  const admitted = admit(unchecked, limits);
  if (!admitted.ok)
    return {
      ok: false,
      failure: malformed(describeExceeded(admitted.exceeded, limits)),
    };
  // From here on only the snapshot is read; the caller's object is not touched again.
  const raws = rawMessages(admitted.value);
  if (!Array.isArray(raws))
    return { ok: false, failure: raws as DecodeFailure };
  const messages: ValidatedMessage[] = [];
  for (const raw of raws) {
    const decoded = decodeMessage(raw, limits);
    if ('kind' in decoded) return { ok: false, failure: decoded };
    messages.push(decoded);
  }
  return { ok: true, messages };
}

/**
 * Creates a decoder for A2UI v0.9: one message, an array of messages, or `{ messages: [...] }`.
 * Input over a limit (see `InputLimits`; `limits` overrides the defaults) is refused before it
 * reaches the upstream schemas, which are built on Zod 3 and accept arrays and nesting of any
 * size, and before anything is copied. The input is read once into a snapshot of plain data
 * (objects, arrays, primitives and binary data; a `Map`, a `Set`, a `Date` or a class instance
 * is refused), and the snapshot is what is validated and kept, so a getter or a proxy cannot
 * change the value between measurement and use. The whole operation sits behind one failure
 * boundary: anything that throws while inspecting or parsing caller input (e.g. a throwing
 * getter) becomes a malformed result. Throws `RangeError` for a limit that is not a positive
 * integer.
 */
export function createA2uiV0_9Decoder(
  limits?: Partial<InputLimits>,
): MessageDecoder {
  const checked = checkedLimits(DEFAULT_INPUT_LIMITS, limits);
  return {
    decode(input) {
      try {
        return decodeInput(input, checked);
      } catch {
        return {
          ok: false,
          failure: malformed('Input could not be inspected or parsed.'),
        };
      }
    },
  };
}

/** The decoder with the default input limits. */
export const a2uiV0_9Decoder: MessageDecoder = createA2uiV0_9Decoder();
