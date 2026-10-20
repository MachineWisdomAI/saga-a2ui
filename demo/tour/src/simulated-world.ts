import type { CallToolResult } from '@modelcontextprotocol/client';
import { createFixtureBackend, type FixtureBackend } from '../../../examples/pack1-consumer/server/fixture-backend.js';
import {
  ARCHIVE_TOOL,
  ArchiveInputSchema,
  ArchiveOutputSchema,
  LIST_TOOL,
  NO_EFFECT_META,
  NotesOutputSchema,
  SESSION_TOOL,
  TEXT,
} from '../../../examples/pack1-consumer/src/notes-contract.js';
import { syntheticNotes } from '../../lit-node/fixtures/notes.js';

// The tour's SIMULATED server. There is no backend behind the static tour: this module answers the
// three tool calls of the notes example from local, in-page state that the visitor changes with
// named controls. It decides nothing about real authentication or authorization, and a reply from
// it is not evidence that any server enforces anything.
//
// What it reuses, so the tour does not invent a second business: the demonstration's synthetic
// notes (demo/lit-node/fixtures/notes.ts), the notes example's synthetic in-memory backend
// (examples/pack1-consumer/server/fixture-backend.ts) and its wire contract (notes-contract.ts).
// What it replaces is only the part a server adds: reading "who is asking" from a verified request
// and turning a backend answer into a tool result. `scripts/tour.test.ts` runs the real
// `createNotesServer` over the same data and requires the same replies for every case below.

/** The simulated person chosen on the page. Choosing one authenticates nobody. */
export type Person = 'alice' | 'bob' | 'nobody';

export const PEOPLE: readonly { readonly id: Person; readonly label: string; readonly effect: string }[] = [
  { id: 'alice', label: 'Alice (simulated)', effect: 'A synthetic subscriber with three notes.' },
  { id: 'bob', label: 'Bob (simulated)', effect: 'A synthetic subscriber with one note. He never sees Alice’s notes.' },
  { id: 'nobody', label: 'No credential (simulated)', effect: 'A request that names nobody. The simulated server refuses it before asking its backend.' },
];

/** Changes a person makes to the synthetic business while a view is open. Each name is one button of the page. */
export const CONTROL_NAMES = [
  'end-notes-session',
  'restore-notes-session',
  'revoke-archive-permission',
  'restore-archive-permission',
  'hold-archives',
  'release-archives',
  'fail-after-write',
  'stop-failing-after-write',
  'reverse-list-order',
  'restore-list-order',
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];

export const isControlName = (value: unknown): value is ControlName => typeof value === 'string' && (CONTROL_NAMES as readonly string[]).includes(value);

export interface TourState {
  readonly person: Person;
  readonly notesSession: 'signed-in' | 'signed-out';
  readonly archivePermission: 'granted' | 'revoked';
  readonly archives: 'immediate' | 'held';
  /** `fails` makes the next archives apply and then fail to answer, so their outcome is unknown. */
  readonly afterWrite: 'answers' | 'fails';
  readonly listOrder: 'as-stored' | 'reversed';
  /** Archives that were actually applied, in order, whoever's they were. */
  readonly archived: readonly string[];
  /** Requests that reached the simulated backend; the session check is counted apart from the protected archive. */
  readonly backendCalls: { readonly sessionChecks: number; readonly archives: number };
  /** Archive requests the backend is holding open right now. */
  readonly waiting: number;
}

export interface TourWorld {
  /** Chooses who the simulated requests name from now on. A view that is already open keeps running; its next call names this person. */
  choose(person: Person): void;
  /** One tool call as the simulated server answers it for the chosen person. */
  callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  /** Applies one named change and returns the state afterwards. */
  control(name: ControlName): TourState;
  state(): TourState;
}

const ACCOUNTS = { alice: 'tour-account-alice', bob: 'tour-account-bob' } as const;

const failure = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });
/** A failure the simulated server knows changed nothing, as the real notes server marks it. */
const refusal = (text: string): CallToolResult => ({ ...failure(text), _meta: { [NO_EFFECT_META]: true } });

export function createTourWorld(): TourWorld {
  let person: Person = 'alice';
  let held = false;
  let failsAfterWrite = false;
  let reversed = false;
  const release: Array<() => void> = [];
  const backend: FixtureBackend = createFixtureBackend(
    {
      before: async (call) => {
        if (call === 'archive' && held) await new Promise<void>((resolve) => release.push(resolve));
      },
      afterArchive: () => {
        if (failsAfterWrite) throw new Error('the simulated backend failed after applying the archive');
      },
    },
    syntheticNotes(ACCOUNTS),
  );
  const signal = new AbortController().signal; // the simulated backend never abandons a call: ending the client's wait stops nothing here either
  const accountOf = (): string | undefined => (person === 'nobody' ? undefined : ACCOUNTS[person]);

  const state = (): TourState => ({
    person,
    notesSession: backend.signedOut.has(ACCOUNTS.alice) ? 'signed-out' : 'signed-in',
    archivePermission: backend.revoked.has(ACCOUNTS.alice) ? 'revoked' : 'granted',
    archives: held ? 'held' : 'immediate',
    afterWrite: failsAfterWrite ? 'fails' : 'answers',
    listOrder: reversed ? 'reversed' : 'as-stored',
    archived: [...backend.archived],
    backendCalls: { sessionChecks: backend.calls.isSignedIn, archives: backend.calls.archive },
    waiting: release.length,
  });

  async function list(accountId: string | undefined): Promise<CallToolResult> {
    if (accountId === undefined) return failure(TEXT.signInRequired);
    const records = await backend.notesFor(accountId, signal);
    // Each public field is copied by name: a record's other fields stay on the "server".
    const notes = records.map((note) => ({ id: note.id, title: note.title, body: note.body }));
    if (reversed) notes.reverse();
    return { content: [{ type: 'text', text: `${notes.length} notes` }], structuredContent: NotesOutputSchema.parse({ notes }) };
  }

  async function session(accountId: string | undefined): Promise<CallToolResult> {
    if (accountId === undefined) return failure(TEXT.signInRequired);
    if (!(await backend.isSignedIn(accountId, signal))) return failure(TEXT.signInRequired);
    return { content: [{ type: 'text', text: 'signed in' }], structuredContent: { signedIn: true } };
  }

  async function archive(accountId: string | undefined, args: Record<string, unknown>): Promise<CallToolResult> {
    const { noteId } = ArchiveInputSchema.parse(args); // a strict input: a forged account or a wrong type never reaches the backend
    // Decided for this request, from who is asking alone: a session check that said yes authorizes nothing.
    if (accountId === undefined) return refusal(TEXT.signInRequired);
    try {
      const archived = await backend.archive(accountId, noteId, signal);
      // One sentence for an absent note, someone else's note and an archived one: nothing is disclosed.
      if (archived === undefined) return refusal(TEXT.cannotArchive);
      return { content: [{ type: 'text', text: 'archived' }], structuredContent: ArchiveOutputSchema.parse({ noteId, archivedAt: archived.archivedAt }) };
    } catch {
      // A failure after the write: the archive was applied, and this answer does not claim otherwise.
      return failure(TEXT.unavailable);
    }
  }

  return {
    choose: (next) => void (person = next),
    state,
    async callTool(name, args) {
      switch (name) {
        case LIST_TOOL:
          return list(accountOf());
        case SESSION_TOOL:
          return session(accountOf());
        case ARCHIVE_TOOL:
          return archive(accountOf(), args);
        default:
          throw new Error(`the simulated server has no tool ${name}`);
      }
    },
    control(name) {
      switch (name) {
        case 'end-notes-session':
          backend.signedOut.add(ACCOUNTS.alice);
          break;
        case 'restore-notes-session':
          backend.signedOut.delete(ACCOUNTS.alice);
          break;
        case 'revoke-archive-permission':
          backend.revoked.add(ACCOUNTS.alice);
          break;
        case 'restore-archive-permission':
          backend.revoked.delete(ACCOUNTS.alice);
          break;
        case 'hold-archives':
          held = true;
          break;
        case 'release-archives':
          held = false;
          for (const go of release.splice(0)) go();
          break;
        case 'fail-after-write':
          failsAfterWrite = true;
          break;
        case 'stop-failing-after-write':
          failsAfterWrite = false;
          break;
        case 'reverse-list-order':
          reversed = true;
          break;
        case 'restore-list-order':
          reversed = false;
          break;
      }
      return state();
    },
  };
}
