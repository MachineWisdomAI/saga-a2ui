import {
  componentKind,
  createInstanceHost,
  type InstanceEvent,
  type InstanceHost,
  type OpenInstance,
} from './index.js';

// A renderer-free adapter for the tests. It plays the part a renderer integration plays: it
// creates "instances" with their own liveness and data scope, and delivers an event to one of
// them. Only the public adapter interface is used, so a different correct runtime would pass too.

export interface ControlEvents {
  readonly activate: InstanceEvent<string>;
  readonly change: InstanceEvent<string>;
}
export const Control = componentKind<ControlEvents>('Control');
export const OtherKind = componentKind<ControlEvents>('OtherKind');

export interface FakeInstance {
  readonly instance: OpenInstance<ControlEvents>;
  /** Delivers `activate` the way the renderer's event handler would. */
  press(): ReturnType<OpenInstance<ControlEvents>['activate']>;
  /** Replaces what this instance's data scope shows, with no notification: the adapter saw nothing. */
  show(data: Record<string, unknown>): void;
  /** Replaces what the data scope shows and tells every subscribed wake-up, as an observing adapter does. */
  change(data: Record<string, unknown>): void;
  /** How many wake-up subscriptions the runtime holds on this instance right now. */
  readonly watching: number;
  /** The renderer destroys the instance: it stops being live and retires. */
  destroy(): void;
  /** The instance stops being live before the renderer has retired it. */
  goStale(): void;
}

export function renderInstance(
  host: InstanceHost,
  componentId: string,
  options: { dataPath?: string; data?: Record<string, unknown>; kind?: typeof Control; observable?: boolean } = {},
): FakeInstance {
  let live = true;
  let data = options.data ?? {};
  const wakeUps = new Set<() => void>();
  const instance = host.open<ControlEvents>({
    kind: options.kind ?? Control,
    componentId,
    dataPath: options.dataPath ?? '/',
    events: ['activate', 'change'],
    isLive: () => live,
    read: (path) => data[path],
    ...(options.observable === false
      ? {}
      : {
          watchScope: (revalidate: () => void) => {
            wakeUps.add(revalidate);
            return () => {
              wakeUps.delete(revalidate);
            };
          },
        }),
  });
  return {
    instance,
    press: () => instance.activate('activate', 'click'),
    show(next) {
      data = next;
    },
    change(next) {
      data = next;
      for (const wakeUp of [...wakeUps]) wakeUp();
    },
    get watching() {
      return wakeUps.size;
    },
    destroy() {
      live = false;
      instance.retire();
    },
    goStale() {
      live = false;
    },
  };
}

export function newHost(onSetupError: (error: unknown) => void = () => undefined): InstanceHost {
  return createInstanceHost({ onSetupError });
}
