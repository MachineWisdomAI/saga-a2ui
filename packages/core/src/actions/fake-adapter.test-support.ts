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
  /** Replaces what this instance's data scope shows. */
  show(data: Record<string, unknown>): void;
  /** The renderer destroys the instance: it stops being live and retires. */
  destroy(): void;
  /** The instance stops being live before the renderer has retired it. */
  goStale(): void;
}

export function renderInstance(
  host: InstanceHost,
  componentId: string,
  options: { dataPath?: string; data?: Record<string, unknown>; kind?: typeof Control } = {},
): FakeInstance {
  let live = true;
  let data = options.data ?? {};
  const instance = host.open<ControlEvents>({
    kind: options.kind ?? Control,
    componentId,
    dataPath: options.dataPath ?? '/',
    events: ['activate', 'change'],
    isLive: () => live,
    read: (path) => data[path],
  });
  return {
    instance,
    press: () => instance.activate('activate', 'click'),
    show(next) {
      data = next;
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
