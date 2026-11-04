import {
  MessageProcessor,
  STRICT_VALIDATION,
  type Catalog,
  type ComponentApi,
  type Subscription,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {
  DEFAULT_RETAINED_LIMITS,
  admit,
  checkedLimits,
  type MessageSize,
  type RetainedLimits,
} from './admission.js';
import type { DecodeFailure, MessageDecoder } from './decoder.js';
import type { A2uiMessageVisitor, ValidatedMessage } from './message.js';
import { measureRetained, retainedGrowth } from './retained-state.js';

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
  /**
   * What the session may keep, over and above the decoder's limit on each call. Input that
   * would take the session past it is refused with `kind: 'rejected'` before it is copied
   * into the processor; deleting a surface always succeeds. Defaults apply to omitted fields.
   * Throws `RangeError` for a limit that is not a positive integer.
   */
  readonly retainedLimits?: Partial<RetainedLimits>;
}

const RETAINED_REFUSAL =
  'This input would take the session past its limit on retained surface state. Delete a surface or start a new session.';

const UNREADABLE_REFUSAL =
  'This input holds a value that is not plain data, so the session cannot measure it and does not keep it.';

/**
 * Reads a message the decoder supplied exactly once, into a snapshot of plain data bounded by
 * `budget`, and returns a message that serves that snapshot. A custom decoder may supply live
 * values (a getter, a proxy, an array with extra own properties); reading them for the limit
 * and again for the copy would let the two observations differ. After this step the session
 * measures, replays and applies only the snapshot, so what was measured is what is kept: an
 * accessor or proxy is read once, an array contributes only its items, and a value that is not
 * plain data (`Map`, `Set`, `Date`, a class instance) or is over the budget is refused.
 * The budget is per message, not per batch: a batch is charged what the same messages sent
 * apart would be (see `retainedGrowth`), so a later message may replace what an earlier one
 * wrote.
 */
function materialize(
  message: ValidatedMessage,
  budget: { readonly nodes: number; readonly bytes: number },
): ValidatedMessage | IngestFailure {
  let outcome: ValidatedMessage | IngestFailure | undefined;
  // Only the first call counts: a message cannot show the session a second observation.
  const take =
    (
      tag: string,
      rebuild: (visitor: A2uiMessageVisitor<unknown>, frozen: never) => unknown,
    ) =>
    (raw: unknown): void => {
      if (outcome) return;
      const admitted = admit(raw, {
        maxMessages: budget.nodes,
        maxArrayItems: budget.nodes,
        maxDepth: budget.nodes,
        maxNodes: budget.nodes,
        maxBytes: budget.bytes,
      });
      if (!admitted.ok) {
        outcome = {
          kind: 'rejected',
          message:
            admitted.exceeded === 'unsupported'
              ? UNREADABLE_REFUSAL
              : RETAINED_REFUSAL,
        };
        return;
      }
      const value = admitted.value as Record<string, unknown>;
      // The visitor case names the operation; the snapshot must carry it as plain data.
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof value[tag] !== 'object' ||
        value[tag] === null
      ) {
        outcome = { kind: 'rejected', message: UNREADABLE_REFUSAL };
        return;
      }
      outcome = {
        accept: (visitor) => rebuild(visitor, value as never) as never,
      };
    };
  message.accept<void>({
    createSurface: take('createSurface', (v, m) => v.createSurface(m)),
    updateComponents: take('updateComponents', (v, m) => v.updateComponents(m)),
    updateDataModel: take('updateDataModel', (v, m) => v.updateDataModel(m)),
    deleteSurface: take('deleteSurface', (v, m) => v.deleteSurface(m)),
  });
  return outcome ?? { kind: 'rejected', message: UNREADABLE_REFUSAL };
}

/** Whether a message only deletes a surface. */
const isDelete: A2uiMessageVisitor<boolean> = {
  createSurface: () => false,
  updateComponents: () => false,
  updateDataModel: () => false,
  deleteSurface: () => true,
};

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

  // Retained-state admission. `tally` is an upper bound of what the session keeps: it adds the
  // upper bound of every admitted batch and never subtracts, so a replaced value or a deleted
  // surface is counted until the bound is next checked against the state itself. Only a batch
  // that would cross the limit pays for that: the real state is measured and the batch is
  // charged what it would really add to it, message by message against the state the earlier
  // ones leave (a value written over an existing one, or a path through containers that
  // exist, adds little or nothing, and the same path twice costs what it costs once), and it
  // is refused only when that leaves no room. Every message is first read once into a snapshot
  // (`materialize`); a value that is not plain data cannot be measured and is refused there.
  // The decision is made on those snapshots, which are also what is applied.
  const limits = checkedLimits(DEFAULT_RETAINED_LIMITS, options.retainedLimits);
  let tally: MessageSize = { nodes: 0, bytes: 0 };
  const fits = (used: MessageSize, extra: MessageSize): boolean =>
    used.nodes + extra.nodes <= limits.maxNodes &&
    used.bytes + extra.bytes <= limits.maxBytes;
  const total = (used: MessageSize, extra: MessageSize): MessageSize => ({
    nodes: used.nodes + extra.nodes,
    bytes: used.bytes + extra.bytes,
  });

  const admitRetained = (
    messages: readonly ValidatedMessage[],
  ): IngestFailure | undefined => {
    // A batch that only deletes surfaces can only shrink the state, so a full session can
    // always make room.
    if (messages.every((message) => message.accept(isDelete))) return undefined;
    const bound = retainedGrowth(messages, limits);
    if (bound && fits(tally, bound)) {
      tally = total(tally, bound);
      return undefined;
    }
    const held = measureRetained(processor.model.surfacesMap, limits);
    const growth =
      bound && retainedGrowth(messages, limits, processor.model.surfacesMap);
    if (growth && fits(held, growth)) {
      tally = total(held, growth);
      return undefined;
    }
    tally = held;
    return { kind: 'rejected', message: RETAINED_REFUSAL };
  };

  return {
    ingest(input) {
      if (disposed)
        return {
          ok: false,
          failure: { kind: 'rejected', message: 'The session was disposed.' },
        };
      const decoded = options.decoder.decode(input);
      if (!decoded.ok) return { ok: false, failure: decoded.failure };
      try {
        // A custom decoder's messages are read once here; everything after this step, the
        // limit and the copy alike, works on the snapshots. The budget is a ceiling on each
        // snapshot (twice what the session may keep, so a message that replaces more than it
        // adds still fits); the exact charge against the state follows.
        const budget = {
          nodes: 2 * limits.maxNodes,
          bytes: 2 * limits.maxBytes,
        };
        const messages: ValidatedMessage[] = [];
        for (const message of decoded.messages) {
          const snapshot = materialize(message, budget);
          if (!('accept' in snapshot)) return { ok: false, failure: snapshot };
          messages.push(snapshot);
        }
        const refused = admitRetained(messages);
        return refused ? { ok: false, failure: refused } : applyAll(messages);
      } catch {
        // A decoder's message that throws when read is refused, never applied.
        return {
          ok: false,
          failure: { kind: 'rejected', message: UNREADABLE_REFUSAL },
        };
      }
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
