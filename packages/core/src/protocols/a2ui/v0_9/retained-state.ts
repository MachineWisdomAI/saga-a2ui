/**
 * What a session keeps, and what a batch of validated messages would add to it, in the units of
 * the retained budget (`measure` in `admission.ts`). Two answers are offered for a batch:
 *
 * - an upper bound that reads no session state, cheap enough for every call, and
 * - the growth against the state the session holds now, worked out message by message against
 *   the state the earlier messages of the batch would leave. It credits what a message replaces
 *   or deletes (a value at a path that is already there, a component that already exists) and
 *   charges only the containers it would newly create, so a batch is charged what the same
 *   messages sent one by one would be.
 *
 * The messages are validated, frozen copies the decoder made from an admitted snapshot, so
 * reading them costs no more than the input limits allowed. The state read here is the
 * session's own, never caller input. A value that is not plain data cannot be measured, so a
 * message that holds one has no growth at all and is refused.
 */
import {
  DataModel,
  type ComponentApi,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import {
  hasOwn,
  isPlainObject,
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

/** What one step of a batch adds to the state, and what it takes out of it. */
interface Change {
  readonly grow: MessageSize;
  readonly release: MessageSize;
  /**
   * The part of `grow` that is kept even if the step stops halfway: the containers a data write
   * creates before the model refuses it. A value replaces another in one assignment, so it is
   * never held beside the one it replaces.
   */
  readonly kept?: MessageSize;
}

const charge = (grow: MessageSize): Change => ({ grow, release: NONE });

/**
 * What `value` at `segments` would add to `root` as the data model sets it: the new value and a
 * slot for each container along the path that is not there yet (one value and the name for an
 * object key, the growth in length for an array index), and the value it replaces. Anything
 * the model would refuse is read as missing, which only over-charges.
 */
function dataChange(
  root: unknown,
  segments: readonly string[],
  value: unknown,
  limits: RetainedLimits,
): Change | undefined {
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
  return {
    grow: grown,
    release: released,
    kept: {
      nodes: grown.nodes - written.nodes,
      bytes: grown.bytes - written.bytes,
    },
  };
}

/**
 * What deleting the value at `segments` takes out of `root`, as the data model deletes it: the
 * value, and the key that held it in an object (an array keeps the slot, as a hole). A path
 * that is not there changes nothing.
 */
function deletionChange(
  root: unknown,
  segments: readonly string[],
  limits: RetainedLimits,
): Change | undefined {
  let container: unknown = root;
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    let child: unknown;
    let slot = NONE;
    if (Array.isArray(container)) {
      if (!isNumeric(segment) || Number(segment) >= container.length)
        return charge(NONE);
      child = container[Number(segment)];
    } else if (isRecord(container)) {
      if (!hasOwn(container, segment)) return charge(NONE);
      child = container[segment];
      const bytes = nameBytes(segment, limits);
      if (bytes === undefined) return charge(NONE);
      slot = { nodes: 1, bytes };
    } else {
      return charge(NONE);
    }
    if (last) {
      if (child === undefined) return charge(NONE);
      const old = contentOf(child, limits);
      return old && { grow: NONE, release: add(old, slot) };
    }
    container = child;
  }
  return charge(NONE);
}

/** A component as the session keeps it. */
interface StoredComponent {
  readonly id: unknown;
  readonly type: unknown;
  readonly properties: unknown;
  readonly metadata?: unknown;
}

/** The data model a write would find, replayed in the order of the batch. */
function replay(model: DataModel, path: string, value: unknown): void {
  try {
    // The processor gets its own copy of a message, and may change it in place later.
    model.set(path, value === null ? undefined : structuredClone(value));
  } catch {
    // The processor refuses this write; whatever it left behind, so does the replay.
  }
}

/**
 * What `messages` would add to the retained state, or `undefined` when one of them is over the
 * limits by itself or holds a value that is not plain data. The answer is the most the state
 * can hold above where it is now at any point of the batch.
 *
 * Without `surfaces` it is an upper bound that reads no state: nothing is credited. With them
 * the messages are taken in order against the state the earlier ones would leave, which the
 * replay keeps: the first write to a surface's data is read against the live data; from the
 * second one a copy of that data stands in for it, and the earlier writes are set on it with
 * the upstream data model. A value that is replaced or deleted is credited once, whatever else
 * the batch did to it. It never under-counts, and a surface that is deleted frees nothing.
 */
export function retainedGrowth<T extends ComponentApi>(
  messages: readonly ValidatedMessage[],
  limits: RetainedLimits,
  surfaces?: ReadonlyMap<string, SurfaceModel<T>>,
): MessageSize | undefined {
  // `running` is where the batch has taken the state, relative to now; `peak` the most that
  // it was at any point. Either may be reached, since a later message may fail upstream.
  let running = NONE;
  let peak = NONE;
  const record = ({ grow, release, kept = NONE }: Change): void => {
    running = {
      nodes: running.nodes + grow.nodes - release.nodes,
      bytes: running.bytes + grow.bytes - release.bytes,
    };
    // After the step, and after the part of it that stays if the step stops halfway.
    peak = {
      nodes: Math.max(
        peak.nodes,
        running.nodes,
        running.nodes - grow.nodes + release.nodes + kept.nodes,
      ),
      bytes: Math.max(
        peak.bytes,
        running.bytes,
        running.bytes - grow.bytes + release.bytes + kept.bytes,
      ),
    };
  };

  /** Surfaces this batch has created or deleted, which are no longer as they are now. */
  const status = new Map<string, 'created' | 'deleted'>();
  /** The data of a surface once a second write needs the state the first one leaves. */
  const drafts = new Map<string, DataModel>();
  /** Writes to a surface's live data that no draft has seen yet. */
  const unseen = new Map<string, { path: string; value: unknown }[]>();
  /** Components the batch wrote, which are what a later message of the batch finds. */
  const written = new Map<string, Map<string, StoredComponent>>();

  /** Whether the surface is there at this point of the batch. */
  const exists = (surfaceId: string): boolean => {
    const state = status.get(surfaceId);
    return state === undefined
      ? !!surfaces?.has(surfaceId)
      : state === 'created';
  };

  /** The root of the surface's data at this point of the batch. */
  const dataRoot = (surfaceId: string): { root: unknown } | undefined => {
    if (!surfaces || !exists(surfaceId)) return undefined;
    const pending = unseen.get(surfaceId);
    let draft = drafts.get(surfaceId);
    if (!draft && pending && pending.length > 0) {
      const live = surfaces.get(surfaceId)!;
      draft = new DataModel(
        structuredClone(live.dataModel.get('/')) as Record<string, unknown>,
      );
      for (const earlier of pending) replay(draft, earlier.path, earlier.value);
      drafts.set(surfaceId, draft);
      unseen.delete(surfaceId);
    }
    if (draft) return { root: draft.get('/') };
    return { root: surfaces.get(surfaceId)!.dataModel.get('/') };
  };

  /** Records that the write was made, for the writes after it. */
  const remember = (surfaceId: string, path: string, value: unknown): void => {
    if (!surfaces || !exists(surfaceId)) return;
    const draft = drafts.get(surfaceId);
    if (draft) replay(draft, path, value);
    else
      unseen.set(surfaceId, [
        ...(unseen.get(surfaceId) ?? []),
        { path, value },
      ]);
  };

  /** The component with this id at this point of the batch. */
  const find = (surfaceId: string, id: string): StoredComponent | undefined => {
    if (!surfaces || !exists(surfaceId)) return undefined;
    const earlier = written.get(surfaceId)?.get(id);
    if (earlier) return earlier;
    if (status.has(surfaceId)) return undefined;
    return surfaces.get(surfaceId)?.componentsModel.get(id);
  };

  const keep = (surfaceId: string, stored: StoredComponent): void => {
    if (!surfaces || !exists(surfaceId)) return;
    const components = written.get(surfaceId) ?? new Map();
    components.set(stored.id as string, stored);
    written.set(surfaceId, components);
  };

  const sizeOf = (component: StoredComponent): MessageSize | undefined =>
    measure(
      [component.id, component.type, component.properties, component.metadata],
      limits,
    );

  const growth: A2uiMessageVisitor<boolean> = {
    createSurface({ createSurface: message }) {
      const theme = contentOf(message.theme, limits);
      const idBytes = nameBytes(message.surfaceId, limits);
      if (!theme || idBytes === undefined) return false;
      // The surface's id, data root, theme and metadata, and the theme's own content.
      record(charge({ nodes: 4 + theme.nodes, bytes: idBytes + theme.bytes }));
      // The processor refuses a surface that is already there, and keeps the one it has.
      if (surfaces && !exists(message.surfaceId)) {
        status.set(message.surfaceId, 'created');
        drafts.set(message.surfaceId, new DataModel({}));
        unseen.delete(message.surfaceId);
        written.delete(message.surfaceId);
      }
      return true;
    },
    deleteSurface({ deleteSurface: message }) {
      // What a deleted surface held is not credited.
      if (surfaces && exists(message.surfaceId)) {
        status.set(message.surfaceId, 'deleted');
        drafts.delete(message.surfaceId);
        unseen.delete(message.surfaceId);
        written.delete(message.surfaceId);
      }
      return true;
    },
    updateComponents({ updateComponents: message }) {
      for (const entry of message.components) {
        if (
          typeof entry === 'object' &&
          entry !== null &&
          !isPlainObject(entry)
        )
          return false;
        const { id, component, catalogId, metadata, ...properties } =
          entry as Record<string, unknown>;
        void catalogId;
        if (typeof id !== 'string') continue;
        const existing = find(message.surfaceId, id);
        const stored: StoredComponent = {
          id,
          type: typeof component === 'string' ? component : existing?.type,
          properties,
          metadata: isRecord(metadata) ? metadata : undefined,
        };
        const size = sizeOf(stored);
        if (!size) return false;
        const replaced = existing && sizeOf(existing);
        if (existing && !replaced) return false;
        record({ grow: size, release: replaced ?? NONE });
        keep(message.surfaceId, stored);
      }
      return true;
    },
    updateDataModel({ updateDataModel: message }) {
      const path = message.path || '/';
      const value: unknown = message.value;
      const segments = dataPathSegments(path);
      // The data model refuses the write, so nothing is kept.
      if (!segments) return true;
      const deleting = value === undefined || value === null;
      const state = dataRoot(message.surfaceId);
      let change: Change | undefined;
      if (!state) {
        // Nothing to credit against: what the path can create, and no more.
        if (deleting) return true;
        const content = contentOf(value, limits);
        change = content && charge(add(content, pathUpperBound(path)));
      } else if (segments.length === 0) {
        // The value becomes the root, replacing it.
        const replaced = contentOf(state.root, limits);
        const content = deleting ? NONE : contentOf(value, limits);
        change = content && replaced && { grow: content, release: replaced };
      } else {
        change = deleting
          ? deletionChange(state.root, segments, limits)
          : dataChange(state.root, segments, value, limits);
      }
      if (!change) return false;
      record(change);
      remember(message.surfaceId, path, value);
      return true;
    },
  };

  for (const message of messages) if (!message.accept(growth)) return undefined;
  return peak;
}
