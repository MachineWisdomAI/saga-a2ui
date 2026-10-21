import type { NoteRecord } from '../../../examples/pack1-consumer/server/notes-server.js';

// DEMO-OWNED synthetic notes: the business data of the notes example in the demonstration. It holds
// no server, credential or Node import, so the standalone demonstration (world.ts) and the static
// tour (demo/tour) read the very same records. Nothing here is an SDK export and none of it belongs
// in the clean starter (templates/lit-node).

/** Private fields a leak would make visible; they must never reach a wire or a page. */
export const PRIVATE_CANARY = 'DEMO-PRIVATE-FIELD-CANARY';

/** The two synthetic people whose notes exist. Each consumer supplies its own account identifiers. */
export interface NoteOwners {
  readonly alice: string;
  readonly bob: string;
}

export function syntheticNotes(owners: NoteOwners): NoteRecord[] {
  const note = (
    id: string,
    ownerAccountId: string,
    title: string,
    body: string,
  ): NoteRecord => ({
    id,
    ownerAccountId,
    title,
    body,
    internalCostCenter: `${PRIVATE_CANARY}-cost-${id}`,
    privateMemo: `${PRIVATE_CANARY}-memo-${id}`,
  });
  return [
    note('n-1', owners.alice, 'Alpha', 'Draft the first show notes.'),
    note('n-2', owners.alice, 'Beta', 'Book the guest for the second episode.'),
    note('n-3', owners.alice, 'Gamma', 'Check the audio levels.'),
    note('n-4', owners.bob, 'Delta', 'Bob’s note, never shown to Alice.'),
  ];
}
