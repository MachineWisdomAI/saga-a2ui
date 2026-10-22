import {
  ActionButtonEntry,
  Catalog,
  ColumnApi,
  CommonSchemas,
  createComponentImplementation,
  ListApi,
  RowApi,
  z,
  type ReactCatalogComponent,
} from '@saga-a2ui/react-mcp-stack';
import type { ReactNode } from 'react';
import { LINE_KINDS } from './notes-line.js';
import { CATALOG_ID } from './notes-surface.js';

// The application-owned catalog of the React consumer. `@a2ui/react` 0.13.0 ships no basic
// catalog, so the layout components are built the way an application builds its own:
// `createComponentImplementation` over the upstream component contracts, the same ones the Lit
// catalog takes from upstream's basic catalog. `Line` has the roles it has in the Lit catalog
// (notes-line.ts) and renders the same elements; `ActionButton` is SAGA's opt-in control. Nothing
// else is in the catalog.

type ChildReference =
  string | { readonly id: string; readonly basePath: string };

// The generated view hands a child list over as tokens, or `{ id, basePath }` for a template item.
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
    .object({ text: CommonSchemas.DynamicString, kind: z.enum(LINE_KINDS) })
    .strict(),
};

const Line = createComponentImplementation(LineApi, ({ props }) => {
  const text = String(props.text ?? '');
  switch (props.kind) {
    case 'title':
      return <h3 data-testid="line-title">{text}</h3>;
    case 'body':
      return <p data-testid="line-body">{text}</p>;
    case 'status':
      // Present before it speaks, so a screen reader announces the first message.
      return (
        <p role="status" data-testid="line-status">
          {text}
        </p>
      );
  }
});

const Column = createComponentImplementation(
  ColumnApi,
  ({ props, buildChild }) => (
    <div>{childrenOf(buildChild, props.children)}</div>
  ),
);
const Row = createComponentImplementation(RowApi, ({ props, buildChild }) => (
  <div>{childrenOf(buildChild, props.children)}</div>
));
const List = createComponentImplementation(ListApi, ({ props, buildChild }) => (
  <div>{childrenOf(buildChild, props.children)}</div>
));

export const notesReactEntries: readonly ReactCatalogComponent[] = [
  Column,
  Row,
  List,
  Line,
  ActionButtonEntry,
];

/** The catalog the React stack presents the layout over. */
export const notesReactCatalog = new Catalog<ReactCatalogComponent>(
  CATALOG_ID,
  'v0.9',
  [...notesReactEntries],
);
