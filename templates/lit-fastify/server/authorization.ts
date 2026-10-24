import type { AccountIdentity } from './identity.js';

// APPLICATION-OWNED. saga a2ui verifies nothing about what an account may do: the server asks this
// function for every protected request, with that request's own identity. Replace the body with
// your policy (a database lookup, a role check). It receives a signal that aborts when the
// request's budget ends, so a slow lookup can stop.

/** The starter allows every signed-in account. That is a placeholder, not a policy. */
export async function mayViewAccount(
  _identity: AccountIdentity,
  _signal: AbortSignal,
): Promise<boolean> {
  return true;
}
