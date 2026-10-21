import type {
  ComponentInstance,
  MessageStore,
  ServerToClientMessage,
} from '@lynx-js/genui/a2ui';
import { createMessageStore } from '@lynx-js/genui/a2ui/store';
import { SOURCE_ID_PROP } from './kind.js';

// The proposed enforcement point for "a bound control carries no protocol action". GenUI resolves
// every property of a component, `action` included, before the component renders, and that
// resolution executes a `functionCall` eagerly. A wrapper component cannot stop it, so the check
// is made on the buffer the renderer reads, before a message can reach the processor.
//
// Scope, stated narrowly: for items of a bound control's catalog name, an `action` key of either
// shape never reaches the processor. Other properties and `checks` can still contain function
// calls, and the processor can still be used directly by an application that bypasses `<A2UI>`.
// This is not a validation pass; GenUI 0.7.0 still interprets the protocol with its own
// `@a2ui/web_core` 0.10.6 processor.

export interface Rejection {
  readonly surfaceId: string;
  readonly componentId: string;
  readonly reason: 'action-on-bound-control';
}

export type Admission =
  | { readonly kind: 'admitted'; readonly message: ServerToClientMessage }
  | { readonly kind: 'rejected'; readonly rejection: Rejection };

export function admit(
  message: ServerToClientMessage,
  boundControlNames: ReadonlySet<string>,
): Admission {
  if (!('updateComponents' in message) || !message.updateComponents)
    return { kind: 'admitted', message };
  const { surfaceId, components } = message.updateComponents;
  const annotated: ComponentInstance[] = [];
  for (const item of components as ComponentInstance[]) {
    if (!boundControlNames.has(item.component)) {
      annotated.push(item);
      continue;
    }
    if ('action' in item) {
      return {
        kind: 'rejected',
        rejection: {
          surfaceId,
          componentId: item.id ?? '',
          reason: 'action-on-bound-control',
        },
      };
    }
    // The adapter's value replaces anything the agent sent under this name. The processor stores
    // a spread of the item and clones JSON-copy it, so a plain string survives to the control.
    annotated.push({ ...item, [SOURCE_ID_PROP]: item.id } as ComponentInstance);
  }
  return {
    kind: 'admitted',
    message: {
      ...message,
      updateComponents: { ...message.updateComponents, components: annotated },
    } as ServerToClientMessage,
  };
}

export interface AdmittingStoreOptions {
  readonly controls: ReadonlySet<string>;
  readonly onRejected: (rejection: Rejection) => void;
}

/** A message buffer that admits each pushed message before the renderer can see it. */
export function createAdmittingMessageStore(
  options: AdmittingStoreOptions,
): MessageStore {
  const inner = createMessageStore();
  return {
    subscribe: inner.subscribe,
    getSnapshot: inner.getSnapshot,
    clear: inner.clear,
    push(message) {
      const admitted: ServerToClientMessage[] = [];
      for (const candidate of Array.isArray(message) ? message : [message]) {
        const result = admit(
          candidate as ServerToClientMessage,
          options.controls,
        );
        if (result.kind === 'rejected') options.onRejected(result.rejection);
        else admitted.push(result.message);
      }
      if (admitted.length > 0) inner.push(admitted);
    },
  };
}
