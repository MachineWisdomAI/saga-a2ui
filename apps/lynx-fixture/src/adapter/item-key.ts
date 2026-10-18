import type { Surface } from '@lynx-js/genui/a2ui';

// Live reads of one property of one rendered control, and a count of the changes a subscription
// actually observed. Both run on the background thread only: they touch the surface's component
// map and its signals, which a render never reads through this path.

/** What identifies the control for a read: its surface, its component ID and its data context. */
export interface Where {
  readonly surface: Surface;
  readonly componentId: string;
  readonly dataContextPath: string | undefined;
}

/** The part of a ReactLynx signal the watch needs. */
interface SignalLike {
  peek(): unknown;
  subscribe(callback: (value: unknown) => void): () => void;
}

type Source =
  | { readonly kind: 'literal'; readonly value: unknown }
  | { readonly kind: 'signal'; readonly signal: SignalLike }
  | { readonly kind: 'unreadable' };

/**
 * A copy of the renderer's own `resolveBindingPath`, which GenUI 0.7.0 does not export. It is a
 * version-sensitive copy: `readLive` is compared with the renderer's resolved prop in the browser
 * tests so a divergence shows.
 */
export function resolveBindingPath(path: string, dataContextPath: string | undefined): string {
  if (path === '') return path;
  if (path.startsWith('/')) return path;
  return dataContextPath === undefined || dataContextPath === '' ? `/${path}` : `${dataContextPath}/${path}`;
}

/** Where the property's value comes from now, read from the raw component the surface holds. */
function sourceOf(where: Where, prop: string): Source {
  const component = where.surface.components.get(where.componentId) as Record<string, unknown> | undefined;
  const raw = component?.[prop];
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return { kind: 'literal', value: raw };
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const keys = Object.keys(raw);
    const path = (raw as { path?: unknown }).path;
    // A plain data binding is exactly `{ path }`. A function call, or anything else, is not read.
    if (keys.length === 1 && typeof path === 'string') {
      const resolved = resolveBindingPath(path, where.dataContextPath);
      if (resolved === '') return { kind: 'unreadable' };
      // `getSignal` registers an empty signal for an absent path; the store tolerates that.
      return { kind: 'signal', signal: where.surface.store.getSignal(resolved) as unknown as SignalLike };
    }
  }
  return { kind: 'unreadable' };
}

/** The property's value now, or `undefined` when it is unreadable. Never executes a function call. */
export function readLive(where: Where, prop: string): unknown {
  const source = sourceOf(where, prop);
  if (source.kind === 'literal') return source.value;
  if (source.kind === 'signal') return source.signal.peek();
  return undefined;
}

export type WatchEvent =
  | { readonly type: 'signal'; readonly value: unknown; readonly counted: boolean }
  | { readonly type: 'resource'; readonly moved: boolean }
  | { readonly type: 'follow'; readonly from: string; readonly to: string };

const UNSET = Symbol('unset');

/** The signal this watch subscribed through, and how to stop. */
interface Watched {
  readonly signal: SignalLike;
  off: () => void;
}

/**
 * Counts the changes of one property's value that a subscription observed (`epoch`), and follows
 * the property's actual source: a component update can replace `{ path: '/old' }` with
 * `{ path: '/new' }` while the component and its data context stay the same.
 *
 * A key alone cannot tell an unobserved A, B, A, because both A values are equal. The epoch
 * counts what the subscription saw. A change that never reached it, such as B set and reverted
 * inside one batched update, is not claimed to be detected.
 */
export class ItemWatch {
  epoch = 0;
  #where: Where | undefined;
  #prop = '';
  #seen: unknown = UNSET;
  #watched: Watched | undefined;
  #offResource: (() => void) | undefined;

  constructor(
    private readonly changed: () => void,
    private readonly observe: (event: WatchEvent) => void,
  ) {}

  start(where: Where, prop: string): void {
    this.stop();
    this.#where = where;
    this.#prop = prop;
    this.#offResource = where.surface.resources.get(where.componentId)?.subscribe(() => {
      this.observe({ type: 'resource', moved: this.reconcile() });
    });
    this.reconcile();
  }

  /** The data context is the last committed one; the commit effect reports it here. */
  move(where: Where): void {
    if (this.#where === undefined) return;
    this.#where = where;
    this.reconcile();
  }

  stop(): void {
    this.#watched?.off();
    this.#watched = undefined;
    this.#offResource?.();
    this.#offResource = undefined;
    this.#where = undefined;
    this.#seen = UNSET;
  }

  /** Subscribes through the signal the property reads now. Returns whether it moved to another one. */
  reconcile(): boolean {
    const where = this.#where;
    if (where === undefined) return false;
    const source = sourceOf(where, this.#prop);
    if (source.kind !== 'signal') {
      const moved = this.#watched !== undefined;
      this.#watched?.off();
      this.#watched = undefined;
      this.#record(source.kind === 'literal' ? source.value : undefined);
      return moved;
    }
    if (this.#watched?.signal === source.signal) return false;
    this.#watched?.off();
    const signal = source.signal;
    const entry: Watched = { signal, off: () => undefined };
    this.#watched = entry;
    let live = false;
    // `subscribe` calls back at once with the current value; that first value is compared with the
    // last one seen, so the epoch steps only if the key shown actually changed.
    entry.off = signal.subscribe((value) => {
      if (this.#watched !== entry) return; // a retired watch
      if (live && this.#where !== undefined) {
        // A callback from a signal the property no longer reads is not a change of the item.
        const current = sourceOf(this.#where, this.#prop);
        if (current.kind !== 'signal' || current.signal !== signal) {
          this.reconcile();
          return;
        }
      }
      this.observe({ type: 'signal', value, counted: !Object.is(this.#seen, value) && this.#seen !== UNSET });
      this.#record(value);
    });
    live = true;
    return true;
  }

  #record(value: unknown): void {
    const previous = this.#seen;
    this.#seen = value;
    if (previous === UNSET || Object.is(previous, value)) return;
    this.epoch += 1;
    this.changed();
  }
}
