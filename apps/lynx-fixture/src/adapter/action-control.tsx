import { NodeRenderer, type CatalogComponent, type ComponentInstance, type GenericComponentProps } from '@lynx-js/genui/a2ui';
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from '@lynx-js/react';
import type { InstanceHost } from '@saga-a2ui/core/actions';
import { InstanceSlot, type Activation, type OpenWhere, type SlotConfig } from './instance-slot.js';
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

/**
 * One generic catalog component for every instance of the kind. It is created once, at module
 * scope: React remounts instances when the component function identity changes, and that would
 * dispose every binding.
 *
 * The render path reads props and the published snapshot and writes nothing: it constructs an
 * inert slot, never opens it. Binding and subscription happen in effects, on the background
 * thread only.
 */
export function createActionControl(options: ActionControlOptions): { readonly name: string; readonly component: CatalogComponent } {
  function ActionControlView(props: GenericComponentProps) {
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

    return (
      <view id={componentId} bindtap={token === undefined || props['isValid'] === false ? undefined : onTap}>
        {childWithContext === undefined ? null : <NodeRenderer component={childWithContext} surface={props.surface} />}
      </view>
    );
  }
  ActionControlView.displayName = ACTION_BUTTON_NAME;
  return { name: ACTION_BUTTON_NAME, component: ActionControlView as CatalogComponent };
}
