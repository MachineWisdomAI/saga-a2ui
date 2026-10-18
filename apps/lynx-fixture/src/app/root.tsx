import { A2UI, Button, Column, List, Text, functionRegistry, type CatalogInput, type Surface } from '@lynx-js/genui/a2ui';
import { SignalStore } from '@lynx-js/genui/a2ui/store';
import { useEffect, useSyncExternalStore } from '@lynx-js/react';
import { ActionHostContext, createActionControl } from '../adapter/action-control.js';
import { countOnMainThread, trace } from '../trace.js';
import { installHarness } from './harness.js';
import { createSessionHolder } from './session.js';
import { attach } from './setup.js';

// Module scope: one stable component type for the life of the bundle. The catalog array is a
// module constant for the same reason.
// A registered client function with an observable effect. GenUI resolves function calls found
// anywhere in a component's properties, so the tests use it to see where resolution runs.
functionRegistry.register({
  name: 'sagaProbe',
  impl: (args) => {
    trace({ ev: 'function-call', value: args['value'] });
    return String(args['value']);
  },
});

const holder = createSessionHolder();
const driver = installHarness(holder);

/** The business item each control kind shows, named by the layout's own component ID. */
const ITEM_KEY_PROPS: Readonly<Record<string, string>> = {
  'submit-order': 'orderId',
  'cancel-order': 'orderId',
  'row-archive': 'noteId',
};

const actionButton = createActionControl({
  itemKeyProp: (sourceComponentId) => ITEM_KEY_PROPS[sourceComponentId],
  onActivationError(error) {
    trace({ ev: 'activation-error', message: error instanceof Error ? error.message : String(error) });
  },
  probe: driver.probe,
  onMount: driver.onMount,
});

// The upstream built-ins declare narrower props than `ComponentType<GenericComponentProps>`, so
// the array does not satisfy `CatalogInput` under `strictFunctionTypes`. The assertion is limited
// to this one list of upstream components and the control above.
const catalogs = [actionButton, Button, Column, List, Text] as unknown as readonly CatalogInput[];

// The first screen is rendered on the main thread before any message has been processed, so
// `<A2UI>` shows its empty state there. Rendering a real control as that empty state is the one
// way to put the control's render path on the main thread: it must construct an inert slot,
// capture no token and open nothing, and the background effect opens it afterwards.
const FIRST_SCREEN_SURFACE = { surfaceId: 'first-screen', components: new Map(), resources: new Map(), store: new SignalStore() } as unknown as Surface;
const FirstScreenControl = actionButton.component;

export function Root() {
  countOnMainThread('roots');
  const session = useSyncExternalStore(holder.subscribe, holder.current, holder.current);

  // Background only: effects never run on the main thread. The registration ends, and the host
  // closes, when the session does.
  useEffect(() => {
    const end = session.host.register((view) => {
      attach(view, driver.observer);
    });
    return () => {
      end();
      session.host.close();
    };
  }, [session]);

  return (
    <ActionHostContext.Provider value={session.host}>
      <A2UI
        key={session.generation}
        messageStore={session.store}
        renderEmpty={() => <FirstScreenControl id='first-screen-control' surface={FIRST_SCREEN_SURFACE} />}
        catalogs={catalogs}
        onAction={(action) => {
          trace({ ev: 'protocol-action', name: action.name, sourceComponentId: action.sourceComponentId });
        }}
      />
    </ActionHostContext.Provider>
  );
}
