import { z } from 'zod';

// Contract shared by the subscriptions MCP server and the view. It imports only `zod`, so the
// browser bundle can use it without pulling in any server code.

export const SUBSCRIPTIONS_TOOL_NAME = 'list_subscriptions';
export const SUBSCRIPTIONS_VIEW_URI = 'ui://saga-a2ui/subscriptions-view.html';

/** Shown when the host reports that the user is not signed in. Carries no account data. */
export const SIGN_IN_REQUIRED_TEXT = 'Sign in to see your subscriptions.';

/**
 * The tool takes no arguments: the account always comes from the verified request identity.
 * Any argument a caller adds (for example `accountId`) is dropped by input validation.
 */
export const SubscriptionsRequestShape = {};

/**
 * Opaque label for one sign-in, minted by the server. It is derived with a server-held key, so
 * it reveals neither the credential nor the account. The view uses it only to tell whether the
 * data it holds still belongs to the sign-in it started with; it never authorizes anything.
 */
export const ViewSessionLabelSchema = z.string().regex(/^vs_[A-Za-z0-9_-]{22}$/);

export const SubscriptionSchema = z
  .object({
    subscriptionId: z.string().min(1).max(64),
    creator: z.string().min(1).max(120),
    tier: z.string().min(1).max(60),
    status: z.enum(['active', 'paused', 'canceled']),
  })
  .strict();

/** The only data published about a signed-in user's subscriptions. Bounded and strict. */
export const SubscriptionsResultSchema = z
  .object({
    displayName: z.string().min(1).max(80),
    subscriptions: z.array(SubscriptionSchema).max(50),
    viewSession: ViewSessionLabelSchema,
  })
  .strict();

export type Subscription = z.infer<typeof SubscriptionSchema>;
export type SubscriptionsResult = z.infer<typeof SubscriptionsResultSchema>;
