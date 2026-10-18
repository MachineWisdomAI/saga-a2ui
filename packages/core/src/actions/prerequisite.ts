import type { Freshness, NoValues } from './outcome.js';
import type { InvocationScope } from './scope.js';

// A prerequisite is reusable application work that must finish before a handler runs, and it may
// stop the handler. It is not authorization: whether it reads state, refreshes a token or asks a
// server is the application's decision, and the server stays authoritative for every protected
// operation. SAGA supplies the way to declare one and to attach it to an action.

export interface PrerequisiteContext<Needs, Input> extends Freshness {
  /** Values provided by earlier prerequisites on this action. */
  readonly provided: Needs;
  /** What `input` copied out of the event, or `undefined` for an action without `input`. */
  readonly params: Input;
  /** Aborts on cancellation or when the work deadline expires. */
  readonly signal: AbortSignal;
  /** Owns what this invocation acquires and releases it when the invocation ends. */
  readonly scope: InvocationScope;
}

export type Proceed<Provides> = { readonly kind: 'proceed'; readonly provides: Provides };
export type Refuse = { readonly kind: 'refuse'; readonly reason: string };
export type PrerequisiteResult<Provides> = Proceed<Provides> | Refuse;

/** Continues to the next prerequisite, or the handler, adding `provides` for everything after it. */
export function proceed(): Proceed<NoValues>;
export function proceed<Provides extends object>(provides: Provides): Proceed<Provides>;
export function proceed(provides: object = {}): Proceed<object> {
  if (typeof provides !== 'object' || provides === null) {
    throw new TypeError('proceed() takes an object of provided values, or nothing.');
  }
  return Object.freeze({ kind: 'proceed', provides });
}

/** Ends the invocation as a refusal: the handler never runs. `reason` is for the failure hook. */
export function refuse(reason: string): Refuse {
  if (typeof reason !== 'string') throw new TypeError('refuse() takes a reason string.');
  return Object.freeze({ kind: 'refuse', reason });
}

/** Reusable and stateless per invocation. `label` is a diagnostic name; it never selects behavior. */
export interface Prerequisite<Provides, Needs = unknown, Input = unknown> {
  readonly label: string;
  readonly run: (
    context: PrerequisiteContext<Needs, Input>,
  ) => PrerequisiteResult<Provides> | PromiseLike<PrerequisiteResult<Provides>>;
}

/** Fixes the type parameters from the callback; a plain `{ label, run }` object is equally valid. */
export function prerequisite<Provides extends object = NoValues, Needs = unknown, Input = unknown>(
  label: string,
  run: Prerequisite<Provides, Needs, Input>['run'],
): Prerequisite<Provides, Needs, Input> {
  if (typeof label !== 'string' || label === '') throw new TypeError('A prerequisite needs a non-empty label.');
  if (typeof run !== 'function') throw new TypeError(`Prerequisite '${label}' needs a function.`);
  return Object.freeze({ label, run });
}

/** What the runtime made of a prerequisite's answer: one of the two, or neither. */
export type Answer =
  | { readonly kind: 'proceed'; readonly provides: object }
  | { readonly kind: 'refuse'; readonly reason: string }
  | { readonly kind: 'malformed' };

/** Reads the unchecked value a prerequisite returned. Unknown shapes are the prerequisite's error. */
export function readAnswer(value: unknown): Answer {
  if (typeof value !== 'object' || value === null) return { kind: 'malformed' };
  const answer = value as { kind?: unknown; provides?: unknown; reason?: unknown };
  if (answer.kind === 'proceed' && typeof answer.provides === 'object' && answer.provides !== null) {
    return { kind: 'proceed', provides: answer.provides };
  }
  if (answer.kind === 'refuse' && typeof answer.reason === 'string') return { kind: 'refuse', reason: answer.reason };
  return { kind: 'malformed' };
}
