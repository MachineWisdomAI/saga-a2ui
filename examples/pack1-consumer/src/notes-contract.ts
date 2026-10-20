import { z } from 'zod';

// The wire contract of the PACK1 notes application, shared by its server and its views. Imports
// only `zod`, so a view bundle that includes it carries no server code. Application-owned: nothing
// here is a SAGA export.

/** The model-visible tool that opens the notes view with the signed-in account's own notes. */
export const LIST_TOOL = 'list_notes';
/** App-only: the view's asynchronous session prerequisite. It sends a request of its own. */
export const SESSION_TOOL = 'check_session';
/** App-only: the protected operation behind each row's Archive control. */
export const ARCHIVE_TOOL = 'archive_note';

/** The only fields of a note that ever leave the server. */
export const NoteSchema = z.strictObject({
  id: z.string().min(1).max(32),
  title: z.string().max(120),
  body: z.string().max(2_000),
});
export type PublicNote = z.infer<typeof NoteSchema>;

export const NotesOutputSchema = z.strictObject({ notes: z.array(NoteSchema).max(50) });
export const SessionOutputSchema = z.strictObject({ signedIn: z.literal(true) });
export const ArchiveInputSchema = z.strictObject({ noteId: z.string().min(1).max(32) });
export const ArchiveOutputSchema = z.strictObject({ noteId: z.string().min(1).max(32), archivedAt: z.number().int().nonnegative() });

/** Fixed sentences: a failure never repeats a backend message, a note identifier or a credential. */
export const TEXT = {
  signInRequired: 'Sign in to see your notes.',
  unavailable: 'Your notes are unavailable.',
  invalidOutput: 'Your notes could not be shown.',
  noNotes: 'There are no notes.',
  cannotArchive: 'This note cannot be archived.',
} as const;

/**
 * `_meta` key a server sets on an `isError` archive reply that it knows changed nothing (nobody
 * signed in, or the note cannot be archived by this account). A failure without it, such as a
 * backend exception or an output the server could not validate after the write, says nothing
 * about whether the archive was applied, so a view must treat it as an unknown outcome.
 */
export const NO_EFFECT_META = 'pack1/no-effect';

export const declaresNoEffect = (reply: { readonly isError?: boolean; readonly _meta?: Record<string, unknown> }): boolean =>
  reply.isError === true && reply._meta?.[NO_EFFECT_META] === true;

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
export const WRITES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
