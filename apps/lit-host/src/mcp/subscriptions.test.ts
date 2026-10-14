import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { startEpisodeListener, type EpisodeListener } from './listener.js';
import { createDevelopmentVerifier, DEV_ACCOUNTS, DEV_TOKENS } from './dev-auth.js';
import { SUBSCRIPTIONS_TOOL_NAME, SubscriptionsResultSchema } from './subscriptions.js';
import type { AccountSubscriptions, SubscriptionBackend } from './subscriptions-server.js';

// Everything here goes through the real listener over HTTP with real bearer credentials.

const VIEW_HTML = '<!doctype html><title>view</title>';

// Backend records carry canary fields that must never reach the wire.
const accounts: Readonly<Record<string, AccountSubscriptions>> = {
  [DEV_ACCOUNTS.alice]: {
    displayName: 'Alice',
    subscriptions: [
      { subscriptionId: 'sub-a1', creator: 'Creator One', tier: 'Gold', status: 'active', cardToken: 'canary-card-a1' } as never,
      { subscriptionId: 'sub-a2', creator: 'Creator Two', tier: 'Basic', status: 'paused' },
    ],
    email: 'canary-alice@example.invalid',
  } as AccountSubscriptions,
  [DEV_ACCOUNTS.bob]: {
    displayName: 'Bob',
    subscriptions: [{ subscriptionId: 'sub-b1', creator: 'Creator Three', tier: 'Silver', status: 'active' }],
    email: 'canary-bob@example.invalid',
  } as AccountSubscriptions,
};

interface Harness {
  readonly listener: EpisodeListener;
  readonly lookups: string[];
  connect(token: string): Promise<Client>;
}

const cleanup: { listener?: EpisodeListener; clients: Client[] } = { clients: [] };

async function harness(backendAccounts: Readonly<Record<string, unknown>> = accounts): Promise<Harness> {
  const lookups: string[] = [];
  const backend: SubscriptionBackend = {
    async listSubscriptions(accountId) {
      lookups.push(accountId);
      return backendAccounts[accountId] as AccountSubscriptions | undefined;
    },
  };
  const listener = await startEpisodeListener({
    viewHtml: VIEW_HTML,
    catalog: { find: () => undefined },
    port: 0,
    subscriptions: { viewHtml: VIEW_HTML, backend, verifier: createDevelopmentVerifier() },
  });
  cleanup.listener = listener;
  return {
    listener,
    lookups,
    async connect(token) {
      const client = new Client({ name: 'test-client', version: '0.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(listener.subscriptionsUrl ?? ''), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
        }),
      );
      cleanup.clients.push(client);
      return client;
    },
  };
}

afterEach(async () => {
  await Promise.all(cleanup.clients.splice(0).map((client) => client.close().catch(() => undefined)));
  await cleanup.listener?.close();
  cleanup.listener = undefined;
});

const list = (client: Client, args: Record<string, unknown> = {}) =>
  client.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: args });

describe('subscriptions for the verified request identity', () => {
  it('returns only the signed-in user’s subscriptions and no private fields', async () => {
    const h = await harness();
    const result = await list(await h.connect(DEV_TOKENS.alice));
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      displayName: 'Alice',
      subscriptions: [
        { subscriptionId: 'sub-a1', creator: 'Creator One', tier: 'Gold', status: 'active' },
        { subscriptionId: 'sub-a2', creator: 'Creator Two', tier: 'Basic', status: 'paused' },
      ],
    });
    const wire = JSON.stringify(result);
    expect(wire).not.toContain('canary');
    expect(wire).not.toContain('Creator Three');
    expect(Object.keys(result.structuredContent ?? {}).sort()).toEqual(['displayName', 'subscriptions', 'viewSession']);
  });

  it('keeps concurrent users apart', async () => {
    const h = await harness();
    const [alice, bob] = await Promise.all([h.connect(DEV_TOKENS.alice), h.connect(DEV_TOKENS.bob)]);
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) => list(index % 2 === 0 ? alice : bob)),
    );
    results.forEach((result, index) => {
      const wire = JSON.stringify(result);
      expect(wire).toContain(index % 2 === 0 ? 'Creator One' : 'Creator Three');
      expect(wire).not.toContain(index % 2 === 0 ? 'Creator Three' : 'Creator One');
    });
  });

  it('ignores an account id forged in the tool arguments', async () => {
    const h = await harness();
    const result = await list(await h.connect(DEV_TOKENS.alice), { accountId: DEV_ACCOUNTS.bob });
    expect(JSON.stringify(result)).toContain('Creator One');
    expect(JSON.stringify(result)).not.toContain('Creator Three');
    expect(h.lookups).toEqual([DEV_ACCOUNTS.alice]);
  });

  it('labels the view session with an opaque value that is not the credential or account', async () => {
    const h = await harness();
    const alice = await h.connect(DEV_TOKENS.alice);
    const bob = await h.connect(DEV_TOKENS.bob);
    const labelOf = async (client: Client) => SubscriptionsResultSchema.parse((await list(client)).structuredContent).viewSession;
    const label = await labelOf(alice);
    expect(label).toMatch(/^vs_[A-Za-z0-9_-]{22}$/);
    expect(label).not.toContain(DEV_TOKENS.alice);
    expect(label).not.toContain(DEV_ACCOUNTS.alice);
    expect(await labelOf(alice)).toBe(label); // stable within a sign-in
    expect(await labelOf(bob)).not.toBe(label);
  });

  it('fails closed without leaking when the backend returns data that breaks the contract', async () => {
    const h = await harness({
      [DEV_ACCOUNTS.alice]: {
        displayName: 'Alice',
        subscriptions: [{ subscriptionId: 's', creator: 'C', tier: 'T', status: 'canary-unsupported-status' }],
      },
    });
    const result = await list(await h.connect(DEV_TOKENS.alice));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('canary');
  });

  it('reports an account unknown to the backend as an error without data', async () => {
    const h = await harness({});
    const result = await list(await h.connect(DEV_TOKENS.alice));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('protected endpoint credentials', () => {
  const post = (url: string, authorization?: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(authorization === undefined ? {} : { authorization }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} },
      }),
    });

  it.each([
    ['a missing credential', undefined, /^Bearer realm="saga-a2ui-subscriptions"$/],
    ['a non-bearer scheme', 'Basic abc', /error="invalid_token"/],
    ['a malformed bearer value', 'Bearer not a token', /error="invalid_token"/],
    ['an unknown token', 'Bearer dev-token-nobody', /error="invalid_token"/],
    ['an expired token', `Bearer ${DEV_TOKENS.expired}`, /error="invalid_token".*expired/],
  ])('rejects %s with 401 and a challenge before any backend work', async (_name, header, challenge) => {
    const h = await harness();
    const response = await post(h.listener.subscriptionsUrl ?? '', header);
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toMatch(challenge);
    expect(await response.text()).not.toContain('Creator');
    expect(h.lookups).toEqual([]);
  });

  it('rejects a service-only credential with 403 insufficient_scope before any backend work', async () => {
    const h = await harness();
    const response = await post(h.listener.subscriptionsUrl ?? '', `Bearer ${DEV_TOKENS.service}`);
    expect(response.status).toBe(403);
    expect(response.headers.get('www-authenticate')).toMatch(/error="insufficient_scope"/);
    expect(h.lookups).toEqual([]);
  });

  it('protects tool discovery and the view resource too', async () => {
    const h = await harness();
    const response = await fetch(h.listener.subscriptionsUrl ?? '', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
  });

  it('does not expose the protected path unless the application configured it', async () => {
    const listener = await startEpisodeListener({ viewHtml: VIEW_HTML, catalog: { find: () => undefined }, port: 0 });
    cleanup.listener = listener;
    expect(listener.subscriptionsUrl).toBeUndefined();
    const response = await post(new URL('/subscriptions/mcp', listener.url).href, `Bearer ${DEV_TOKENS.alice}`);
    expect(response.status).toBe(404);
  });
});

describe('development-only verifier', () => {
  it('refuses to be constructed in a production environment', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => createDevelopmentVerifier()).toThrow(/development/i);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
