import { A2uiSurface, type ReactCatalogComponent } from '@a2ui/react/v0_9';
import type { Catalog, SurfaceModel } from '@a2ui/web_core/v0_9';
import {
  a2uiV0_9Decoder,
  createMessageSession,
  type IngestFailure,
  type MessageSession,
  type SurfaceLayout,
  type SurfaceUpdateFailure,
} from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { createElement, useSyncExternalStore, type ReactElement } from 'react';

/**
 * A typed surface for React: an application opens a core `SurfaceLayout` with its catalog,
 * mounts `<Surface of={bound.handle} />` and updates the data with `bound.update(data)`. The
 * message session, the decoder, the order in which the opening messages are applied and the
 * upstream surface model stay in this module; protocol parsing is the core's. React does not
 * depend on MCP.
 *
 * Replacing an answer or resetting presentation state is not an update. An ordinary update is
 * applied in place, so the mounted controls keep their DOM nodes, focus, local state and action
 * bindings; `<Surface>` is never keyed on data.
 */

declare const opaqueHandle: unique symbol;

/** What `<Surface>` renders. Opaque: obtain it from `openSurface` and pass it on unchanged. */
export interface SurfaceHandle {
  readonly [opaqueHandle]: true;
}

/** Why an update changed nothing. `message` is plain text that is safe to display. */
export interface UpdateFailure {
  readonly kind: SurfaceUpdateFailure['kind'] | IngestFailure['kind'];
  readonly message: string;
}

/** The same structured result the Lit app element's `updateData` returns. */
export type UpdateResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: UpdateFailure };

export interface BoundSurface<TData> {
  readonly handle: SurfaceHandle;
  /**
   * Validates `data` against the layout and applies it in place. Never throws. A rejection (data
   * the layout's schema refuses, or a disposed surface) returns the failure and leaves the data
   * and the rendered controls as they were.
   */
  update(data: TData): UpdateResult;
  /** Ends the surface. Idempotent. Afterwards `update` fails and `<Surface>` renders nothing. */
  dispose(): void;
}

/** The handle `openSurface` hands out. Only this module can make one. */
class OpenedSurface implements SurfaceHandle {
  declare readonly [opaqueHandle]: true;
  private readonly listeners = new Set<() => void>();
  private ended = false;

  constructor(readonly surface: SurfaceModel<ReactCatalogComponent>) {}

  get disposed(): boolean {
    return this.ended;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Marks the handle ended and tells every mounted `<Surface>`; false when it already was. */
  end(): boolean {
    if (this.ended) return false;
    this.ended = true;
    for (const listener of [...this.listeners]) listener();
    return true;
  }
}

/**
 * Opens `layout` in a new session over `catalog` and returns the bound surface. Throws, with the
 * session's failure message and no surface left behind, when the session does not accept the
 * layout (for example a component the catalog lacks, or a catalog the layout does not name).
 */
export function openSurface<TData>(
  layout: SurfaceLayout<TData>,
  catalog: Catalog<ReactCatalogComponent>,
): BoundSurface<TData> {
  const session: MessageSession<ReactCatalogComponent> = createMessageSession({
    catalogs: [catalog],
    decoder: a2uiV0_9Decoder,
  });
  // Subscribed before the opening is applied: the surface exists only for the duration of ingest.
  const created: SurfaceModel<ReactCatalogComponent>[] = [];
  const subscription = session.onSurfaceCreated((surface) => {
    if (surface.id === layout.surfaceId) created.push(surface);
  });
  const opened = session.ingest(layout.opening);
  subscription.unsubscribe();
  const [surface] = created;
  if (!opened.ok || !surface) {
    session.dispose();
    throw new Error(
      opened.ok
        ? `The layout created no surface "${layout.surfaceId}".`
        : opened.failure.message,
    );
  }

  const handle = new OpenedSurface(surface);
  return {
    handle,
    update(data) {
      if (handle.disposed)
        return {
          ok: false,
          failure: { kind: 'rejected', message: 'The surface was disposed.' },
        };
      const input = layout.update(data);
      if (!input.ok) return { ok: false, failure: input.failure };
      return session.ingest(input.messages);
    },
    dispose() {
      // Mounted surfaces stop rendering before the model they render is disposed.
      if (handle.end()) session.dispose();
    },
  };
}

const neverChanges = (): (() => void) => () => undefined;

/**
 * Renders a bound surface with the upstream `A2uiSurface`. It renders nothing, and does not
 * throw, once the surface is disposed. It never disposes the surface itself: the application that
 * opened it owns its lifetime, so Strict Mode's replay of effects cannot end it.
 */
export function Surface(props: {
  readonly of: SurfaceHandle;
}): ReactElement | null {
  const opened = props.of instanceof OpenedSurface ? props.of : undefined;
  const disposed = useSyncExternalStore(
    opened?.subscribe ?? neverChanges,
    () => opened?.disposed ?? true,
  );
  return opened && !disposed
    ? createElement(A2uiSurface, { surface: opened.surface })
    : null;
}
