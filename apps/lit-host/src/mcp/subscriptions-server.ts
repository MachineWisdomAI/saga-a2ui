import { createHmac, randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import { CLOSED_VIEW_CSP } from '@saga-a2ui/mcp/policy';
import {
  registerProtectedOperation,
  type OperationOutcome,
  type RequestLifetime,
} from '@saga-a2ui/mcp/server';
import { identityFromAuthInfo } from './request-auth.js';
import {
  INVALID_OUTPUT_TEXT,
  INVALID_SUBSCRIPTION_INPUT_TEXT,
  SIGN_IN_REQUIRED_TEXT,
  SUBSCRIPTIONS_TOOL_NAME,
  SUBSCRIPTIONS_UNAVAILABLE_TEXT,
  SUBSCRIPTIONS_VIEW_URI,
  SubscriptionsRequestSchema,
  SubscriptionsResultSchema,
  isSubscriptionStatus,
} from './subscriptions.js';

/** What the application's backend knows about one subscription. Only four fields are published. */
export interface SubscriptionRecord {
  readonly subscriptionId: string;
  readonly creator: string;
  readonly tier: string;
  readonly status: string;
}

export interface AccountSubscriptions {
  readonly displayName: string;
  readonly subscriptions: readonly SubscriptionRecord[];
}

/** The application's data seam, keyed by the verified account. A real application calls its backend here. */
export interface SubscriptionBackend {
  /** `signal` aborts when the read is abandoned (its budget, the request's deadline or the caller). */
  listSubscriptions(
    accountId: string,
    signal: AbortSignal,
  ): Promise<AccountSubscriptions | undefined>;
}

/** Mints the opaque view-session label for a sign-in. */
export type ViewSessionLabeler = (signInId: string) => string;

/** Labels are an HMAC under a key that exists only in this process: not reversible, not guessable. */
export function createViewSessionLabeler(): ViewSessionLabeler {
  const key = randomBytes(32);
  return (signInId) =>
    `vs_${createHmac('sha256', key).update(signInId).digest().subarray(0, 16).toString('base64url')}`;
}

export interface SubscriptionsServerOptions {
  readonly viewHtml: string;
  readonly backend: SubscriptionBackend;
  readonly labelViewSession: ViewSessionLabeler;
  /**
   * This browse read's own limit: the per-operation override of the operation limit. Omitted, the
   * route's or SDK instance's operation limit applies (3,000 ms by default). It can be tighter or
   * looser than that limit, but never extends the request. Expiry or request cancellation retires
   * the read: the safe failure is the only result, and a later backend resolution is not returned.
   */
  readonly readBoundMs?: number;
  /** The request this server was built for, started by the listener at admission. */
  readonly lifetime: RequestLifetime;
}

/** The account's subscriptions as published for one request: already filtered, with the sign-in that read them. */
interface PublishedAccount {
  readonly account: AccountSubscriptions;
  readonly signInId: string;
}

/**
 * One read-only protected operation. The application decides which account the verified request
 * names (`identityFromAuthInfo`) and which subscriptions belong to it; the connector supplies the
 * per-request context, validates input and output and bounds the wait. The server holds no
 * current-user state, and no tool argument can name an account.
 */
export function createSubscriptionsServer(
  options: SubscriptionsServerOptions,
): McpServer {
  const server = new McpServer({
    name: 'saga-a2ui-subscriptions-demo',
    version: '0.0.0',
  });

  registerProtectedOperation(
    server,
    {
      name: SUBSCRIPTIONS_TOOL_NAME,
      title: 'List my subscriptions',
      description: 'Returns the signed-in user’s own subscriptions.',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      input: SubscriptionsRequestSchema,
      output: SubscriptionsResultSchema,
      view: {
        uri: SUBSCRIPTIONS_VIEW_URI,
        title: 'Subscriptions view',
        html: options.viewHtml,
        csp: CLOSED_VIEW_CSP,
      },
      ...(options.readBoundMs === undefined
        ? {}
        : { boundMs: options.readBoundMs }),
      failures: {
        absent: SUBSCRIPTIONS_UNAVAILABLE_TEXT,
        unavailable: SUBSCRIPTIONS_UNAVAILABLE_TEXT,
        invalidOutput: INVALID_OUTPUT_TEXT,
        signInRequired: SIGN_IN_REQUIRED_TEXT,
      },
      identity: identityFromAuthInfo,
      async handle(
        args,
        identity,
        request,
      ): Promise<OperationOutcome<PublishedAccount>> {
        if (args.status !== undefined && !isSubscriptionStatus(args.status)) {
          return { kind: 'refused', text: INVALID_SUBSCRIPTION_INPUT_TEXT };
        }
        const account = await request.within('storage', (signal) =>
          options.backend.listSubscriptions(identity.accountId, signal),
        );
        if (!account) return { kind: 'absent' };
        const published =
          args.status === undefined
            ? account
            : {
                displayName: account.displayName,
                subscriptions: account.subscriptions.filter(
                  (record) => record.status === args.status,
                ),
              };
        return {
          kind: 'record',
          record: { account: published, signInId: identity.signInId },
        };
      },
      // Each field is copied from the record explicitly (no spreading); the connector validates the
      // result against the strict output contract before anything is serialized.
      project: ({ account, signInId }) => ({
        text: `${account.displayName}: ${account.subscriptions.length} subscription(s)`,
        data: {
          displayName: account.displayName,
          subscriptions: account.subscriptions.map((record) => ({
            subscriptionId: record.subscriptionId,
            creator: record.creator,
            tier: record.tier,
            status: record.status,
          })),
          viewSession: options.labelViewSession(signInId),
        },
      }),
    },
    { lifetime: options.lifetime },
  );

  return server;
}
