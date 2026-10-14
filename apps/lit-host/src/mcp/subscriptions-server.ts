import { createHmac, randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { identityFromAuthInfo } from './request-auth.js';
import {
  SIGN_IN_REQUIRED_TEXT,
  SUBSCRIPTIONS_TOOL_NAME,
  SUBSCRIPTIONS_VIEW_URI,
  SubscriptionsRequestShape,
  SubscriptionsResultSchema,
  type SubscriptionsResult,
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
  listSubscriptions(accountId: string): Promise<AccountSubscriptions | undefined>;
}

/** Mints the opaque view-session label for a sign-in. */
export type ViewSessionLabeler = (signInId: string) => string;

/** Labels are an HMAC under a key that exists only in this process: not reversible, not guessable. */
export function createViewSessionLabeler(): ViewSessionLabeler {
  const key = randomBytes(32);
  return (signInId) => `vs_${createHmac('sha256', key).update(signInId).digest().subarray(0, 16).toString('base64url')}`;
}

export interface SubscriptionsServerOptions {
  readonly viewHtml: string;
  readonly backend: SubscriptionBackend;
  readonly labelViewSession: ViewSessionLabeler;
}

const VIEW_CSP = { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] } as const;

/**
 * Builds each field from the record explicitly (no spreading), then validates the result.
 * A record with an unsupported value fails here, before anything is serialized.
 */
function toSubscriptionsResult(account: AccountSubscriptions, viewSession: string): SubscriptionsResult {
  return SubscriptionsResultSchema.parse({
    displayName: account.displayName,
    subscriptions: account.subscriptions.map((record) => ({
      subscriptionId: record.subscriptionId,
      creator: record.creator,
      tier: record.tier,
      status: record.status,
    })),
    viewSession,
  });
}

const failure = (text: string) => ({ isError: true as const, content: [{ type: 'text' as const, text }] });

/**
 * One read-only tool whose identity is the SDK's per-request verified auth context
 * (`extra.authInfo`), read inside each invocation. The server holds no current-user state, and
 * no tool argument can name an account.
 */
export function createSubscriptionsServer(options: SubscriptionsServerOptions): McpServer {
  const server = new McpServer({ name: 'saga-a2ui-subscriptions-demo', version: '0.0.0' });

  registerAppTool(
    server,
    SUBSCRIPTIONS_TOOL_NAME,
    {
      title: 'List my subscriptions',
      description: 'Returns the signed-in user’s own subscriptions.',
      inputSchema: SubscriptionsRequestShape,
      outputSchema: SubscriptionsResultSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: SUBSCRIPTIONS_VIEW_URI } },
    },
    async (_args, extra) => {
      const identity = identityFromAuthInfo(extra.authInfo);
      if (!identity) return failure(SIGN_IN_REQUIRED_TEXT);
      try {
        const account = await options.backend.listSubscriptions(identity.accountId);
        if (!account) return failure('No subscriptions are available for this account.');
        const result = toSubscriptionsResult(account, options.labelViewSession(identity.signInId));
        return {
          content: [{ type: 'text', text: `${result.displayName}: ${result.subscriptions.length} subscription(s)` }],
          structuredContent: result,
        };
      } catch {
        // The failure text deliberately omits backend detail and validation messages.
        return failure('Subscriptions are unavailable.');
      }
    },
  );

  registerAppResource(server, 'Subscriptions view', SUBSCRIPTIONS_VIEW_URI, {}, async () => ({
    contents: [
      { uri: SUBSCRIPTIONS_VIEW_URI, mimeType: RESOURCE_MIME_TYPE, text: options.viewHtml, _meta: { ui: { csp: VIEW_CSP } } },
    ],
  }));

  return server;
}
