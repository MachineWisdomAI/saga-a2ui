import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer, type AuthInfo, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import { registerProtectedOperation, valueOrThrow, viewUriForHtml, type RequestLifetime } from '@saga-a2ui/mcp/server';
import { z } from 'zod';
import {
  ARCHIVE_TOOL,
  ArchiveInputSchema,
  ArchiveOutputSchema,
  LIST_TOOL,
  NO_EFFECT_META,
  NotesOutputSchema,
  READ_ONLY,
  SESSION_TOOL,
  SessionOutputSchema,
  TEXT,
  WRITES,
} from '../src/notes-contract.js';

// The application's MCP delivery for the PACK1 notes view, composed from SAGA's server export and
// the MCP Apps server helper. Every protected request decides for itself who is asking, from the
// verified request context only: a prior check_session never authorizes archive_note, and no tool
// argument can name an account. The application owns the backend, the listener (none here: the
// caller connects a transport) and the built view it serves.

/** What the backend knows about a note. Only `id`, `title` and `body` may ever be published. */
export interface NoteRecord {
  readonly id: string;
  readonly ownerAccountId: string;
  readonly title: string;
  readonly body: string;
  /** Private fields: they exist so that a leak would be visible. They must never reach the wire. */
  readonly internalCostCenter: string;
  readonly privateMemo: string;
}

export interface NotesBackend {
  notesFor(accountId: string, signal: AbortSignal): Promise<readonly NoteRecord[]>;
  isSignedIn(accountId: string, signal: AbortSignal): Promise<boolean>;
  /** `undefined` when the account may not archive that note, whatever the reason. */
  archive(accountId: string, noteId: string, signal: AbortSignal): Promise<{ readonly archivedAt: number } | undefined>;
}

/** The built view is required before the server can claim to serve anything. */
export class ViewArtifactMissing extends Error {
  constructor() {
    super('The notes view has not been built: the server needs the built page and will not start without it.');
    this.name = 'ViewArtifactMissing';
  }
}

// The status line every notes page carries, whichever renderer built it.
const VIEW_MARKER = 'data-testid="view-status"';

function requireViewArtifact(html: unknown): string {
  if (typeof html !== 'string' || !html.includes(VIEW_MARKER)) throw new ViewArtifactMissing();
  return html;
}

const identityOf = (authInfo: AuthInfo | undefined): { readonly accountId: string } | undefined => {
  const accountId = authInfo?.extra?.accountId;
  return typeof accountId === 'string' && accountId !== '' ? { accountId } : undefined;
};

const failure = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

/** A failure the server knows changed nothing; the view may tell the person so. Any other failure leaves the outcome unknown. */
const refusal = (text: string): CallToolResult => ({ ...failure(text), _meta: { [NO_EFFECT_META]: true } });

export interface NotesServerOptions {
  /** The final document; its bytes name its resource. */
  readonly html: string;
  /** The actual built page filename, relative to the view directory. */
  readonly filename: string;
  readonly backend: NotesBackend;
  /**
   * The request this server was built for, started by the adapter at admission. With it, every
   * backend wait is a stage of that request: bounded by the operation limit and by what the request
   * has left, and never renewed. Without it the list operation runs under the SDK defaults and the
   * two application tools wait on the caller's cancellation alone.
   */
  readonly lifetime?: RequestLifetime;
}

/** Builds the MCP server for one built notes page. */
export function createNotesServer(options: NotesServerOptions): McpServer {
  const html = requireViewArtifact(options.html);
  const { backend, lifetime } = options;

  /**
   * Runs one backend call of an application tool inside the request's lifetime. A call that does not
   * finish in time throws its typed cause, which the tool answers as "unavailable" and never as a
   * refusal: ending the wait does not undo a call already started, and a late answer is dropped.
   */
  async function bounded<T>(ctx: ServerContext, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (lifetime === undefined) return work(ctx.mcpReq.signal);
    const result = await lifetime.run('storage', (scope) => work(scope.signal), { upstream: ctx.mcpReq.signal });
    // The lifetime recorded its own expiry, disconnect and completion; the rest are this stage's.
    if (!result.ok && result.cause.kind !== 'request-timeout' && result.cause.kind !== 'disconnected' && result.cause.kind !== 'completed') lifetime.record(result.cause);
    return valueOrThrow(result);
  }
  const view = { uri: viewUriForHtml(html, options.filename), title: 'Notes view', html, csp: CLOSED_VIEW_CSP };
  const server = new McpServer({ name: 'pack1-notes', version: '0.0.0' });

  registerProtectedOperation(
    server,
    {
      name: LIST_TOOL,
      title: 'Open my notes',
      description: 'Shows the signed-in account’s own notes, each with an Archive control.',
      annotations: READ_ONLY,
      input: z.strictObject({}),
      output: NotesOutputSchema,
      view,
      failures: { absent: TEXT.noNotes, unavailable: TEXT.unavailable, invalidOutput: TEXT.invalidOutput, signInRequired: TEXT.signInRequired },
      identity: identityOf,
      async handle(_input, identity, request) {
        return { kind: 'record', record: await backend.notesFor(identity.accountId, request.signal) };
      },
      // Each public field is copied by name: a record's other fields stay on the server.
      project: (records) => {
        const notes = records.map((note) => ({ id: note.id, title: note.title, body: note.body }));
        return { text: `${notes.length} notes`, data: { notes } };
      },
    },
    lifetime === undefined ? undefined : { lifetime },
  );

  registerAppTool(
    server,
    SESSION_TOOL,
    {
      title: 'Check the session',
      description: 'Tells the view whether the account is still signed in. It authorizes nothing.',
      inputSchema: z.strictObject({}),
      outputSchema: SessionOutputSchema,
      annotations: READ_ONLY,
      _meta: { ui: { resourceUri: view.uri, visibility: ['app'] } },
    },
    async (_args, ctx: ServerContext): Promise<CallToolResult> => {
      const identity = identityOf(ctx.http?.authInfo);
      if (!identity) return failure(TEXT.signInRequired);
      try {
        if (!(await bounded(ctx, (signal) => backend.isSignedIn(identity.accountId, signal)))) return failure(TEXT.signInRequired);
      } catch {
        return failure(TEXT.unavailable);
      }
      return { content: [{ type: 'text', text: 'signed in' }], structuredContent: { signedIn: true } };
    },
  );

  registerAppTool(
    server,
    ARCHIVE_TOOL,
    {
      title: 'Archive a note',
      description: 'Archives one of the signed-in account’s notes.',
      inputSchema: ArchiveInputSchema,
      outputSchema: ArchiveOutputSchema,
      annotations: WRITES,
      _meta: { ui: { resourceUri: view.uri, visibility: ['app'] } },
    },
    async ({ noteId }, ctx: ServerContext): Promise<CallToolResult> => {
      // Authorization is decided here, for this request, from the verified context alone.
      const identity = identityOf(ctx.http?.authInfo);
      if (!identity) return refusal(TEXT.signInRequired);
      try {
        const archived = await bounded(ctx, (signal) => backend.archive(identity.accountId, noteId, signal));
        // One sentence for an absent note, someone else's note and an archived one: nothing is disclosed.
        if (archived === undefined) return refusal(TEXT.cannotArchive);
        const output = ArchiveOutputSchema.parse({ noteId, archivedAt: archived.archivedAt });
        return { content: [{ type: 'text', text: 'archived' }], structuredContent: output };
      } catch {
        // An exception, a wait that ran out of time, or an output that failed validation after the
        // write: the archive may have been applied (or may still be), so this failure does not claim otherwise.
        return failure(TEXT.unavailable);
      }
    },
  );

  return server;
}
