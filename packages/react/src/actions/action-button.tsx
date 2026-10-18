import { createComponentImplementation, type NodeViewProps, type ReactComponentImplementation } from '@a2ui/react/v0_9';
import type { ComponentNode } from '@a2ui/web_core/v0_9';
import { ActionButtonApi } from '@saga-a2ui/core/actions/action-button-schema';
import { componentKind, type InstanceEvent, type OpenInstance } from '@saga-a2ui/core/actions';
import { createContext, useCallback, useContext, useLayoutEffect, useRef, type ReactNode } from 'react';
import { ActionScopeContext } from './instance-host.js';

/** The event an `ActionButton` delivers: the instance's data scope plus the DOM click. */
export type ActionButtonActivation = InstanceEvent<Event>;

export interface ActionButtonEvents {
  readonly activate: ActionButtonActivation;
}

/** The kind token application setup passes to `getById` and `watchById`. */
export const ActionButton = componentKind<ActionButtonEvents>('ActionButton');

type Activate = (native: Event) => 'started' | 'unbound' | 'retired';

/** What the control's click calls. Outside a boundary nothing is attached, so a press does nothing. */
const ActivateContext = createContext<Activate>(() => 'unbound');

/**
 * Owns one rendered instance for one committed (host, node) pair.
 *
 * A function component is not the instance: React can re-run it, discard a render before commit
 * or mount a second copy. The instance is the span between this layout effect's setup and its
 * cleanup, so a render that is never committed publishes nothing and opens nothing.
 *
 * The effect is a layout effect so that the previous pair retires and the new one opens within
 * the same commit, before the browser paints. A live-looking control is never left without its
 * instance, and a control that left the screen is never left with one. Retirement is the
 * commit-time signal: a handle, a binding and a press all consult it, so a node that is still live
 * under a new host is already retired when the commit finishes.
 */
function InstanceBoundary({ node, children }: { readonly node: ComponentNode; readonly children: ReactNode }) {
  const scope = useContext(ActionScopeContext);
  // Written only by the layout effect below. A press reads it at press time, never at render time.
  const instance = useRef<OpenInstance<ActionButtonEvents> | undefined>(undefined);

  useLayoutEffect(() => {
    const context = node.context;
    if (!scope || !context) return undefined;
    const open = scope.host.open<ActionButtonEvents>({
      kind: ActionButton,
      componentId: node.componentId,
      dataPath: node.dataPath,
      events: ['activate'],
      // The resolver disposes a node synchronously and its cleanup retires this instance in the same call.
      isLive: () => !node.disposed,
      // This instance's own scope: a node's context is fixed when it is created.
      read: (path) => context.dataContext.resolveDynamicValue<unknown>({ path }),
    });
    instance.current = open;
    // Runs synchronously when the resolver disposes the node, whichever of this and the cleanup below
    // reaches the instance first. The registration cannot be removed, which is harmless: `retire` is idempotent.
    // A node already disposed never calls it back; this effect's cleanup is then the instance's only retirement.
    node.addCleanup(open.retire);
    return () => {
      if (instance.current === open) instance.current = undefined;
      open.retire();
    };
  }, [scope, node]);

  const activate = useCallback<Activate>((native) => instance.current?.activate('activate', native) ?? 'unbound', []);
  return <ActivateContext.Provider value={activate}>{children}</ActivateContext.Provider>;
}

/** Wraps an entry's generated view with the boundary that knows its node. */
function withInstance(implementation: ReactComponentImplementation): ReactComponentImplementation {
  const Inner = implementation.view;
  if (!Inner) throw new Error('withInstance needs an entry with a generated view');
  const View = (props: NodeViewProps) => (
    <InstanceBoundary node={props.node}>
      <Inner {...props} />
    </InstanceBoundary>
  );
  View.displayName = `${implementation.name}.instance`;
  return { ...implementation, view: View };
}

/**
 * The catalog entry. An application lists it in its own catalog. The control has no upstream
 * `action`, so its single click handler is the only activation site; a consumer that renders the
 * entry through `render` instead of `view` gets no boundary and an inert button.
 */
export const ActionButtonEntry: ReactComponentImplementation = withInstance(
  createComponentImplementation(ActionButtonApi, ({ props, buildChild }) => {
    const activate = useContext(ActivateContext);
    return (
      <button type="button" disabled={props.isValid === false} onClick={(event) => activate(event.nativeEvent)}>
        {typeof props.child === 'string' ? buildChild(props.child) : null}
      </button>
    );
  }),
);
