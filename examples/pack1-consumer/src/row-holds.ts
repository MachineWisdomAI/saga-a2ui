// An application-owned resource owner, the kind a longer-lived part of an application keeps: one
// token per archive in flight. The action's invocation scope owns a token while the invocation is
// undecided and gives it back when the invocation ends (`end`), or hands it to this owner for good
// once the server confirmed (`confirm`). SAGA never reaches into the owner; a token affects only
// its own acquisition and `end` is idempotent.

type Phase = 'pending' | 'confirmed';

export class RowHolds {
  #next = 0;
  readonly #tokens = new Map<number, { readonly noteId: string; phase: Phase }>();

  constructor(private readonly changed: (pending: readonly string[], confirmed: readonly string[]) => void) {}

  begin(noteId: string): number {
    const token = (this.#next += 1);
    this.#tokens.set(token, { noteId, phase: 'pending' });
    this.#publish();
    return token;
  }

  /** Takes the token over for good: the invocation no longer releases it. */
  confirm(token: number): void {
    const entry = this.#tokens.get(token);
    if (entry) entry.phase = 'confirmed';
    this.#publish();
  }

  /** Gives an unconfirmed token back. A confirmed token, or one already given back, is left alone. */
  end(token: number): void {
    if (this.#tokens.get(token)?.phase === 'pending') this.#tokens.delete(token);
    this.#publish();
  }

  #publish(): void {
    const ids = (phase: Phase) => [...this.#tokens.values()].filter((entry) => entry.phase === phase).map((entry) => entry.noteId);
    this.changed(ids('pending'), ids('confirmed'));
  }
}
