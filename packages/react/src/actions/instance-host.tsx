import { createInstanceHost, snapshotLimits, type InstanceHost, type InstanceView, type Limits } from '@saga-a2ui/core/actions';
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
 *
 * `limits` is this application's defaults for every action bound under the provider: used for each
 * bound an action does not override itself, and before the SDK defaults of 30,000 ms of work and
 * 5,000 ms per awaited hook or cleanup step. Like the host, it is fixed for the provider's
 * lifetime: it is checked and copied when the provider first renders (an invalid value throws
 * there, before anything mounts), and later changes to the prop or to the object are not read.
 * Mount a provider with a new `key` to configure another host.
 */
export function InstanceHostProvider(props: {
  readonly onSetupError: (error: unknown) => void;
  readonly limits?: Limits;
  readonly children: ReactNode;
}) {
  const [limits] = useState(() => snapshotLimits(props.limits));
  const [scope, setScope] = useState<ActionScope>();
  const sink = useRef(props.onSetupError);
  useEffect(() => {
    sink.current = props.onSetupError;
  });
  useEffect(() => {
    const onSetupError = (error: unknown): void => sink.current(error);
    const created: ActionScope = { host: createInstanceHost({ onSetupError, limits }), onSetupError };
    setScope(created);
    return () => {
      created.host.close();
      setScope(undefined);
    };
  }, [limits]);
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
