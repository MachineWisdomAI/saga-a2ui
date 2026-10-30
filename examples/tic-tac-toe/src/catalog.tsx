import {
  ActionButtonEntry,
  Catalog,
  ColumnApi,
  CommonSchemas,
  createComponentImplementation,
  ListApi,
  RowApi,
  SagaAttribution,
  z,
  type HostLinks,
  type ReactCatalogComponent,
} from '@saga-a2ui/react-mcp-stack';
import type { ReactNode } from 'react';
import { CATALOG_ID } from './surface.js';

// The application-owned catalog: the components its layout may name, and nothing else. Every
// component here is this application's own and shows supplied text as text, never as markup;
// `ActionButton` is SAGA's opt-in control. Nothing is registered globally by the SDK.

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
      kind: z.enum(['body', 'status']),
    })
    .strict(),
};

const Line: ReactCatalogComponent = createComponentImplementation(
  LineApi,
  ({ props }) => {
    const text = String(props.text ?? '');
    // The status element is present before it speaks, so a screen reader announces each change.
    return props.kind === 'status' ? (
      <p className="status" role="status">
        {text}
      </p>
    ) : (
      <span>{text}</span>
    );
  },
);

/** Native disclosure keeps the identifier available without crowding the board. */
const GameDetails: ReactCatalogComponent = createComponentImplementation(
  {
    name: 'GameDetails',
    schema: z.object({ gameId: CommonSchemas.DynamicString }).strict(),
  },
  ({ props }) => (
    <details>
      <summary>Show game ID</summary>
      <code>{String(props.gameId ?? '')}</code>
    </details>
  ),
);

const Column: ReactCatalogComponent = createComponentImplementation(
  ColumnApi,
  ({ props, buildChild }) => (
    <div className="column">{childrenOf(buildChild, props.children)}</div>
  ),
);

const Row: ReactCatalogComponent = createComponentImplementation(
  RowApi,
  ({ props, buildChild }) => (
    <div className="row">{childrenOf(buildChild, props.children)}</div>
  ),
);

/** The nine squares in a three-by-three grid. */
const Board: ReactCatalogComponent = createComponentImplementation(
  { ...ListApi, name: 'Board' },
  ({ props, buildChild }) => (
    <div className="board" role="group" aria-label="Tic-tac-toe board">
      {childrenOf(buildChild, props.children)}
    </div>
  ),
);

const SquareFaceApi = {
  name: 'SquareFace',
  schema: z
    .object({
      mark: CommonSchemas.DynamicString,
      label: CommonSchemas.DynamicString,
      winning: CommonSchemas.DynamicString,
    })
    .strict(),
};

/**
 * What goes inside a square's button: the mark for the eye, and the full name for assistive
 * technology ("Row 1, column 2, empty"), which becomes the button's accessible name.
 */
const SquareFace: ReactCatalogComponent = createComponentImplementation(
  SquareFaceApi,
  ({ props }) => (
    <span className={props.winning ? 'square winning' : 'square'}>
      <span aria-hidden="true">{String(props.mark ?? '')}</span>
      <span className="visually-hidden">{String(props.label ?? '')}</span>
    </span>
  ),
);

const ShownApi = {
  name: 'Shown',
  schema: z
    .object({
      when: CommonSchemas.DynamicString,
      child: CommonSchemas.ComponentId,
    })
    .strict(),
};

/** Shows its child only while `when` is not empty, so a control can be absent instead of disabled. */
const Shown: ReactCatalogComponent = createComponentImplementation(
  ShownApi,
  ({ props, buildChild }) =>
    String(props.when ?? '') !== '' && typeof props.child === 'string'
      ? buildChild(props.child)
      : null,
);

/**
 * The framework credit, placed once at the foot of the card so it shows while playing, after the
 * game ends and beside a recoverable error. The application supplies it with the host's way to
 * open a link; deleting this component and the layout's `credit` entry removes the credit.
 */
function createCredit(
  links: () => HostLinks | undefined,
): ReactCatalogComponent {
  return createComponentImplementation(
    { name: 'Credit', schema: z.object({}).strict() },
    () => (
      <footer className="credit">
        <SagaAttribution links={links()} />
      </footer>
    ),
  );
}

export const boardEntries: readonly ReactCatalogComponent[] = [
  Column,
  Row,
  Board,
  Line,
  SquareFace,
  Shown,
  GameDetails,
  ActionButtonEntry,
];

/**
 * The one function the layout calls: the squares' `checks` use it to disable a control. A catalog
 * holds only the functions its application declares, so this one is the application's own; it
 * is `required` from the A2UI basic catalog, written out: a value that is missing or empty fails.
 */
const required = {
  name: 'required',
  returnType: 'boolean',
  schema: z.object({ value: z.any() }).strict(),
  execute: (args: Record<string, unknown>): boolean =>
    args.value !== undefined && args.value !== null && args.value !== '',
};

/**
 * What the stack presents the layout over. `links` returns the host's way to open a link, which
 * the stack hands over when the view starts and before the first render.
 */
export function createBoardCatalog(
  links: () => HostLinks | undefined,
): Catalog<ReactCatalogComponent> {
  return new Catalog<ReactCatalogComponent>(
    CATALOG_ID,
    'v0.9',
    [...boardEntries, createCredit(links)],
    [required],
  );
}
