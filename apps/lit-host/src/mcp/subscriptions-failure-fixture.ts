import type {
  AccountSubscriptions,
  SubscriptionBackend,
} from './subscriptions-server.js';

/**
 * Synthetic failure cases for the browse pipeline. Nothing here is a credential or a real
 * account. Tests drive these through the listener and the view; the canary must never appear
 * on the wire or in the view.
 */
export const FAILURE_CANARY = 'canary-failure-secret';

export const BACKEND_FAILURE_MESSAGE = `backend status 503 ${FAILURE_CANARY}`;

export const emptyAccount = {
  displayName: 'Alice',
  subscriptions: [],
} satisfies AccountSubscriptions;

export const invalidOutputAccount = {
  displayName: 'Alice',
  subscriptions: [
    { subscriptionId: 's', creator: 'C', tier: 'T', status: FAILURE_CANARY },
  ],
} satisfies AccountSubscriptions;

export const listedAccount = {
  displayName: 'Alice',
  subscriptions: [
    {
      subscriptionId: 'sub-a1',
      creator: 'Creator One',
      tier: 'Gold',
      status: 'active',
    },
    {
      subscriptionId: 'sub-a2',
      creator: 'Creator Two',
      tier: 'Basic',
      status: 'paused',
    },
  ],
} satisfies AccountSubscriptions;

/** A known tool, a bounded string, and a value the business rule rejects. */
export const invalidBusinessArguments = { status: 'not-a-status' } as const;

export const unknownToolRequest = {
  jsonrpc: '2.0' as const,
  id: 'req-unknown-tool',
  method: 'tools/call',
  params: {
    name: 'list_subscriptions_admin',
    arguments: { note: FAILURE_CANARY },
  },
};

/** Valid JSON-RPC framing is missing, but an id is still present to correlate. */
export const malformedRequest = {
  id: 'req-malformed',
  method: 'tools/call',
  params: { name: 'list_subscriptions', arguments: { leak: FAILURE_CANARY } },
};

export function countingBackend(
  accounts: Readonly<Record<string, AccountSubscriptions | undefined>>,
  options?: { throwMessage?: string },
): SubscriptionBackend & { readonly lookups: string[] } {
  const lookups: string[] = [];
  return {
    lookups,
    async listSubscriptions(accountId) {
      lookups.push(accountId);
      if (options?.throwMessage) throw new Error(options.throwMessage);
      return accounts[accountId];
    },
  };
}
