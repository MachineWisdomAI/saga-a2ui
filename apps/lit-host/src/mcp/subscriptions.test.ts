import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { startEpisodeListener, type EpisodeListener } from './listener.js';
import { createDevelopmentVerifier, DEV_ACCOUNTS, DEV_TOKENS } from './dev-auth.js';
import {
  INVALID_OUTPUT_TEXT,
  INVALID_SUBSCRIPTION_INPUT_TEXT,
  SUBSCRIPTION_LIMITS,
  SUBSCRIPTIONS_TOOL_NAME,
  SUBSCRIPTIONS_UNAVAILABLE_TEXT,
  SubscriptionsResultSchema,
} from './subscriptions.js';
import {
  BACKEND_FAILURE_MESSAGE,
  FAILURE_CANARY,
  emptyAccount,
  invalidBusinessArguments,
  invalidOutputAccount,
  malformedRequest,
  unknownToolRequest,
} from './subscriptions-failure-fixture.js';
import { SUBSCRIPTIONS_SCOPE } from './request-auth.js';
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

describe('identity is immutable per request', () => {
  // A verifier is free to reuse one `AuthInfo` object across calls — a cached token record, for
  // example. The identity accepted for a request must survive that: the transport reads `req.auth`
  // only after the body arrives, so a retained verifier object would let a later request's claims
  // decide an earlier request's user. Reproduced over the real listener with a paused request.
  it('keeps each request bound to the identity its verifier accepted for it', async () => {
    const reused: AuthInfo = {
      token: 'reused',
      clientId: 'shared-client',
      scopes: [SUBSCRIPTIONS_SCOPE],
      expiresAt: Date.now() / 1000 + 3600,
      extra: { accountId: DEV_ACCOUNTS.alice, signInId: 'sign-in-alice' },
    };
    const lookups: string[] = [];
    const listener = await startEpisodeListener({
      viewHtml: VIEW_HTML,
      catalog: { find: () => undefined },
      port: 0,
      subscriptions: {
        viewHtml: VIEW_HTML,
        backend: {
          async listSubscriptions(accountId) {
            lookups.push(accountId);
            return accounts[accountId] as AccountSubscriptions | undefined;
          },
        },
        verifier: {
          async verifyAccessToken(token) {
            const account = token === 'alice-token' ? DEV_ACCOUNTS.alice : token === 'bob-token' ? DEV_ACCOUNTS.bob : undefined;
            if (!account) throw new InvalidTokenError('Unknown credential');
            reused.extra = { accountId: account, signInId: `sign-in-${account}` };
            return reused;
          },
        },
      },
    });
    cleanup.listener = listener;

    const url = new URL(listener.subscriptionsUrl ?? '');
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} },
    });
    // A request the test can pause: headers and part of the body go out first, the rest later.
    const send = (token: string) => {
      let settle!: (value: { status: number; text: string }) => void;
      const done = new Promise<{ status: number; text: string }>((resolve) => {
        settle = resolve;
      });
      const req = request(
        {
          host: url.hostname,
          port: Number(url.port),
          path: url.pathname,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
            'content-length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            text += chunk;
          });
          res.on('end', () => settle({ status: res.statusCode ?? 0, text }));
        },
      );
      return { req, done };
    };

    // Alice's headers and first body byte: the server authenticates her and waits for the rest.
    const alice = send('alice-token');
    alice.req.write(body.slice(0, 1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Bob's request completes while Alice's body is still paused; the shared verifier object now
    // names Bob. Alice's call must still read Alice's account.
    const bob = send('bob-token');
    bob.req.end(body);
    const bobResponse = await bob.done;
    alice.req.end(body.slice(1));
    const aliceResponse = await alice.done;

    expect(bobResponse.status).toBe(200);
    expect(aliceResponse.status).toBe(200);
    expect(JSON.parse(aliceResponse.text).result.structuredContent.displayName).toBe('Alice');
    expect(JSON.parse(bobResponse.text).result.structuredContent.displayName).toBe('Bob');
    expect([...lookups].sort()).toEqual([DEV_ACCOUNTS.alice, DEV_ACCOUNTS.bob].sort());
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

describe('subscription request failures', () => {
  const post = (
    url: string,
    body: string,
    headers: Record<string, string> = {},
    token: string = DEV_TOKENS.alice,
  ) =>
    fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body,
    });

  const toolCall = (id: string | number, name: string, args: Record<string, unknown> = {}) =>
    JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

  it('returns an empty list as a successful read, not an error', async () => {
    const h = await harness({ [DEV_ACCOUNTS.alice]: emptyAccount });
    const result = await list(await h.connect(DEV_TOKENS.alice));
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ displayName: 'Alice', subscriptions: [] });
    expect(JSON.stringify(result)).not.toContain(FAILURE_CANARY);
  });

  it('rejects invalid business input for the known tool before any backend work', async () => {
    const h = await harness();
    const result = await list(await h.connect(DEV_TOKENS.alice), { ...invalidBusinessArguments });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(INVALID_SUBSCRIPTION_INPUT_TEXT);
    expect(JSON.stringify(result)).not.toContain(invalidBusinessArguments.status);
    expect(JSON.stringify(result)).not.toContain(FAILURE_CANARY);
    expect(result.structuredContent).toBeUndefined();
    expect(h.lookups).toEqual([]);
  });

  it('answers an unknown tool with a correlated JSON-RPC error and does not run the handler', async () => {
    const h = await harness();
    const response = await post(h.listener.subscriptionsUrl ?? '', JSON.stringify(unknownToolRequest));
    const body = await response.json() as { id?: unknown; error?: { code?: number; message?: string }; result?: unknown };
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(body.id).toBe(unknownToolRequest.id);
    expect(body.result).toBeUndefined();
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toBe('Unknown tool');
    expect(JSON.stringify(body)).not.toContain(FAILURE_CANARY);
    expect(JSON.stringify(body)).not.toContain(unknownToolRequest.params.name);
    expect(h.lookups).toEqual([]);
  });

  it('answers a malformed MCP call with a correlated JSON-RPC error, not an HTTP auth failure', async () => {
    const h = await harness();
    const response = await post(h.listener.subscriptionsUrl ?? '', JSON.stringify(malformedRequest));
    const body = await response.json() as { jsonrpc?: string; id?: unknown; error?: { code?: number; message?: string }; result?: unknown };
    expect(response.status).toBe(400);
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(malformedRequest.id);
    expect(body.result).toBeUndefined();
    expect(body.error?.code).toBe(-32600);
    expect(body.error?.message).toBe('Invalid request');
    expect(JSON.stringify(body)).not.toContain(FAILURE_CANARY);
    expect(h.lookups).toEqual([]);
  });

  it('answers invalid JSON with a parse error that cannot be correlated, and not a tool result', async () => {
    const h = await harness();
    const response = await post(h.listener.subscriptionsUrl ?? '', `{${FAILURE_CANARY}`);
    const body = await response.json() as { id?: unknown; error?: { code?: number }; result?: unknown };
    expect(response.status).toBe(400);
    expect(body.id).toBeNull();
    expect(body.error?.code).toBe(-32700);
    expect(body.result).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(FAILURE_CANARY);
    expect(h.lookups).toEqual([]);
  });

  it('keeps HTTP authorization separate from those protocol failures', async () => {
    const h = await harness();
    const response = await post(h.listener.subscriptionsUrl ?? '', toolCall(9, SUBSCRIPTIONS_TOOL_NAME), {}, '');
    // empty token is still an Authorization header; use a missing header instead
    const missing = await fetch(h.listener.subscriptionsUrl ?? '', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: toolCall(9, SUBSCRIPTIONS_TOOL_NAME),
    });
    expect(response.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toMatch(/^Bearer /);
    const body = await missing.json() as { error?: string; jsonrpc?: string; result?: unknown };
    expect(body.error).toBe('missing_token');
    expect(body.jsonrpc).toBeUndefined();
    expect(body.result).toBeUndefined();
    expect(h.lookups).toEqual([]);
  });

  it('rejects an oversized body at the transport boundary before any handler work', async () => {
    const h = await harness();
    const response = await post(
      h.listener.subscriptionsUrl ?? '',
      'x'.repeat(SUBSCRIPTION_LIMITS.maxRequestBytes + 1),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('www-authenticate')).toBeNull();
    const body = await response.json() as { error?: string; jsonrpc?: string; result?: unknown };
    expect(body.error).toBe('payload_too_large');
    expect(body.jsonrpc).toBeUndefined();
    expect(body.result).toBeUndefined();
    expect(h.lookups).toEqual([]);
  });

  it('rejects a missing Accept header as transport, not as a tool error', async () => {
    const h = await harness();
    const response = await fetch(h.listener.subscriptionsUrl ?? '', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${DEV_TOKENS.alice}`,
        'content-type': 'application/json',
      },
      body: toolCall(3, SUBSCRIPTIONS_TOOL_NAME),
    });
    expect(response.status).toBe(406);
    expect(response.headers.get('www-authenticate')).toBeNull();
    const body = await response.json() as { error?: string; jsonrpc?: string };
    expect(body.error).toBe('not_acceptable');
    expect(body.jsonrpc).toBeUndefined();
    expect(h.lookups).toEqual([]);
  });

  it('does not forward a backend failure message or status', async () => {
    const lookups: string[] = [];
    const listener = await startEpisodeListener({
      viewHtml: VIEW_HTML,
      catalog: { find: () => undefined },
      port: 0,
      subscriptions: {
        viewHtml: VIEW_HTML,
        verifier: createDevelopmentVerifier(),
        backend: {
          async listSubscriptions(accountId) {
            lookups.push(accountId);
            throw new Error(BACKEND_FAILURE_MESSAGE);
          },
        },
      },
    });
    cleanup.listener = listener;
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(listener.subscriptionsUrl ?? ''), {
        requestInit: { headers: { authorization: `Bearer ${DEV_TOKENS.alice}` } },
      }),
    );
    cleanup.clients.push(client);
    const result = await client.callTool({ name: SUBSCRIPTIONS_TOOL_NAME, arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(SUBSCRIPTIONS_UNAVAILABLE_TEXT);
    expect(JSON.stringify(result)).not.toContain(FAILURE_CANARY);
    expect(JSON.stringify(result)).not.toContain('503');
    expect(JSON.stringify(result)).not.toContain('backend status');
    expect(result.structuredContent).toBeUndefined();
    expect(lookups).toEqual([DEV_ACCOUNTS.alice]);
  });

  it('filters a valid status without returning other rows', async () => {
    const h = await harness();
    const result = await list(await h.connect(DEV_TOKENS.alice), { status: 'paused' });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      displayName: 'Alice',
      subscriptions: [{ subscriptionId: 'sub-a2', creator: 'Creator Two', tier: 'Basic', status: 'paused' }],
    });
    expect(JSON.stringify(result)).not.toContain('Creator One');
  });

  it('rejects an argument string over the input limit before any backend work', async () => {
    const h = await harness();
    const response = await post(
      h.listener.subscriptionsUrl ?? '',
      toolCall(11, SUBSCRIPTIONS_TOOL_NAME, { status: 'x'.repeat(SUBSCRIPTION_LIMITS.maxArgumentString + 1) }),
    );
    const body = await response.json() as { id?: unknown; error?: { code?: number; message?: string }; result?: unknown };
    expect(response.status).toBe(200);
    expect(body.id).toBe(11);
    expect(body.result).toBeUndefined();
    expect(body.error?.code).toBe(-32602);
    expect(body.error?.message).toBe('Invalid params');
    expect(JSON.stringify(body)).not.toContain('x'.repeat(SUBSCRIPTION_LIMITS.maxArgumentString + 1));
    expect(h.lookups).toEqual([]);
  });

  it('rejects a result with too many items at projection and does not publish them', async () => {
    const overflow = {
      displayName: 'Alice',
      subscriptions: Array.from({ length: SUBSCRIPTION_LIMITS.maxSubscriptions + 1 }, (_, index) => ({
        subscriptionId: `sub-${index}`,
        creator: index === 50 ? FAILURE_CANARY : 'Creator',
        tier: 'Gold',
        status: 'active',
      })),
    };
    const h = await harness({ [DEV_ACCOUNTS.alice]: overflow });
    const result = await list(await h.connect(DEV_TOKENS.alice));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(INVALID_OUTPUT_TEXT);
    expect(JSON.stringify(result)).not.toContain(FAILURE_CANARY);
    expect(result.structuredContent).toBeUndefined();
  });

  it('does not forward invalid projected output or the validator message', async () => {
    const h = await harness({ [DEV_ACCOUNTS.alice]: invalidOutputAccount });
    const result = await list(await h.connect(DEV_TOKENS.alice));
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain(INVALID_OUTPUT_TEXT);
    expect(JSON.stringify(result)).not.toContain(FAILURE_CANARY);
    expect(result.structuredContent).toBeUndefined();
  });
});
