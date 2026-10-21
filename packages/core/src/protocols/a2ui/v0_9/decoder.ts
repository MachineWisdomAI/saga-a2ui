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

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

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

function decodeMessage(raw: unknown): ValidatedMessage | DecodeFailure {
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

function rawMessages(input: unknown): readonly unknown[] | DecodeFailure {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && 'messages' in input) {
    if (!Array.isArray(input.messages) || Object.keys(input).length !== 1) {
      return malformed(
        'A message list must be an object with only a "messages" array.',
      );
    }
    return input.messages;
  }
  return [input];
}

function decodeInput(input: unknown): DecodeResult {
  const raws = rawMessages(input);
  if (!Array.isArray(raws))
    return { ok: false, failure: raws as DecodeFailure };
  const messages: ValidatedMessage[] = [];
  for (const raw of raws) {
    const decoded = decodeMessage(raw);
    if ('kind' in decoded) return { ok: false, failure: decoded };
    messages.push(decoded);
  }
  return { ok: true, messages };
}

/**
 * Decoder for A2UI v0.9: one message, an array of messages, or `{ messages: [...] }`.
 * The whole operation sits behind one failure boundary: anything that throws while
 * inspecting or parsing caller input (e.g. a throwing getter) becomes a malformed result.
 */
export const a2uiV0_9Decoder: MessageDecoder = {
  decode(input) {
    try {
      return decodeInput(input);
    } catch {
      return {
        ok: false,
        failure: malformed('Input could not be inspected or parsed.'),
      };
    }
  },
};
