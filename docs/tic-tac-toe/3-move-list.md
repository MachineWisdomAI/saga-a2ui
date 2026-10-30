# Add a move list

The server already records every move, and the controller already turns that history into an array of `{ text }` entries. The board's data includes it at `/history`, but the layout does not display it yet. You can add the list entirely in the view.

## Render the history

In `src/catalog.tsx`, add a `MoveList` component using the same registration pattern as `Board`. It renders an ordered list around its children. Include it in `boardCatalog` so the layout can name it. The complete file below shows both additions in context.

In `src/surface.ts`, append `'history'` to the root's children. Add a `history` component that repeats a `move` child over `/history`. Then define `move` as a `Line` with `text: { path: 'text' }`. That relative path reads each history entry's text, just as a square reads its own mark.

The connection is now: the controller updates `history`, the layout repeats one row for each entry, and the React catalog renders those rows as a list. The server operations and click actions need no changes.

<details>
<summary>Complete src/catalog.tsx</summary>

```tsx file=src/catalog.tsx
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

/** The moves so far, one per line, in the order they were played. */
const MoveList: ReactCatalogComponent = createComponentImplementation(
  { ...ListApi, name: 'MoveList' },
  ({ props, buildChild }) => (
    <ol className="moves" aria-label="Moves so far" style={{ listStyle: 'none', padding: 0 }}>
      {childrenOf(buildChild, props.children).map((move, at) => (
        <li key={at}>{move}</li>
      ))}
    </ol>
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
function createCredit(links: () => HostLinks | undefined): ReactCatalogComponent {
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
  MoveList,
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
```

</details>

<details>
<summary>Complete src/surface.ts</summary>

```ts file=src/surface.ts
import { defineSurface, z } from '@saga-a2ui/react-mcp-stack';
import { VIEW_TEXT } from './text.js';

// The layout of the board: its data and its components. The layout gives the markup its IDs and its
// structure and nothing else: it names no action, no handler and no function. Which behavior a
// control has is decided by application code that attaches an action to the rendered instance
// (view.tsx), never by a name in this layout.

export const CATALOG_ID = 'https://saga-a2ui.dev/catalogs/tic-tac-toe/board/v1';

/** The IDs the application attaches actions to. */
export const SQUARE_ID = 'square';
export const NEW_GAME_ID = 'new-game';
export const CHECK_ID = 'check-move';

const SquareDataSchema = z.object({
  /** The square's number, 0 to 8, which the square action sends. */
  index: z.number(),
  /** What a screen reader says: "Row 1, column 2, empty". */
  label: z.string(),
  /** "X", "O" or empty. */
  mark: z.string(),
  /** Non-empty when the square can be played now; an empty string disables the control. */
  playable: z.string(),
  /** Non-empty for the three squares of a winning line. */
  winning: z.string(),
});

const BoardDataSchema = z.object({
  gameId: z.string(),
  /** The one status line: whose turn it is, how the game ended, or what to do next. */
  status: z.string(),
  squares: z.array(SquareDataSchema),
  /** Non-empty when "Check for the assistant's move" should be offered. */
  canCheck: z.string(),
  /** The moves so far, in words, one line each. */
  history: z.array(z.object({ text: z.string() })),
});

export const boardSurface = defineSurface({
  surfaceId: 'board',
  catalogId: CATALOG_ID,
  data: BoardDataSchema,
  initial: { gameId: '', status: '', squares: [], canCheck: '', history: [] },
  root: {
    component: 'Column',
    bind: {},
    props: {
      children: [
        'status',
        'send-hint',
        'board',
        'controls',
        'game-details',
        'history',
        'credit',
      ],
    },
  },
  components: [
    {
      id: 'send-hint',
      component: 'Line',
      kind: 'body',
      text: VIEW_TEXT.sendHint,
    },
    { id: 'credit', component: 'Credit' },
    {
      id: 'game-details',
      component: 'GameDetails',
      gameId: { path: '/gameId' },
    },
    {
      id: 'status',
      component: 'Line',
      kind: 'status',
      text: { path: '/status' },
    },
    {
      id: 'board',
      component: 'Board',
      children: { componentId: SQUARE_ID, path: '/squares' },
    },
    {
      id: SQUARE_ID,
      component: 'ActionButton',
      child: 'square-face',
      // A control whose check fails is disabled, so an occupied square, the assistant's turn and a
      // finished game all leave nothing to press.
      checks: [
        {
          condition: {
            call: 'required',
            args: { value: { path: 'playable' } },
          },
          message: 'This square cannot be played now.',
        },
      ],
    },
    {
      id: 'square-face',
      component: 'SquareFace',
      mark: { path: 'mark' },
      label: { path: 'label' },
      winning: { path: 'winning' },
    },
    {
      id: 'controls',
      component: 'Row',
      children: [NEW_GAME_ID, 'check-slot'],
    },
    { id: NEW_GAME_ID, component: 'ActionButton', child: 'new-game-label' },
    {
      id: 'new-game-label',
      component: 'Line',
      kind: 'body',
      text: 'New game',
    },
    {
      id: 'check-slot',
      component: 'Shown',
      when: { path: '/canCheck' },
      child: CHECK_ID,
    },
    {
      id: 'history',
      component: 'MoveList',
      children: { componentId: 'move', path: '/history' },
    },
    { id: 'move', component: 'Line', kind: 'body', text: { path: 'text' } },
    { id: CHECK_ID, component: 'ActionButton', child: 'check-label' },
    {
      id: 'check-label',
      component: 'Line',
      kind: 'body',
      text: "Check for the assistant's move",
    },
  ],
});

/** The data the surface shows: replaced whole by each update. */
export type BoardData = z.infer<typeof BoardDataSchema>;
```

</details>


## Check it in the host

Stop the server, run `npm run typecheck` and `npm run build`, then `npm start`. Refresh the host's tools and open a new game as described in [Add a move list](../build-tic-tac-toe-with-react.md#4-add-a-move-list).

After you click the centre square, the list should say **1. You: row 2, column 2**. O's reply adds the second entry; later moves append entries without losing earlier ones.

Move `'history'` before `'board'` in the root's children and rebuild. The list should appear above the grid without changing the catalog or controller. The layout controls where a component appears; the catalog controls how it renders.
