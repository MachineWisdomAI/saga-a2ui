import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer, type AuthInfo, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import { registerProtectedOperation, viewUriForHtml } from '@saga-a2ui/mcp/server';
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

const VIEW_ROOT = '<notes-app';

function requireViewArtifact(html: unknown): string {
  if (typeof html !== 'string' || !html.includes(VIEW_ROOT)) throw new ViewArtifactMissing();
  return html;
}

const identityOf = (authInfo: AuthInfo | undefined): { readonly accountId: string } | undefined => {
  const accountId = authInfo?.extra?.accountId;
  return typeof accountId === 'string' && accountId !== '' ? { accountId } : undefined;
};

const failure = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

/** A failure the server knows changed nothing; the view may tell the person so. Any other failure leaves the outcome unknown. */
const refusal = (text: string): CallToolResult => ({ ...failure(text), _meta: { [NO_EFFECT_META]: true } });

/** Builds the MCP server for one built notes page. `html` is the final document; its bytes name its resource. */
export function createNotesServer(options: { readonly html: string; readonly backend: NotesBackend }): McpServer {
  const html = requireViewArtifact(options.html);
  const { backend } = options;
  const view = { uri: viewUriForHtml(html), title: 'Notes view', html, csp: CLOSED_VIEW_CSP };
  const server = new McpServer({ name: 'pack1-notes', version: '0.0.0' });

  registerProtectedOperation(server, {
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
  });

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
        if (!(await backend.isSignedIn(identity.accountId, ctx.mcpReq.signal))) return failure(TEXT.signInRequired);
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
        const archived = await backend.archive(identity.accountId, noteId, ctx.mcpReq.signal);
        // One sentence for an absent note, someone else's note and an archived one: nothing is disclosed.
        if (archived === undefined) return refusal(TEXT.cannotArchive);
        const output = ArchiveOutputSchema.parse({ noteId, archivedAt: archived.archivedAt });
        return { content: [{ type: 'text', text: 'archived' }], structuredContent: output };
      } catch {
        // An exception, or an output that failed validation after the write: the archive may have
        // been applied, so this failure does not claim otherwise.
        return failure(TEXT.unavailable);
      }
    },
  );

  return server;
}
