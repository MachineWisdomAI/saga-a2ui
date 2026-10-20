import {
  Action,
  prerequisite,
  proceed,
  refuse,
  type InstanceEvent,
  type NoValues,
  type Prerequisite,
  type ServerReply,
  type ServerTransport,
} from '@saga-a2ui/core/actions';

// The second and third reusable prerequisites the guide (docs/actions.md) teaches, written the way
// an application writes them and qualified by scripts/guide-actions.test.ts. It is guide
// qualification source, not part of the notes example, an SDK export or a recommended API: every
// name here belongs to the application. The test bundles this file with the notes example against
// the installed packages, so the snippets below are the text that was run.

/** What the application provides: its own confirmation, its own durable audit and its own owner of an audit entry. */
export interface GuardEnvironment {
  /** Asks the person. `false` when they decline. The signal ends the question when the press is obsolete. */
  confirm(noteId: string, signal: AbortSignal): Promise<boolean>;
  /** Writes one durable audit entry and returns its identifier. Rejects when it cannot be written. */
  record(entry: { readonly noteId: string; readonly at: string }, signal: AbortSignal): Promise<string>;
  /** The application's own owner finishes the entry once the outcome is known. */
  settle(auditId: string, result: 'archived' | 'unknown'): void;
}

interface Pressed {
  readonly noteId: string;
  readonly at: string;
}

// #region guide-snippet:confirm-prerequisite
/** Cross-cutting requirement: the person confirms. A refusal means the handler never starts. */
export const confirmArchive = (environment: GuardEnvironment): Prerequisite<NoValues, unknown, Pressed> =>
  prerequisite('confirm', async ({ params, signal }) => ((await environment.confirm(params.noteId, signal)) ? proceed() : refuse('not-confirmed')));
// #endregion guide-snippet:confirm-prerequisite

// #region guide-snippet:audit-prerequisite
/** Cross-cutting requirement: a durable audit entry exists before the protected request is sent. */
export const auditArchive = (environment: GuardEnvironment): Prerequisite<{ readonly auditId: string }, unknown, Pressed> =>
  prerequisite('audit', async ({ params, signal }) => {
    try {
      return proceed({ auditId: await environment.record(params, signal) });
    } catch {
      return refuse('audit-unavailable'); // no audit entry, no protected request
    }
  });
// #endregion guide-snippet:audit-prerequisite

export interface GuardedArchiveOptions<Reply extends ServerReply> {
  readonly transport: ServerTransport<Reply>;
  /** The notes example's session prerequisite (`createSessionPrerequisite`), reused as it is. */
  readonly requireSession: Prerequisite<{ readonly signedIn: true }, unknown, unknown>;
  readonly environment: GuardEnvironment;
  /**
   * The application's own validation of the archive acknowledgement: it returns the validated output
   * or throws. The notes example parses `structuredContent` with its `ArchiveOutputSchema`; a reply
   * that is merely not an error acknowledges nothing.
   */
  readonly parseArchived: (reply: Reply) => unknown;
}

// #region guide-snippet:guarded-archive
export function createGuardedArchive<Reply extends ServerReply>({ transport, requireSession, environment, parseArchived }: GuardedArchiveOptions<Reply>) {
  return Action.server<InstanceEvent<unknown>, Reply>('archive-note-guarded', transport)
    .input((event) => ({ noteId: String(event.read('id')), at: event.dataPath }))
    .before(requireSession) // 1. a valid session (its own request, counted apart)
    .before(confirmArchive(environment)) // 2. the person confirms
    .before(auditArchive(environment)) // 3. the audit entry exists
    .run(async ({ params, call }) => {
      const reply = await call('archive_note', { noteId: params.noteId });
      if (reply.isError === true) throw new Error('The archive request failed');
      return parseArchived(reply); // a reply is not an acknowledgement until the application has validated it
    })
    .onSuccess(({ provided }) => environment.settle(provided.auditId, 'archived'))
    .onFailure((context) => {
      // Only a failure of the handler can have followed a write (an unreadable acknowledgement
      // included); earlier stages sent nothing protected.
      if (context.stage === 'running') environment.settle(context.provided.auditId, 'unknown');
    })
    .onCanceled((context) => {
      if (context.stage !== 'prerequisites') environment.settle(context.provided.auditId, 'unknown');
    })
    .build();
}
// #endregion guide-snippet:guarded-archive
