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
 * A message that passed schema validation. Produced only by a decoder, never by casting;
 * no constructor is exported, so the decoder's schema check cannot be bypassed.
 * The wrapped value is a deep-frozen private copy, so neither the caller's original input
 * nor a visitor can change what was validated.
 */
export interface ValidatedMessage {
  /** Invoke the visitor operation for this message's case and return its result. */
  accept<Result>(visitor: A2uiMessageVisitor<Result>): Result;
}
