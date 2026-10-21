import {
  MessageProcessor,
  STRICT_VALIDATION,
  type Catalog,
  type ComponentApi,
  type Subscription,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import type { DecodeFailure, MessageDecoder } from './decoder.js';
import type { A2uiMessageVisitor, ValidatedMessage } from './message.js';

/** A decode failure, or the upstream processor refusing a well-formed message. */
export interface IngestFailure {
  readonly kind: DecodeFailure['kind'] | 'rejected';
  /** Plain text, safe to display. */
  readonly message: string;
}

export type IngestResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: IngestFailure };

/**
 * Owns one upstream `MessageProcessor` and the mutable surface state inside it.
 *
 * Ingestion path: `unknown` input -> decoder (version, envelope, schema) -> validated
 * messages -> visitor -> processor (component support, partial updates, references, state).
 * Component-support and partial-update rules are the upstream processor's, enabled with
 * `STRICT_VALIDATION`; this module does not duplicate them.
 *
 * Lifetime: the session lives until `dispose()`. Disposal is idempotent, unsubscribes nothing
 * the caller still holds (callers unsubscribe their own `Subscription`s), and afterwards
 * `ingest` fails with `kind: 'rejected'`.
 */
export interface MessageSession<T extends ComponentApi> {
  /** Decode and apply input. Never throws for bad input; all-or-nothing decoding, then
   *  messages apply in order and the first upstream rejection stops the batch. */
  ingest(input: unknown): IngestResult;
  onSurfaceCreated(handler: (surface: SurfaceModel<T>) => void): Subscription;
  onSurfaceDeleted(handler: (surfaceId: string) => void): Subscription;
  dispose(): void;
}

export interface MessageSessionOptions<T extends ComponentApi> {
  readonly catalogs: readonly Catalog<T>[];
  readonly decoder: MessageDecoder;
}

export function createMessageSession<T extends ComponentApi>(
  options: MessageSessionOptions<T>,
): MessageSession<T> {
  const processor = new MessageProcessor<T>([...options.catalogs], undefined, {
    validationConfig: STRICT_VALIDATION,
  });
  let disposed = false;

  // Every case is applied by the upstream processor, which owns state transitions. The
  // visitor keeps case handling exhaustive: a new message case will not typecheck here.
  //
  // Upstream keeps supplied objects (e.g. the data-model value) and mutates them in place on
  // later updates, so it gets its own copy; the validated, frozen message stays unchanged.
  const apply: A2uiMessageVisitor<void> = {
    createSurface: (message) =>
      processor.processMessages(structuredClone(message)),
    updateComponents: (message) =>
      processor.processMessages(structuredClone(message)),
    updateDataModel: (message) =>
      processor.processMessages(structuredClone(message)),
    deleteSurface: (message) =>
      processor.processMessages(structuredClone(message)),
  };

  const applyAll = (messages: readonly ValidatedMessage[]): IngestResult => {
    try {
      for (const message of messages) message.accept(apply);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        failure: {
          kind: 'rejected',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  };

  return {
    ingest(input) {
      if (disposed)
        return {
          ok: false,
          failure: { kind: 'rejected', message: 'The session was disposed.' },
        };
      const decoded = options.decoder.decode(input);
      return decoded.ok
        ? applyAll(decoded.messages)
        : { ok: false, failure: decoded.failure };
    },
    onSurfaceCreated: (handler) => processor.onSurfaceCreated(handler),
    onSurfaceDeleted: (handler) => processor.onSurfaceDeleted(handler),
    dispose() {
      if (disposed) return;
      disposed = true;
      processor.model.dispose();
      processor.dispose();
    },
  };
}
