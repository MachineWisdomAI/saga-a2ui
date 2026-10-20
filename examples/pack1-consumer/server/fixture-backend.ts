import type { NoteRecord, NotesBackend } from './notes-server.js';

// A synthetic in-memory backend for the PACK1 consumers. It is test scaffolding the consumer
// ships so that two installs can be compared on identical data: no real account, credential or
// service is involved. `hooks` let a test decide when each backend call answers.

export const CANARY = 'PRIVATE-FIELD-CANARY';

export interface BackendHooks {
  /** Awaited at the start of each backend call; a test holds a call open by returning a pending promise. */
  before?(call: 'notesFor' | 'isSignedIn' | 'archive', accountId: string, noteId?: string): Promise<void> | void;
}

export interface FixtureBackend extends NotesBackend {
  /** Calls that reached the backend, by kind: prerequisite requests are counted apart from the protected operation. */
  readonly calls: { notesFor: number; isSignedIn: number; archive: number };
  /** Archives that were actually applied. */
  readonly archived: string[];
  /** Accounts the session check treats as signed out. */
  readonly signedOut: Set<string>;
  /** Accounts whose archive permission was withdrawn after they signed in. */
  readonly revoked: Set<string>;
}

export const alice = 'acct-alice';
export const bob = 'acct-bob';

export function fixtureNotes(): NoteRecord[] {
  const note = (id: string, ownerAccountId: string, title: string, body: string): NoteRecord => ({
    id,
    ownerAccountId,
    title,
    body,
    internalCostCenter: `${CANARY}-cost-${id}`,
    privateMemo: `${CANARY}-memo-${id}`,
  });
  return [
    note('n-1', alice, 'Alpha', 'First **note** with a [link](https://docs.example.com/alpha).'),
    note('n-2', alice, 'Beta', 'Second note\n\n![tracker](https://tracker.example.com/pixel.png)'),
    note('n-3', bob, 'Gamma', 'Bob’s note, never shown to Alice.'),
  ];
}

export function createFixtureBackend(hooks: BackendHooks = {}, records: readonly NoteRecord[] = fixtureNotes()): FixtureBackend {
  const calls = { notesFor: 0, isSignedIn: 0, archive: 0 };
  const archived: string[] = [];
  const signedOut = new Set<string>();
  const revoked = new Set<string>();
  const done = new Set<string>();
  return {
    calls,
    archived,
    signedOut,
    revoked,
    async notesFor(accountId) {
      calls.notesFor += 1;
      await hooks.before?.('notesFor', accountId);
      return records.filter((note) => note.ownerAccountId === accountId && !done.has(note.id));
    },
    async isSignedIn(accountId) {
      calls.isSignedIn += 1;
      await hooks.before?.('isSignedIn', accountId);
      return !signedOut.has(accountId);
    },
    async archive(accountId, noteId) {
      calls.archive += 1;
      await hooks.before?.('archive', accountId, noteId);
      const note = records.find((one) => one.id === noteId);
      if (!note || note.ownerAccountId !== accountId || revoked.has(accountId) || done.has(noteId)) return undefined;
      done.add(noteId);
      archived.push(noteId);
      return { archivedAt: 1_000 + archived.length };
    },
  };
}
