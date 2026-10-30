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
