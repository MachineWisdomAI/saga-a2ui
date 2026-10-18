import type { ActionBinding, ComponentKind, InstanceHost, OpenInstance } from '@saga-a2ui/core/actions';
import { ItemWatch, readLive, type Where, type WatchEvent } from './item-key.js';
import { countOnMainThread } from '../trace.js';
import type { ActionButtonEvents, LynxTap } from './kind.js';

// One mounted ReactLynx component instance's connection to ACT1's instance host. The slot is the
// logical instance: it outlives the physical node the renderer draws it on, and it lives from the
// mount effect to its cleanup. Its `installation` is one open-to-close run inside that.

/** One open-to-close run. `live` turns false before the instance is retired. */
interface Installation {
  live: boolean;
}

/** What a render may read: reference-stable between changes, so `useSyncExternalStore` can use it. */
export interface SlotSnapshot {
  readonly installation: Installation | undefined;
  readonly keyProp: string | undefined;
  readonly epoch: number;
  /** The binding ACT1 has attached to the tap event, by reference; `undefined` while none is. */
  readonly binding: ActionBinding | undefined;
}

/** What one render showed. A queued `bindtap` closure carries it and is checked against the slot. */
export interface TapToken {
  readonly installation: Installation;
  readonly epoch: number;
  /** The binding that was attached when this render ran. It is compared by reference at the tap. */
  readonly binding: ActionBinding | undefined;
  readonly shownKey: unknown;
}

export type Activation = 'delivered' | 'failed' | 'unbound' | 'retired' | 'stale';

export type SlotProbe =
  | WatchEvent
  | { readonly type: 'opened'; readonly where: Where }
  | { readonly type: 'closed' }
  | { readonly type: 'render'; readonly shownKey: unknown; readonly epoch: number }
  | { readonly type: 'commit' }
  | { readonly type: 'refused'; readonly outcome: Exclude<Activation, 'delivered' | 'failed'> };

export interface SlotConfig {
  /** The presentation's host. Without one the control stays unbound and refuses every tap. */
  readonly host: InstanceHost | undefined;
  readonly kind: ComponentKind<ActionButtonEvents>;
  /** The property that identifies the business item the control shows, if the layout names one. */
  readonly itemKeyProp: (sourceComponentId: string) => string | undefined;
  /** An activation that threw. ACT1 rethrows to the event's caller, which is this adapter. */
  readonly onActivationError: (error: unknown) => void;
  readonly probe: (slot: InstanceSlot, event: SlotProbe) => void;
}

export interface OpenWhere extends Where {
  readonly sourceComponentId: string;
}

export class InstanceSlot {
  /** Test-only handle on the latest `bindtap` closure a commit effect published. */
  currentTap: ((event: LynxTap) => unknown) | undefined;
  /** Exposed so the browser tests can read identities. Nothing selects behavior by it. */
  label = '';

  #installation: Installation | undefined;
  #opened: OpenInstance<ActionButtonEvents> | undefined;
  #unsubscribeOpened: (() => void) | undefined;
  #where: OpenWhere | undefined;
  #keyProp: string | undefined;
  #watch: ItemWatch | undefined;
  #snapshot: SlotSnapshot = Object.freeze({ installation: undefined, keyProp: undefined, epoch: 0, binding: undefined });
  readonly #listeners = new Set<() => void>();

  constructor(private readonly config: SlotConfig) {
    countOnMainThread('slotsConstructed');
  }

  /** The last committed identity of this instance. */
  get where(): OpenWhere | undefined {
    return this.#where;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): SlotSnapshot => this.#snapshot;

  get installation(): object | undefined {
    return this.#installation;
  }

  /** Background only: runs in the mount effect. Setup of the application's discovery callbacks runs inside `host.open`. */
  open(where: OpenWhere): void {
    countOnMainThread('opens');
    this.close();
    const installation: Installation = { live: true };
    this.#installation = installation;
    this.#where = where;
    this.#keyProp = this.config.itemKeyProp(where.sourceComponentId);
    if (this.#keyProp !== undefined) {
      this.#watch = new ItemWatch(
        () => this.#publish(),
        (event) => this.config.probe(this, event),
      );
      this.#watch.start(where, this.#keyProp);
    }
    this.#opened = this.config.host?.open<ActionButtonEvents>({
      kind: this.config.kind,
      // The layout's own ID, not the expanded clone's: setup discovers a template's rows by it.
      componentId: where.sourceComponentId,
      dataPath: where.dataContextPath ?? '/',
      events: ['activate'],
      isLive: () => installation.live,
      read: (prop) => (installation.live && this.#where !== undefined ? readLive(this.#where, prop) : undefined),
    });
    // Setup has already run inside `host.open`, so what it bound is published below. From here a
    // dispose or a rebind on the handle publishes a new snapshot, and the next render's token
    // carries the new binding.
    this.#unsubscribeOpened = this.#opened?.subscribe(() => this.#publish());
    this.#publish();
    this.config.probe(this, { type: 'opened', where });
  }

  /** Background only: the commit effect reports the last committed data context. */
  sync(where: OpenWhere): void {
    this.config.probe(this, { type: 'commit' });
    if (this.#installation === undefined) return;
    this.#where = where;
    this.#watch?.move(where);
  }

  /** Background only: the effect cleanup. Retires the instance, which disposes its bindings. */
  close(): void {
    countOnMainThread('closes');
    const installation = this.#installation;
    if (installation === undefined) return;
    installation.live = false;
    this.#unsubscribeOpened?.();
    this.#unsubscribeOpened = undefined;
    this.#opened?.retire();
    this.#opened = undefined;
    this.#watch?.stop();
    this.#watch = undefined;
    this.#installation = undefined;
    this.#where = undefined;
    this.#keyProp = undefined;
    this.#publish();
    this.config.probe(this, { type: 'closed' });
  }

  /**
   * Runs in render, on both threads, so it reads only the published snapshot and the render's own
   * props and returns a plain object.
   */
  tapToken(snapshot: SlotSnapshot, shown: Readonly<Record<string, unknown>>): TapToken | undefined {
    if (snapshot.installation === undefined) return undefined;
    countOnMainThread('tokensCaptured');
    return {
      installation: snapshot.installation,
      epoch: snapshot.epoch,
      binding: snapshot.binding,
      shownKey: snapshot.keyProp === undefined ? undefined : shown[snapshot.keyProp],
    };
  }

  /**
   * Admits one tap, then hands it to the callable ACT1 installed for this instance. The checks
   * run in order and a refusal is silent to the renderer: the closure is from a mount, an
   * observed identity change, a binding that is no longer the attached one, or an item that no
   * longer matches the instance. No binding attached is `unbound`; a different one than the
   * render showed is `stale`, so a closure queued before a dispose never reaches a replacement.
   */
  activate(token: TapToken, native: LynxTap): Activation {
    const installation = this.#installation;
    if (installation === undefined || !installation.live || token.installation !== installation) {
      return this.#refuse('stale');
    }
    if (token.epoch !== (this.#watch?.epoch ?? 0)) return this.#refuse('stale');
    const opened = this.#opened;
    if (opened === undefined) return this.#refuse('retired');
    const attached = opened.attached('activate');
    if (attached === undefined) return this.#refuse('unbound');
    if (token.binding !== attached) return this.#refuse('stale');
    if (this.#keyProp !== undefined && this.#where !== undefined && readLive(this.#where, this.#keyProp) !== token.shownKey) {
      return this.#refuse('stale');
    }
    try {
      const outcome = opened.activate('activate', native);
      if (outcome === 'started') return 'delivered';
      return this.#refuse(outcome);
    } catch (error) {
      this.config.onActivationError(error);
      return 'failed';
    }
  }

  /** Test instrumentation for the render path: reports what a render showed. Writes nothing. */
  noteRender(shownKey: unknown): void {
    countOnMainThread('renders');
    this.config.probe(this, { type: 'render', shownKey, epoch: this.#watch?.epoch ?? 0 });
  }

  #refuse(outcome: Exclude<Activation, 'delivered' | 'failed'>): Activation {
    this.config.probe(this, { type: 'refused', outcome });
    return outcome;
  }

  #publish(): void {
    this.#snapshot = Object.freeze({
      installation: this.#installation,
      keyProp: this.#keyProp,
      epoch: this.#watch?.epoch ?? 0,
      binding: this.#opened?.attached('activate'),
    });
    for (const listener of [...this.#listeners]) listener();
  }
}
