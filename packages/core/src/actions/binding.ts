import { planOf, type ActionDefinition } from './definition.js';
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
   * Idempotent. Detaches this binding's own callable, so later events do nothing, and ends the
   * subscription after one final `disposed` state. Other bindings of the same definition are untouched.
   */
  dispose(): void;
}

let bindingCount = 0;

/**
 * The runtime end of a binding. `detach` removes this binding's own installation from its slot
 * and is called once, when the binding is disposed.
 *
 * An activation is admitted only while the binding is `idle`. One that arrives while an
 * invocation is still running (the handler caused the same event again) is dropped, which is the
 * `ignore` busy policy; no other policy exists yet.
 *
 * An invocation that is entirely synchronous passes `running` and `settling` and is `idle` again
 * before `activate` returns, with a listener call for each change. A failure of the invocation is
 * finalized the same way and then rethrown to the caller of `activate`: this slice has no failure
 * hook to receive it, and swallowing it would hide it.
 */
export function createBinding<Event>(
  definition: ActionDefinition<Event>,
  detach: () => void,
): { readonly binding: ActionBinding; readonly activate: (event: Event) => void } {
  const plan = planOf(definition);
  const listeners = new Set<() => void>();
  let state: BindingState = Object.freeze({ phase: 'idle' });
  const phase = (): BindingPhase => state.phase;

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        const returned: unknown = listener();
        if (isThenable(returned)) discardOutcome(returned);
      } catch {
        // A listener cannot affect the action.
      }
    }
  };
  const setPhase = (next: BindingPhase): void => {
    state = Object.freeze({ phase: next });
    notify();
  };

  const binding: ActionBinding = {
    id: `binding-${++bindingCount}`,
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
      if (phase() === 'disposed') return;
      detach();
      setPhase('disposed');
      listeners.clear();
    },
  };

  const activate = (event: Event): void => {
    if (phase() !== 'idle') return;
    setPhase('running');
    let failure: { readonly error: unknown } | undefined;
    try {
      plan.invoke(event);
    } catch (error) {
      failure = { error };
    }
    // The handler or a listener may have disposed the binding, which stays disposed.
    if (phase() === 'running') setPhase('settling');
    if (phase() === 'settling') setPhase('idle');
    if (failure !== undefined) throw failure.error;
  };

  return { binding, activate };
}
