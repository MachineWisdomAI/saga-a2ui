import type {
  CreateSurfaceMessage,
  DeleteSurfaceMessage,
  UpdateComponentsMessage,
  UpdateDataModelMessage,
} from '@a2ui/web_core/v0_9';

/**
 * Handles each supported A2UI v0.9 message case. Every operation receives its own validated
 * value. There is deliberately no catch-all: adding a case to this interface makes every
 * incomplete visitor fail typechecking.
 */
export interface A2uiMessageVisitor<Result> {
  createSurface(message: Readonly<CreateSurfaceMessage>): Result;
  updateComponents(message: Readonly<UpdateComponentsMessage>): Result;
  updateDataModel(message: Readonly<UpdateDataModelMessage>): Result;
  deleteSurface(message: Readonly<DeleteSurfaceMessage>): Result;
}

/**
 * A message that passed schema validation. Produced only by a decoder, never by casting.
 * The wrapped value is a deep-frozen private copy, so neither the caller's original input
 * nor a visitor can change what was validated.
 */
export interface ValidatedMessage {
  /** Invoke the visitor operation for this message's case and return its result. */
  accept<Result>(visitor: A2uiMessageVisitor<Result>): Result;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Wrap an already schema-validated message of one case. The caller owns the validation. */
export const validatedMessage = {
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
