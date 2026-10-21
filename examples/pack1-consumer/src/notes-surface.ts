import type { PublicNote } from './notes-contract.js';

// The layout and the data messages of the notes surface. The layout gives the markup its IDs and
// its structure and nothing else: it names no action, no handler and no function. Which behavior a
// control has is decided by application code that binds an action to the rendered instance
// (notes-view.ts), never by a name in these messages.

export const CATALOG_ID = 'https://pack1.example/catalogs/notes/v1';
export const SURFACE_ID = 'notes';

/**
 * The layout entry that shows a note's body. The application's own `Line` is the default; a
 * consumer that installed the optional FaithfulCard passes an entry for it instead (main-card.ts),
 * so a build without the card contains no mention of it.
 */
export interface BodyEntry {
  readonly id: 'note-body';
  readonly component: string;
  readonly [property: string]: unknown;
}

export const ownBody: BodyEntry = {
  id: 'note-body',
  component: 'Line',
  kind: 'body',
  text: { path: 'body' },
};

export function notesSurface(body: BodyEntry): unknown[] {
  return [
    {
      version: 'v0.9',
      createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: SURFACE_ID,
        components: [
          {
            id: 'root',
            component: 'List',
            children: { componentId: 'note-row', path: '/notes' },
          },
          {
            id: 'note-row',
            component: 'Column',
            children: [
              'note-title',
              'note-body',
              'note-actions',
              'note-status',
            ],
          },
          {
            id: 'note-title',
            component: 'Line',
            kind: 'title',
            text: { path: 'title' },
          },
          body,
          {
            id: 'note-actions',
            component: 'Row',
            children: ['row-read', 'row-archive'],
          },
          {
            id: 'row-read',
            component: 'ActionButton',
            child: 'row-read-label',
          },
          {
            id: 'row-read-label',
            component: 'Line',
            kind: 'body',
            text: 'Mark read',
          },
          {
            id: 'row-archive',
            component: 'ActionButton',
            child: 'row-archive-label',
          },
          {
            id: 'row-archive-label',
            component: 'Line',
            kind: 'body',
            text: 'Archive',
          },
          {
            id: 'note-status',
            component: 'Line',
            kind: 'status',
            text: { path: 'status' },
          },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: { surfaceId: SURFACE_ID, value: { notes: [] } },
    },
  ];
}

/** Replaces the whole list. Every row starts with an empty status line. */
export const notesData = (notes: readonly PublicNote[]): unknown[] => [
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE_ID,
      value: { notes: notes.map((note) => ({ ...note, status: '' })) },
    },
  },
];

/** Writes one row's status line, in the data scope of the instance that was pressed. */
export const statusAt = (dataPath: string, text: string): unknown[] => [
  {
    version: 'v0.9',
    updateDataModel: {
      surfaceId: SURFACE_ID,
      path: `${dataPath}/status`,
      value: text,
    },
  },
];
