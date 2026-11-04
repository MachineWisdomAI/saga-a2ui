import {
  ActionButtonEntry,
  Catalog,
  ColumnApi,
  CommonSchemas,
  createComponentImplementation,
  z,
  type ReactCatalogComponent,
} from '@saga-a2ui/react-mcp-stack';
import type { ReactNode } from 'react';
import { CATALOG_ID } from './surface.js';

// The application-owned catalog: the components its layout may name, and nothing else. `Line` is
// this application's own component; it shows supplied text as text, never as markup. `Column` is
// built over the stack's layout contract, and `ActionButton` is SAGA's opt-in control. Choosing a
// component is the application's decision: nothing here is registered globally by the SDK.

type ChildReference =
  string | { readonly id: string; readonly basePath: string };

// The view hands a child list over as tokens, or `{ id, basePath }` for a template item.
function childrenOf(
  buildChild: (id: string, basePath?: string) => ReactNode,
  value: unknown,
): ReactNode[] {
  const list = Array.isArray(value) ? (value as ChildReference[]) : [];
  return list.map((child) =>
    typeof child === 'string'
      ? buildChild(child)
      : buildChild(child.id, child.basePath),
  );
}

const LineApi = {
  name: 'Line',
  schema: z
    .object({
      text: CommonSchemas.DynamicString,
      kind: z.enum(['title', 'body']),
    })
    .strict(),
};

const Line: ReactCatalogComponent = createComponentImplementation(
  LineApi,
  ({ props }) => {
    const text = String(props.text ?? '');
    return props.kind === 'title' ? <h3>{text}</h3> : <span>{text}</span>;
  },
);

const Column: ReactCatalogComponent = createComponentImplementation(
  ColumnApi,
  ({ props, buildChild }) => (
    <div>{childrenOf(buildChild, props.children)}</div>
  ),
);

export const starterEntries: readonly ReactCatalogComponent[] = [
  Column,
  Line,
  ActionButtonEntry,
];

/** What the stack presents the layout over. */
export const starterCatalog = new Catalog<ReactCatalogComponent>(
  CATALOG_ID,
  'v0.9',
  [...starterEntries],
);
