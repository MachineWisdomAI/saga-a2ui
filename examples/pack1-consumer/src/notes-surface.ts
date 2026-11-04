import { defineSurface } from '@saga-a2ui/core/protocols/a2ui/v0_9';
import { z } from '@saga-a2ui/core/protocols/a2ui/zod3';
import type { PublicNote } from './notes-contract.js';

// The layout and the data of the notes surface. The layout gives the markup its IDs and its
// structure and nothing else: it names no action, no handler and no function. Which behavior a
// control has is decided by application code that binds an action to the rendered instance
// (notes-view.ts), never by a name in this layout.

export const CATALOG_ID = 'https://pack1.example/catalogs/notes/v1';

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

/** The data the surface shows: the notes, each with its own status line. */
const NotesDataSchema = z.object({
  notes: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      body: z.string(),
      status: z.string(),
    }),
  ),
});
export type NotesData = z.infer<typeof NotesDataSchema>;

/** Every row starts with an empty status line. */
export const notesData = (notes: readonly PublicNote[]): NotesData => ({
  notes: notes.map((note) => ({ ...note, status: '' })),
});

export function notesLayout(body: BodyEntry) {
  return defineSurface({
    surfaceId: 'notes',
    catalogId: CATALOG_ID,
    data: NotesDataSchema,
    initial: { notes: [] },
    root: {
      component: 'List',
      bind: {},
      props: { children: { componentId: 'note-row', path: '/notes' } },
    },
    components: [
      {
        id: 'note-row',
        component: 'Column',
        children: ['note-title', 'note-body', 'note-actions', 'note-status'],
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
  });
}
