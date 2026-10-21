import { vi } from 'vitest';
import {
  componentKind,
  createInstanceHost,
  type ActionBinding,
  type BindOptions,
  type InstanceEvent,
  type InstanceHost,
  type Limits,
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
  options: {
    dataPath?: string;
    data?: Record<string, unknown>;
    kind?: typeof Control;
    observable?: boolean;
  } = {},
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

export function newHost(
  onSetupError: (error: unknown) => void = () => undefined,
  limits?: Limits,
): InstanceHost {
  return createInstanceHost({
    onSetupError,
    ...(limits === undefined ? {} : { limits }),
  });
}

// ---------------------------------------------------------------------------------------------
// Shared by the action suites: a gated promise, the controlled clock, and a one-control rig.
// ---------------------------------------------------------------------------------------------

export interface Gate<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}
/** A promise the test settles, so the order in which things settle is never an accident of scheduling. */
export function gate<T = void>(): Gate<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onValue, onError) => {
    resolve = onValue;
    reject = onError;
  });
  return { promise, resolve, reject };
}

/** Lets promise callbacks run without moving the clock. */
export const settle = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);
export const elapse = (ms: number): Promise<unknown> =>
  vi.advanceTimersByTimeAsync(ms);

export interface Rig {
  readonly control: FakeInstance;
  readonly binding: ActionBinding;
  readonly phases: string[];
}

/** One control bound to `definition` through the public handle, with the binding's phases recorded. */
export function rig(
  definition: unknown,
  options: {
    id?: string;
    data?: Record<string, unknown>;
    bind?: BindOptions;
    observable?: boolean;
    limits?: Limits;
  } = {},
): Rig {
  const host = newHost(undefined, options.limits);
  const control = renderInstance(host, options.id ?? 'c', {
    ...(options.data === undefined ? {} : { data: options.data }),
    ...(options.observable === undefined
      ? {}
      : { observable: options.observable }),
  });
  let binding: ActionBinding | undefined;
  host.register((view) => {
    view.watchById(options.id ?? 'c', Control, (handle) => {
      binding = handle.bindAction(
        'activate',
        definition as never,
        options.bind,
      );
    });
  });
  if (binding === undefined) throw new Error('nothing was bound');
  const phases: string[] = [];
  const bound = binding;
  bound.subscribe(() => phases.push(bound.state.phase));
  return { control, binding, phases };
}
