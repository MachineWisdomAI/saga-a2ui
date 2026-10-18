import { createInstanceHost, type InstanceHost, type InstanceView } from '@saga-a2ui/core/actions';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The host one provider owns, with the sink its setup errors go to. A host is never reused: a
 * closed host is terminal, so every effect run that needs one creates its own.
 */
export interface ActionScope {
  readonly host: InstanceHost;
  readonly onSetupError: (error: unknown) => void;
}

export const ActionScopeContext = createContext<ActionScope | undefined>(undefined);

/**
 * Owns one host for the subtree it wraps. The host is created in an effect and closed in that
 * effect's cleanup, so Strict Mode's simulated unmount closes the first host and its second setup
 * makes another: the host children see is always an open one, and a reference kept to an earlier
 * one can no longer open an instance or register a setup. Children render only once a host exists,
 * which costs one extra render before the surface mounts.
 *
 * Mount it once per rendered surface, at the component that renders `A2uiSurface`; that
 * component's unmount is then the explicit teardown of every instance and binding beneath it.
 * Two surfaces under one provider are not a single scope: each rendered instance is separate, and
 * `getById` fails for an ID that both render.
 */
export function InstanceHostProvider(props: {
  readonly onSetupError: (error: unknown) => void;
  readonly children: ReactNode;
}) {
  const [scope, setScope] = useState<ActionScope>();
  const sink = useRef(props.onSetupError);
  useEffect(() => {
    sink.current = props.onSetupError;
  });
  useEffect(() => {
    const onSetupError = (error: unknown): void => sink.current(error);
    const created: ActionScope = { host: createInstanceHost({ onSetupError }), onSetupError };
    setScope(created);
    return () => {
      created.host.close();
      setScope(undefined);
    };
  }, []);
  return scope ? <ActionScopeContext.Provider value={scope}>{props.children}</ActionScopeContext.Provider> : null;
}

/**
 * Runs `setup` once per (host, setup) pair. Its effect cleanup ends the registration: discovery
 * stops and every binding made through the handles it delivered is disposed. Keep `setup` stable
 * per definition (for example with `useCallback`): a new function ends the registration and starts
 * another, which disposes the bindings of the first.
 *
 * A setup that throws leaves nothing bound. The error goes to the provider's `onSetupError` and
 * then propagates, so the nearest React error boundary decides what the application shows, as the
 * app element's safe fallback does for Lit. A discovery callback that throws loses only the
 * bindings it made and reports to `onSetupError` alone.
 */
export function useActionSetup(setup: (view: InstanceView) => void): void {
  const scope = useContext(ActionScopeContext);
  useEffect(() => {
    if (!scope) return undefined;
    try {
      return scope.host.register(setup);
    } catch (error) {
      try {
        scope.onSetupError(error);
      } catch {
        // The sink is the end of the line; the original error is the one that propagates.
      }
      throw error;
    }
  }, [scope, setup]);
}
