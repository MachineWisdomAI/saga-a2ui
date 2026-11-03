import type { CallToolResult } from '@modelcontextprotocol/client';
import type { ServerTransport } from '@saga-a2ui/core/actions';
import { createNotesActions } from './notes-actions.js';
import { VIEW_TEXT, readNotesResult } from './notes-contract.js';
import { RowHolds } from './row-holds.js';
import { notesData, type NotesData } from './notes-surface.js';

// The part of the notes view that does not depend on the renderer: the page's status line and
// logs, the application's actions and their resource owner, the replacement of the notes a result
// carries and the status line of each row. The Lit view (notes-view.ts) and the React view
// (notes-react-view.tsx) each hand it the stack's bound surface, so both show, replace, refuse and
// retire notes by the same code. The stack connects to the host and runs the view's lifetime.

/** The stack's bound surface, as far as the controller needs it. */
export interface NotesSurface {
  /** Replaces the notes shown, in place. Does nothing once the view is gone. */
  update(data: NotesData): unknown;
}

export interface NotesController {
  /** The application's actions over the host's server transport, each defined once; the renderer binds them to its rendered rows. */
  actions(
    server: ServerTransport<CallToolResult>,
  ): ReturnType<typeof createNotesActions>;
  /** Writes the page's status line. */
  say(text: string): void;
  /** Shows one delivered result on `surface`, replacing the notes shown before it. */
  show(
    result: {
      readonly isError?: boolean;
      readonly structuredContent?: unknown;
    },
    surface: NotesSurface,
  ): void;
  /** The view ended: the status line says so. */
  retire(): void;
}

/** The page's own elements (`view-status`, `read-log`, `holds-pending`, `holds-confirmed`) are the same in every consumer's HTML. */
export function createNotesController(): NotesController {
  const text = (id: string): Element | null =>
    document.querySelector(`[data-testid="${id}"]`);
  const status = text('view-status');
  const readLog = text('read-log');
  const holdsPending = text('holds-pending');
  const holdsConfirmed = text('holds-confirmed');
  const say = (sentence: string): void =>
    void (status && (status.textContent = sentence));
  say(VIEW_TEXT.waiting);

  const read: string[] = [];
  const holds = new RowHolds((pending, confirmed) => {
    if (holdsPending) holdsPending.textContent = pending.join(',');
    if (holdsConfirmed) holdsConfirmed.textContent = confirmed.join(',');
  });

  // The notes shown, with each row's status line, and the surface they are shown on.
  let shown: NotesData['notes'] = [];
  let surface: NotesSurface | undefined;

  /** Writes one row's status line: the row at `dataPath` (`/notes/<index>`) keeps everything else it shows. */
  const present = (dataPath: string, line: string): void => {
    const index = /^\/notes\/(\d+)$/.exec(dataPath)?.[1];
    if (index === undefined || shown[Number(index)] === undefined) return;
    shown = shown.map((note, at) =>
      at === Number(index) ? { ...note, status: line } : note,
    );
    surface?.update({ notes: shown });
  };

  return {
    actions: (server) =>
      createNotesActions({
        holds,
        transport: server,
        present,
        recordRead: (noteId) => {
          read.push(noteId);
          if (readLog) readLog.textContent = read.join(',');
        },
      }),
    say,
    // Each result replaces the notes shown. An error or a result this contract does not accept shows
    // none of it (readNotesResult), and the next valid result shows its own notes again.
    show(result, target) {
      const delivered = readNotesResult(result);
      surface = target;
      shown = notesData(delivered.notes).notes;
      target.update({ notes: shown });
      say(delivered.status);
    },
    // The stack has retired the rendered surface before this runs, which disposed its bindings (local
    // actions, the optional card) and cancelled what was still undecided, so a retained button no
    // longer does anything.
    retire() {
      surface = undefined;
      say(VIEW_TEXT.closed);
    },
  };
}
