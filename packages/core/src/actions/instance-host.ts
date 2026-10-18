import { createBinding, type ActionBinding } from './binding.js';
import type { ActionDefinition } from './definition.js';

// The adapter-facing half of direct attachment. A renderer adapter (Lit today) opens one
// `OpenInstance` per rendered component instance and forwards that instance's own events to it.
// Application setup code reaches the instances through `InstanceView`, selects them by component
// ID once, and attaches definitions to the exact handle it is given. IDs choose handles during
// setup; they never route an activation. The only thing that reaches a bound callable is the
// instance's own event call, through the slot that instance owns.

/** A directly imported token for a kind of component. Its identity, not its label, selects. */
export class ComponentKind<Events> {
  /** Phantom member: the events this kind offers. Never set at runtime. */
  declare readonly events?: Events;
  constructor(readonly label: string) {}
}

export function componentKind<Events>(label: string): ComponentKind<Events> {
  return new ComponentKind<Events>(label);
}

/** The event an adapter delivers for one instance. `Native` is the renderer's own event type. */
export interface InstanceEvent<Native = unknown> {
  readonly componentId: string;
  /** The data scope this instance renders in: `/` outside any template. */
  readonly dataPath: string;
  readonly native: Native;
  /**
   * Reads this instance's own data scope, now. It answers only while the event is being
   * delivered, so a continuation cannot read whichever item the position shows later; calling it
   * afterwards throws.
   */
  read(path: string): unknown;
}

type NativeOf<Event> = Event extends InstanceEvent<infer Native> ? Native : never;

/**
 * Optional, per binding. `subject` reads, through a supported application or renderer API and not
 * through a view object captured by an earlier render, the semantic item the instance shows now
 * (for a list row, a token that changes whenever the shown item changes). The runtime captures it
 * at activation and compares a fresh read with `Object.is` at its own decision points and on every
 * `current()` call. A reader that throws at activation ends the invocation as `invalid-input`; one
 * that throws later counts as a change. Without `subject`, an invocation's target is the instance
 * alone: a replaced row is not detected, which is right for a fixed control and wrong for a row.
 */
export interface BindOptions {
  readonly subject?: () => unknown;
}

/** A handle stands for one rendered instance. Disposing a binding does not retire its handle. */
export interface InstanceHandle<Events> {
  /** The component ID as the adapter reports it. For discovery and diagnostics, not an instance key. */
  readonly id: string;
  readonly dataPath: string;
  /** What this instance's data scope shows now; `undefined` once the instance is not live. */
  read(path: string): unknown;
  /**
   * Binds `action` to one event of this instance and installs its callable in that slot.
   * Throws when the event is not offered, when a live binding already holds the slot, when the
   * handle is stale (its instance was retired or is no longer live, or its setup ended), or when `action` was not built
   * by `Action`.
   */
  bindAction<Name extends keyof Events & string>(
    event: Name,
    action: ActionDefinition<Events[Name]>,
    options?: BindOptions,
  ): ActionBinding;
}

export interface InstanceView {
  /** The one instance with this ID and kind. Throws when there is none or more than one. */
  getById<Events>(id: string, kind: ComponentKind<Events>): InstanceHandle<Events>;
  /**
   * Setup-time discovery: calls `onHandle` once for each present and later instance with this ID
   * and kind. Unsubscribing stops discovery only. It disposes no binding and removes no callable.
   */
  watchById<Events>(id: string, kind: ComponentKind<Events>, onHandle: (handle: InstanceHandle<Events>) => void): () => void;
}

export interface OpenInfo<Events> {
  readonly kind: ComponentKind<Events>;
  readonly componentId: string;
  readonly dataPath: string;
  /** The events this instance offers. Binding any other event throws. */
  readonly events: readonly (keyof Events & string)[];
  /** A fresh pull on every call, never a cached answer: is this still the instance that was opened? */
  readonly isLive: () => boolean;
  /** Reads this instance's own data scope. */
  readonly read: (path: string) => unknown;
  /**
   * Optional. Calls `revalidate` after each change the adapter can observe in what this instance
   * shows, and returns the unsubscribe. The runtime subscribes only while an invocation is not
   * settled, and a call requests the same recheck that any checkpoint performs. An adapter's own
   * observation of its instance, kept while nothing runs, is separate and stays the adapter's.
   */
  readonly watchScope?: (revalidate: () => void) => () => void;
}

export interface OpenInstance<Events> {
  /**
   * Delivers one event of this instance to the callable installed for it, synchronously. Returns
   * `unbound` when nothing is installed, and `retired` when the instance was retired or is no
   * longer live. `started` means the callable received the event; a binding that is busy drops it.
   */
  activate<Name extends keyof Events & string>(event: Name, native: NativeOf<Events[Name]>): 'started' | 'unbound' | 'retired';
  /**
   * The binding now attached to one event of this instance, by identity: `undefined` while
   * nothing is attached, and never a disposed binding. An adapter that captures it with what it
   * renders can later tell, by reference, that the callable `activate` would reach is no longer
   * the one that render showed. A rebind on the same handle is a different reference.
   */
  attached<Name extends keyof Events & string>(event: Name): ActionBinding | undefined;
  /**
   * Calls `listener` synchronously after this instance gains or loses an attached binding, and
   * once when it retires, with the change already visible through `attached`. A listener that
   * throws affects neither the bind nor the other listeners. Returns the unsubscribe function;
   * a retired instance never calls a listener again.
   */
  subscribe(listener: () => void): () => void;
  /** Idempotent. Disposes every binding on this instance and makes its handles stale. */
  retire(): void;
}

export interface InstanceHost {
  /**
   * Runs the application's setup against a view owned by this one registration and returns the
   * function that ends it. Ending a registration stops its discovery and disposes every binding
   * made through the handles it delivered. If `setup` throws, the registration ends and the
   * error propagates.
   */
  register(setup: (view: InstanceView) => void): () => void;
  open<Events>(info: OpenInfo<Events>): OpenInstance<Events>;
  /** Terminal. Ends every registration and retires every instance. Later `open` and `register` do nothing. */
  close(): void;
}

interface Slot {
  /** Identifies this installation, so a late disposal of an older binding cannot detach a newer one. */
  readonly installation: object;
  readonly binding: ActionBinding;
  deliver(native: unknown): void;
}

interface InstanceRecord {
  readonly kind: ComponentKind<unknown>;
  readonly componentId: string;
  readonly dataPath: string;
  readonly events: ReadonlySet<string>;
  readonly isLive: () => boolean;
  readonly read: (path: string) => unknown;
  readonly watchScope: ((revalidate: () => void) => () => void) | undefined;
  readonly slots: Map<string, Slot>;
  readonly listeners: Set<() => void>;
  retired: boolean;
}

interface Watch {
  readonly id: string;
  readonly kind: ComponentKind<unknown>;
  readonly onHandle: (handle: InstanceHandle<never>) => void;
}

interface Registration {
  active: boolean;
  readonly watches: Set<Watch>;
  readonly bindings: Set<ActionBinding>;
  /** Bindings made while a discovery callback runs, innermost callback last. */
  readonly callbackScopes: Set<ActionBinding>[];
}

export function createInstanceHost(options: { readonly onSetupError: (error: unknown) => void }): InstanceHost {
  const instances = new Set<InstanceRecord>();
  const registrations = new Set<Registration>();
  let closed = false;

  const reportSetupError = (error: unknown): void => {
    try {
      options.onSetupError(error);
    } catch {
      // The sink is the end of the line; a failing sink cannot be reported anywhere else.
    }
  };

  /** Tells the adapter that this instance's attachment changed. A listener cannot affect the host. */
  function announce(record: InstanceRecord): void {
    for (const listener of [...record.listeners]) {
      // A listener removed by an earlier one in this same pass gets nothing more.
      if (!record.listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        // The adapter's listener is not the host's concern.
      }
    }
  }

  function retire(record: InstanceRecord): void {
    if (record.retired) return;
    record.retired = true;
    instances.delete(record);
    // Disposing detaches each slot, which announces; the retirement itself announces once below.
    // Mute those, so a subscriber sees one change with the instance already empty and retired.
    const listeners = [...record.listeners];
    record.listeners.clear();
    for (const slot of [...record.slots.values()]) slot.binding.dispose();
    record.slots.clear();
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // See `announce`.
      }
    }
  }

  function end(registration: Registration): void {
    if (!registration.active) return;
    registration.active = false;
    registration.watches.clear();
    registrations.delete(registration);
    for (const binding of [...registration.bindings]) binding.dispose();
  }

  function handleFor<Events>(registration: Registration, record: InstanceRecord): InstanceHandle<Events> {
    return {
      id: record.componentId,
      dataPath: record.dataPath,
      read: (path) => (record.retired || !record.isLive() ? undefined : record.read(path)),
      bindAction<Name extends keyof Events & string>(
        event: Name,
        action: ActionDefinition<Events[Name]>,
        options?: BindOptions,
      ) {
        const subject = options?.subject;
        if (subject !== undefined && typeof subject !== 'function') {
          throw new TypeError(`The subject option for '${record.componentId}' must be a function.`);
        }
        // `isLive` is read fresh: the renderer may have dropped this instance's model before it retires the element.
        if (!registration.active || record.retired || !record.isLive()) {
          throw new Error(
            `The handle for '${record.componentId}' is stale: its instance was retired or is no longer live, or its setup ended. ` +
              'Bind through a handle delivered for the current instance.',
          );
        }
        if (!record.events.has(event)) {
          throw new Error(`The component '${record.componentId}' does not offer the event '${event}'.`);
        }
        if (record.slots.has(event)) {
          throw new Error(
            `The event '${event}' of '${record.componentId}' already has a live binding. ` +
              'Dispose it before binding again.',
          );
        }
        const installation = {};
        const detach = (): void => {
          const detached = record.slots.get(event)?.installation === installation;
          if (detached) record.slots.delete(event);
          registration.bindings.delete(binding);
          for (const scope of registration.callbackScopes) scope.delete(binding);
          if (detached) announce(record);
        };
        // Throws for a definition `Action` did not build, before anything is installed.
        const { binding, activate } = createBinding(action, {
          detach,
          isLive: () => !record.retired && record.isLive(),
          subject,
          watchScope: record.watchScope,
        });
        record.slots.set(event, {
          installation,
          binding,
          deliver(native) {
            let delivering = true;
            const delivered: InstanceEvent<unknown> = {
              componentId: record.componentId,
              dataPath: record.dataPath,
              native,
              read(path) {
                if (!delivering) throw new Error('read() answers only while the event is being delivered.');
                return record.read(path);
              },
            };
            try {
              // Interop assertion, the only one in this module. The adapter opened this instance
              // with a kind whose events are `InstanceEvent`s of its own native event type, and
              // `activate` is typed to accept exactly that native value, so the event built above
              // is the `Events[Name]` that this definition accepts.
              activate(delivered as unknown as Events[Name]);
            } finally {
              delivering = false;
            }
          },
        });
        registration.bindings.add(binding);
        registration.callbackScopes.at(-1)?.add(binding);
        announce(record);
        return binding;
      },
    };
  }

  /** Runs one discovery callback. A failure disposes only what that callback bound. */
  function runCallback(registration: Registration, callback: () => void): void {
    const owned = new Set<ActionBinding>();
    registration.callbackScopes.push(owned);
    try {
      callback();
    } catch (error) {
      for (const binding of [...owned]) binding.dispose();
      reportSetupError(error);
    } finally {
      registration.callbackScopes.pop();
    }
  }

  function matches(id: string, kind: ComponentKind<unknown>, record: InstanceRecord): boolean {
    return !record.retired && record.componentId === id && record.kind === kind && record.isLive();
  }

  function viewFor(registration: Registration): InstanceView {
    return {
      getById(id, kind) {
        if (!registration.active) throw new Error(`The setup that asked for '${id}' has ended.`);
        const found = [...instances].filter((record) => matches(id, kind, record));
        if (found.length === 0) throw new Error(`No rendered instance has the component ID '${id}' and kind '${kind.label}'.`);
        if (found.length > 1) {
          throw new Error(
            `${found.length} rendered instances have the component ID '${id}' and kind '${kind.label}'. ` +
              'Use watchById to reach each of them.',
          );
        }
        return handleFor(registration, found[0]!);
      },
      watchById(id, kind, onHandle) {
        if (!registration.active) throw new Error(`The setup that watches '${id}' has ended.`);
        const watch: Watch = { id, kind, onHandle };
        registration.watches.add(watch);
        for (const record of [...instances]) {
          if (!registration.watches.has(watch)) break;
          if (matches(id, kind, record)) runCallback(registration, () => onHandle(handleFor(registration, record)));
        }
        return () => {
          registration.watches.delete(watch);
        };
      },
    };
  }

  return {
    register(setup) {
      if (closed) return () => undefined;
      const registration: Registration = {
        active: true,
        watches: new Set(),
        bindings: new Set(),
        callbackScopes: [],
      };
      registrations.add(registration);
      try {
        setup(viewFor(registration));
      } catch (error) {
        end(registration);
        throw error;
      }
      return () => end(registration);
    },

    open(info) {
      const record: InstanceRecord = {
        kind: info.kind,
        componentId: info.componentId,
        dataPath: info.dataPath,
        events: new Set(info.events),
        isLive: info.isLive,
        read: info.read,
        watchScope: info.watchScope,
        slots: new Map(),
        listeners: new Set(),
        retired: closed,
      };
      if (!closed) {
        instances.add(record);
        for (const registration of [...registrations]) {
          for (const watch of [...registration.watches]) {
            if (record.retired || !registration.watches.has(watch) || !matches(watch.id, watch.kind, record)) continue;
            runCallback(registration, () => watch.onHandle(handleFor(registration, record)));
          }
        }
      }
      return {
        activate(event, native) {
          if (record.retired || !record.isLive()) return 'retired';
          const slot = record.slots.get(event);
          if (slot === undefined) return 'unbound';
          slot.deliver(native);
          return 'started';
        },
        attached: (event) => record.slots.get(event)?.binding,
        subscribe(listener) {
          if (record.retired) return () => undefined;
          record.listeners.add(listener);
          return () => {
            record.listeners.delete(listener);
          };
        },
        retire: () => retire(record),
      };
    },

    close() {
      if (closed) return;
      closed = true;
      for (const registration of [...registrations]) end(registration);
      for (const record of [...instances]) retire(record);
    },
  };
}
