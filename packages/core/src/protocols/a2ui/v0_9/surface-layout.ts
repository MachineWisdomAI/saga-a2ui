import type { z } from '../zod3.js';
import { deepFreeze } from './deep-freeze.js';

/**
 * Surface authoring for A2UI v0.9: an application states a surface's data and its component
 * layout, and this module is the one place that writes the protocol's messages for it. Wire
 * names and the version literal stay here (see "Protocol input becomes a value object" in the
 * coding standards).
 *
 * Bounded on purpose: one root component over a flat data model, plus an explicit list of
 * further components passed through unchanged. It is not a binding engine, and it does not
 * validate component names or properties itself. Every generated message is meant to go
 * through `a2uiV0_9Decoder` and the upstream processor like any other input, which is where
 * catalog support is decided.
 */

/** The fixed id of a layout's root component, as the upstream renderer expects. */
const ROOT_ID = 'root';
const VERSION = 'v0.9';

/** One component of a layout as the wire format spells it; the catalog decides what it means. */
export interface ComponentDefinition {
  readonly id: string;
  readonly component: string;
  readonly [property: string]: unknown;
}

/** Why `update` refused data. `message` is plain text that is safe to display. */
export interface SurfaceUpdateFailure {
  readonly kind: 'invalid-data';
  readonly message: string;
}

/** Decoder input for one data update, or the reason no message was produced. */
export type UpdateInput =
  | { readonly ok: true; readonly messages: readonly unknown[] }
  | { readonly ok: false; readonly failure: SurfaceUpdateFailure };

/** A surface as an application defines it: identity, typed data and the messages that open it. */
export interface SurfaceLayout<TData> {
  readonly surfaceId: string;
  readonly catalogId: string;
  /** The data the surface opens with. */
  readonly initial: TData;
  /**
   * `createSurface`, `updateComponents` and the initial `updateDataModel`, as decoder input.
   * Deeply frozen, so one layout can open any number of sessions.
   */
  readonly opening: readonly unknown[];
  /**
   * The `updateDataModel` message that replaces the whole data model with `data`, as decoder
   * input. The data must satisfy the layout's schema exactly: an unknown field (at any depth) is
   * refused, never dropped, and no default is filled in and nothing is coerced.
   */
  update(data: TData): UpdateInput;
}

export interface SurfaceSpec<Schema extends z.ZodObject<z.ZodRawShape>> {
  readonly surfaceId: string;
  readonly catalogId: string;
  /** The flat data model: a Zod 3 object whose fields are the surface's data. */
  readonly data: Schema;
  readonly root: {
    readonly component: string;
    /** Root property name -> the data field it shows, as a path binding. */
    readonly bind: Readonly<
      Record<string, Extract<keyof z.infer<Schema>, string>>
    >;
    /** Root properties that are plain values rather than bindings. */
    readonly props?: Readonly<Record<string, unknown>>;
  };
  /** The other components, passed through exactly as written. Their ids must be distinct. */
  readonly components?: readonly ComponentDefinition[];
  readonly initial: z.infer<Schema>;
}

/** The text of every issue, each led by the field it is about (empty path means the whole value). */
function describeIssues(label: string, error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0
        ? `${label}.${issue.path.join('.')}: ${issue.message}`
        : `${label}: ${issue.message}`,
    )
    .join('; ');
}

/** The path of the first place where `parsed` differs from `given`, or undefined when equal. */
function firstChange(
  given: unknown,
  parsed: unknown,
  path: readonly (string | number)[],
): string | undefined {
  if (Object.is(given, parsed)) return undefined;
  const here = path.join('.');
  const bothArrays = Array.isArray(given) && Array.isArray(parsed);
  const bothRecords =
    !bothArrays &&
    typeof given === 'object' &&
    given !== null &&
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(given) &&
    !Array.isArray(parsed);
  if (!bothArrays && !bothRecords) return here;
  const keys = new Set([
    ...Object.keys(given as object),
    ...Object.keys(parsed as object),
  ]);
  for (const key of keys) {
    const before = (given as Record<string, unknown>)[key];
    const after = (parsed as Record<string, unknown>)[key];
    // An optional field given as `undefined` and one that is absent mean the same thing.
    if (before === undefined && after === undefined) continue;
    const changed = firstChange(before, after, [...path, key]);
    if (changed !== undefined) return changed;
  }
  return undefined;
}

/**
 * Checks `value` against the schema and requires that parsing leaves it exactly as given. Zod
 * strips unknown keys of nested objects, applies defaults and runs coercions and transforms; any
 * of those would change what the surface shows from what the caller passed, so each is refused,
 * naming the first changed field.
 */
function checkExact<Schema extends z.ZodObject<z.ZodRawShape>>(
  schema: Schema,
  label: string,
  value: unknown,
): { ok: true; data: z.infer<Schema> } | { ok: false; message: string } {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return { ok: false, message: describeIssues(label, parsed.error) };
  const changed = firstChange(value, parsed.data, [label]);
  if (changed !== undefined)
    return {
      ok: false,
      message: `${changed}: the schema would change this value (an unknown field dropped, a default applied or a conversion made); give exactly the data the schema describes.`,
    };
  return { ok: true, data: parsed.data };
}

/** A JSON Pointer to a top-level field (RFC 6901 escapes). */
const pointerTo = (field: string): string =>
  `/${field.replaceAll('~', '~0').replaceAll('/', '~1')}`;

function requireText(name: string, value: string, surfaceId: string): void {
  if (value.length === 0)
    throw new Error(`defineSurface(${surfaceId}): ${name} must not be empty.`);
}

/**
 * Defines a surface. Throws, naming the field, when the definition is inconsistent: an
 * `initial` that fails the schema, a binding to a field the schema does not have, a property
 * given both as a binding and as a value, or component ids that repeat or reuse the root's.
 * Whether the catalog supports the components is not decided here; opening the surface in a
 * session reports that.
 */
export function defineSurface<Schema extends z.ZodObject<z.ZodRawShape>>(
  spec: SurfaceSpec<Schema>,
): SurfaceLayout<z.infer<Schema>> {
  const { surfaceId, catalogId, root } = spec;
  requireText('surfaceId', surfaceId, surfaceId);
  requireText('catalogId', catalogId, surfaceId);
  requireText('root.component', root.component, surfaceId);

  // Strict: data with a field the schema lacks is refused, not silently dropped.
  const schema = spec.data.strict();
  const label = `defineSurface(${surfaceId})`;

  const fields = Object.keys(spec.data.shape);
  const props = root.props ?? {};
  for (const [property, field] of Object.entries(root.bind)) {
    if (!fields.includes(field))
      throw new Error(
        `${label}: root.bind.${property} names the field "${field}", which the data schema does not define.`,
      );
    if (property in props)
      throw new Error(
        `${label}: root property "${property}" is both bound and given a value.`,
      );
  }
  const reserved = ['id', 'component'];
  for (const property of [...Object.keys(root.bind), ...Object.keys(props)]) {
    if (reserved.includes(property))
      throw new Error(
        `${label}: root property "${property}" is set by the layout and cannot be supplied.`,
      );
  }
  const ids = new Set<string>([ROOT_ID]);
  for (const entry of spec.components ?? []) {
    if (ids.has(entry.id))
      throw new Error(
        `${label}: component id "${entry.id}" is repeated or reuses the root's id "${ROOT_ID}".`,
      );
    ids.add(entry.id);
  }

  const initial = checkExact(schema, 'initial', spec.initial);
  if (!initial.ok) throw new Error(`${label}: ${initial.message}`);
  const initialData: z.infer<Schema> = deepFreeze(
    structuredClone(initial.data),
  );

  const bindings = Object.fromEntries(
    Object.entries(root.bind).map(([property, field]) => [
      property,
      { path: pointerTo(field) },
    ]),
  );
  const rootComponent = {
    id: ROOT_ID,
    component: root.component,
    ...props,
    ...bindings,
  };

  const replaceData = (value: unknown): unknown => ({
    version: VERSION,
    updateDataModel: { surfaceId, value },
  });

  const opening = deepFreeze(
    structuredClone([
      { version: VERSION, createSurface: { surfaceId, catalogId } },
      {
        version: VERSION,
        updateComponents: {
          surfaceId,
          components: [rootComponent, ...(spec.components ?? [])],
        },
      },
      replaceData(initialData),
    ]),
  );

  return {
    surfaceId,
    catalogId,
    initial: initialData,
    opening,
    update(data) {
      const checked = checkExact(schema, 'data', data);
      if (!checked.ok)
        return {
          ok: false,
          failure: { kind: 'invalid-data', message: checked.message },
        };
      return {
        ok: true,
        messages: deepFreeze(structuredClone([replaceData(checked.data)])),
      };
    },
  };
}
