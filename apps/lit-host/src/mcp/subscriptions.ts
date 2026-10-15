import { z } from 'zod';

// Contract shared by the subscriptions MCP server and the view. It imports only `zod`, so the
// browser bundle can use it without pulling in any server code.

export const SUBSCRIPTIONS_TOOL_NAME = 'list_subscriptions';
export const SUBSCRIPTIONS_VIEW_URI = 'ui://saga-a2ui/subscriptions-view.html';

/** Shown when the host reports that the user is not signed in. Carries no account data. */
export const SIGN_IN_REQUIRED_TEXT = 'Sign in to see your subscriptions.';

/** Tool failure: the read could not be completed. Safe to retry. Carries no backend detail. */
export const SUBSCRIPTIONS_UNAVAILABLE_TEXT = 'Subscriptions are unavailable.';

/** Tool failure: the known tool was called with business input it does not accept. */
export const INVALID_SUBSCRIPTION_INPUT_TEXT = 'That subscription request could not be read.';

/** Tool failure: the backend record could not be projected. Carries no field values. */
export const INVALID_OUTPUT_TEXT = 'The subscriptions result could not be shown.';

/** Successful read with nothing to list. Not a failure. */
export const EMPTY_SUBSCRIPTIONS_TEXT = 'No subscriptions.';

/**
 * Finite bounds for this browse pipeline. Each bound is enforced at the boundary that can
 * reject the work before it is copied further: request bytes before the handler, argument
 * size before the backend, projected items and strings before serialization, incoming
 * host state before the view renders it, and `readBoundMs` on the server callback itself.
 * A backend read that exceeds that bound is retired; a later resolution is not emitted.
 */
export const SUBSCRIPTION_LIMITS = {
  maxRequestBytes: 65_536,
  maxIncomingStateBytes: 32_768,
  maxArgumentString: 64,
  maxArgumentElements: 8,
  maxSubscriptions: 50,
  readBoundMs: 5_000,
} as const;

export const SUBSCRIPTION_STATUSES = ['active', 'paused', 'canceled'] as const;

/**
 * The account always comes from the verified request identity. `status`, when present, is an
 * optional filter the tool itself checks; any other argument (for example `accountId`) is
 * dropped by input validation and cannot select an account.
 */
export const SubscriptionsRequestShape = {
  status: z.string().max(SUBSCRIPTION_LIMITS.maxArgumentString).optional(),
};

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
