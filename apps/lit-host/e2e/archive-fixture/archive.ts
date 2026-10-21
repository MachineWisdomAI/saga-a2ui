import type { CallToolResult } from '@modelcontextprotocol/client';
import {
  Action,
  prerequisite,
  proceed,
  refuse,
  type ActionDefinition,
  type PrerequisiteContext,
  type ServerTransport,
} from '@saga-a2ui/core/actions';

// The Blueprint's non-playback Archive workflow, written once as a function of one projection of
// the renderer's event. Test-only application code: the session, confirmation and audit checks, the
// durable record and the presentation are supplied by the page or the test, and the transport is
// the MCP Apps `App` itself (or a double with its shape). Nothing here is a SAGA export.

/** A returned tool-level failure that this example's tool documents as "nothing changed". */
export class ArchiveRejected extends Error {}
/** The server answered, but the client cannot say what the answer was. */
export class ArchiveReplyUnreadable extends Error {}

/** What the application's presentation can say. Each is what the outcome establishes, no more. */
export type ArchiveMessage =
  /** No archive request was sent. A prerequisite's own request may have been. */
  | { readonly kind: 'not-sent'; readonly why: string; readonly retry: true }
  | { readonly kind: 'archived'; readonly archivedAt: number }
  /** The server effect completed; only the client's required work failed or was abandoned. */
  | { readonly kind: 'archived-view-failed'; readonly archivedAt: number }
  /** This tool's contract: a returned tool-level failure changed nothing. */
  | { readonly kind: 'declined'; readonly retry: true }
  /** The request may have been applied. Never invites a retry. */
  | { readonly kind: 'status-unknown'; readonly retry: false };

/** The environment the page or test supplies. Every member is the application's, not SAGA's. */
export interface ArchiveEnvironment {
  readonly transport: ServerTransport<CallToolResult>;
  /** A client-side session check; the server authorizes every request on its own. */
  session(
    signal: AbortSignal,
  ): Promise<{ readonly userKey: string } | undefined>;
  confirm(
    userKey: string,
    noteId: string,
    signal: AbortSignal,
  ): Promise<boolean>;
  /** Durable audit that must exist before the request may be sent. */
  audit(noteId: string, signal: AbortSignal): Promise<boolean>;
  /** Required client work after the server effect. */
  recordArchived(
    noteId: string,
    archivedAt: number,
    signal: AbortSignal,
  ): Promise<void>;
  refreshList(signal: AbortSignal): Promise<void>;
  /** The one synchronous presentation write for the note the instance showed, when the event named one. */
  show(noteId: string | undefined, message: ArchiveMessage): void;
}

export function requireNoteId(value: unknown): string {
  if (typeof value !== 'string' || value === '')
    throw new Error('this row shows no note');
  return value;
}

function parseArchived(reply: CallToolResult): { readonly archivedAt: number } {
  const archivedAt = (
    reply.structuredContent as { archivedAt?: unknown } | undefined
  )?.archivedAt;
  if (typeof archivedAt !== 'number')
    throw new ArchiveReplyUnreadable('the archive reply has no archivedAt');
  return { archivedAt };
}

/** Reusable on a local action as well as on this server action. */
export const requireSession = (
  environment: Pick<ArchiveEnvironment, 'session'>,
) =>
  prerequisite('session', async ({ signal }) => {
    const session = await environment.session(signal);
    return session === undefined
      ? refuse('sign-in-required')
      : proceed({ session });
  });

export const confirmArchive = (
  environment: Pick<ArchiveEnvironment, 'confirm'>,
) =>
  prerequisite(
    'confirm-archive',
    async ({
      provided,
      params,
      signal,
    }: PrerequisiteContext<
      { readonly session: { readonly userKey: string } },
      { readonly noteId: string }
    >) =>
      (await environment.confirm(
        provided.session.userKey,
        params.noteId,
        signal,
      ))
        ? proceed({ confirmed: true as const })
        : refuse('declined'),
  );

export const auditIntent = (environment: Pick<ArchiveEnvironment, 'audit'>) =>
  prerequisite<Record<never, never>, unknown, { readonly noteId: string }>(
    'audit-intent',
    async ({ params, signal }) =>
      (await environment.audit(params.noteId, signal))
        ? proceed()
        : refuse('audit-unavailable'),
  );

/**
 * `noteIdOf` is the only renderer-specific part: it reads and validates the note identifier from
 * that renderer's event. The adapter copied the underlying value from the exact rendered
 * instance when it admitted the event, so repeated component ids cannot select the data.
 */
export function archiveNoteWith<Event>(
  noteIdOf: (event: Event) => string,
  environment: ArchiveEnvironment,
): ActionDefinition<Event> {
  return Action.server<Event, CallToolResult>(
    'archive-note',
    environment.transport,
  )
    .input((event) => ({ noteId: noteIdOf(event) }))
    .before(requireSession(environment))
    .before(confirmArchive(environment))
    .before(auditIntent(environment))
    .run(async ({ params, call }) => {
      const reply = await call('archive_note', { noteId: params.noteId });
      // A returned tool-level failure is a result, not an exception. This example's tool sets
      // isError only when it changed nothing; that is the tool's contract, not MCP's.
      if (reply.isError === true)
        throw new ArchiveRejected('The server declined to archive the note');
      return parseArchived(reply);
    })
    .onSuccess(async ({ params, result, signal, current }) => {
      await environment.recordArchived(
        params.noteId,
        result.archivedAt,
        signal,
      );
      if (current())
        environment.show(params.noteId, {
          kind: 'archived',
          archivedAt: result.archivedAt,
        });
    })
    .onFailure(async (context) => {
      if (context.stage === 'input') {
        // Nothing was read from the event, so no note can be named.
        if (context.current())
          environment.show(undefined, {
            kind: 'not-sent',
            why: context.failure.kind,
            retry: true,
          });
        return;
      }
      if (context.stage === 'prerequisites') {
        // The handler never started, so no archive request was sent. A prerequisite's own request may have been.
        const { failure } = context;
        const why =
          failure.kind === 'refused'
            ? `${failure.prerequisite}: ${failure.reason}`
            : failure.kind;
        if (context.current())
          environment.show(context.params.noteId, {
            kind: 'not-sent',
            why,
            retry: true,
          });
        return;
      }
      const { failure, params } = context;
      if (
        failure.kind === 'success-hook-error' ||
        failure.kind === 'success-hook-timeout'
      ) {
        // The handler returned, so the server effect completed; only client work failed.
        await environment.refreshList(context.signal);
        if (context.current())
          environment.show(params.noteId, {
            kind: 'archived-view-failed',
            archivedAt: failure.result.archivedAt,
          });
        return;
      }
      if (
        failure.kind === 'handler-error' &&
        failure.error instanceof ArchiveRejected
      ) {
        if (context.current())
          environment.show(params.noteId, { kind: 'declined', retry: true });
        return;
      }
      // Timeout, transport failure or an unreadable reply: the request may have been applied.
      if (context.current())
        environment.show(params.noteId, {
          kind: 'status-unknown',
          retry: false,
        });
    })
    .onCanceled((context) => {
      // Aborting ends the client's wait. It does not show the host forwarded it or that the server stopped.
      const { noteId } = context.params;
      if (context.stage === 'prerequisites')
        environment.show(noteId, {
          kind: 'not-sent',
          why: `canceled: ${context.cause}`,
          retry: true,
        });
      else if (context.stage === 'completing')
        environment.show(noteId, {
          kind: 'archived-view-failed',
          archivedAt: context.result.archivedAt,
        });
      else environment.show(noteId, { kind: 'status-unknown', retry: false });
    })
    .build();
}
