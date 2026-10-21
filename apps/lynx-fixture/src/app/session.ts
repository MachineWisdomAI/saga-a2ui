import type { ServerToClientMessage } from '@lynx-js/genui/a2ui';
import { createInstanceHost, type InstanceHost } from '@saga-a2ui/core/actions';
import {
  createAdmittingMessageStore,
  type Rejection,
} from '../adapter/admission.js';
import { ACTION_BUTTON_NAME } from '../adapter/kind.js';
import { trace } from '../trace.js';

/**
 * One presentation: a message buffer, the processor that `<A2UI>` creates for it, and an action
 * host. The adapter chooses a stricter rule than upstream: one admitting store per session,
 * replaced only together with the mount's `key`, because bound controls and the source-ID
 * annotation assume one continuous message history.
 */
export interface Session {
  readonly generation: number;
  readonly host: InstanceHost;
  readonly store: ReturnType<typeof createAdmittingMessageStore>;
  readonly rejections: Rejection[];
  readonly setupErrors: unknown[];
}

const BOUND_CONTROLS: ReadonlySet<string> = new Set([ACTION_BUTTON_NAME]);

function createSession(generation: number): Session {
  const rejections: Rejection[] = [];
  const setupErrors: unknown[] = [];
  return {
    generation,
    host: createInstanceHost({
      onSetupError(error) {
        setupErrors.push(error);
        trace({
          ev: 'setup-error',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    }),
    store: createAdmittingMessageStore({
      controls: BOUND_CONTROLS,
      onRejected(rejection) {
        rejections.push(rejection);
        trace({ ev: 'rejected', ...rejection });
      },
    }),
    rejections,
    setupErrors,
  };
}

/** The current session, observable so the root can remount on a reset. */
export function createSessionHolder() {
  let generation = 0;
  let current = createSession(generation);
  const listeners = new Set<() => void>();
  return {
    current: (): Session => current,
    /** A new session is a new mount: the root keys `<A2UI>` by the generation. */
    reset(): Session {
      generation += 1;
      current = createSession(generation);
      for (const listener of [...listeners]) listener();
      return current;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push(messages: readonly ServerToClientMessage[]): void {
      current.store.push(messages);
    },
  };
}

export type SessionHolder = ReturnType<typeof createSessionHolder>;
