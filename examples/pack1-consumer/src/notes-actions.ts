import type { CallToolResult } from '@modelcontextprotocol/client';
import { Action, prerequisite, proceed, refuse, type ServerTransport } from '@saga-a2ui/core/actions';
import type { ActionButtonActivation } from '@saga-a2ui/lit/actions';
import { ARCHIVE_TOOL, ArchiveOutputSchema, SESSION_TOOL, declaresNoEffect } from './notes-contract.js';
import type { RowHolds } from './row-holds.js';

// The application's actions, each defined once. A definition holds no pending state, so the same
// one is bound to every rendered row; each binding keeps its own state. The application binds
// them to rendered instances (notes-view.ts); no markup names them.

export interface NotesEnvironment {
  /** The MCP Apps `App` itself, or a double with its shape. */
  readonly transport: ServerTransport<CallToolResult>;
  /** Writes one row's status line in the data scope of the instance at `dataPath`. */
  present(dataPath: string, text: string): void;
  /** The local action's whole effect: the page remembers which notes were marked read. */
  recordRead(noteId: string): void;
  /** The application's own owner of the holds that archives in flight take. */
  readonly holds: RowHolds;
}

class ArchiveDeclined extends Error {}

function requireNoteId(value: unknown): string {
  if (typeof value !== 'string' || value === '') throw new Error('this row shows no note');
  return value;
}

export function createNotesActions(environment: NotesEnvironment) {
  // An asynchronous session prerequisite. It sends a request of its own (`check_session`), which
  // the server counts apart from the protected `archive_note`, and it authorizes nothing: the
  // server decides again for every protected request.
  const requireSession = prerequisite('session', async ({ signal }) => {
    const reply = await environment.transport.callServerTool({ name: SESSION_TOOL, arguments: {} }, { signal });
    return reply.isError === true ? refuse('sign-in-required') : proceed({ signedIn: true as const });
  });

  /** The archive-note flow: one server action, reusable on every row. */
  const archiveNote = Action.server<ActionButtonActivation, CallToolResult>('archive-note', environment.transport)
    .input((event) => ({ noteId: requireNoteId(event.read('id')), at: event.dataPath }))
    // Inside the event turn: the application's hold on this row, owned by the invocation. The
    // scope gives it back when the invocation ends unless the success hook hands it over.
    .atActivation(({ scope, event }) => scope.own(environment.holds.begin(requireNoteId(event.read('id'))), (token) => environment.holds.end(token)))
    .before(requireSession)
    .run(async ({ params, call }) => {
      const reply = await call(ARCHIVE_TOOL, { noteId: params.noteId });
      // A returned tool-level failure is a result, not an exception. Only a refusal the server marked
      // as having no effect is a known outcome; any other failure (a backend exception, an output the
      // server could not validate after writing) may follow an applied archive, so it stays unknown.
      if (declaresNoEffect(reply)) throw new ArchiveDeclined('The server declined to archive the note');
      if (reply.isError === true) throw new Error('The archive request failed');
      return ArchiveOutputSchema.parse(reply.structuredContent);
    })
    .onSuccess(({ params, result, activation, current }) => {
      // The server confirmed: the hold now belongs to the application's owner for good.
      activation.transfer((token) => environment.holds.confirm(token));
      if (current()) environment.present(params.at, `Archived at ${result.archivedAt}`);
    })
    .onFailure((context) => {
      if (context.stage === 'input') return; // nothing was read from the event, so no row can be named
      if (!context.current()) return; // the row shows another note now, or is gone
      if (context.stage === 'prerequisites') {
        // The handler never started: no archive request was sent.
        const { failure } = context;
        environment.present(context.params.at, `Not archived: ${failure.kind === 'refused' ? failure.reason : failure.kind}`);
      } else if (context.failure.kind === 'handler-error' && context.failure.error instanceof ArchiveDeclined) {
        environment.present(context.params.at, 'The server declined; nothing changed');
      } else {
        // A timeout, a transport failure or an unreadable reply: the request may have been applied.
        environment.present(context.params.at, 'Archive status unknown');
      }
    })
    .onCanceled((context) => {
      if (!context.current()) return;
      environment.present(context.params.at, context.stage === 'prerequisites' ? 'Not archived: canceled' : 'Archive status unknown');
    })
    .build();

  /** A local action: no server request, no prerequisite. */
  const markRead = Action.local<ActionButtonActivation>('mark-read')
    .input((event) => ({ noteId: requireNoteId(event.read('id')) }))
    .run(({ params }) => environment.recordRead(params.noteId))
    .build();

  return { archiveNote, markRead };
}
