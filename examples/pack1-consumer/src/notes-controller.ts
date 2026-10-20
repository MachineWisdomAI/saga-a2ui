import { PostMessageTransport, type App } from '@modelcontextprotocol/ext-apps';
import { connectToolResultView } from '@saga-a2ui/mcp/view';
import { createNotesActions } from './notes-actions.js';
import { VIEW_TEXT, readNotesResult } from './notes-contract.js';
import { RowHolds } from './row-holds.js';
import { notesData, statusAt } from './notes-surface.js';

// The part of the notes view that does not depend on the renderer: the page's status line and
// logs, the application's actions and their resource owner, the replacement of the notes a result
// carries, and the one way the view ends. The Lit view (notes-view.ts) and the React view
// (notes-react-view.tsx) each supply only the rendered surface, so both show, replace, refuse and
// retire notes by the same code.

/** The rendered surface a renderer exposes to the controller. */
export interface NotesSurface {
  /** Applies A2UI messages to the surface. Does nothing once the surface is gone. */
  ingest(messages: unknown[]): void;
  /** Ends the rendered surface. Disposing the surface disposes its bindings and cancels what is undecided. */
  remove(): void;
}

export interface NotesController {
  /** The application's actions, each defined once; the renderer binds them to its rendered rows. */
  readonly actions: ReturnType<typeof createNotesActions>;
  /** Writes the page's status line. */
  say(text: string): void;
  /** Connects to the host; results, teardown and the page going away are handled from then on. */
  connect(): Promise<void>;
}

/** The page's own elements (`view-status`, `read-log`, `holds-pending`, `holds-confirmed`) are the same in every consumer's HTML. */
export function createNotesController(app: App, surface: NotesSurface): NotesController {
  const text = (id: string): Element | null => document.querySelector(`[data-testid="${id}"]`);
  const status = text('view-status');
  const readLog = text('read-log');
  const holdsPending = text('holds-pending');
  const holdsConfirmed = text('holds-confirmed');
  const say = (sentence: string): void => void (status && (status.textContent = sentence));
  say(VIEW_TEXT.waiting);

  const read: string[] = [];
  const holds = new RowHolds((pending, confirmed) => {
    if (holdsPending) holdsPending.textContent = pending.join(',');
    if (holdsConfirmed) holdsConfirmed.textContent = confirmed.join(',');
  });
  const actions = createNotesActions({
    holds,
    transport: app,
    present: (dataPath, line) => surface.ingest(statusAt(dataPath, line)),
    recordRead: (noteId) => {
      read.push(noteId);
      if (readLog) readLog.textContent = read.join(',');
    },
  });

  // Each result replaces the notes shown. An error or a result this contract does not accept shows
  // none of it (readNotesResult), and the next valid result shows its own notes again.
  const show = (result: { readonly isError?: boolean; readonly structuredContent?: unknown }): void => {
    const shown = readNotesResult(result);
    surface.ingest(notesData(shown.notes));
    say(shown.status);
  };

  // The application's one way to end its view, for a host teardown and for the page going away
  // alike. Removing the surface disposes its bindings (local actions, the optional card) and
  // cancels what is still undecided, so a retained button no longer does anything. Idempotent.
  let retired = false;
  const retire = (): void => {
    if (retired) return;
    retired = true;
    surface.remove();
    say(VIEW_TEXT.closed);
  };

  return {
    actions,
    say,
    async connect() {
      const connection = await connectToolResultView({
        app,
        transport: new PostMessageTransport(window.parent, window.parent),
        onToolResult: show,
        // The host is closing this view; it ends the connection itself once it has the answer.
        onTeardown: retire,
      });
      // The page is going away: end the application's bindings first, then the connection.
      addEventListener('pagehide', () => {
        retire();
        connection.dispose();
      });
    },
  };
}
