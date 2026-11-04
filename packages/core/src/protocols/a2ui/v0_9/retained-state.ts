/**
 * What a session keeps, and what a batch of validated messages would add to it, in the units of
 * the retained budget (`measure` in `admission.ts`). Two answers are offered for a batch:
 *
 * - an upper bound that reads no session state, cheap enough for every call, and
 * - the exact growth against the state the session holds now, which credits what a message
 *   replaces (a value at a path that is already there, a component that already exists) and
 *   charges only the containers it would newly create.
 *
 * The messages are validated, frozen copies the decoder made from an admitted snapshot, so
 * reading them costs no more than the input limits allowed. The state read here is the
 * session's own, never caller input.
 */
import type { ComponentApi, SurfaceModel } from '@a2ui/web_core/v0_9';
import {
  hasOwn,
  measure,
  utf8Length,
  type MessageSize,
  type RetainedLimits,
} from './admission.js';
import type { A2uiMessageVisitor, ValidatedMessage } from './message.js';

/** The upstream data model's own ceiling on an array index (`MAX_ARRAY_INDEX`). */
const MAX_ARRAY_INDEX = 10_000;

const NONE: MessageSize = { nodes: 0, bytes: 0 };

const isNumeric = (segment: string): boolean => /^(0|[1-9]\d*)$/.test(segment);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const add = (a: MessageSize, b: MessageSize): MessageSize => ({
  nodes: a.nodes + b.nodes,
  bytes: a.bytes + b.bytes,
});

/** `grown` less `released`, never below nothing (a message that shrinks state grows none). */
const net = (grown: MessageSize, released: MessageSize): MessageSize => ({
  nodes: Math.max(0, grown.nodes - released.nodes),
  bytes: Math.max(0, grown.bytes - released.bytes),
});

/** What the session holds: every surface, its data, theme, metadata and components. */
export function measureRetained<T extends ComponentApi>(
  surfaces: ReadonlyMap<string, SurfaceModel<T>>,
  limits: RetainedLimits,
): MessageSize {
  const roots: unknown[] = [];
  for (const surface of surfaces.values()) {
    roots.push(
      surface.id,
      surface.dataModel.get('/'),
      surface.theme,
      surface.metadata,
    );
    for (const component of surface.componentsModel.values)
      roots.push(
        component.id,
        component.type,
        component.properties,
        component.metadata,
      );
  }
  // State past the limits cannot have been admitted; treat it as full.
  return (
    measure(roots, limits) ?? { nodes: limits.maxNodes, bytes: limits.maxBytes }
  );
}

/** What `value` costs inside a container, beyond the slot (one value) that holds it. */
function contentOf(
  value: unknown,
  limits: RetainedLimits,
): MessageSize | undefined {
  const size = measure([value], limits);
  return size && { nodes: size.nodes - 1, bytes: size.bytes };
}

/** UTF-8 length of a name; undefined when it is longer than the byte budget. */
function nameBytes(name: string, limits: RetainedLimits): number | undefined {
  return name.length > limits.maxBytes ? undefined : utf8Length(name);
}

/** The segments of a data path as the upstream data model reads them. */
function dataPathSegments(path: string): string[] | undefined {
  const segments: string[] = [];
  for (const raw of path.split('/')) {
    if (raw.length === 0) continue;
    const segment = raw.replace(/~([01])/g, (_, code: string) =>
      code === '1' ? '/' : '~',
    );
    // The data model refuses these segments, so such a write changes nothing.
    if (
      segment === '__proto__' ||
      segment === 'constructor' ||
      segment === 'prototype'
    )
      return undefined;
    segments.push(segment);
  }
  return segments;
}

/**
 * What writing at `path` can leave behind beyond the value written, whatever the state: the
 * upstream data model creates every missing container along a path, and a numeric segment may
 * create an array that is then extended to that index, which the retained measure counts item
 * by item. So each segment is charged as one value, or as `index + 1` items for a numeric
 * segment (the index is capped where upstream refuses it); and the path's own bytes stand for
 * the property names it creates. Callers have already bounded the path's segments.
 */
export function pathUpperBound(path: string): MessageSize {
  let nodes = 0;
  for (const segment of path.split('/')) {
    if (segment.length === 0) continue;
    nodes += isNumeric(segment)
      ? Math.min(Number(segment), MAX_ARRAY_INDEX + 1) + 1
      : 1;
  }
  return { nodes, bytes: utf8Length(path) };
}

/**
 * What `value` at `segments` would add to `root` as the data model sets it: the new value,
 * and a slot for each container along the path that is not there yet (one value and the name
 * for an object key, the growth in length for an array index), less the value it replaces.
 * Anything the model would refuse is read as missing, which only over-charges.
 */
function dataGrowth(
  root: unknown,
  segments: readonly string[],
  value: unknown,
  limits: RetainedLimits,
): MessageSize | undefined {
  const written = contentOf(value, limits);
  if (!written) return undefined;
  let grown = written;
  let released = NONE;
  // `container` is what the next segment is looked up in; undefined once the path leaves what
  // exists, from where every container is new.
  let container: unknown =
    isRecord(root) || Array.isArray(root) ? root : undefined;
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    let child: unknown;
    let slot: MessageSize;
    if (Array.isArray(container) && isNumeric(segment)) {
      const at = Math.min(Number(segment), MAX_ARRAY_INDEX + 1);
      slot = { nodes: Math.max(0, at + 1 - container.length), bytes: 0 };
      child = at < container.length ? container[at] : undefined;
    } else if (isRecord(container)) {
      const bytes = nameBytes(segment, limits);
      if (bytes === undefined) return undefined;
      const present = hasOwn(container, segment);
      slot = present ? NONE : { nodes: 1, bytes };
      child = present ? container[segment] : undefined;
    } else {
      // Below a container the path creates: an array for a numeric segment, else an object.
      const bytes = nameBytes(segment, limits);
      if (bytes === undefined) return undefined;
      slot = isNumeric(segment)
        ? {
            nodes: Math.min(Number(segment), MAX_ARRAY_INDEX + 1) + 1,
            bytes: 0,
          }
        : { nodes: 1, bytes };
      child = undefined;
    }
    grown = add(grown, slot);
    if (last) {
      // The slot held a value, which this write replaces.
      if (child !== undefined) {
        const old = contentOf(child, limits);
        if (!old) return undefined;
        released = old;
      }
    } else {
      container = isRecord(child) || Array.isArray(child) ? child : undefined;
    }
  }
  return net(grown, released);
}

/** Surfaces and components by which a message in a batch has already changed state. */
interface Touched {
  /** Surfaces created or deleted by an earlier message of the batch. */
  readonly rebuilt: Set<string>;
  /** Surfaces whose data an earlier message of the batch wrote. */
  readonly data: Set<string>;
  /** `surface\0component` of a component an earlier message of the batch wrote. */
  readonly components: Set<string>;
}

/**
 * What `messages` would add to the retained state, or `undefined` when one of them is over the
 * limits by itself. Without `surfaces` it is an upper bound that reads no state. With them
 * it is the exact growth against that state, where a replaced value is credited only once and
 * only while nothing earlier in the batch has changed what it replaces; every later message
 * is charged in full. Either way it never under-counts, and deleting charges nothing.
 */
export function retainedGrowth<T extends ComponentApi>(
  messages: readonly ValidatedMessage[],
  limits: RetainedLimits,
  surfaces?: ReadonlyMap<string, SurfaceModel<T>>,
): MessageSize | undefined {
  const touched: Touched = {
    rebuilt: new Set(),
    data: new Set(),
    components: new Set(),
  };
  /** The surface as it stands now, unless an earlier message of the batch has rebuilt it. */
  const live = (surfaceId: string): SurfaceModel<T> | undefined =>
    touched.rebuilt.has(surfaceId) ? undefined : surfaces?.get(surfaceId);

  const growth: A2uiMessageVisitor<MessageSize | undefined> = {
    createSurface({ createSurface: message }) {
      touched.rebuilt.add(message.surfaceId);
      const theme = contentOf(message.theme, limits);
      const idBytes = nameBytes(message.surfaceId, limits);
      if (!theme || idBytes === undefined) return undefined;
      // The surface's id, data root, theme and metadata, and the theme's own content.
      return { nodes: 4 + theme.nodes, bytes: idBytes + theme.bytes };
    },
    deleteSurface({ deleteSurface: message }) {
      touched.rebuilt.add(message.surfaceId);
      return NONE;
    },
    updateComponents({ updateComponents: message }) {
      let total = NONE;
      for (const entry of message.components) {
        const { id, component, catalogId, metadata, ...properties } =
          entry as Record<string, unknown>;
        void catalogId;
        if (typeof id !== 'string') continue;
        const key = `${message.surfaceId}\0${id}`;
        const existing =
          surfaces && !touched.components.has(key)
            ? live(message.surfaceId)?.componentsModel.get(id)
            : undefined;
        touched.components.add(key);
        const type = typeof component === 'string' ? component : existing?.type;
        const written = measure(
          [id, type, properties, isRecord(metadata) ? metadata : undefined],
          limits,
        );
        if (!written) return undefined;
        const replaced = existing
          ? measure(
              [
                existing.id,
                existing.type,
                existing.properties,
                existing.metadata,
              ],
              limits,
            )
          : undefined;
        if (existing && !replaced) return undefined;
        total = add(total, replaced ? net(written, replaced) : written);
      }
      return total;
    },
    updateDataModel({ updateDataModel: message }) {
      const path = message.path || '/';
      const value: unknown = message.value;
      const surface =
        surfaces && !touched.data.has(message.surfaceId)
          ? live(message.surfaceId)
          : undefined;
      touched.data.add(message.surfaceId);
      // Writing nothing deletes (or does nothing), and what is deleted is released.
      if (value === undefined || value === null) return NONE;
      const segments = dataPathSegments(path);
      // The data model refuses the write, so nothing is kept.
      if (!segments) return NONE;
      if (!surface) {
        const written = contentOf(value, limits);
        return written && add(written, pathUpperBound(path));
      }
      const root: unknown = surface.dataModel.get('/');
      if (segments.length === 0) {
        // The value becomes the root, replacing it.
        const written = contentOf(value, limits);
        const replaced = contentOf(root, limits);
        return written && replaced && net(written, replaced);
      }
      return dataGrowth(root, segments, value, limits);
    },
  };

  let total = NONE;
  for (const message of messages) {
    const grown = message.accept(growth);
    if (!grown) return undefined;
    total = add(total, grown);
  }
  return total;
}
