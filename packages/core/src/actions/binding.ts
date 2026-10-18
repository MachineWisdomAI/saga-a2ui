import { planOf, type ActionDefinition } from './definition.js';
import { emitObservation, Invocation, type InvocationOwner, type Seam } from './invocation.js';
import { discardOutcome, isThenable } from './thenable.js';

export type BindingPhase = 'idle' | 'running' | 'settling' | 'disposed';

/** Replaced on every change and never mutated, so comparing identities shows whether anything changed. */
export interface BindingState {
  readonly phase: BindingPhase;
}

/** One definition attached to one event of one rendered instance. */
export interface ActionBinding {
  /** Opaque and unique within the page session. It finds nothing: no member of this API maps an id to a binding. */
  readonly id: string;
  readonly state: BindingState;
  /**
   * Calls `listener` synchronously after each state change and returns the unsubscribe function.
   * The listener carries no event data, and a listener that throws, or returns a promise that
   * rejects, never affects the action. Nothing is delivered after the final `disposed` state.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Idempotent. Cancels an undecided invocation with cause `disposed`, detaches this binding's own
   * callable, so later events do nothing, and ends the subscription after one final `disposed`
   * state. A decided outcome is never rewritten. Other bindings of the same definition are untouched.
   */
  dispose(): void;
}

/** What a binding needs from the adapter and the application besides the definition. */
export interface BindingSeam extends Seam {
  /**
   * Removes this binding's own installation from its slot. Called once, when the binding is
   * disposed. A no-op when the slot holds a newer installation.
   */
  readonly detach: () => void;
}

let bindingCount = 0;

/**
 * The runtime end of a binding. An activation arrives only through `activate`, and the binding
 * applies the definition's busy policy to it.
 *
 * While an invocation is `running` or `settling`, a new activation first revalidates it, which
 * applies the outcome rule to whatever changed since its last checkpoint, and only then meets the
 * policy. `ignore` (the default) drops it: no hook runs, no invocation exists. `replace` cancels a
 * running invocation with cause `replaced` and starts the new one at once; an invocation already
 * settling keeps its outcome and finishes its cleanup beside the new one.
 *
 * An invocation that is entirely synchronous passes `running` and `settling` and is `idle` again
 * before `activate` returns, with a listener call for each change. A failure decided in that call
 * stack is rethrown to the caller of `activate` when the definition has no `onFailure` to receive
 * it: swallowing it would hide it. A failure decided later has no caller to return to.
 */
export function createBinding<Event>(
  definition: ActionDefinition<Event>,
  seam: BindingSeam,
): { readonly binding: ActionBinding; readonly activate: (event: Event) => void } {
  const plan = planOf(definition);
  const listeners = new Set<() => void>();
  let state: BindingState = Object.freeze({ phase: 'idle' });
  let disposing = false;
  /** The newest invocation that has not settled; it alone drives the phase. */
  let owner: Invocation<Event> | undefined;
  const unsettled = new Set<Invocation<Event>>();
  const phase = (): BindingPhase => state.phase;
  const id = `binding-${++bindingCount}`;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      // A callback may have unsubscribed this listener, or disposed the binding, which ended every
      // subscription after its own final notification. A listener removed meanwhile gets nothing more.
      if (!listeners.has(listener)) continue;
      try {
        const returned: unknown = listener();
        if (isThenable(returned)) discardOutcome(returned);
      } catch {
        // A listener cannot affect the action.
      }
    }
  };
  const setPhase = (next: BindingPhase): void => {
    if (state.phase === next) return;
    state = Object.freeze({ phase: next });
    notify();
  };
  const isDisposed = (): boolean => disposing || phase() === 'disposed';

  const invocationOwner: InvocationOwner<Event> = {
    bindingId: id,
    isDisposed,
    decided(invocation) {
      if (owner === invocation && !isDisposed() && phase() === 'running') setPhase('settling');
    },
    settled(invocation) {
      unsettled.delete(invocation);
      if (owner !== invocation) return;
      owner = undefined;
      // An older invocation's cleanup, or a disposed binding, never rewrites the phase.
      if (!isDisposed()) setPhase('idle');
    },
    retire() {
      binding.dispose();
    },
  };

  const binding: ActionBinding = {
    id,
    get state() {
      return state;
    },
    subscribe(listener) {
      if (phase() === 'disposed') return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (isDisposed()) return;
      disposing = true;
      seam.detach();
      setPhase('disposed');
      listeners.clear();
      for (const invocation of [...unsettled]) invocation.disposed();
    },
  };

  const ignore = (busy: Invocation<Event>): void => {
    emitObservation(plan, id, Date.now(), { phase: 'ignored', ignoredReason: 'busy', busyInvocationId: busy.id });
  };

  const activate = (event: Event): void => {
    if (isDisposed()) return;
    const busy = owner;
    if (busy !== undefined) {
      busy.recheck();
      // Revalidating may have ended it, or retired this binding.
      if (isDisposed()) return;
    }
    if (owner !== undefined && plan.busy === 'ignore') {
      ignore(owner);
      return;
    }
    const invocation = new Invocation<Event>(plan, invocationOwner, seam);
    const replaced = owner;
    owner = invocation;
    replaced?.replaced();
    setPhase('running');
    // A subscriber is application code and may have disposed the binding while being told. A
    // disposed binding has detached and starts no work.
    if (isDisposed()) {
      owner = undefined;
      return;
    }
    unsettled.add(invocation);
    const failure = invocation.start(event);
    if (failure !== undefined) throw failure.error;
  };

  return { binding, activate };
}
