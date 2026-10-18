import { NodeRenderer, useChecks, type CatalogComponent, type CheckLike, type ComponentInstance, type GenericComponentProps } from '@lynx-js/genui/a2ui';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from '@lynx-js/react';
import type { InstanceHost } from '@saga-a2ui/core/actions';
import { InstanceSlot, type Activation, type OpenWhere, type SlotConfig, type TapToken } from './instance-slot.js';
import { ACTION_BUTTON_NAME, ActionButton, SOURCE_ID_PROP, type LynxTap } from './kind.js';

/** The presentation's action host. One `<A2UI>` mount, one host; a new session is a new host. */
export const ActionHostContext = createContext<InstanceHost | undefined>(undefined);

export interface ActionControlOptions {
  readonly itemKeyProp: SlotConfig['itemKeyProp'];
  readonly onActivationError: SlotConfig['onActivationError'];
  readonly probe: SlotConfig['probe'];
  /** Called with each slot as its component mounts; the browser tests use it to reach instances. */
  readonly onMount?: (slot: InstanceSlot) => void;
}

/** What the slot machinery gives a render: the committed tap closure and the pieces to draw. */
interface SlotView {
  readonly token: TapToken | undefined;
  readonly onTap: (event: LynxTap) => Activation | 'no-token';
  readonly componentId: string;
  readonly child: ComponentInstance | undefined;
}

export interface ActionControl {
  readonly name: string;
  readonly component: CatalogComponent;
  /**
   * The same slot machinery without the checks gate, for the one place a control has to render
   * outside `<A2UI>`: the empty first screen, which `<A2UI>` draws before its context exists.
   * `useChecks` needs that context, so the full control cannot be placed there. A test probe,
   * not a second control: it shares `useSlotView` with the control and nothing else.
   */
  readonly firstScreenProbe: CatalogComponent;
}

const noUnsubscribe = (): void => undefined;
const noSubscribe = (): (() => void) => noUnsubscribe;
const noSnapshot = (): undefined => undefined;

/**
 * The `checks` rules as the agent wrote them, from the public `surface.components` store, and
 * the component's own resource as the update notification (what `NodeRenderer` subscribes to), so
 * a replaced rule list re-renders the control. The array keeps its identity until the stored
 * component is replaced, which is what `useChecks` keys its re-evaluation on.
 */
function useStoredChecks(surface: GenericComponentProps['surface'], componentId: string): CheckLike[] | undefined {
  const resource = surface.resources.get(componentId);
  useSyncExternalStore(resource === undefined ? noSubscribe : resource.subscribe, resource === undefined ? noSnapshot : resource.getSnapshot, resource === undefined ? noSnapshot : resource.getSnapshot);
  const stored: unknown = (surface.components.get(componentId) as Record<string, unknown> | undefined)?.['checks'];
  return Array.isArray(stored) ? (stored as CheckLike[]) : undefined;
}

/**
 * One generic catalog component for every instance of the kind. It is created once, at module
 * scope: React remounts instances when the component function identity changes, and that would
 * dispose every binding.
 *
 * The render path reads props and the published snapshot and writes nothing: it constructs an
 * inert slot, never opens it. Binding and subscription happen in effects, on the background
 * thread only.
 */
export function createActionControl(options: ActionControlOptions): ActionControl {
  function useSlotView(props: GenericComponentProps): SlotView {
    const host = useContext(ActionHostContext);
    const [slot] = useState(
      () =>
        new InstanceSlot({
          host,
          kind: ActionButton,
          itemKeyProp: options.itemKeyProp,
          onActivationError: options.onActivationError,
          probe: options.probe,
        }),
    );
    const snapshot = useSyncExternalStore(slot.subscribe, slot.getSnapshot, slot.getSnapshot);

    const componentId = props.id ?? '';
    const where: OpenWhere = {
      surface: props.surface,
      componentId,
      sourceComponentId: typeof props[SOURCE_ID_PROP] === 'string' ? props[SOURCE_ID_PROP] : componentId,
      dataContextPath: props.dataContextPath,
    };

    // Effects run on the background side, after commit.
    useEffect(() => {
      slot.label = `${where.sourceComponentId}@${where.dataContextPath ?? '/'}`;
      slot.open(where);
      options.onMount?.(slot);
      return () => {
        slot.close();
      };
    }, [slot]);
    useEffect(() => {
      slot.sync(where);
    }, [slot, props.surface, componentId, props.dataContextPath]);

    // Pure: what this render showed.
    const token = slot.tapToken(snapshot, props);
    slot.noteRender(token?.shownKey);
    const onTap = (event: LynxTap): Activation | 'no-token' => (token === undefined ? 'no-token' : slot.activate(token, event));
    useEffect(() => {
      slot.currentTap = onTap;
    });

    const childId = typeof props['child'] === 'string' ? props['child'] : undefined;
    const child = childId === undefined ? undefined : props.surface.components.get(childId);
    const childWithContext: ComponentInstance | undefined =
      child !== undefined && props.dataContextPath !== undefined ? { ...child, dataContextPath: props.dataContextPath } : child;
    return { token, onTap, componentId, child: childWithContext };
  }

  function ActionControlView(props: GenericComponentProps) {
    const { token, onTap, componentId, child } = useSlotView(props);

    // The supported checks seam, the one the published `Button` uses: GenUI's exported `useChecks`
    // evaluates the rule list reactively and this adapter implements no expression interpreter of
    // its own. The control is interactive only when `isValid` and every check pass, and it shows
    // the first failure's message. Checks gate the interface; they authorize nothing.
    //
    // The hook is given the component's stored rules, not `props['checks']`. By the time props
    // arrive, GenUI has already replaced a `{ path }` or function-call condition with its current
    // value, which `useChecks` does not recognise and so counts as passing, and the rule no longer
    // names the data it depends on. The stored rule keeps the binding, so the hook evaluates it
    // against the current data model and re-evaluates when that model changes.
    const checked = useChecks({ checks: useStoredChecks(props.surface, componentId), componentId, surface: props.surface, dataContextPath: props.dataContextPath });
    const enabled = props['isValid'] !== false && checked.ok;

    return (
      <>
        <view id={componentId} bindtap={token === undefined || !enabled ? undefined : onTap}>
          {child === undefined ? null : <NodeRenderer component={child} surface={props.surface} />}
        </view>
        {!checked.ok && typeof checked.firstFailureMessage === 'string' && checked.firstFailureMessage !== '' ? <text id={`${componentId}-error`}>{checked.firstFailureMessage}</text> : null}
      </>
    );
  }
  ActionControlView.displayName = ACTION_BUTTON_NAME;

  function FirstScreenProbe(props: GenericComponentProps) {
    const { token, onTap, componentId } = useSlotView(props);
    return <view id={componentId} bindtap={token === undefined ? undefined : onTap} />;
  }
  FirstScreenProbe.displayName = `${ACTION_BUTTON_NAME}FirstScreenProbe`;

  return {
    name: ACTION_BUTTON_NAME,
    component: ActionControlView as CatalogComponent,
    firstScreenProbe: FirstScreenProbe as CatalogComponent,
  };
}
