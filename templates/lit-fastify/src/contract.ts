import { z } from 'zod';

// The wire contract shared by the server and the view. It imports only `zod`, so a view bundle that
// includes it carries no server code. Application-owned: nothing here is a SAGA export.

/** Public: the view shows that the service is running. Needs no credential. */
export const STATUS_TOOL = 'get_status';
/** Protected: the view shows the account the server verified for this request. */
export const ACCOUNT_TOOL = 'get_account';

export const StatusOutputSchema = z.strictObject({
  status: z.literal('running'),
});
export const AccountOutputSchema = z.strictObject({
  accountId: z.string().min(1).max(200),
});

/** Fixed sentences. A failure never repeats a backend message, an identifier or a credential. */
export const TEXT = {
  signInRequired: 'Sign in to see your account.',
  notAllowed: 'This account may not see this.',
  unavailable: 'This is unavailable right now.',
  invalidOutput: 'This could not be shown.',
  noAccount: 'There is no account to show.',
  noStatus: 'There is no status to show.',
} as const;

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * What the built page must contain for the server to serve it: the element the view renders into.
 * The server refuses to start with a page that lacks it, so a missing or wrong build fails early.
 */
export const VIEW_MARKER = '<starter-app';
